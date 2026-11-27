/**
 * The Edge Function `file-link` (fileLink.ts): the second factor and the
 * person's rights first, as the user; only then the service key signs, for
 * a lifetime the server chooses.
 */
import { describe, expect, it, vi } from 'vitest'
import { handleFileLink, parseFileLinkRequest, DOWNLOAD_SECONDS, PREVIEW_SECONDS, type FileLinkDeps } from './fileLink'

const FILE = '11111111-1111-4111-8111-111111111111'
const JOB = '22222222-2222-4222-8222-222222222222'

function deps(over: Partial<FileLinkDeps> = {}): FileLinkDeps & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    hasMfa: async () => true,
    rpcAsUser: async (fn) => {
      calls.push(fn)
      if (fn === 'request_file_download') return { data: 'org/job/file.stl', error: null }
      if (fn === 'job_file_name') return { data: 'FK-1 scan.stl', error: null }
      if (fn === 'request_job_previews') return { data: [{ file_id: FILE, preview_path: 'org/job/p.webp' }], error: null }
      return { data: null, error: { message: 'no' } }
    },
    sign: vi.fn(async (path: string, seconds: number) => `https://signed/${path}?s=${seconds}`),
    signMany: vi.fn(async (paths: string[], seconds: number) => paths.map(p => `https://signed/${p}?s=${seconds}`)),
    ...over,
  }
}

describe('file-link', () => {
  it('a download: rights first, then a 60-second link with the job-code name', async () => {
    const d = deps()
    const a = await handleFileLink({ fileId: FILE }, d)
    expect(a).toEqual({ status: 200, body: { url: `https://signed/org/job/file.stl?s=${DOWNLOAD_SECONDS}`, expiresIn: 60 } })
    expect(d.calls[0]).toBe('request_file_download')
    expect(d.sign).toHaveBeenCalledWith('org/job/file.stl', 60, 'FK-1 scan.stl')
  })

  it('previews: one call for the job (rights and one audit entry), 300-second links', async () => {
    const d = deps()
    const a = await handleFileLink({ jobId: JOB, previews: true }, d)
    expect(a.body).toEqual({ previews: [{ fileId: FILE, url: `https://signed/org/job/p.webp?s=${PREVIEW_SECONDS}` }], expiresIn: 300 })
    expect(d.calls).toEqual(['request_job_previews'])
  })

  it('refused by the database: one fixed answer, and nothing is signed', async () => {
    const d = deps({ rpcAsUser: async () => ({ data: null, error: { message: 'File not found', code: '42501' } }) })
    expect(await handleFileLink({ fileId: FILE }, d)).toEqual({ status: 403, body: { error: 'not allowed' } })
    expect(await handleFileLink({ jobId: JOB, previews: true }, d)).toEqual({ status: 403, body: { error: 'not allowed' } })
    expect(d.sign).not.toHaveBeenCalled()
    expect(d.signMany).not.toHaveBeenCalled()
  })

  it('without the second factor: nothing is asked and nothing is signed', async () => {
    const d = deps({ hasMfa: async () => false })
    expect(await handleFileLink({ fileId: FILE }, d)).toEqual({ status: 403, body: { error: 'mfa_required' } })
    expect(d.calls).toEqual([])
    expect(d.sign).not.toHaveBeenCalled()
  })

  it('a file sent with a Network order: the rights of the clinic first (sql/138), then a 60-second link', async () => {
    const d = deps({ rpcAsUser: async (fn) => (fn === 'request_order_file_download' ? { data: 'client-orders/o/f', error: null } : { data: null, error: { message: 'no' } }) })
    expect(await handleFileLink({ orderFileId: FILE }, d)).toEqual({ status: 200, body: { url: 'https://signed/client-orders/o/f?s=60', expiresIn: 60 } })
  })

  it('the caller cannot choose a lifetime, a path or a bucket', async () => {
    expect(parseFileLinkRequest({ fileId: FILE, expiresIn: 31_536_000 })).toEqual({ kind: 'download', fileId: FILE })
    expect(parseFileLinkRequest({ path: 'org/job/file.stl' })).toBeNull()
    expect(parseFileLinkRequest({ fileId: 'not-a-uuid' })).toBeNull()
    expect(parseFileLinkRequest({ jobId: JOB })).toBeNull()
    expect((await handleFileLink({ path: 'x' }, deps())).status).toBe(400)
  })
})
