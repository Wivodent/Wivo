/**
 * Wivo Network's languages (English, Latvian, Russian, Estonian).
 *
 * Every message key the Network's screens use, found by walking the imports
 * from its entry (mobile/networkMain.tsx, which is also what a clinic's
 * /network renders: mobile/network/NetworkApp.tsx), has a translation in
 * each of them, with the same placeholders. Latvian exists only for these
 * keys; the rest of the app stays en/et/ru.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { en, type MessageKey } from './en'
import { et } from './et'
import { ru } from './ru'
import { lv } from './lv'
import {
  LANGS, NETWORK_LANGS, browserNetworkLang, networkLangFrom, networkLanguageDecision, translate, type Message,
} from './index'

const ROOT = resolve(__dirname, '../..')
const ENTRY = 'src/renderer/src/mobile/networkMain.tsx'

function resolveImport(from: string, spec: string): string | null {
  let base: string
  if (spec.startsWith('@shared/')) base = join(ROOT, 'shared', spec.slice(8))
  else if (spec.startsWith('@/')) base = join(ROOT, 'src/renderer/src', spec.slice(2))
  else if (spec.startsWith('.')) base = resolve(dirname(from), spec)
  else return null
  for (const ext of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) {
    const p = base + ext
    if (/\.(ts|tsx)$/.test(p) && existsSync(p)) return p
  }
  return null
}

/** The files the Network's bundle is made of (ours, not node_modules), and the keys they name. */
function networkKeys(): { files: string[]; keys: MessageKey[] } {
  const seen = new Set<string>()
  const keys = new Set<MessageKey>()
  const walk = (file: string): void => {
    if (seen.has(file)) return
    seen.add(file)
    if (/[\\/]shared[\\/]i18n[\\/]/.test(file)) return
    const src = readFileSync(file, 'utf8')
    for (const m of src.matchAll(/['`]([a-zA-Z][a-zA-Z0-9]*\.[a-zA-Z0-9_.]+)['`]/g)) {
      if (m[1] in en) keys.add(m[1] as MessageKey)
    }
    for (const m of src.matchAll(/(?:import|export)[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const spec = m[1] ?? m[2]
      if (spec.endsWith('?raw')) continue
      const p = resolveImport(file, spec)
      if (p) walk(p)
    }
  }
  walk(join(ROOT, ENTRY))
  return { files: [...seen], keys: [...keys] }
}

const { files, keys } = networkKeys()
const placeholders = (m: Message | undefined): string[] =>
  typeof m === 'string' ? [...m.matchAll(/\{(\w+)\}/g)].map(x => x[1]).sort() : []

describe('the Network speaks four languages', () => {
  it('finds the Network\'s screens and their keys', () => {
    expect(files.some(f => f.endsWith('NetworkApp.tsx'))).toBe(true)
    expect(keys.length).toBeGreaterThan(300)
    expect(keys).toContain('network.signIn')
  })

  it.each([['lv', lv], ['et', et], ['ru', ru]] as const)('every key the Network uses is in %s', (_name, catalog) => {
    expect(keys.filter(k => catalog[k] === undefined)).toEqual([])
  })

  it.each([['lv', lv], ['et', et], ['ru', ru]] as const)('%s keeps every placeholder of the English', (_name, catalog) => {
    const wrong = keys.filter(k => typeof en[k] === 'string' && typeof catalog[k] === 'string'
      && placeholders(catalog[k]).join() !== placeholders(en[k]).join())
    expect(wrong).toEqual([])
  })

  it('Latvian holds only keys that exist in English, and is for the Network only', () => {
    expect(Object.keys(lv).filter(k => !(k in en))).toEqual([])
    expect(LANGS).toEqual(['en', 'et', 'ru'])
    expect(NETWORK_LANGS).toEqual(['en', 'lv', 'ru', 'et'])
  })

  it('Latvian counts: one form for 1 and 21, another for 2, 11 and 0', () => {
    expect(translate('lv', 'wizard.teeth2', { n: 1 })).toBe('1 zobs')
    expect(translate('lv', 'wizard.teeth2', { n: 21 })).toBe('21 zobs')
    expect(translate('lv', 'wizard.teeth2', { n: 11 })).toBe('11 zobi')
    expect(translate('lv', 'wizard.teeth2', { n: 2 })).toBe('2 zobi')
    expect(translate('lv', 'network.nOpenOrders', { n: 3 })).toBe('3 atvērti pasūtījumi')
    expect(translate('ru', 'wizard.toothTeeth2', { sorted: [11, 12] })).toBe('2 зуба')
    expect(translate('ru', 'wizard.toothTeeth2', { sorted: [11, 12, 13, 14, 15] })).toBe('5 зубов')
  })

  it('a key the Network does not use falls back to English in Latvian', () => {
    expect(lv['testCopy.fakeLabel']).toBeUndefined()
    expect(translate('lv', 'testCopy.fakeLabel')).toBe(en['testCopy.fakeLabel'])
  })
})

describe('which language a Network page shows', () => {
  it('first visit: the browser\'s, if the Network has it; else English', () => {
    expect(browserNetworkLang(['lv-LV', 'en'])).toBe('lv')
    expect(browserNetworkLang(['de-DE', 'ru'])).toBe('ru')
    expect(browserNetworkLang(['et'])).toBe('et')
    expect(browserNetworkLang(['fi', 'de'])).toBe('en')
    expect(browserNetworkLang(undefined)).toBe('en')
  })

  it('a choice made on this device wins over the browser', () => {
    expect(networkLangFrom('et', ['lv'])).toBe('et')
    expect(networkLangFrom('xx', ['lv'])).toBe('lv')
    expect(networkLangFrom(null, ['de'])).toBe('en')
  })

  it('after sign-in: this device\'s choice, else the account\'s, else the browser\'s saved', () => {
    expect(networkLanguageDecision({ account: 'ru', current: 'lv', chosenHere: true })).toEqual({ lang: 'lv', save: true })
    expect(networkLanguageDecision({ account: 'lv', current: 'lv', chosenHere: true })).toEqual({ lang: 'lv', save: false })
    expect(networkLanguageDecision({ account: 'ru', current: 'en', chosenHere: false })).toEqual({ lang: 'ru', save: false })
    expect(networkLanguageDecision({ account: null, current: 'en', chosenHere: false })).toEqual({ lang: 'en', save: true })
    expect(networkLanguageDecision({ account: 'de', current: 'et', chosenHere: false })).toEqual({ lang: 'et', save: true })
  })
})
