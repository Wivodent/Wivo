/**
 * 2.2.5 (docs/SECURITY-REVIEW-2026-11.md E1, E2): the booking function's IP
 * comes from a header the caller cannot write, Turnstile is checked with the
 * clinic's secret, and nothing a database refused reaches a log whole.
 */
import { describe, it, expect, vi } from 'vitest'
import { clientIp } from './clientIp'
import { verifyTurnstile, originHostnames } from './turnstile'
import { safeReturnUrl } from './returnUrl'
import { scrubDbDetail, scrubPersonalData } from '../../../shared/privacy/scrub'

const h = (o: Record<string, string>) => ({ get: (k: string) => o[k.toLowerCase()] ?? null })

describe('clientIp: never the caller\'s own X-Forwarded-For', () => {
  it('Cloudflare\'s CF-Connecting-IP wins over anything in X-Forwarded-For', () => {
    expect(clientIp(h({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '1.2.3.4, 203.0.113.7' }))).toBe('203.0.113.7')
  })

  it('a made-up first value is ignored: the last hop is the platform\'s', () => {
    const forged = ['9.9.9.1', '9.9.9.2', '9.9.9.3'].map(fake => clientIp(h({ 'x-forwarded-for': `${fake}, 198.51.100.4` })))
    expect(new Set(forged)).toEqual(new Set(['198.51.100.4']))
  })

  it('nothing to go by: everybody shares one bucket', () => {
    expect(clientIp(h({}))).toBe('unknown')
    expect(clientIp(h({ 'x-forwarded-for': ' , ' }))).toBe('unknown')
  })
})

describe('verifyTurnstile', () => {
  const answer = (body: object, ok = true) => vi.fn(async () => new Response(JSON.stringify(body), { status: ok ? 200 : 500 }))

  it('a passed check from an allowed host: ok, with the secret, the token and the IP sent', async () => {
    const fetch = answer({ success: true, hostname: 'dentiks.lv' })
    expect(await verifyTurnstile({ secret: 's3cret', token: 'tok', ip: '203.0.113.7', hostnames: ['dentiks.lv'], fetch }))
      .toEqual({ ok: true })
    const sent = (fetch.mock.calls[0] as unknown as [string, { body: URLSearchParams }])[1].body
    expect([sent.get('secret'), sent.get('response'), sent.get('remoteip')]).toEqual(['s3cret', 'tok', '203.0.113.7'])
  })

  it('no token, a refused one, another site\'s, or Cloudflare unreachable: not ok, and why', async () => {
    expect(await verifyTurnstile({ secret: 's', token: undefined, ip: 'x' })).toEqual({ ok: false, reason: 'missing_token' })
    expect(await verifyTurnstile({ secret: 's', token: 't', ip: 'x', fetch: answer({ success: false }) })).toEqual({ ok: false, reason: 'refused' })
    expect(await verifyTurnstile({ secret: 's', token: 't', ip: 'x', hostnames: ['dentiks.lv'], fetch: answer({ success: true, hostname: 'evil.example' }) }))
      .toEqual({ ok: false, reason: 'wrong_host' })
    expect(await verifyTurnstile({ secret: 's', token: 't', ip: 'x', fetch: answer({}, false) })).toEqual({ ok: false, reason: 'unreachable' })
    const down = vi.fn(async () => { throw new Error('dns') })
    expect(await verifyTurnstile({ secret: 's', token: 't', ip: 'x', fetch: down as unknown as typeof fetch })).toEqual({ ok: false, reason: 'unreachable' })
  })

  it('the allowed hostnames come from the origins', () => {
    expect(originHostnames(['https://dentiks.lv', 'https://www.dentiks.lv', 'nonsense'])).toEqual(['dentiks.lv', 'www.dentiks.lv'])
  })
})

describe('a refused row never reaches a log or Sentry whole', () => {
  it('the values go, the column names stay', () => {
    expect(scrubDbDetail('new row for relation "visit_requests" violates check constraint "x"\nFailing row contains (5f1, Mari (Jr) Maasikas, +372 5551234, null).'))
      .toBe('new row for relation "visit_requests" violates check constraint "x"\nFailing row contains (…).')
    expect(scrubDbDetail('duplicate key value violates unique constraint "p_key" Key (patsient, clinic_id)=(Mari Maasikas, 9a) already exists.'))
      .toBe('duplicate key value violates unique constraint "p_key" Key (patsient, clinic_id)=(…) already exists.')
    expect(scrubDbDetail('DETAIL: Key (email)=(mari@x.ee) is still referenced')).toBe('DETAIL: …')
    expect(scrubPersonalData('Failing row contains (Mari, mari@x.ee)')).toBe('Failing row contains (…)')
  })
})

describe('the return page links only to an https address (E3)', () => {
  it('https kept; javascript:, data:, http: and nonsense give no link', () => {
    expect(safeReturnUrl(' https://dentiks.lv/aitah ')).toBe('https://dentiks.lv/aitah')
    for (const v of ['javascript:alert(1)', 'data:text/html,<script>x</script>', 'http://dentiks.lv', 'dentiks.lv', '', null, 5])
      expect(safeReturnUrl(v), String(v)).toBeNull()
  })
})
