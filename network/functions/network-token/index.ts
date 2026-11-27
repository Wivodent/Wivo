/**
 * Wivo Network: a short-lived signed token for ONE clinic (docs/PLAN-NETWORK-1.md).
 * The work is in ../_shared/networkToken.ts (tested).
 *
 * Deploy (to the Network project only): docs/NETWORK-SETUP.md, step 5.
 * Secret: NETWORK_SIGNING_KEY, the Ed25519 private key (PKCS#8, base64url)
 * from network/scripts/make-network-key.mjs. Never in a clinic's project.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import { handleNetworkToken, type ClaimsRow } from '../_shared/networkToken.ts'
import { importSigningKey } from '../_shared/generated/token.ts'

const URL_ = Deno.env.get('SUPABASE_URL') ?? ''
const ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const keyPromise = importSigningKey(Deno.env.get('NETWORK_SIGNING_KEY') ?? '')

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-wivo-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json(405, { error: 'bad request' })
  const auth = req.headers.get('Authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return json(401, { error: 'sign in first' })
  let body: unknown = null
  try { body = await req.json() } catch { /* bad request below */ }

  let key: CryptoKey
  try { key = await keyPromise } catch { return json(500, { error: 'not set up' }) }

  const asAccount = createClient(URL_, ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false, autoRefreshToken: false } })
  const answer = await handleNetworkToken(body, {
    key,
    nowSeconds: () => Math.floor(Date.now() / 1000),
    claims: async (clinicId) => {
      const { data, error } = await asAccount.rpc('token_claims', { p_clinic: clinicId })
      if (error || !Array.isArray(data) || data.length !== 1) return null
      return data[0] as ClaimsRow
    },
    // Network 003: without it, the token simply carries no address.
    contact: async (clinicId) => {
      const { data, error } = await asAccount.rpc('token_contact', { p_clinic: clinicId })
      if (error || !Array.isArray(data) || data.length !== 1) return null
      return data[0] as { email: string | null; email_notifications: boolean }
    },
    // Network 004: without it, the token simply carries no billing e-mail.
    billing: async (clinicId) => {
      const { data, error } = await asAccount.rpc('token_billing', { p_clinic: clinicId })
      if (error) return undefined
      return typeof data === 'string' && data.trim() ? data.trim() : null
    },
  })
  return json(answer.status, answer.body)
})

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}
