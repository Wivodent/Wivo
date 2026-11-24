/**
 * A comment waiting for its attachment follows that one upload (Riga's trial,
 * 2026-11-24: Cancel on the upload left the comment loading until a reload).
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('./supabase', () => ({
  supabase: { rpc: vi.fn(async () => ({ data: null, error: { message: 'register refused in the test' } })), auth: { getSession: async () => ({ data: { session: null } }) } },
  storageEndpoint: () => 'https://x.invalid', anonKey: () => 'anon',
}))
vi.mock('./sound', () => ({ playSound: () => {} }))
vi.mock('./previews', () => ({ makePreview: async () => null }))

import { dismissUpload, enqueueUpload, pendingAttachment, retryUpload, uploadTask } from './uploadQueue'

const file = () => new File([new Uint8Array([1, 2, 3])], 'note.txt', { type: 'text/plain' })
const settle = () => new Promise(r => setTimeout(r, 20))

describe("a comment's attachment while it uploads", () => {
  it('queued or uploading: it waits', () => {
    const id = enqueueUpload('job-1', file(), 'other')
    expect(typeof id).toBe('string')
    expect(pendingAttachment(uploadTask(id))).toBe('uploading')
  })

  it('failed: the comment says so instead of spinning, and a retry can still store it', async () => {
    const id = enqueueUpload('job-1', file(), 'other')
    await settle()
    expect(uploadTask(id)?.status).toBe('failed')
    expect(pendingAttachment(uploadTask(id))).toBe('failed')
    retryUpload(id)
    expect(pendingAttachment(uploadTask(id))).toBe('uploading')
    await settle()
  })

  it('cancelled (the X on the upload row): gone, so the comment lets go of it', async () => {
    const stored = vi.fn()
    const id = enqueueUpload('job-1', file(), 'other', null, stored)
    await settle()
    dismissUpload(id)
    expect(uploadTask(id)).toBeNull()
    expect(pendingAttachment(uploadTask(id))).toBe('gone')
    expect(stored).not.toHaveBeenCalled()
  })

  it('no upload at all is gone too', () => {
    expect(uploadTask(null)).toBeNull()
    expect(pendingAttachment(null)).toBe('gone')
  })
})
