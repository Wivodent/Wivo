/**
 * Orders from outside, through the Wivo Network (docs/PLAN-NETWORK-1.md):
 * the one door for a Network client into this clinic. The work and every
 * check are in ../_shared/networkClient.ts (tested); the database decides
 * the rest (sql/138: client_* functions, service role only).
 *
 * Called by the phone app's Network mode from any address, with no key of
 * this project: the gateway's JWT check is OFF (verify_jwt = false in
 * supabase/config.toml; deploy with --no-verify-jwt). A caller proves itself
 * with a Network token (connect) or the session this clinic gave it.
 *
 * Deploy: `supabase functions deploy network-client --no-verify-jwt --project-ref <ref>`
 * (docs/NETWORK-SETUP.md, part B).
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import { APP_ALLOWED_HEADERS } from '../_shared/appVersion.ts'
import { serviceClientKey } from '../_shared/serviceAuth.ts'
import { handleNetworkClient } from '../_shared/networkClient.ts'

const env = (name: string) => Deno.env.get(name)
const service = createClient(env('SUPABASE_URL') ?? '', serviceClientKey(env), { auth: { persistSession: false, autoRefreshToken: false } })
const bucket = service.storage.from('job-files')

// No cookie and no ambient credential: any origin may ask, only a valid token or session gets an answer.
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': APP_ALLOWED_HEADERS,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json(405, { error: 'bad_request' })
  const length = Number(req.headers.get('content-length') ?? '0')
  if (length > 64 * 1024) return json(413, { error: 'too_large' })
  let body: unknown = null
  try { body = await req.json() } catch { /* bad request below */ }

  const answer = await handleNetworkClient(body, {
    rpc: async (fn, args) => {
      const { data, error } = await service.rpc(fn, args)
      return { data, error: error ? { code: error.code, message: error.message } : null }
    },
    nowSeconds: () => Math.floor(Date.now() / 1000),
    signDownload: async (path, seconds, name) => {
      const { data, error } = await bucket.createSignedUrl(path, seconds, name ? { download: name } : undefined)
      return error || !data ? null : data.signedUrl
    },
    signUpload: async (path) => {
      const { data, error } = await bucket.createSignedUploadUrl(path)
      return error || !data ? null : { url: data.signedUrl, token: data.token }
    },
  })
  return json(answer.status, answer.body)
})

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}
