/**
 * A template is saved by ONE call (save_workflow_template, sql/133), never by
 * the four requests that could leave it without stages (2.2.4).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpc = vi.fn()
const from = vi.fn()
vi.mock('./supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a), from: (...a: unknown[]) => from(...a) } }))
const { saveTemplate, stagesPayload } = await import('./workflowTemplates')
const { isConflict } = await import('@shared/concurrency/guardedSave')

const st = (stageKey: string, extra: object = {}) => ({
  stageKey, position: 9, task: '  ', optional: false, defaultOn: false, onlyIf: [], orderer: false, payRole: null, people: ['p1', 'p1'], ...extra,
})

beforeEach(() => { rpc.mockReset(); from.mockReset() })

describe('saveTemplate', () => {
  it('one call with the stages in order, positions and people cleaned; no table is written directly', async () => {
    rpc.mockResolvedValue({ data: { id: 't1', updated_at: 'x' }, error: null })
    const r = await saveTemplate('org', { id: 't1', name: ' Crowns ', stages: [st('disain', { payRole: 'disain' }), st('valmis')], updatedAt: '2026-11-26T10:00:00+00:00' })
    expect(r).toEqual({ id: 't1' })
    expect(from).not.toHaveBeenCalled()
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('save_workflow_template', {
      p_id: 't1', p_name: 'Crowns', p_expected_updated_at: '2026-11-26T10:00:00+00:00',
      p_stages: [
        { stage_key: 'disain', task: null, optional: false, default_on: false, only_if: [], orderer: false, pay_role: 'disain', people: ['p1'] },
        { stage_key: 'valmis', task: null, optional: false, default_on: false, only_if: [], orderer: false, pay_role: null, people: ['p1'] },
      ],
    })
  })

  it('a new template sends no version', async () => {
    rpc.mockResolvedValue({ data: { id: 'new' }, error: null })
    await saveTemplate('org', { id: null, name: 'N', stages: [st('disain')], updatedAt: 'ignored' })
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_id: null, p_expected_updated_at: null })
  })

  it('somebody else saved first (WV003): a conflict for the banner', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'WV003', message: 'Someone else saved this template meanwhile' } })
    const err = await saveTemplate('org', { id: 't1', name: 'N', stages: [st('disain')], updatedAt: 'a' }).catch(e => e)
    expect(isConflict(err)).toBe(true)
  })

  it('what the form check finds is returned and nothing is sent', async () => {
    const r = await saveTemplate('org', { id: 't1', name: 'N', stages: [st('disain', { payRole: 'too' }), st('print', { payRole: 'too' })] })
    expect('problems' in r && r.problems.length).toBeTruthy()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('stagesPayload keeps the rules and the order', () => {
    expect(stagesPayload([{ ...st('a'), onlyIf: ['digital'], optional: false, people: ['x'] }])[0])
      .toMatchObject({ stage_key: 'a', only_if: ['digital'], people: ['x'] })
  })
})
