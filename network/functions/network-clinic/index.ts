/**
 * Wivo Network: a clinic reads or changes its own directory entry (listed,
 * invite code), with a request signed by its own key (docs/NETWORK-SETUP.md,
 * A8). The work is in ../_shared/networkClinic.ts (tested).
 *
 * Called only by a clinic's Edge Function network-directory, server to
 * server, with no key of this project: the gateway's JWT check is OFF
 * (deploy with --no-verify-jwt). The signature is the proof.
 *
 * Deploy (to the Network project only):
 *   npx supabase functions deploy network-clinic --no-verify-jwt --project-ref <NETWORK_REF> --workdir network
 * No secret of its own: the platform's URL and service key only.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import { handleNetworkClinic, type EntryRow } from '../_shared/networkClinic.ts'

const service = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
  auth: { persistSession: false, autoRefreshToken: false },
})

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return json(405, { error: 'bad_request' })
  if (Number(req.headers.get('content-length') ?? '0') > 4096) return json(413, { error: 'too_large' })
  let body: unknown = null
  try { body = await req.json() } catch { /* bad request below */ }

  const one = (data: unknown): EntryRow | null => (Array.isArray(data) && data.length === 1 ? data[0] as EntryRow : null)
  const answer = await handleNetworkClinic(body, {
    nowMs: () => Date.now(),
    publicKey: async (clinicId) => {
      const { data, error } = await service.rpc('clinic_request_key', { p_clinic: clinicId })
      return error || typeof data !== 'string' ? null : data
    },
    entry: async (clinicId) => {
      const { data, error } = await service.rpc('clinic_own_entry', { p_clinic: clinicId })
      return error ? null : one(data)
    },
    setListed: async (clinicId, listed, atMs) => {
      const { data, error } = await service.rpc('clinic_set_listed', { p_clinic: clinicId, p_listed: listed, p_at: atMs })
      if (error) return error.code === '40001' ? 'older' : null
      return one(data)
    },
  })
  return json(answer.status, answer.body)
})

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
