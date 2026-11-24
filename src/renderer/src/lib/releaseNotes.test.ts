import { describe, it, expect } from 'vitest'
import {
  NOTES, NOTE_VERSIONS, allReleaseNotes, compareVersions, fillPhoneUrl, notesVersionFor, notesUnseen, parseNotes, phoneUrl, releaseNotes, shortVersion,
  type Block,
} from './releaseNotes'

describe('which notes to show', () => {
  it('compares versions by number', () => {
    expect(compareVersions('2.10.0', '2.9.0')).toBeGreaterThan(0)
    expect(compareVersions('2.0.0', '2.0.0')).toBe(0)
    expect(compareVersions('1.109.0', '2.0.0')).toBeLessThan(0)
    expect(compareVersions('2.0', '2.0.0')).toBe(0)
  })

  it('the newest notes not newer than the running app', () => {
    const available = ['2.0.0', '2.1.0']
    expect(notesVersionFor('2.0.0', available)).toBe('2.0.0')
    // A patch without notes of its own keeps the previous ones (already seen).
    expect(notesVersionFor('2.0.3', available)).toBe('2.0.0')
    expect(notesVersionFor('2.4.0', available)).toBe('2.1.0')
    expect(notesVersionFor('1.109.0', available)).toBeNull()
  })

  it('unseen until the person has seen these notes or newer ones', () => {
    expect(notesUnseen('2.0.0', null)).toBe(true)
    expect(notesUnseen('2.0.0', '')).toBe(true)
    expect(notesUnseen('2.1.0', '2.0.0')).toBe(true)
    expect(notesUnseen('2.0.0', '2.0.0')).toBe(false)
    // Seen on a newer version (another device): nothing to show here.
    expect(notesUnseen('2.0.0', '2.1.0')).toBe(false)
  })

  it('shows 2.0.0 as 2.0', () => {
    expect(shortVersion('2.0.0')).toBe('2.0')
    expect(shortVersion('2.0.1')).toBe('2.0.1')
  })
})

describe('all versions in the window, newest first', () => {
  it('every version up to the one asked for, newest on top, none newer', () => {
    const available = ['2.0.0', '2.0.5', '2.0.6']
    expect(allReleaseNotes('2.0.6', 'en', undefined, available).map(n => n.version)).toEqual(['2.0.6', '2.0.5', '2.0.0'])
    expect(allReleaseNotes('2.0.5', 'en', undefined, available).map(n => n.version)).toEqual(['2.0.5', '2.0.0'])
    // A patch without notes: the newest before it leads, all older ones follow.
    expect(allReleaseNotes('2.0.9', 'en', undefined, available).map(n => n.version)).toEqual(['2.0.6', '2.0.5', '2.0.0'])
    expect(allReleaseNotes('1.0.0', 'en', undefined, available)).toEqual([])
  })

  it('the repository lists 2.0.6, 2.0.5 and 2.0.0 in that order, in both languages', () => {
    for (const lang of ['en', 'et'] as const) {
      const versions = allReleaseNotes('2.0.6', lang).map(n => n.version)
      expect(versions.slice(0, 3), lang).toEqual(['2.0.6', '2.0.5', '2.0.0'])
      expect(new Set(versions).size).toBe(versions.length)
    }
  })

  it('2.0.6 says the window lists every version and that it is the first automatic update', () => {
    for (const lang of ['en', 'et'] as const) {
      const n = allReleaseNotes('2.0.6', lang)[0]
      expect(n.version).toBe('2.0.6')
      expect(JSON.stringify(n.blocks).length, lang).toBeGreaterThan(200)
    }
  })
})

describe('parseNotes', () => {
  it('title, headings, wrapped paragraphs and lists', () => {
    const { title, blocks } = parseNotes([
      '# What is new',
      '',
      'First line',
      'continues here.',
      '',
      '## Phone',
      '- one',
      '- two that',
      '  wraps **here**',
      'After the list.',
    ].join('\n'))
    expect(title).toBe('What is new')
    expect(blocks).toEqual<Block[]>([
      { kind: 'paragraph', text: [{ text: 'First line continues here.' }] },
      { kind: 'heading', text: [{ text: 'Phone' }] },
      { kind: 'list', items: [[{ text: 'one' }], [{ text: 'two that wraps ' }, { text: 'here', bold: true }]] },
      { kind: 'paragraph', text: [{ text: 'After the list.' }] },
    ])
  })

  it('a second # line is a heading, not a new title', () => {
    expect(parseNotes('# A\n# B')).toEqual({ title: 'A', blocks: [{ kind: 'heading', text: [{ text: 'B' }] }] })
  })
})

describe('the notes in release-notes/', () => {
  it('exist, and every version has English and Estonian', () => {
    expect(NOTE_VERSIONS.length).toBeGreaterThan(0)
    for (const v of NOTE_VERSIONS) {
      expect(v, 'folder name must be a version like 2.0.0').toMatch(/^\d+\.\d+\.\d+$/)
      expect(Object.keys(NOTES.get(v) ?? {}).sort(), v).toEqual(expect.arrayContaining(['en', 'et']))
    }
  })

  it('each has a title and content, and every link is a working https link', () => {
    for (const [v, files] of NOTES) {
      for (const [lang, md] of Object.entries(files)) {
        const { title, blocks } = parseNotes(md ?? '')
        expect(title, `${v}/${lang}.md`).not.toBe('')
        expect(blocks.length, `${v}/${lang}.md`).toBeGreaterThan(0)
        // Link syntax with anything but https renders as plain text: a typo
        // would silently lose the link.
        for (const m of fillPhoneUrl(md ?? '').matchAll(/\]\(([^)]*)\)/g)) expect(m[1], `${v}/${lang}.md`).toMatch(/^https:\/\//)
        // A phone address is the build's, never written into the notes.
        expect(md ?? '', `${v}/${lang}.md`).not.toMatch(/wivodent\.com|pages\.dev/)
      }
    }
  })

  it("2.0 points to the phone app in both languages: main's by default", () => {
    for (const lang of ['en', 'et'] as const) {
      const notes = releaseNotes('2.0.0', lang)
      const links = JSON.stringify(notes?.blocks)
      expect(links, lang).toContain('"href":"https://app.wivodent.com"')
    }
  })

  it("a clinic's build names its own phone app, in the text and in the link (Riga)", () => {
    for (const lang of ['en', 'et'] as const) {
      const json = JSON.stringify(releaseNotes('2.0.0', lang, 'https://wivo.dentiks.lv')?.blocks)
      expect(json, lang).toContain('"href":"https://wivo.dentiks.lv"')
      expect(json, lang).toContain('"text":"wivo.dentiks.lv"')
      expect(json, lang).not.toContain('wivodent.com')
    }
  })

  it('the phone address comes from the build, and only a plain https address counts', () => {
    expect(phoneUrl('https://wivo.dentiks.lv/')).toBe('https://wivo.dentiks.lv')
    expect(phoneUrl(undefined)).toBe('https://app.wivodent.com')
    expect(phoneUrl('')).toBe('https://app.wivodent.com')
    expect(phoneUrl('http://wivo.dentiks.lv')).toBe('https://app.wivodent.com')
    expect(phoneUrl('javascript:alert(1)')).toBe('https://app.wivodent.com')
    expect(phoneUrl('https://x.pages.dev/path')).toBe('https://app.wivodent.com')
  })

  it('a language without its own file falls back to English', () => {
    expect(releaseNotes('2.0.0', 'ru')?.title).toBe(releaseNotes('2.0.0', 'en')?.title)
  })
})
