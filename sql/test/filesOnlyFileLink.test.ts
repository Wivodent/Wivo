/**
 * F6 (2.2.6): a job's files only through the `file-link` Edge Function.
 *
 * The database (sql/137): no storage policy lets a signed-in person read the
 * job-files bucket any more, so nobody can sign a link of their own; uploads
 * still work. The app: nothing signs a job-files link itself; downloads,
 * previews and the patient export all ask file-link.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { freshDb } from './harness'

const ROOT = join(__dirname, '..', '..')

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) sources(path, out)
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(path)
  }
  return out
}

describe('files only through file-link (sql/137)', () => {
  it('leaves no read policy on job-files for a signed-in person, and keeps the upload', async () => {
    const db = await freshDb()
    const { rows } = await db.query<{ policyname: string; cmd: string; roles: string[] }>(
      `select policyname, cmd, roles::text[] as roles from pg_policies
        where schemaname = 'storage' and tablename = 'objects'
          and (qual ilike '%job-files%' or with_check ilike '%job-files%')`)
    expect(rows.filter(r => r.cmd === 'SELECT' || r.cmd === 'ALL' || r.cmd === 'UPDATE' || r.cmd === 'DELETE')).toEqual([])
    expect(rows.map(r => `${r.policyname}:${r.cmd}`)).toEqual(['job_files_insert:INSERT'])
    await db.close()
  }, 120_000)

  it('runs twice without complaint', async () => {
    const db = await freshDb()
    const sql = readFileSync(join(__dirname, '..', '137_files_only_through_file_link.sql'), 'utf8')
    await db.exec(sql)
    await db.exec(sql)
    await db.close()
  }, 120_000)

  it('the app signs no job-files link itself, anywhere (desktop and phone)', () => {
    const offenders: string[] = []
    for (const file of sources(join(ROOT, 'src'))) {
      const text = readFileSync(file, 'utf8')
      if (/createSignedUrls?\s*\(/.test(text)) offenders.push(file.slice(ROOT.length + 1))
      if (/from\(\s*['"]job-files['"]\s*\)(?![\s\S]{0,80}\.(upload|uploadToSignedUrl)\()/.test(text)) offenders.push(`${file.slice(ROOT.length + 1)} (job-files)`)
    }
    expect(offenders).toEqual([])
  })

  it('downloads, previews and the patient export ask file-link', () => {
    const link = readFileSync(join(ROOT, 'src/renderer/src/lib/fileLink.ts'), 'utf8')
    expect(link).toMatch(/functions\.invoke\('file-link'/)
    expect(link).not.toMatch(/request_file_download|storage\./)
    expect(readFileSync(join(ROOT, 'src/renderer/src/components/Files/JobFiles.tsx'), 'utf8')).toMatch(/jobPreviewUrls\(/)
    expect(readFileSync(join(ROOT, 'src/renderer/src/components/Patients/PatientExport.tsx'), 'utf8')).toMatch(/fileDownloadUrl\(/)
  })
})
