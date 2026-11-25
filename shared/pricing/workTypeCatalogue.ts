/**
 * Wivo's catalogue of common dental lab work: what an owner adds to their own
 * list with one "+" (Settings → Prices → Add from catalogue).
 *
 * In code, not in the database: it is Wivo's, the same for every clinic, and
 * changes with a release. An entry's id is English kebab-case and is also its
 * picture's file name (src/renderer/src/assets/worktypes/3d/<id>.webp).
 *
 * An entry carries NO price and NO cost (a test fails if one does): those are
 * always the clinic's own. Adding an entry makes an ordinary work type, named
 * in the clinic's language, with the entry's price unit, kind and suggested
 * option groups, which the owner can change or remove like any other.
 *
 * The option library entries the groups point at are here too (OPTIONS):
 * their names in the four languages, no price. An option's id is also its
 * picture's file name (…/3d/options/<id>.webp).
 */
import type { PriceMode, WorkType } from './workTypes'
import type { WorkOption, WorkOptionGroup } from './workOptions'

export type CatalogueLang = 'en' | 'et' | 'ru' | 'lv'
type Names = Readonly<Record<CatalogueLang, string>>

/** How the catalogue groups its tiles. */
export type CatalogueKind = 'crown' | 'bridge' | 'implant' | 'denture' | 'guard' | 'model' | 'digital' | 'other'
export const CATALOGUE_KINDS: readonly CatalogueKind[] = ['crown', 'bridge', 'implant', 'denture', 'guard', 'model', 'digital', 'other']

/** Which teeth the work is asked for on the new-job form (shared/wizard workTypeRules). */
export type TeethMode = 'tooth' | 'arch' | 'none'

export interface CatalogueGroup {
  key: string
  names: Names
  mitu: boolean
  options: readonly string[]
}

export interface CatalogueEntry {
  id: string
  names: Names
  kind: CatalogueKind
  /** The price unit a new type starts with: per tooth ('hammas') or per job ('too'). */
  unit: PriceMode
  /** Built on implants: its teeth are marked as implants when picked (2.2.0). */
  implantBased: boolean
  /**
   * Set only where the type's words cannot tell (a digital scan, an aligner):
   * otherwise the form reads it from the name, as for any type.
   */
  teeth?: TeethMode
  groups?: readonly CatalogueGroup[]
}

// ── Option groups ─────────────────────────────────────────────────────────────

const FRAMEWORK: CatalogueGroup = {
  key: 'framework', mitu: false,
  names: { en: 'Framework', et: 'Raam', ru: 'Каркас', lv: 'Karkass' },
  options: ['metal-bar', 'zirconia-framework', 'cocr-framework', 'peek-bar'],
}
const ATTACHMENTS: CatalogueGroup = {
  key: 'attachments', mitu: true,
  names: { en: 'Attachments', et: 'Kinnitused', ru: 'Крепления', lv: 'Stiprinājumi' },
  options: ['multi-unit', 'ti-base'],
}
const RETENTION: CatalogueGroup = {
  key: 'retention', mitu: false,
  names: { en: 'Retention', et: 'Kinnitusviis', ru: 'Фиксация', lv: 'Fiksācija' },
  options: ['screw-retained', 'cement-retained'],
}
const OVERDENTURE_ATTACHMENTS: CatalogueGroup = {
  key: 'attachments', mitu: false,
  names: { en: 'Attachments', et: 'Kinnitused', ru: 'Крепления', lv: 'Stiprinājumi' },
  options: ['locator', 'ball-attachment', 'metal-bar'],
}
const EXTRAS: CatalogueGroup = {
  key: 'extras', mitu: true,
  names: { en: 'Extras', et: 'Lisad', ru: 'Дополнительно', lv: 'Papildus' },
  options: ['pink-gingiva', 'temporary-pmma'],
}
const ABUTMENT_BASE: CatalogueGroup = {
  key: 'base', mitu: false,
  names: { en: 'Base', et: 'Alus', ru: 'Основание', lv: 'Pamatne' },
  options: ['ti-base', 'multi-unit'],
}
const FULL_ARCH = [FRAMEWORK, ATTACHMENTS, EXTRAS] as const

