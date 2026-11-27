/**
 * The board reads the switched-off stages of all its cards in one call
 * (sql/139 job_skipped_stages), not one read per card. A database without the
 * function: job_stage read directly, a few ids at a time; without job stages
 * at all: none, and the arrows work as before.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

let rpcAnswer: { data: unknown; error: { code: string; message: string } | null } = { data: [], error: null }
let tableAnswer: (ids: string[]) => { data: unknown; error: { code: string; message: string } | null } = () => ({ data: [], error: null })
const rpcCalls: { fn: string; args: unknown }[] = []
const tableReads: string[][] = []

vi.mock('./supabase', () => ({
  supabase: {
    rpc: async (fn: string, args: unknown) => { rpcCalls.push({ fn, args }); return rpcAnswer },
    from: () => ({
      select: () => ({
        in: (_col: string, ids: string[]) => ({
          not: async () => { tableReads.push(ids); return tableAnswer(ids) },
        }),
      }),
    }),
  },
}))

import { fetchSkippedStages } from './jobStages'

beforeEach(() => { rpcCalls.length = 0; tableReads.length = 0 })

describe('fetchSkippedStages', () => {
  it('one call for every card', async () => {
    rpcAnswer = { data: [{ job_id: 'j1', stage_key: 'b' }, { job_id: 'j3', stage_key: 'c' }], error: null }
    const ids = Array.from({ length: 300 }, (_, i) => `j${i}`)
    const m = await fetchSkippedStages(ids)
    expect(rpcCalls).toEqual([{ fn: 'job_skipped_stages', args: { p_jobs: ids } }])
    expect(tableReads).toEqual([])
    expect([...m.get('j1')!]).toEqual(['b'])
    expect([...m.get('j3')!]).toEqual(['c'])
  })

  it('no cards: nothing asked', async () => {
    expect((await fetchSkippedStages([])).size).toBe(0)
    expect(rpcCalls).toEqual([])
  })

  it('a database without the function: job_stage read directly, in parts', async () => {
    rpcAnswer = { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }
    tableAnswer = ids => ({ data: ids.includes('j100') ? [{ job_id: 'j100', stage_key: 'd' }] : [], error: null })
    const ids = Array.from({ length: 170 }, (_, i) => `j${i}`)
    const m = await fetchSkippedStages(ids)
    expect(tableReads.map(r => r.length)).toEqual([80, 80, 10])
    expect([...m.get('j100')!]).toEqual(['d'])
  })

  it('a database without job stages: none', async () => {
    rpcAnswer = { data: null, error: { code: '42883', message: 'function does not exist' } }
    tableAnswer = () => ({ data: null, error: { code: '42P01', message: 'relation "job_stage" does not exist' } })
    expect((await fetchSkippedStages(['j1'])).size).toBe(0)
  })

  it('any other error is thrown, not taken for "none"', async () => {
    rpcAnswer = { data: null, error: { code: '42501', message: 'Sign in with your second factor first' } }
    await expect(fetchSkippedStages(['j1'])).rejects.toMatchObject({ code: '42501' })
  })
})
