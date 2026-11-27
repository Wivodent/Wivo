/**
 * A job's stage bar (docs/WORKFLOW-STAGES.md §3.2, §4, §5): the stages in
 * order, who is on each, which one the job is at, and the buttons that move
 * it. Every change is one click and saved at once. Every action asks the
 * database (lib/jobStages): a button is shown only when the database would
 * allow it, and an error from it is shown as is.
 *
 * Renders nothing for a job without stages (an old job): the caller shows the
 * plain pipeline timeline then.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowLeft, ArrowRight, Play, Plus } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { usePipeline } from '../../context/PipelineContext'
import { useClinicProfiles } from '../../hooks/useClinicProfiles'
import { describeError } from '../Patients/errors'
import {
  addJobStage, atSkippedStage, hasStagePeople, jobStagesUnavailable, moveJobStage, myTurnIn, neighbours, setJobStagePeople,
  setJobStageSkipped, skipStage, startJobStage, stageLines, useCanMove, useJobStages, useRefreshJobStages,
} from '../../lib/jobStages'
import { StageBar, type StageBarItem } from './StageBar'
import { stagePeopleOf } from '@/lib/stageAssign'
import { t } from '@/lib/i18n'

export function JobStageBar({ job, size = 'md', canAddStage = true }: {
  job: { id: string; status: string }
  size?: 'md' | 'lg'
  /** The desk may add a stage to this job; the phone does not. */
  canAddStage?: boolean
}) {
  const { user } = useAuth()
  const { stages: clinicStages, stageMap, doneStageKey } = usePipeline()
  const { data: profiles = [] } = useClinicProfiles()
  const { data: stages = [] } = useJobStages(job.id)
  const refresh = useRefreshJobStages()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(false)

  const lines = stageLines(stages, job.status)
  const { previous, next } = neighbours(lines)
  const canNext = useCanMove(job.id, job.status, next?.stageKey)
  const canPrevious = useCanMove(job.id, job.status, previous?.stageKey)
  const { data: mayEdit = false } = useQuery<boolean>({
    queryKey: ['may_edit_job_stages', job.id],
    enabled: stages.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error: err } = await supabase.rpc('may_edit_job_stages', { p_job: job.id })
      if (err) {
        if (jobStagesUnavailable(err)) return false
        throw err
      }
      return data === true
    },
  })

  if (stages.length === 0) return null

  const label = (key: string) => stageMap[key]?.label ?? key
  const finished = job.status === doneStageKey
  const everyone = stagePeopleOf(profiles, t('wizard.unnamed'))
  const current = lines.find(l => l.state === 'current')
  const turnIn = myTurnIn(lines, user?.id)
  const startable = !finished && current && (current.people.includes(user?.id ?? '') || !hasStagePeople(stages))

  const items: StageBarItem[] = lines.map(l => ({
    key: l.stageKey,
    label: label(l.stageKey),
    hex: stageMap[l.stageKey]?.hex ?? '#94A3B8',
    state: finished && l.state === 'current' ? 'done' : l.state,
    started: l.startedAt !== null,
    startedBy: l.startedBy,
    people: l.people,
    // The stage the job is at can be skipped too: the job then moves on to the
    // next active stage (lib/jobStages skipStage), if this person may move it there.
    canSkip: l.state === 'skipped' || l.state === 'upcoming'
      || (l.state === 'current' && !l.skipped && !finished && next !== null && canNext.data === true),
  }))
  const stuck = atSkippedStage(lines) && !finished
  const phone = size === 'lg'
  const goNext = () => { if (next) void run(() => moveJobStage(job.id, next.stageKey)) }
  const goBack = () => { if (previous) void run(() => moveJobStage(job.id, previous.stageKey)) }

  async function run(action: () => Promise<void>) {
    setError(null)
    setBusy(true)
    try {
      await action()
    } catch (e) {
      setError(describeError(e))
    } finally {
      setBusy(false)
      refresh(job.id)
    }
  }

  const btn = size === 'lg' ? 'min-h-[44px] px-4 text-sm' : 'px-3 py-1 text-xs'

  return (
    <section aria-label={t('workflow.stagesTitle')} className="space-y-3">
      <StageBar
        items={items}
        everyone={everyone}
        editable={mayEdit}
        size={size}
        busy={busy}
        onPeople={(key, people) => void run(() => setJobStagePeople(job.id, key, people))}
        onSkip={(key, skipped) => void run(() => skipped ? skipStage(job.id, lines, key) : setJobStageSkipped(job.id, key, false))}
      />

      {stuck && (
        <div role="status" className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-400/60 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <AlertTriangle size={16} aria-hidden="true" />
          <span className="flex-1">{t('workflow.inSkippedStage')}</span>
          {next && canNext.data === true && (
            <button type="button" disabled={busy} onClick={goNext}
              className={`btn-ghost flex items-center gap-1 border border-amber-500/60 text-amber-900 ${btn}`}>
              {t('workflow.moveToNextActive')} <ArrowRight size={14} aria-hidden="true" />
            </button>
          )}
        </div>
      )}

      {/* The phone: one big button to move on, a smaller one back (2.2.6). */}
      {phone && !stuck && next && canNext.data === true && (
        <button type="button" disabled={busy} onClick={goNext}
          className="btn-primary flex min-h-[56px] w-full items-center justify-center gap-2 text-lg font-semibold">
          {t('workflow.moveToNextStage')} <ArrowRight size={20} aria-hidden="true" />
        </button>
      )}
      {phone && previous && canPrevious.data === true && (
        <button type="button" disabled={busy} onClick={goBack}
          className="btn-ghost mx-auto flex min-h-[44px] items-center gap-1 text-sm">
          <ArrowLeft size={16} aria-hidden="true" /> {t('workflow.back')}
        </button>
      )}

      {turnIn !== null && (
        <p className="text-xs text-ink-muted">
          {turnIn === 0 ? t('workflow.myTurnNext') : t('workflow.myTurnIn', { n: turnIn })}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {!phone && previous && canPrevious.data === true && (
          <button type="button" disabled={busy} onClick={goBack}
            className={`btn-ghost flex items-center gap-1 border border-ink-faint/30 ${btn}`}>
            <ArrowLeft size={14} aria-hidden="true" /> {t('workflow.previousStage')}
          </button>
        )}
        {startable && (
          <button type="button" disabled={busy} onClick={() => void run(() => startJobStage(job.id))}
            className={`btn-ghost flex items-center gap-1 border border-ink-faint/30 ${btn}`}>
            <Play size={14} aria-hidden="true" /> {t('workflow.iStarted')}
          </button>
        )}
        {!phone && !stuck && next && canNext.data === true && (
          <button type="button" disabled={busy} onClick={goNext}
            className={`btn-ghost flex items-center gap-1 border border-accent/40 text-accent ${btn}`}>
            {t('workflow.nextStage')} <ArrowRight size={14} aria-hidden="true" />
          </button>
        )}
        {mayEdit && canAddStage && (
          <button type="button" onClick={() => setAdding(a => !a)} className={`btn-ghost ml-auto flex items-center gap-1 ${btn}`}>
            <Plus size={12} aria-hidden="true" /> {t('workflow.addStage')}
          </button>
        )}
      </div>

      {adding && mayEdit && (
        <AddStage
          options={clinicStages.filter(s => !lines.some(l => l.stageKey === s.key)).map(s => ({ key: s.key, label: s.label }))}
          after={lines.map(l => ({ key: l.stageKey, label: label(l.stageKey) }))}
          busy={busy}
          onAdd={(stage, after) => void run(async () => { await addJobStage(job.id, stage, after); setAdding(false) })}
        />
      )}
      {error && <p role="alert" className="text-sm text-rose-500">{error}</p>}
    </section>
  )
}

function AddStage({ options, after, busy, onAdd }: {
  options: { key: string; label: string }[]
  after: { key: string; label: string }[]
  busy: boolean
  onAdd: (stage: string, after: string | null) => void
}) {
  const [stage, setStage] = useState(options[0]?.key ?? '')
  const [where, setWhere] = useState<string>(after[after.length - 1]?.key ?? '')
  if (options.length === 0) return <p className="text-xs text-ink-muted">{t('workflow.noMoreStages')}</p>
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <select className="input w-40" value={stage} onChange={e => setStage(e.target.value)} aria-label={t('workflow.addStage')}>
        {options.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
      </select>
      <select className="input w-44" value={where} onChange={e => setWhere(e.target.value)} aria-label={t('workflow.addAfter')}>
        <option value="">{t('workflow.atTheStart')}</option>
        {after.map(o => <option key={o.key} value={o.key}>{t('workflow.afterStage', { stage: o.label })}</option>)}
      </select>
      <button type="button" disabled={busy || !stage} onClick={() => onAdd(stage, where || null)} className="btn-ghost border border-ink-faint/30">
        {t('workflow.addStage')}
      </button>
    </div>
  )
}