// ── The entries: one per picture in assets/worktypes/3d ──────────────────────

export const CATALOGUE: readonly CatalogueEntry[] = [
  // Crowns and single units
  { id: 'crown-zirconia', kind: 'crown', unit: 'hammas', implantBased: false,
    names: { en: 'Zirconia crown', et: 'Tsirkooniumkroon', ru: 'Циркониевая коронка', lv: 'Cirkonija kronis' } },
  { id: 'crown-metal-ceramic', kind: 'crown', unit: 'hammas', implantBased: false,
    names: { en: 'Metal-ceramic crown', et: 'Metallkeraamiline kroon', ru: 'Металлокерамическая коронка', lv: 'Metālkeramikas kronis' } },
  { id: 'crown-temporary', kind: 'crown', unit: 'hammas', implantBased: false,
    names: { en: 'Temporary crown', et: 'Ajutine kroon', ru: 'Временная коронка', lv: 'Pagaidu kronis' } },
  { id: 'telescopic-crown', kind: 'crown', unit: 'hammas', implantBased: false,
    names: { en: 'Telescopic crown', et: 'Teleskoopkroon', ru: 'Телескопическая коронка', lv: 'Teleskopiskais kronis' } },
  { id: 'post-core', kind: 'crown', unit: 'hammas', implantBased: false,
    names: { en: 'Post and core', et: 'Tihvtkänd', ru: 'Культевая вкладка', lv: 'Kultes ieliktnis' } },
  { id: 'inlay-onlay', kind: 'crown', unit: 'hammas', implantBased: false,
    names: { en: 'Inlay / onlay', et: 'Inlay / onlay', ru: 'Вкладка / накладка', lv: 'Inleja / onleja' } },
  { id: 'filling', kind: 'crown', unit: 'hammas', implantBased: false,
    names: { en: 'Filling', et: 'Täidis', ru: 'Пломба', lv: 'Plomba' } },
  { id: 'veneer', kind: 'crown', unit: 'hammas', implantBased: false,
    names: { en: 'Veneer', et: 'Viniir', ru: 'Винир', lv: 'Venīrs' } },

  // Bridges
  { id: 'bridge', kind: 'bridge', unit: 'hammas', implantBased: false,
    names: { en: 'Bridge', et: 'Sild', ru: 'Мост', lv: 'Tilts' } },
  { id: 'maryland-bridge', kind: 'bridge', unit: 'hammas', implantBased: false,
    names: { en: 'Maryland bridge', et: 'Maryland-sild', ru: 'Адгезивный мост (Мэриленд)', lv: 'Merilendas tilts' } },

  // On implants
  { id: 'crown-implant', kind: 'implant', unit: 'hammas', implantBased: true, groups: [RETENTION, ATTACHMENTS],
    names: { en: 'Implant crown', et: 'Implantaadikroon', ru: 'Коронка на импланте', lv: 'Kronis uz implanta' } },
  { id: 'implant-bridge', kind: 'implant', unit: 'hammas', implantBased: true, groups: [RETENTION, ATTACHMENTS],
    names: { en: 'Implant bridge', et: 'Implantaadisild', ru: 'Мост на имплантах', lv: 'Tilts uz implantiem' } },
  { id: 'implant-abutment', kind: 'implant', unit: 'hammas', implantBased: true, groups: [ABUTMENT_BASE],
    names: { en: 'Implant abutment', et: 'Implantaadi abutment', ru: 'Абатмент на имплант', lv: 'Implanta abatments' } },
  { id: 'custom-abutment', kind: 'implant', unit: 'hammas', implantBased: true, groups: [ABUTMENT_BASE],
    names: { en: 'Custom abutment', et: 'Individuaalne abutment', ru: 'Индивидуальный абатмент', lv: 'Individuāls abatments' } },
  { id: 'all-on-4', kind: 'implant', unit: 'too', implantBased: true, groups: FULL_ARCH,
    names: { en: 'All-on-4', et: 'All-on-4', ru: 'All-on-4', lv: 'All-on-4' } },
  { id: 'all-on-4-bar', kind: 'implant', unit: 'too', implantBased: true, groups: FULL_ARCH,
    names: { en: 'All-on-4 on a bar', et: 'All-on-4 raamil', ru: 'All-on-4 на балке', lv: 'All-on-4 uz sijas' } },
  { id: 'all-on-5', kind: 'implant', unit: 'too', implantBased: true, groups: FULL_ARCH,
    names: { en: 'All-on-5', et: 'All-on-5', ru: 'All-on-5', lv: 'All-on-5' } },
  { id: 'all-on-6', kind: 'implant', unit: 'too', implantBased: true, groups: FULL_ARCH,
    names: { en: 'All-on-6', et: 'All-on-6', ru: 'All-on-6', lv: 'All-on-6' } },
  { id: 'hybrid-denture', kind: 'implant', unit: 'too', implantBased: true, groups: FULL_ARCH,
    names: { en: 'Hybrid denture', et: 'Hübriidprotees', ru: 'Гибридный протез', lv: 'Hibrīdprotēze' } },
  { id: 'overdenture', kind: 'implant', unit: 'too', implantBased: true, groups: [OVERDENTURE_ATTACHMENTS],
    names: { en: 'Overdenture', et: 'Katteprotees', ru: 'Покрывной протез', lv: 'Pārklājošā protēze' } },
  { id: 'surgical-guide', kind: 'implant', unit: 'too', implantBased: false,
    names: { en: 'Surgical guide', et: 'Kirurgiline juhik', ru: 'Хирургический шаблон', lv: 'Ķirurģiskais šablons' } },
  { id: 'titanium-mesh', kind: 'implant', unit: 'too', implantBased: false,
    names: { en: 'Titanium mesh', et: 'Titaanvõrk', ru: 'Титановая сетка', lv: 'Titāna siets' } },

  // Dentures
  { id: 'denture-full', kind: 'denture', unit: 'too', implantBased: false,
    names: { en: 'Full denture', et: 'Täisprotees', ru: 'Полный съёмный протез', lv: 'Pilna protēze' } },
  { id: 'denture-partial', kind: 'denture', unit: 'too', implantBased: false,
    names: { en: 'Partial denture', et: 'Osaprotees', ru: 'Частичный съёмный протез', lv: 'Daļēja protēze' } },
  { id: 'denture-immediate', kind: 'denture', unit: 'too', implantBased: false,
    names: { en: 'Immediate denture', et: 'Kohene protees', ru: 'Иммедиат-протез', lv: 'Tūlītējā protēze' } },
  { id: 'denture-reline', kind: 'denture', unit: 'too', implantBased: false,
    names: { en: 'Denture reline', et: 'Proteesi ümbervooderdus', ru: 'Перебазировка протеза', lv: 'Protēzes pārbāzēšana' } },
  { id: 'denture-repair', kind: 'denture', unit: 'too', implantBased: false,
    names: { en: 'Denture repair', et: 'Proteesi parandus', ru: 'Починка протеза', lv: 'Protēzes remonts' } },
  { id: 'bite-rim', kind: 'denture', unit: 'too', implantBased: false, teeth: 'arch',
    names: { en: 'Bite rim', et: 'Hammustusvall', ru: 'Восковой валик', lv: 'Sakodiena veltnis' } },
  { id: 'gingival-mask', kind: 'denture', unit: 'too', implantBased: false, teeth: 'arch',
    names: { en: 'Gingival mask', et: 'Igemmask', ru: 'Десневая маска', lv: 'Smaganu maska' } },

  // Guards, retainers, appliances
  { id: 'night-guard', kind: 'guard', unit: 'too', implantBased: false,
    names: { en: 'Night guard / splint', et: 'Öökaitse / splint', ru: 'Ночная каппа / сплинт', lv: 'Nakts šina' } },
  { id: 'sports-guard', kind: 'guard', unit: 'too', implantBased: false, teeth: 'none',
    names: { en: 'Sports guard', et: 'Spordikaitse', ru: 'Спортивная каппа', lv: 'Sporta aizsargs' } },
  { id: 'sleep-apnea', kind: 'guard', unit: 'too', implantBased: false, teeth: 'none',
    names: { en: 'Sleep apnea appliance', et: 'Uneapnoe aparaat', ru: 'Аппарат от апноэ сна', lv: 'Miega apnojas aparāts' } },
  { id: 'whitening-tray', kind: 'guard', unit: 'too', implantBased: false, teeth: 'none',
    names: { en: 'Whitening tray', et: 'Valgenduskapp', ru: 'Капа для отбеливания', lv: 'Balināšanas kape' } },
  { id: 'aligner', kind: 'guard', unit: 'too', implantBased: false, teeth: 'none',
    names: { en: 'Aligner', et: 'Alainer', ru: 'Элайнер', lv: 'Elaineris' } },
  { id: 'retainer-fixed', kind: 'guard', unit: 'too', implantBased: false,
    names: { en: 'Fixed retainer', et: 'Fikseeritud retainer', ru: 'Несъёмный ретейнер', lv: 'Fiksēts retainers' } },
  { id: 'retainer-removable', kind: 'guard', unit: 'too', implantBased: false,
    names: { en: 'Removable retainer', et: 'Eemaldatav retainer', ru: 'Съёмный ретейнер', lv: 'Izņemams retainers' } },
  { id: 'space-maintainer', kind: 'guard', unit: 'too', implantBased: false, teeth: 'none',
    names: { en: 'Space maintainer', et: 'Ruumihoidja', ru: 'Аппарат для сохранения места', lv: 'Vietas uzturētājs' } },

  // Models and trays
  { id: 'model', kind: 'model', unit: 'too', implantBased: false,
    names: { en: 'Model', et: 'Mudel', ru: 'Модель', lv: 'Modelis' } },
  { id: 'wax-up', kind: 'model', unit: 'hammas', implantBased: false,
    names: { en: 'Wax-up', et: 'Vahamodelleering', ru: 'Восковое моделирование', lv: 'Vaska modelēšana' } },
  { id: 'impression-tray', kind: 'model', unit: 'too', implantBased: false,
    names: { en: 'Custom impression tray', et: 'Individuaalne jäljendilusikas', ru: 'Индивидуальная ложка', lv: 'Individuālā nospieduma karote' } },

  // Digital
  { id: 'digital-scan', kind: 'digital', unit: 'too', implantBased: false, teeth: 'none',
    names: { en: 'Digital scan', et: 'Digitaalne skaneering', ru: 'Цифровое сканирование', lv: 'Digitālā skenēšana' } },
  { id: 'crown-design', kind: 'digital', unit: 'hammas', implantBased: false,
    names: { en: 'Crown design (CAD)', et: 'Krooni disain (CAD)', ru: 'Дизайн коронки (CAD)', lv: 'Kroņa dizains (CAD)' } },
  { id: 'smile-design', kind: 'digital', unit: 'too', implantBased: false,
    names: { en: 'Smile design', et: 'Naeratuse disain', ru: 'Дизайн улыбки', lv: 'Smaida dizains' } },

  // Other
  { id: 'remake', kind: 'other', unit: 'too', implantBased: false,
    names: { en: 'Remake', et: 'Ümbertegemine', ru: 'Переделка', lv: 'Pārtaisīšana' } },
  { id: 'other', kind: 'other', unit: 'too', implantBased: false,
    names: { en: 'Other work', et: 'Muu töö', ru: 'Другая работа', lv: 'Cits darbs' } },
]

