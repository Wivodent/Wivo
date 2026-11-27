/**
 * 2.2.6: a job at a stage that is skipped on it kept no Previous or Next
 * button (the stage counted as "skipped", not "current"). Now: Next is the
 * next active stage, Previous the previous active one, the page warns, and
 * skipping the stage a job is at moves the job on to the next active stage.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const calls: { fn: string; args: Record<string, unknown> }[] = []
let rpcError: Record<string, { message: string; code: string }> = {}
let jobStatus = 'a'
let stageRows: { stage_key: string; position: number }[] = []

vi.mock('./supabase', () => ({
  supabase: {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args })
      return { data: null, error: rpcError[fn] ?? null }
    },
    from: (table: string) => ({
      select: () => ({
        eq: () => table === 'jobs'
          ? { maybeSingle: async () => ({ data: { status: jobStatus }, error: null }) }
          : Promise.resolve({ data: stageRows, error: null }),
      }),
    }),
  },
}))

import { applyStageEdits, atSkippedStage, firstActiveAfter, neighbours, skipStage, stageLines, type JobStage } from './jobStages'

const st = (stageKey: string, position: number, extra: Partial<JobStage> = {}): JobStage => ({
  id: stageKey, stageKey, position, task: null, skipped: false, startedAt: null, startedBy: null, doneAt: null, doneBy: null, people: [], ...extra,
})

beforeEach(() => { calls.length = 0; rpcError = {} })

describe('a job at a skipped stage', () => {
  const stages = [st('a', 0), st('b', 1, { skipped: true }), st('c', 2, { skipped: true }), st('d', 3), st('e', 4)]

  it('its stage is still the current one, marked skipped', () => {
    const lines = stageLines(stages, 'c')
    expect(lines.map(l => l.state)).toEqual(['done', 'skipped', 'current', 'upcoming', 'upcoming'])
    expect(lines[2].skipped).toBe(true)
    expect(atSkippedStage(lines)).toBe(true)
  })

  it('Next is the next active stage, Previous the previous active one', () => {
    const n = neighbours(stageLines(stages, 'c'))
    expect(n.next?.stageKey).toBe('d')
    expect(n.previous?.stageKey).toBe('a')
  })

  it('a job at an active stage: no warning, the same neighbours as before', () => {
    const lines = stageLines(stages, 'd')
    expect(atSkippedStage(lines)).toBe(false)
    expect(neighbours(lines)).toMatchObject({ previous: { stageKey: 'a' }, next: { stageKey: 'e' } })
  })

  it('upcoming stages count from the skipped current one, skipped ones not counted', () => {
    expect(stageLines(stages, 'b').map(l => l.stagesAway)).toEqual([null, null, null, 0, 1])
  })
})

describe('skipping the stage the job is at', () => {
  it('moves the job on to the next active stage', async () => {
    const lines = stageLines([st('a', 0), st('b', 1), st('c', 2, { skipped: true }), st('d', 3)], 'b')
    rpcError = { set_job_stage_skipped: { message: 'A done stage cannot be skipped', code: '22023' } }
    await skipStage('job', lines, 'b')
    expect(calls[0]).toEqual({ fn: 'move_job_stage', args: { p_job: 'job', p_to: 'd' } })
  })

  it('another stage is skipped as before, without moving the job', async () => {
    const lines = stageLines([st('a', 0), st('b', 1), st('c', 2)], 'a')
    await skipStage('job', lines, 'b')
    expect(calls).toEqual([{ fn: 'set_job_stage_skipped', args: { p_job: 'job', p_stage: 'b', p_skipped: true } }])
  })

  it('no active stage after it: refused, nothing moved', async () => {
    const lines = stageLines([st('a', 0), st('b', 1), st('c', 2, { skipped: true })], 'b')
    await expect(skipStage('job', lines, 'b')).rejects.toThrow()
    expect(calls).toEqual([])
  })

  it('a new job whose starting stage the form skipped starts at the first stage after it that is not skipped', async () => {
    jobStatus = 'a'
    stageRows = [{ stage_key: 'a', position: 0 }, { stage_key: 'b', position: 1 }, { stage_key: 'c', position: 2 }]
    await applyStageEdits('job', { people: {}, skipped: ['a', 'b'] })
    expect(calls).toEqual([
      { fn: 'set_job_stage_skipped', args: { p_job: 'job', p_stage: 'b', p_skipped: true } },
      { fn: 'move_job_stage', args: { p_job: 'job', p_to: 'c' } },
    ])
    expect(firstActiveAfter([{ stageKey: 'x', position: 0 }], 'x', new Set(['x']))).toBeNull()
  })
})

describe('the stage bar hides skipped stages (2.2.7)', () => {
  it('shows every stage but the skipped ones, and always the one the job is at', async () => {
    const { visibleStageLines } = await import('./jobStages')
    const stages = [st('a', 0), st('b', 1, { skipped: true }), st('c', 2, { skipped: true }), st('d', 3)]
    expect(visibleStageLines(stageLines(stages, 'a')).map(l => l.stageKey)).toEqual(['a', 'd'])
    // At a skipped stage (dragged there on the board): it shows, as the current one.
    const atSkipped = visibleStageLines(stageLines(stages, 'c'))
    expect(atSkipped.map(l => [l.stageKey, l.state])).toEqual([['a', 'done'], ['c', 'current'], ['d', 'upcoming']])
    // Shown on request, for taking a skip back.
    expect(visibleStageLines(stageLines(stages, 'a'), true).map(l => l.stageKey)).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('the board closes the stages a dragged job has switched off', () => {
  it('every skipped stage but the one the job is at', async () => {
    const { closedStagesFor } = await import('./jobStages')
    const stages = [st('a', 0), st('b', 1, { skipped: true }), st('c', 2, { skipped: true }), st('d', 3)]
    expect([...closedStagesFor(stages, 'a')].sort()).toEqual(['b', 'c'])
    expect([...closedStagesFor(stages, 'c')]).toEqual(['b'])
    expect(closedStagesFor([], 'a').size).toBe(0)
  })
})
