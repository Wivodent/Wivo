/**
 * The options chosen on a job, each with who makes it (sql/130): the job
 * card, the job page and the phone. The person button is the stage bar's: a
 * dashed "+ person" while the job's technician makes it (the default), the
 * person's initials once someone else is chosen. A click opens the team list;
 * the choice is saved at once, and the person is told in the bell.
 *
 * Stored on the job's own work item (work_items[].valikuTegijad); a pay rule
 * "Only with option" pays this person (lib/earnings.ts).
 */
import { useEffect, useRef, useState } from 'react'
import { User, UserPlus } from 'lucide-react'
import type { Job } from '../../types/job'
import { jobWorkItems } from '../../types/job'
import { useSettings } from '../../stores/useSettings'
import { useClinicProfiles } from '../../hooks/useClinicProfiles'
import { usePermissions } from '../../hooks/usePermissions'
import { useUpdateJob } from '../../hooks/useJobs'
import { describeError } from '../Patients/errors'
import { initials, stagePeopleOf, type StagePerson } from '@/lib/stageAssign'
import { chosenOptions, withOptionDoer, type ChosenOption } from '../../lib/optionDoers'
import { t } from '@/lib/i18n'

export function OptionDoers({ job, size = 'md', compact = false, className = '' }: {
  job: Job
  /** The frame around it, only drawn when the job has options. */
  className?: string
  /** 'lg': thumb-sized, a bottom sheet (the phone). */
  size?: 'md' | 'lg'
  /** On a job card: small chips, no heading. */
  compact?: boolean
}) {
  const { settings } = useSettings()
  const { data: profiles = [] } = useClinicProfiles()
  const editable = usePermissions().can('jobs.write')
  const update = useUpdateJob()
  const [open, setOpen] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const items = jobWorkItems(job)
  const names = new Map(settings.tooValikud.map(o => [o.id, o.nimi]))
  const chosen = chosenOptions(items, names)
  if (chosen.length === 0) return null

  const everyone = stagePeopleOf(profiles, t('wizard.unnamed'))
  const person = (id: string | null) => (id ? everyone.find(p => p.id === id) : undefined)
  const techName = person(job.assigned_to ?? null)?.name ?? t('optionDoers.technician')
  const lg = size === 'lg'
  const circle = lg ? 'h-11 w-11 text-sm' : compact ? 'h-6 w-6 text-[9px]' : 'h-7 w-7 text-[10px]'

  async function choose(c: ChosenOption, doer: string | null) {
    setOpen(null)
    setError(null)
    if (doer === c.doer) return
    try {
      await update.mutateAsync({ id: job.id, base: job, work_items: withOptionDoer(items, c.itemId, c.optionId, doer) })
    } catch (e) {
      setError(describeError(e))
    }
  }

  return (
    <div className={`${compact ? '' : 'flex flex-col gap-2'} ${className}`} onClick={e => compact && e.stopPropagation()}>
      {!compact && <p className={`font-semibold text-ink-muted ${lg ? 'text-sm' : 'text-xs'}`}>{t('optionDoers.title')}</p>}
      <ul className={`flex flex-wrap ${compact ? 'gap-1' : 'gap-2'}`}>
        {chosen.map(c => {
          const key = `${c.itemId}:${c.optionId}`
          const who = person(c.doer)
          const label = c.doer
            ? t('optionDoers.madeBy', { name: who?.name ?? t('workflow.someone') })
            : t('optionDoers.madeByTechnician', { name: techName })
          return (
            <li key={key} className={`relative inline-flex items-center gap-1.5 rounded-lg bg-bg-sidebar ${
              compact ? 'pl-1.5 pr-0.5 py-0.5 text-[10px]' : lg ? 'pl-3 pr-1 py-1 text-base' : 'pl-2.5 pr-1 py-1 text-sm'}`}>
              <span className="text-ink">{c.name}</span>
              <button type="button" disabled={!editable || update.isPending} title={label} aria-label={`${c.name}: ${label}`}
                onClick={e => { e.stopPropagation(); setOpen(open === key ? null : key) }}
                className={`${circle} flex items-center justify-center rounded-full disabled:cursor-default ${
                  c.doer
                    ? 'bg-bg-card font-semibold text-ink ring-1 ring-ink-faint/30'
                    : 'border border-dashed border-ink-faint/60 text-ink-muted hover:border-accent hover:text-accent'}`}>
                {c.doer
                  ? (who?.named !== false ? initials(who?.name) : <User size={lg ? 18 : 12} aria-hidden="true" />)
                  : <UserPlus size={lg ? 18 : compact ? 11 : 13} aria-hidden="true" />}
              </button>
              {open === key && editable && (
                <DoerPicker
                  option={c}
                  everyone={everyone}
                  techName={techName}
                  sheet={lg}
                  onClose={() => setOpen(null)}
                  onChoose={doer => void choose(c, doer)}
                />
              )}
            </li>
          )
        })}
      </ul>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}

function DoerPicker({ option, everyone, techName, sheet, onClose, onChoose }: {
  option: ChosenOption
  everyone: StagePerson[]
  techName: string
  sheet: boolean
  onClose: () => void
  onChoose: (doer: string | null) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const down = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    const id = window.setTimeout(() => {
      document.addEventListener('mousedown', down)
      document.addEventListener('touchstart', down)
    }, 0)
    document.addEventListener('keydown', key)
    return () => {
      window.clearTimeout(id)
      document.removeEventListener('mousedown', down)
      document.removeEventListener('touchstart', down)
      document.removeEventListener('keydown', key)
    }
  }, [onClose])

  const row = `flex w-full items-center gap-2 rounded-lg px-2 text-left text-sm text-ink hover:bg-bg-sidebar ${sheet ? 'min-h-[44px]' : 'min-h-[30px]'}`
  return (
    <div ref={ref} role="dialog" aria-label={option.name} onClick={e => e.stopPropagation()}
      className={sheet
        ? 'fixed inset-x-0 bottom-0 z-50 max-h-[75vh] overflow-y-auto rounded-t-2xl border-t border-ink-faint/20 bg-bg-card p-4 shadow-2xl'
        : 'absolute left-0 top-full z-30 mt-1 max-h-80 w-64 overflow-y-auto rounded-xl border border-ink-faint/20 bg-bg-card p-2 shadow-xl'}>
      <p className="px-1 pb-1 text-xs font-semibold text-ink-muted">{t('optionDoers.whoMakes', { option: option.name })}</p>
      <ul className="space-y-0.5" role="radiogroup">
        <li>
          <button type="button" role="radio" aria-checked={option.doer === null} className={row} onClick={() => onChoose(null)}>
            <input type="radio" readOnly tabIndex={-1} checked={option.doer === null} />
            <span className="truncate">{t('optionDoers.technicianDefault', { name: techName })}</span>
          </button>
        </li>
        {everyone.map(p => (
          <li key={p.id}>
            <button type="button" role="radio" aria-checked={option.doer === p.id} className={row} onClick={() => onChoose(p.id)}>
              <input type="radio" readOnly tabIndex={-1} checked={option.doer === p.id} />
              <span className="truncate">{p.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