/** The options the groups above offer. Names only: the price is the clinic's. */
export const OPTIONS: readonly { id: string; names: Names }[] = [
  { id: 'metal-bar', names: { en: 'Metal bar', et: 'Metallraam', ru: 'Металлическая балка', lv: 'Metāla sija' } },
  { id: 'zirconia-framework', names: { en: 'Zirconia framework', et: 'Tsirkooniumraam', ru: 'Циркониевый каркас', lv: 'Cirkonija karkass' } },
  { id: 'cocr-framework', names: { en: 'CoCr framework', et: 'CoCr raam', ru: 'Каркас CoCr', lv: 'CoCr karkass' } },
  { id: 'peek-bar', names: { en: 'PEEK bar', et: 'PEEK raam', ru: 'Балка PEEK', lv: 'PEEK sija' } },
  { id: 'titanium-mesh', names: { en: 'Titanium mesh', et: 'Titaanvõrk', ru: 'Титановая сетка', lv: 'Titāna siets' } },
  { id: 'multi-unit', names: { en: 'Multi-unit abutment', et: 'Multi-unit abutment', ru: 'Мультиюнит', lv: 'Multi-unit abatments' } },
  { id: 'ti-base', names: { en: 'Ti-base', et: 'Ti-base', ru: 'Ti-base', lv: 'Ti-base' } },
  { id: 'screw-retained', names: { en: 'Screw-retained', et: 'Kruviga kinnitatud', ru: 'Винтовая фиксация', lv: 'Ar skrūves fiksāciju' } },
  { id: 'cement-retained', names: { en: 'Cement-retained', et: 'Tsemendiga kinnitatud', ru: 'Цементная фиксация', lv: 'Ar cementa fiksāciju' } },
  { id: 'locator', names: { en: 'Locator', et: 'Locator', ru: 'Локатор', lv: 'Lokators' } },
  { id: 'ball-attachment', names: { en: 'Ball attachment', et: 'Kuulkinnitus', ru: 'Шаровый аттачмент', lv: 'Lodveida stiprinājums' } },
  { id: 'pink-gingiva', names: { en: 'Pink gingiva', et: 'Roosa igemeosa', ru: 'Розовая десна', lv: 'Rozā smaganas' } },
  { id: 'temporary-pmma', names: { en: 'Temporary PMMA', et: 'Ajutine PMMA', ru: 'Временный PMMA', lv: 'Pagaidu PMMA' } },
]

