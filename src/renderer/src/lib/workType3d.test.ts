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
import { CATALOGUE, OPTIONS } from '@shared/pricing/workTypeCatalogue'

const all = (): boolean => true
const none = (): boolean => false
const only = (...files: string[]) => (f: string): boolean => files.includes(f)

describe('the mapping file', () => {
  it('file names are English kebab-case WebP', () => {
    const files = [...Object.values(KIND_3D_FILES), ...VARIANT_3D_FILES.map(v => v.file)].filter(Boolean)
    for (const file of files) expect(file).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*\.webp$/)
  })

  it('the plain tooth has no picture', () => {
    expect(KIND_3D_FILES.tooth).toBeNull()
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
    expect(workType3dFileIn({ nimi: 'Zirkoon', match: ['kroon'] }, all)).toBe('crown-zirconia.webp')
    expect(workType3dFileIn({ nimi: 'Öine kaitse' }, all)).toBe('night-guard.webp')
  })

  it("a variant wins when its file is there, else the kind's picture", () => {
    expect(workType3dFileIn({ nimi: 'All-on-6' }, all)).toBe('all-on-6.webp')
    expect(workType3dFileIn({ nimi: 'All-on-6' }, only('all-on-4.webp'))).toBe('all-on-4.webp')
    expect(workType3dFileIn({ nimi: 'Titaanvõrk' }, all)).toBe('titanium-mesh.webp')
    expect(workType3dFileIn({ nimi: 'Titaanvõrk' }, only('crown-zirconia.webp'))).toBeNull()
  })

  it("a type from the catalogue: its entry's picture, whatever it is called", () => {
    expect(workType3dFileIn({ nimi: 'Kroon', katalog: 'crown-metal-ceramic' }, all)).toBe('crown-metal-ceramic.webp')
  })

  it('a type named exactly as a catalogue entry, in any language: that picture', () => {
    expect(workType3dFileIn({ nimi: 'Metallkeraamiline kroon' }, all)).toBe('crown-metal-ceramic.webp')
    expect(workType3dFileIn({ nimi: 'Labor', match: ['телескопическая коронка'] }, all)).toBe('telescopic-crown.webp')
  })

  // The names a clinic gives its own types, in Estonian, Russian and English:
  // each finds its catalogue picture without being added from the catalogue.
  it.each([
    ['bridge', ['Sild', 'Мост', 'Bridge', 'Tsirkooniumsild']],
    ['implant-bridge', ['Implantaadisild', 'Implantsild', 'Sild implantaatidel', 'Мост на имплантах', 'Implant bridge']],
    ['filling', ['Täidis', 'Taidis', 'Пломба', 'Filling']],
    ['crown-zirconia', ['Kroon', 'Tsirkooniumkroon', 'Коронка', 'Crown']],
    ['crown-metal-ceramic', ['Metallkeraamika kroon', 'Металлокерамическая коронка', 'PFM crown']],
    ['crown-temporary', ['Ajutine kroon', 'Временная коронка', 'Temporary crown']],
    ['crown-implant', ['Implantkroon', 'Kroon implantaadil', 'Коронка на импланте', 'Implant crown']],
    ['implant-abutment', ['Abutment', 'Абатмент']],
    ['custom-abutment', ['Individuaalne abutment', 'Индивидуальный абатмент', 'Custom abutment']],
    ['telescopic-crown', ['Teleskoopkroon', 'Телескопическая коронка']],
    ['post-core', ['Tihvtkänd', 'Культевая вкладка', 'Post and core']],
    ['inlay-onlay', ['Inlay', 'Onlay', 'Вкладка', 'Накладка']],
    ['veneer', ['Viniir', 'Laminaat', 'Винир', 'Ламинат', 'Veneer']],
    ['maryland-bridge', ['Maryland sild', 'Мэриленд мост']],
    ['denture-full', ['Proteez', 'Protees', 'Täisprotees', 'Полный протез', 'Протез', 'Denture']],
    ['denture-partial', ['Osaproteez', 'Bügelprotees', 'Частичный протез', 'Бюгельный протез', 'Partial denture']],
    ['denture-immediate', ['Immediaatprotees', 'Иммедиат-протез']],
    ['denture-reline', ['Rebaseerimine', 'Proteesi ümbervooderdus', 'Перебазировка', 'Reline']],
    ['denture-repair', ['Proteesi parandus', 'Ремонт протеза', 'Denture repair']],
    ['hybrid-denture', ['Hübriidproteez', 'Гибридный протез']],
    ['overdenture', ['Katteproteez', 'Покрывной протез']],
    ['all-on-4', ['All-on-4', 'Allon4']],
    ['all-on-4-bar', ['All-on-4 raamil', 'All-on-4 на балке']],
    ['all-on-5', ['All-on-5', 'Allon5']],
    ['all-on-6', ['All-on-6', 'All on 6']],
    ['night-guard', ['Kaitse / splint', 'Öökaitse', 'Nightguard', 'Splint', 'Сплинт', 'Капа', 'Каппа', 'Окклюзионная шина']],
    ['sports-guard', ['Spordikaitse', 'Спортивная капа', 'Sports guard']],
    ['whitening-tray', ['Valgenduskapp', 'Капа для отбеливания']],
    ['sleep-apnea', ['Norskamisvastane aparaat', 'Аппарат от храпа']],
    ['aligner', ['Alainer', 'Элайнер', 'Aligner']],
    ['retainer-fixed', ['Retainer', 'Ретейнер', 'Ретайнер', 'Несъёмный ретейнер']],
    ['retainer-removable', ['Eemaldatav retainer', 'Съёмный ретейнер']],
    ['space-maintainer', ['Ruumihoidja', 'Space maintainer', 'Аппарат для сохранения места']],
    ['surgical-guide', ['Kirurgiline juhik', 'Хирургический шаблон']],
    ['titanium-mesh', ['Titaanvõrk', 'Титановая сетка']],
    ['wax-up', ['Vahamodelleering', 'Wax-up', 'Восковое моделирование']],
    ['bite-rim', ['Vahavall', 'Восковой валик']],
    ['gingival-mask', ['Igemmask', 'Десневая маска']],
    ['model', ['Mudel', 'Модель']],
    ['impression-tray', ['Individuaalne lusikas', 'Индивидуальная ложка']],
    ['digital-scan', ['Skaneerimine', 'Сканирование']],
    ['crown-design', ['Krooni disain', 'Дизайн коронки']],
    ['smile-design', ['Naeratuse disain', 'Дизайн улыбки']],
    ['remake', ['Ümbertegemine', 'Переделка']],
  ])('%s: found by the names clinics use', (id, names) => {
    for (const nimi of names) expect(workType3dFileIn({ nimi }, all), nimi).toBe(`${id}.webp`)
  })

  it('every catalogue entry is found by its own name in en, et and ru', () => {
    for (const e of CATALOGUE) for (const lang of ['en', 'et', 'ru'] as const) {
      expect(workType3dFileIn({ nimi: e.names[lang] }, all), `${e.id} ${lang}`).toBe(`${e.id}.webp`)
    }
  })

  it('no file, or a type nothing recognises: no picture (the line icon shows)', () => {
    expect(workType3dFileIn({ nimi: 'Kroon' }, none)).toBeNull()
    expect(workType3dFileIn({ nimi: 'Disain' }, all)).toBeNull()
    expect(kind3dFileIn('crown', none)).toBeNull()
    expect(kind3dFileIn('crown', all)).toBe('crown-zirconia.webp')
  })
})

