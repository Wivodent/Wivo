/**
 * A move refused because the target stage is switched off on the job says so,
 * with "Turn on and move" for whoever may switch it back on; the same refusal
 * for somebody not on the job's stages says that instead.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('./supabase', () => ({ supabase: {} }))

import { explainStageMove, type StageMoveLookups } from './stageMoveError'
import { en } from '@shared/i18n/en'
import { t } from './i18n'


const verdictRefused = { code: '42501', message: 'You may not move this job from design to milling' }

const lookups = (skipped: boolean | null | 'throw', mayEdit: boolean | 'throw' = false): StageMoveLookups & { asked: string[] } => {
  const asked: string[] = []
  return {
    asked,
    targetSkipped: async (job, stage) => {
      asked.push(`skipped ${job} ${stage}`)
      if (skipped === 'throw') throw new Error('offline')
      return skipped
    },
    mayEditStages: async job => {
      asked.push(`edit ${job}`)
      if (mayEdit === 'throw') throw new Error('offline')
      return mayEdit
    },
  }
}

describe('explainStageMove', () => {
  it('the target is switched off, and I may edit the stages: say so, offer to turn it on', async () => {
    const l = lookups(true, true)
    expect(await explainStageMove(verdictRefused, 'job', 'milling', l)).toEqual({
      message: t('workflow.stageSwitchedOff'), switchedOff: true, mayTurnOn: true,
    })
    expect(l.asked).toEqual(['skipped job milling', 'edit job'])
  })

  it('switched off, and I may not edit the stages: the reason, no button', async () => {
    expect(await explainStageMove(verdictRefused, 'job', 'milling', lookups(true, false)))
      .toEqual({ message: t('workflow.stageSwitchedOff'), switchedOff: true, mayTurnOn: false })
    expect((await explainStageMove(verdictRefused, 'job', 'milling', lookups(true, 'throw'))).mayTurnOn).toBe(false)
  })

  it('the target is on: I am not on the job\'s stages', async () => {
    const r = await explainStageMove(verdictRefused, 'job', 'milling', lookups(false, true))
    expect(r).toEqual({ message: t('workflow.moveNotOnStage'), switchedOff: false, mayTurnOn: false })
  })

  it('cannot tell (lookup failed or refused): the general explanation, never "no permission"', async () => {
    for (const l of [lookups(null), lookups('throw')]) {
      const r = await explainStageMove(verdictRefused, 'job', 'milling', l)
      expect(r.message).toBe(t('workflow.moveRefused'))
      expect(r.mayTurnOn).toBe(false)
    }
  })

  it('any other error: told as describeError tells it, nothing looked up', async () => {
    const l = lookups(true, true)
    expect((await explainStageMove({ code: '42501', message: 'Moving from design to milling is not allowed' }, 'job', 'milling', l)).message)
      .toBe(t('workflow.moveAgainstRule'))
    expect((await explainStageMove({ code: '42501', message: 'No permission to move jobs' }, 'job', 'milling', l)).message)
      .toBe(t('app.noPermission'))
    expect(l.asked).toEqual([])
  })
})