const KIND_HEX: Record<CatalogueKind, string> = {
  crown: '#3B82F6', bridge: '#8B5CF6', implant: '#6366F1', denture: '#F43F5E',
  guard: '#06B6D4', model: '#94A3B8', digital: '#0EA5E9', other: '#64748B',
}

export const catalogueEntry = (id: string | null | undefined): CatalogueEntry | undefined =>
  id ? CATALOGUE.find(e => e.id === id) : undefined

/** Every name of an entry, lowercase: how it is matched, searched and recognised. */
export const entryWords = (e: Pick<CatalogueEntry, 'names'>): string[] =>
  [...new Set(Object.values(e.names).map(n => n.toLowerCase()))]

/** The catalogue language for a clinic's language; Latvian has its own names. */
export const catalogueLang = (lang: string | null | undefined): CatalogueLang =>
  lang === 'et' || lang === 'ru' || lang === 'lv' ? lang : 'en'

/**
 * The work type made from an entry, and the options it needs that the clinic's
 * library does not have yet.
 *
 * Named in the clinic's language, with the entry's other names as synonyms (so
 * the form's rules and the pictures recognise it whatever it is later called),
 * the entry's unit, NO price. An existing work type is never touched; a name
 * already on the list gets a number ("Zirconia crown 2").
 */
