/**
 * The 2.2.3 hand test, without a database: two windows, one job.
 *
 *   A: Edit → a note and a new price, Save.
 *   B: moves the job to the next stage.
 *   B opens the job again → sees A's note and price, and the stage.
 *
 * Before the fix B's jobs list was never told (realtime held the token from
 * before the second-factor code, lib/realtimeAuth) and opening a job read
 * only that list, so B showed the old note and price until Ctrl+R.
 */
import { describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { guardedSave, type GuardedIo, type Row } from '@shared/concurrency/guardedSave'
import type { Job } from '../types/job'

vi.mock('../lib/supabase', () => ({ supabase: {} }))
const { refreshJobInCache, withJobReplaced, JOB_MERGEABLE } = await import('./useJobs')
const { followTokenForRealtime } = await import('../lib/realtimeAuth')

const start = {
  id: 'j1', patsient: 'Test', status: 'disain', hind: 300, markused: [] as { id: string; tekst: string }[],
  updated_at: 't1',
} as unknown as Job

/** The stored row, as the database keeps it. */
function database() {
  let row: Row = structuredClone(start) as unknown as Row
  let n = 1
  const io: GuardedIo<Row> = {
    async write(patch, expected) {
      if (row.updated_at !== expected) return null
      row = { ...row, ...structuredClone(patch), updated_at: `t${++n}` }
      return structuredClone(row)
    },
    async read() { return structuredClone(row) },
  }
  return {
    io,
    get row() { return row as unknown as Job },
    plainUpdate(patch: Record<string, unknown>) { row = { ...row, ...patch, updated_at: `t${++n}` } },
    read: async (id: string) => (id === row.id ? structuredClone(row) as unknown as Job : null),
  }
}

/** A window: its own jobs list, as react-query keeps it. */
function windowWith(job: Job) {
  const qc = new QueryClient()
  qc.setQueryData<Job[]>(['jobs'], [structuredClone(job), { ...structuredClone(job), id: 'other' }])
  return { qc, job: (id = 'j1') => qc.getQueryData<Job[]>(['jobs'])!.find(j => j.id === id)! }
}

describe('two windows, one job (the 2.2.3 hand test)', () => {
  it('B opens the job after A saved: A\'s note and price are there, and B\'s stage', async () => {
    const db = database()
    const a = windowWith(db.row)
    const b = windowWith(db.row)

    // A: Edit pressed; a note added and the price changed.
    const aStart = a.job()
    // B: moves the stage (a plain update of the one field, as on the board).
    db.plainUpdate({ status: 'valmis' })
    b.qc.setQueryData<Job[]>(['jobs'], old => old!.map(j => (j.id === 'j1' ? { ...j, status: 'valmis' } : j)))
    // A saves: over a row B has changed meanwhile.
    const saved = await guardedSave(db.io, aStart as unknown as Row,
      { hind: 350, markused: [{ id: 'n1', tekst: 'Test' }] }, { mergeable: JOB_MERGEABLE })
    expect(saved.kind).toBe('saved')
    expect(db.row).toMatchObject({ status: 'valmis', hind: 350, markused: [{ id: 'n1', tekst: 'Test' }] })

    // B, no event heard: its list still has the old note and price.
    expect(b.job()).toMatchObject({ hind: 300, markused: [] })
    // B opens the job: it is read from the database.
    await refreshJobInCache(b.qc, 'j1', db.read)
    expect(b.job()).toMatchObject({ status: 'valmis', hind: 350, markused: [{ id: 'n1', tekst: 'Test' }] })
    // The other jobs in B's list are as they were.
    expect(b.job('other').hind).toBe(300)
  })

  it('a job that cannot be read (offline, deleted) leaves the list as it is', async () => {
    const b = windowWith(start)
    await refreshJobInCache(b.qc, 'j1', async () => null)
    expect(b.job().hind).toBe(300)
    expect(withJobReplaced(undefined, start)).toBeUndefined()
    expect(withJobReplaced([start], { ...start, id: 'x' } as Job)).toEqual([start])
  })
})

describe('realtime gets the token signed in with the second factor', () => {
  it('passed on after the code is typed (MFA_CHALLENGE_VERIFIED), once per token', async () => {
    vi.useFakeTimers()
    let emit: (event: string, session: { access_token: string } | null) => void = () => {}
    const setAuth = vi.fn()
    followTokenForRealtime({
      onAuthStateChange: cb => { emit = cb as typeof emit },
      setRealtimeAuth: setAuth,
    })
    emit('SIGNED_IN', { access_token: 'aal1' })
    emit('MFA_CHALLENGE_VERIFIED', { access_token: 'aal2' })
    emit('TOKEN_REFRESHED', { access_token: 'aal2' })
    await vi.runAllTimersAsync()
    expect(setAuth.mock.calls.map(c => c[0])).toEqual(['aal1', 'aal2'])

    emit('SIGNED_OUT', null)
    emit('SIGNED_IN', { access_token: 'aal2' })
    await vi.runAllTimersAsync()
    expect(setAuth.mock.calls.map(c => c[0])).toEqual(['aal1', 'aal2', 'aal2'])
    vi.useRealTimers()
  })
})
