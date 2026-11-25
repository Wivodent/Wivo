/**
 * Which 3D illustration a work type gets: by what the type is, never by the
 * clinic's name for it, in every language a clinic's list may be in; a missing
 * file falls back to the kind's picture, then to none (the line icon).
 */
import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { defaultWorkTypesFor } from '@shared/pricing/workTypes'
import { WORK_KINDS } from '../components/NewJobWizard/jobtype/workKindShapes'
import { KIND_3D_FILES, VARIANT_3D_FILES } from './workType3dMap'
import { kind3dFileIn, workType3dFileIn } from './workType3d'

const all = (): boolean => true
const none = (): boolean => false
const only = (...files: string[]) => (f: string): boolean => files.includes(f)

describe('the mapping file', () => {
  it('every kind but the plain tooth has a file; file names are English kebab-case', () => {
    for (const kind of WORK_KINDS) {
      const file = KIND_3D_FILES[kind]
      if (kind === 'tooth') expect(file).toBeNull()
      else expect(file).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*\.png$/)
    }
    for (const v of VARIANT_3D_FILES) expect(v.file).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*\.png$/)
  })

  it('no two kinds share a file', () => {
    const files = Object.values(KIND_3D_FILES).filter(Boolean)
    expect(new Set(files).size).toBe(files.length)
  })
})

describe('which picture for which type', () => {
  it.each(['et', 'en', 'ru'] as const)('the default types (%s) get the same files in every language', lang => {
    const files = defaultWorkTypesFor(lang).map(t => workType3dFileIn(t, all))
    const estonian = defaultWorkTypesFor('et').map(t => workType3dFileIn(t, all))
    expect(files).toEqual(estonian)
    expect(files).toEqual(WORK_KINDS.slice(0, 15).map(k => KIND_3D_FILES[k]))
  })

  it('a renamed type keeps its picture through its synonyms', () => {
    expect(workType3dFileIn({ nimi: 'Zirkoon', match: ['kroon'] }, all)).toBe('crown.png')
    expect(workType3dFileIn({ nimi: 'Öine kaitse' }, all)).toBe('night-guard.png')
  })

  it('a variant wins when its file is there, else the kind\'s picture', () => {
    expect(workType3dFileIn({ nimi: 'All-on-4' }, all)).toBe('all-on-4.png')
    expect(workType3dFileIn({ nimi: 'All-on-4' }, only('all-on-x.png'))).toBe('all-on-x.png')
    expect(workType3dFileIn({ nimi: 'Titaanvõrk' }, all)).toBe('titanium-mesh.png')
    expect(workType3dFileIn({ nimi: 'Titaanvõrk' }, only('crown.png'))).toBeNull()
  })

  it('no file, or a type nothing recognises: no picture (the line icon shows)', () => {
    expect(workType3dFileIn({ nimi: 'Kroon' }, none)).toBeNull()
    expect(workType3dFileIn({ nimi: 'Disain' }, all)).toBeNull()
    expect(kind3dFileIn('crown', none)).toBeNull()
    expect(kind3dFileIn('crown', all)).toBe('crown.png')
  })
})

describe('the folder', () => {
  it('every picture in it is one the mapping names (a stray file would never show)', () => {
    const dir = resolve(__dirname, '../assets/worktypes/3d')
    const known = new Set([...Object.values(KIND_3D_FILES), ...VARIANT_3D_FILES.map(v => v.file)])
    const pictures = readdirSync(dir).filter(f => /\.(png|jpe?g|webp|svg)$/i.test(f))
    expect(pictures.filter(f => !known.has(f.toLowerCase()))).toEqual([])
  })
})
