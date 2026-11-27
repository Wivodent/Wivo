/**
 * Why a job did not move to a stage, said for the move that was tried.
 *
 * The database refuses a move into a stage switched off (skipped) on the job
 * with the same words as a move by somebody not on the job's stages ("You may
 * not move this job from … to …", 42501). Knowing the job and the target, the
 * screen can tell them apart: the target's own row says whether it is
 * switched off, and may_edit_job_stages whether this person may switch it
 * back on ("Turn on and move").
 *
 * Every other error is told by describeError (lib/refusal for the rest).
 */
import { describeError } from '../components/Patients/errors'
import { refusalOf } from './refusal'
import { supabase } from './supabase'
import { t } from './i18n'

export interface StageMoveProblem {
  message: string
  /** The target stage is switched off on this job. */
  switchedOff: boolean
  /** …and this person may switch it back on: offer "Turn on and move". */
  mayTurnOn: boolean
}

export interface StageMoveLookups {
  /** Is `stage` skipped on this job? Null when it cannot be told. */
  targetSkipped: (jobId: string, stage: string) => Promise<boolean | null>
  /** may_edit_job_stages: owner, admin, Manage stages, or who ordered it with Edit jobs. */
  mayEditStages: (jobId: string) => Promise<boolean>
}

const fromDatabase: StageMoveLookups = {
  targetSkipped: async (jobId, stage) => {
    const { data, error } = await supabase.from('job_stage').select('skipped_at')
      .eq('job_id', jobId).eq('stage_key', stage).maybeSingle()
    if (error) return null
    if (!data) return false
    return (data as { skipped_at: string | null }).skipped_at !== null
  },
  mayEditStages: async jobId => {
    const { data, error } = await supabase.rpc('may_edit_job_stages', { p_job: jobId })
    return !error && data === true
  },
}

/** Never throws: a lookup that fails leaves the plain explanation. */
export async function explainStageMove(
  err: unknown, jobId: string, to: string, lookups: StageMoveLookups = fromDatabase,
): Promise<StageMoveProblem> {
  const plain = { message: describeError(err), switchedOff: false, mayTurnOn: false }
  if (refusalOf(err) !== 'stageMoveRefused') return plain
  let skipped: boolean | null = null
  try { skipped = await lookups.targetSkipped(jobId, to) } catch { skipped = null }
  if (skipped === false) return { ...plain, message: t('workflow.moveNotOnStage') }
  if (skipped !== true) return plain
  let mayTurnOn = false
  try { mayTurnOn = await lookups.mayEditStages(jobId) } catch { mayTurnOn = false }
  return { message: t('workflow.stageSwitchedOff'), switchedOff: true, mayTurnOn }
}
