/**
 * The Edge Function `file-link`: the ONE way to a job's file (F6, 2.2.6).
 *
 *   { fileId }                → { url, expiresIn }               a download, 60 s
 *   { jobId, previews: true } → { previews: [{ fileId, url }], expiresIn }   300 s
 *   { orderFileId }           → { url, expiresIn }               a file sent with a Network order, 60 s (sql/138)
 *
 * First the database, AS THE USER: the second factor (sql/098), then
 * `request_file_download` / `request_job_previews`, which check the person's
 * rights and write the audit entry exactly as before. Only after that does
 * the service key sign, for a lifetime the server chooses. The app has no
 * other way to a file once sql/137 has removed the storage read policy.
 *
 * Every refusal is one fixed answer: the database's own message names its
 * functions (2.2.5, E4).
 */

export const DOWNLOAD_SECONDS = 60
export const PREVIEW_SECONDS = 300
const MAX_PREVIEWS = 200

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type RpcResult = { data: unknown; error: unknown }

export interface FileLinkDeps {
  /** A database function called AS THE USER (their token, their version header). */
  rpcAsUser: (fn: string, args?: Record<string, unknown>) => Promise<RpcResult>
  /** The second factor, checked by the database (requireMfa.ts). */
  hasMfa: () => Promise<boolean>
  /** Signs with the service key. */
  sign: (path: string, seconds: number, download?: string) => Promise<string | null>
  signMany: (paths: string[], seconds: number) => Promise<(string | null)[]>
}

export type FileLinkRequest =
  | { kind: 'download'; fileId: string }
  | { kind: 'previews'; jobId: string }
  | { kind: 'order_file'; fileId: string }

export function parseFileLinkRequest(body: unknown): FileLinkRequest | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  if (typeof b.fileId === 'string' && UUID.test(b.fileId)) return { kind: 'download', fileId: b.fileId }
  if (b.previews === true && typeof b.jobId === 'string' && UUID.test(b.jobId)) return { kind: 'previews', jobId: b.jobId }
  if (typeof b.orderFileId === 'string' && UUID.test(b.orderFileId)) return { kind: 'order_file', fileId: b.orderFileId }
  return null
}

export interface FileLinkAnswer { status: number; body: Record<string, unknown> }

const notAllowed: FileLinkAnswer = { status: 403, body: { error: 'not allowed' } }

export async function handleFileLink(body: unknown, deps: FileLinkDeps): Promise<FileLinkAnswer> {
  const request = parseFileLinkRequest(body)
  if (!request) return { status: 400, body: { error: 'bad request' } }
  if (!(await deps.hasMfa())) return { status: 403, body: { error: 'mfa_required' } }

  if (request.kind === 'download') {
    const { data: path, error } = await deps.rpcAsUser('request_file_download', { p_file: request.fileId })
    if (error || typeof path !== 'string') return notAllowed
    const { data: name } = await deps.rpcAsUser('job_file_name', { p_file: request.fileId })
    const url = await deps.sign(path, DOWNLOAD_SECONDS, typeof name === 'string' ? name : undefined)
    if (!url) return { status: 500, body: { error: 'could not sign' } }
    return { status: 200, body: { url, expiresIn: DOWNLOAD_SECONDS } }
  }

  if (request.kind === 'order_file') {
    const { data: path, error } = await deps.rpcAsUser('request_order_file_download', { p_file: request.fileId })
    if (error || typeof path !== 'string') return notAllowed
    const url = await deps.sign(path, DOWNLOAD_SECONDS)
    if (!url) return { status: 500, body: { error: 'could not sign' } }
    return { status: 200, body: { url, expiresIn: DOWNLOAD_SECONDS } }
  }

  const { data, error } = await deps.rpcAsUser('request_job_previews', { p_job: request.jobId })
  if (error || !Array.isArray(data)) return notAllowed
  const rows = (data as { file_id?: unknown; preview_path?: unknown }[])
    .filter(r => typeof r.file_id === 'string' && typeof r.preview_path === 'string')
    .slice(0, MAX_PREVIEWS) as { file_id: string; preview_path: string }[]
  if (rows.length === 0) return { status: 200, body: { previews: [], expiresIn: PREVIEW_SECONDS } }
  const urls = await deps.signMany(rows.map(r => r.preview_path), PREVIEW_SECONDS)
  const previews = rows
    .map((r, i) => ({ fileId: r.file_id, url: urls[i] }))
    .filter((p): p is { fileId: string; url: string } => typeof p.url === 'string' && p.url.length > 0)
  return { status: 200, body: { previews, expiresIn: PREVIEW_SECONDS } }
}
