/**
 * The one way to a job's file: a short-lived link the SERVER signs (F6).
 *
 *   { fileId }                → a 60-second download link
 *   { jobId, previews: true } → the job's ready previews, 300-second links
 *
 * The work and the order of the checks are in ../_shared/fileLink.ts (tested):
 * the second factor and the person's rights, checked by the database AS THE
 * USER (which also writes the audit entry), and only then the service key.
 * The user never chooses a link's lifetime.
 *
 * Deploy: `supabase functions deploy file-link --project-ref <ref>`.
 * Once every app in use calls this function for previews too (the release
 * that raises the minimum version), sql/137 removes the storage read policy
 * and this is the only way to a file (docs/NIGHT-REPORT-2026-11-27.md, part 3).
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import { sessionHasMfa } from '../_shared/requireMfa.ts'
import { APP_ALLOWED_HEADERS, callerVersionHeaders } from '../_shared/appVersion.ts'
import { serviceClientKey } from '../_shared/serviceAuth.ts'
import { handleFileLink } from '../_shared/fileLink.ts'

const env = (name: string) => Deno.env.get(name)
const URL_ = env('SUPABASE_URL') ?? ''
const ANON = env('SUPABASE_ANON_KEY') ?? ''
const noSession = { persistSession: false, autoRefreshToken: false }
const service = createClient(URL_, serviceClientKey(env), { auth: noSession })

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': APP_ALLOWED_HEADERS,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json(405, { error: 'bad request' })
  const auth = req.headers.get('Authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return json(401, { error: 'sign in first' })

  let body: unknown = null
  try { body = await req.json() } catch { /* empty body: bad request below */ }

  const asUser = createClient(URL_, ANON, {
    global: { headers: { Authorization: auth, ...callerVersionHeaders(req) } },
    auth: noSession,
  })
  const bucket = service.storage.from('job-files')
  const answer = await handleFileLink(body, {
    rpcAsUser: async (fn, args) => await asUser.rpc(fn, args),
    hasMfa: () => sessionHasMfa(fn => asUser.rpc(fn)),
    sign: async (path, seconds, download) => {
      const { data, error } = await bucket.createSignedUrl(path, seconds, download ? { download } : undefined)
      return error || !data ? null : data.signedUrl
    },
    signMany: async (paths, seconds) => {
      const { data, error } = await bucket.createSignedUrls(paths, seconds)
      if (error || !data) return paths.map(() => null)
      return paths.map((_, i) => data[i]?.signedUrl ?? null)
    },
  })
  return json(answer.status, answer.body)
})

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}
