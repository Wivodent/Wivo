/**
 * `team-account` set_password (2.2.5, sql/135): the database decides, then the
 * service key sets the password, then the audit entry and the sign-out. The
 * password never reaches a log.
 */
import { describe, it, expect, vi } from 'vitest'
import { handleTeamRequest, parseTeamRequest, type TeamAccountDeps } from './teamAccount'

const b64url = (o: object) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const jwt = (payload: object) => `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.c2lnbmF0dXJl`
const NOW = 1_800_000_000_000
const ME = '11111111-1111-4111-8111-111111111111'
const WORKER = '33333333-3333-4333-8333-333333333333'
const ORG = '44444444-4444-4444-8444-444444444444'
const AUTH = `Bearer ${jwt({ sub: ME, role: 'authenticated', aal: 'aal2', exp: NOW / 1000 + 600 })}`
const PASSWORD = 'correct-horse-battery'

function setup(o: { refuse?: { message: string; code?: string; hint?: string }; setError?: string; completeError?: boolean } = {}) {
  const order: string[] = []
  const warn = vi.fn()
  const deps: TeamAccountDeps = {
    asUser: async (fn, args) => {
      order.push(`user:${fn}`)
      if (fn !== 'authorize_password_set') return { data: null, error: { message: 'unexpected' } }
      if (o.refuse) return { data: null, error: o.refuse }
      return { data: { ok: true, org_id: ORG, actor_id: ME, user_id: args.p_user }, error: null }
    },
    asService: async (fn, args) => {
      order.push(`service:${fn}:${JSON.stringify(args)}`)
      return o.completeError ? { data: null, error: { message: 'boom' } } : { data: null, error: null }
    },
    setPassword: async (userId) => { order.push(`set:${userId}`); return { error: o.setError ?? null } },
    hasMfa: async () => true,
    callerClinic: async () => null,
    generateLink: async () => ({ hashedToken: null, userId: null, error: 'unused' }),
    createUser: async () => ({ userId: null, error: 'unused' }),
    userEmail: async () => null,
    sendMail: async () => ({ ok: true }),
    env: () => undefined,
    warn,
    now: () => NOW,
  }
  return { deps, order, warn }
}
const ask = (deps: TeamAccountDeps, body: object = { action: 'set_password', userId: WORKER, password: PASSWORD }) =>
  handleTeamRequest(AUTH, body, deps)

describe('set_password', () => {
  it('authorised, then set, then the audit entry and the sign-out, in that order', async () => {
    const { deps, order } = setup()
    expect(await ask(deps)).toEqual({ status: 200, body: { ok: true, userId: WORKER } })
    expect(order).toEqual([
      'user:authorize_password_set',
      `set:${WORKER}`,
      `service:complete_password_set:${JSON.stringify({ p_org: ORG, p_actor: ME, p_target: WORKER })}`,
    ])
  })

  it('the database says no: nothing is set', async () => {
    for (const [refuse, error] of [
      [{ message: 'Enter a code', code: '42501', hint: 'fresh_code' }, 'fresh_code'],
      [{ message: 'Only the owner', code: '42501' }, 'not_allowed'],
      [{ message: 'Sign in with your second factor', code: '42501', hint: 'mfa_required' }, 'mfa_required'],
    ] as const) {
      const { deps, order } = setup({ refuse })
      expect((await ask(deps)).body).toEqual({ ok: false, error })
      expect(order).toEqual(['user:authorize_password_set'])
    }
  })

  it('a short password is refused before anything is asked', async () => {
    expect(parseTeamRequest({ action: 'set_password', userId: WORKER, password: 'short' })).toBeNull()
    const { deps, order } = setup()
    expect((await ask(deps, { action: 'set_password', userId: WORKER, password: 'short' })).status).toBe(400)
    expect(order).toEqual([])
  })

  it('a failure after the password is set is said, with whose; the password is in no log', async () => {
    const { deps, warn } = setup({ completeError: true })
    expect(await ask(deps)).toEqual({ status: 502, body: { ok: false, error: 'failed', userId: WORKER } })
    const weak = setup({ setError: '422 Password should be at least 12 characters' })
    expect((await ask(weak.deps)).body).toEqual({ ok: false, error: 'weak_password' })
    for (const call of [...warn.mock.calls, ...weak.warn.mock.calls]) expect(String(call[0])).not.toContain(PASSWORD)
  })
})
