/**
 * This clinic's Wivo Network directory entry: the owner shows or hides the
 * clinic in the directory and sees its invite link (Orders → Wivo Network).
 * The work and the order of the checks are in ../_shared/networkDirectory.ts
 * (tested): the second factor and the owner, decided by the database AS THE
 * USER, and only then the clinic's own key signs a request for the Network.
 *
 * Secrets (docs/NETWORK-SETUP.md, B5; set with --env-file, never typed):
 *   NETWORK_CLINIC_KEY  this clinic's Ed25519 private key (PKCS#8, base64url)
 *                       from network/scripts/make-clinic-key.mjs
 *   NETWORK_URL         https://<NETWORK_REF>.supabase.co
 *
 * Deploy: `npx supabase functions deploy network-directory --project-ref <ref>`.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import { sessionHasMfa } from '../_shared/requireMfa.ts'
import { APP_ALLOWED_HEADERS, callerVersionHeaders } from '../_shared/appVersion.ts'
import { handleNetworkDirectory, type OwnerSettings } from '../_shared/networkDirectory.ts'
import { importClinicSigningKey } from '../_shared/generated/clinicRequest.ts'

const env = (name: string) => Deno.env.get(name)
const URL_ = env('SUPABASE_URL') ?? ''
const ANON = env('SUPABASE_ANON_KEY') ?? ''
const noSession = { persistSession: false, autoRefreshToken: false }
const rawKey = (env('NETWORK_CLINIC_KEY') ?? '').trim()
const keyPromise: Promise<CryptoKey | null> = rawKey ? importClinicSigningKey(rawKey).catch(() => null) : Promise.resolve(null)

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': APP_ALLOWED_HEADERS,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json(405, { error: 'bad_request' })
  const auth = req.headers.get('Authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return json(401, { error: 'sign in first' })

  let body: unknown = null
  try { body = await req.json() } catch { /* bad request below */ }

  const asUser = createClient(URL_, ANON, {
    global: { headers: { Authorization: auth, ...callerVersionHeaders(req) } },
    auth: noSession,
  })
  const answer = await handleNetworkDirectory(body, {
    hasMfa: () => sessionHasMfa(fn => asUser.rpc(fn)),
    ownerSettings: async () => {
      const { data, error } = await asUser.from('network_settings').select('enabled, network_clinic_id').limit(1)
      return error || !Array.isArray(data) || data.length !== 1 ? null : data[0] as OwnerSettings
    },
    key: () => keyPromise,
    networkUrl: (env('NETWORK_URL') ?? '').trim().replace(/\/+$/, '') || null,
    nowMs: () => Date.now(),
    post: async (url, payload) => {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(10_000),
        })
        let data: unknown = null
        try { data = await res.json() } catch { /* not JSON: no answer */ }
        return { status: res.status, data }
      } catch { return null }
    },
  })
  return json(answer.status, answer.body)
})

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}
