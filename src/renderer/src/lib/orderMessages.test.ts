/**
 * The clinic's message with files (sql/143): the message, then for each file
 * a cleaned copy, its slot, the upload to the slot's path, "done". Both sides
 * clean a file before it leaves (lib/fileClean), as job files are.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const calls: string[] = []
let v2Missing = false
vi.mock('./supabase', () => ({
  supabase: {
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      calls.push(`rpc:${fn}`)
      if (fn === 'post_order_message_v2') return v2Missing ? { data: null, error: { code: 'PGRST202', message: 'missing' } } : { data: 'msg-1', error: null }
      if (fn === 'post_order_message') return { data: 'msg-old', error: null }
      if (fn === 'order_file_slot') return { data: { file_id: `file-${String(args.p_name)}`, path: `client-orders/o/r/${String(args.p_name)}` }, error: null }
      return { data: null, error: null }
    }),
    storage: { from: () => ({ upload: vi.fn(async (path: string) => { calls.push(`upload:${path}`); return { error: null } }) }) },
  },
}))
vi.mock('./fileClean', () => ({
  cleanForUpload: vi.fn((bytes: Uint8Array) => { calls.push('clean'); return bytes }),
  sha256Hex: vi.fn(async () => 'a'.repeat(64)),
}))

import { sendOrderMessage } from './orderMessages'

beforeEach(() => { calls.length = 0; v2Missing = false })

const file = (name: string) => ({ name, type: 'image/jpeg', arrayBuffer: async () => new ArrayBuffer(4) }) as unknown as File

describe('the clinic writes on an order with files', () => {
  it('the message first, then each file cleaned, slotted, uploaded to its own path and marked done', async () => {
    expect(await sendOrderMessage('order-1', 'Design attached', { needsReview: true, files: [file('a.jpg'), file('b.stl')] })).toBe('msg-1')
    expect(calls).toEqual([
      'rpc:post_order_message_v2',
      'clean', 'rpc:order_file_slot', 'upload:client-orders/o/r/a.jpg', 'rpc:order_file_done',
      'clean', 'rpc:order_file_slot', 'upload:client-orders/o/r/b.stl', 'rpc:order_file_done',
    ])
  })

  it('a database before sql/143: a plain message still goes; files or a review are not silently dropped', async () => {
    v2Missing = true
    expect(await sendOrderMessage('order-1', 'Hello')).toBe('msg-old')
    await expect(sendOrderMessage('order-1', 'With a file', { files: [file('a.jpg')] })).rejects.toBeTruthy()
    await expect(sendOrderMessage('order-1', 'Review please', { needsReview: true })).rejects.toBeTruthy()
  })
})

describe('both sides clean a file before it leaves (read from the source)', () => {
  it('the client (lib/network) and the clinic (lib/orderMessages) both call cleanForUpload', () => {
    for (const rel of ['./network.ts', './orderMessages.ts']) {
      const src = readFileSync(join(__dirname, rel), 'utf8')
      expect(src).toContain("import { cleanForUpload, sha256Hex } from './fileClean'")
      expect(src).toMatch(/cleanForUpload\(new Uint8Array\(await file\.arrayBuffer\(\)\), file\.name\)/)
    }
  })
  it('the job page of a job from an order shows its conversation', () => {
    expect(readFileSync(join(__dirname, '../components/JobDetail/JobDetailPanel.tsx'), 'utf8')).toContain('<JobOrderThread jobId={job.id} />')
  })
})
