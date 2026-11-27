/**
 * The only way the app reaches a job's file: the `file-link` Edge Function
 * (F6, 2.2.6). It checks the person's rights and writes the audit entry in
 * the database, as the user, and then signs a link for a lifetime the SERVER
 * chooses (60 s for a download, 300 s for a preview). The app never signs a
 * storage link itself: from sql/137 on it has no right to.
 *
 * Refused for rights → "no permission" (42501, describeError). Any other
 * failure (the function not reachable, the network) → a neutral "not
 * available", never a way round it.
 */
import { supabase } from './supabase'

const notAllowed = (): Error => Object.assign(new Error('not allowed'), { code: '42501' })
// Said as the neutral "not available yet" (describeError reads PGRST202 so).
const notAvailable = (): Error => Object.assign(new Error('file link not available'), { code: 'PGRST202' })

async function invokeFileLink<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('file-link', { body })
  if (error) {
    const status = 'context' in error ? (error as { context?: Response }).context?.status : undefined
    throw status === 403 ? notAllowed() : notAvailable()
  }
  return data as T
}

export async function fileDownloadUrl(fileId: string, _fileName?: string): Promise<string> {
  const data = await invokeFileLink<{ url?: unknown }>({ fileId })
  if (typeof data?.url !== 'string') throw notAvailable()
  return data.url
}

/** A job's ready previews: file id → a short-lived picture link. One audit entry for the job. */
export async function jobPreviewUrls(jobId: string): Promise<Map<string, string>> {
  const data = await invokeFileLink<{ previews?: unknown }>({ jobId, previews: true })
  const list = Array.isArray(data?.previews) ? data.previews as { fileId?: unknown; url?: unknown }[] : []
  return new Map(list
    .filter((p): p is { fileId: string; url: string } => typeof p.fileId === 'string' && typeof p.url === 'string')
    .map(p => [p.fileId, p.url] as [string, string]))
}

/** Save a job's file: the same signed, audited link, opened as a download. */
export async function saveFile(fileId: string, fileName: string): Promise<void> {
  const a = document.createElement('a')
  a.href = await fileDownloadUrl(fileId, fileName)
  a.download = fileName
  a.click()
}

/**
 * A PDF to show in the viewer, from the same signed link as a download. That
 * link tells the browser to save the file, which a frame obeys; read into
 * memory first, it displays instead. The caller revokes the address when done.
 */
export async function filePdfObjectUrl(fileId: string, fileName: string): Promise<string> {
  const res = await fetch(await fileDownloadUrl(fileId, fileName))
  if (!res.ok) throw new Error(`${res.status}`)
  return URL.createObjectURL(new Blob([await res.arrayBuffer()], { type: 'application/pdf' }))
}

/** A file a Network client sent with an order (sql/138): the clinic's rights, the audit entry, a 60-second link. */
export async function saveOrderFile(fileId: string, fileName: string): Promise<void> {
  const data = await invokeFileLink<{ url?: unknown }>({ orderFileId: fileId })
  if (typeof data?.url !== 'string') throw notAvailable()
  const a = document.createElement('a')
  a.href = data.url
  a.download = fileName
  a.click()
}

/** An order file's 60-second link, to show a picture in the conversation (sql/143). The same rights and audit entry as a download. */
export async function orderFileUrl(fileId: string): Promise<string> {
  const data = await invokeFileLink<{ url?: unknown }>({ orderFileId: fileId })
  if (typeof data?.url !== 'string') throw notAvailable()
  return data.url
}