describe('the folder', () => {
  const dir = resolve(__dirname, '../assets/worktypes/3d')
  const pictures = readdirSync(dir).filter(f => /\.(png|jpe?g|webp|svg)$/i.test(f))

  it('holds WebP pictures only, named in English kebab-case (the originals stay out of git)', () => {
    expect(pictures.filter(f => !/^[a-z0-9]+(-[a-z0-9]+)*\.webp$/.test(f))).toEqual([])
  })

  it('has every file the mapping names', () => {
    const named = [...Object.values(KIND_3D_FILES), ...VARIANT_3D_FILES.map(v => v.file)].filter((f): f is string => !!f)
    expect(named.filter(f => !pictures.includes(f))).toEqual([])
  })
})

describe('the folder and the catalogue (shared/pricing/workTypeCatalogue)', () => {
  const pictures = (dir: string) => readdirSync(resolve(__dirname, dir)).filter(f => f.endsWith('.webp')).map(f => f.replace(/\.webp$/, '')).sort()

  it('one picture per catalogue entry, and no picture without one', () => {
    expect(pictures('../assets/worktypes/3d')).toEqual(CATALOGUE.map(e => e.id).sort())
  })

  it('one picture per catalogue option, and no option picture without one', () => {
    expect(pictures('../assets/worktypes/3d/options')).toEqual(OPTIONS.map(o => o.id).sort())
  })
})
