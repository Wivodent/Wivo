/**
 * The visitor's IP, from a header the visitor cannot write (2.2.5,
 * docs/SECURITY-REVIEW-2026-11.md E1).
 *
 * Before 2.2.5 the rate limits took the FIRST value of X-Forwarded-For. A
 * caller writes that value itself: proxies append to the header, they do not
 * replace it. A script sending a new made-up address with each request was
 * never limited, and could fill a clinic's inbox.
 *
 * In order:
 *   1. CF-Connecting-IP: Supabase's edge sits behind Cloudflare, which sets
 *      this header itself and overwrites whatever the caller sent.
 *   2. The LAST value of X-Forwarded-For: the one the nearest proxy (the
 *      platform's) appended. Earlier values are the caller's own words.
 *   3. 'unknown': every such caller shares one bucket, the safe direction.
 *
 * Pure, so it is tested without Deno (clientIp.test.ts).
 */
export function clientIp(headers: { get(name: string): string | null }): string {
  const cf = headers.get('cf-connecting-ip')?.trim()
  if (cf) return cf
  const hops = (headers.get('x-forwarded-for') ?? '').split(',').map(s => s.trim()).filter(Boolean)
  if (hops.length > 0) return hops[hops.length - 1]
  return 'unknown'
}
