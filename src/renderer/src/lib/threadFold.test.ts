import { describe, expect, it, beforeEach } from 'vitest'
import { unreadCount, startsOpen, newestAt, lastLabel, readChoice, writeChoice, readSeen, writeSeen } from './threadFold'

const msgs = [
  { from_client: true, created_at: '2026-11-27T10:00:00Z' },
  { from_client: false, created_at: '2026-11-27T11:00:00Z' },
  { from_client: true, created_at: '2026-11-27T12:00:00Z' },
]

describe('the conversation folds', () => {
  it('unread: the other side’s messages after what was seen', () => {
    expect(unreadCount(msgs, 'clinic', null)).toBe(2)
    expect(unreadCount(msgs, 'clinic', '2026-11-27T11:30:00Z')).toBe(1)
    expect(unreadCount(msgs, 'clinic', '2026-11-27T12:00:00Z')).toBe(0)
    expect(unreadCount(msgs, 'client', '2026-11-27T10:30:00Z')).toBe(1)
  })

  it('open with unread messages; else the last choice; else closed', () => {
    expect(startsOpen(1, false)).toBe(true)
    expect(startsOpen(0, true)).toBe(true)
    expect(startsOpen(0, false)).toBe(false)
    expect(startsOpen(0, null)).toBe(false)
  })

  it('the newest message, and its time as the heading says it', () => {
    expect(newestAt(msgs)).toBe('2026-11-27T12:00:00Z')
    expect(newestAt([])).toBeNull()
    const now = new Date('2026-11-27T20:00:00')
    expect(lastLabel('2026-11-27T18:42:00', now)).toBe('18:42')
    expect(lastLabel('2026-11-20T18:42:00', now)).toMatch(/20 .* 18:42/)
    expect(lastLabel(null, now)).toBeNull()
  })

  describe('kept per person on this device', () => {
    const store = new Map<string, string>()
    beforeEach(() => {
      store.clear()
      ;(globalThis as { localStorage?: unknown }).localStorage = {
        getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) },
      }
    })
    it('the choice and what was seen, per person', () => {
      expect(readChoice('u1')).toBeNull()
      writeChoice('u1', true)
      expect(readChoice('u1')).toBe(true)
      expect(readChoice('u2')).toBeNull()
      writeSeen('u1', 'o1', '2026-11-27T12:00:00Z')
      expect(readSeen('u1', 'o1')).toBe('2026-11-27T12:00:00Z')
      expect(readSeen('u1', 'o2')).toBeNull()
    })
    it('a storage that refuses: nothing kept, nothing breaks', () => {
      ;(globalThis as { localStorage?: unknown }).localStorage = { getItem: () => { throw new Error('no') }, setItem: () => { throw new Error('no') } }
      expect(readChoice('u1')).toBeNull()
      expect(() => writeChoice('u1', true)).not.toThrow()
    })
  })
})