export function workTypeFromCatalogue(
  entry: CatalogueEntry,
  lang: CatalogueLang,
  existing: readonly WorkType[],
  library: readonly WorkOption[],
): { type: WorkType; newOptions: WorkOption[] } {
  const base = entry.names[lang]
  const taken = new Set(existing.map(t => t.nimi.toLowerCase()))
  let nimi = base
  for (let i = 2; taken.has(nimi.toLowerCase()); i++) nimi = `${base} ${i}`

  const inLibrary = new Set(library.map(o => o.id))
  const newOptions: WorkOption[] = []
  for (const g of entry.groups ?? []) {
    for (const id of g.options) {
      if (inLibrary.has(id)) continue
      const o = OPTIONS.find(x => x.id === id)
      if (!o) continue
      inLibrary.add(id)
      newOptions.push({ id, nimi: o.names[lang], yhik: 'too' })
    }
  }
  const valikuGrupid: WorkOptionGroup[] = (entry.groups ?? []).map(g => ({
    key: g.key, nimi: g.names[lang], mitu: g.mitu, valikud: [...g.options],
  }))

  return {
    type: {
      nimi,
      hex: KIND_HEX[entry.kind],
      hinnaTyyp: entry.unit,
      match: entryWords(entry).filter(w => w !== nimi.toLowerCase()),
      katalog: entry.id,
      ...(entry.teeth ? { hambaviis: entry.teeth } : {}),
      ...(valikuGrupid.length > 0 ? { valikuGrupid } : {}),
    },
    newOptions,
  }
}
