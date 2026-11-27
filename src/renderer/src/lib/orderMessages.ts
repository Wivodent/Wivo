/**
 * The clinic writes on an order (sql/143): a message, optionally "Needs your
 * review", with files. Each file is cleaned first as every job file is
 * (lib/fileClean: a photo loses its location, camera and dates), gets a slot
 * (order_file_slot), goes straight to Storage under the slot's path (the
 * storage policy lets only its maker upload, once), and is marked done.
 *
 * A database before sql/143 has no files or reviews on messages: a plain
 * message still goes, through post_order_message.
 */
import { supabase } from './supabase'
import { cleanForUpload, sha256Hex } from './fileClean'

const missing = (code?: string) => code === 'PGRST202' || code === '42883'

export async function sendOrderMessage(orderId: string, body: string, opts: { needsReview?: boolean; files?: File[] } = {}): Promise<string> {
  const files = opts.files ?? []
  const v2 = await supabase.rpc('post_order_message_v2', { p_order: orderId, p_body: body, p_needs_review: !!opts.needsReview })
  let messageId: string
  if (v2.error) {
    if (!missing(v2.error.code) || files.length > 0 || opts.needsReview) throw v2.error
    const v1 = await supabase.rpc('post_order_message', { p_order: orderId, p_body: body })
    if (v1.error) throw v1.error
    messageId = v1.data as string
  } else messageId = v2.data as string

  for (const file of files) {
    const bytes = cleanForUpload(new Uint8Array(await file.arrayBuffer()), file.name)
    const slot = await supabase.rpc('order_file_slot', {
      p_message: messageId, p_name: file.name.replace(/[/\\]/g, '_').slice(0, 200), p_size: bytes.length,
      p_sha256: await sha256Hex(bytes), p_mime: file.type || null,
    })
    if (slot.error) throw slot.error
    const { file_id, path } = slot.data as { file_id: string; path: string }
    const up = await supabase.storage.from('job-files').upload(path, new Blob([bytes.slice().buffer as ArrayBuffer], { type: file.type || 'application/octet-stream' }), { upsert: false })
    if (up.error) throw up.error
    const done = await supabase.rpc('order_file_done', { p_file: file_id })
    if (done.error) throw done.error
  }
  return messageId
}
