/**
 * A work item's options on the new-job form (docs/design production.html,
 * "Framework"): one row of big buttons per option group of the item's type,
 * with the option's picture when there is one (assets/worktypes/3d/options).
 * A pick-one group has "None" too; a pick-any group toggles each button.
 *
 * The groups are the type's own (Settings → Prices); the options and their
 * prices come from the clinic's library (shared/pricing/workOptions).
 */
import { Check } from 'lucide-react'
import type { NewJobState } from '@shared/wizard'
import { baseTypeName } from '@shared/wizard'
import { effectiveOption, type WorkOption, type WorkOptionGroup } from '@shared/pricing/workOptions'
import type { WorkType } from '@shared/pricing/workTypes'
import { useSettings, useWorkTypes } from '@/stores/useSettings'
import { workOptionImage } from '@/lib/workOptionImages'
import { FOCUS_RING } from '../wizardTheme'
import { t } from '@/lib/i18n'

export function OptionGroupButtons({ typeKey, state, patch }: {
  typeKey: string
  state: NewJobState
  patch: (p: Partial<NewJobState>) => void
}) {
  const { settings } = useSettings()
  const { types } = useWorkTypes()
  const type = types.find(x => x.nimi === baseTypeName(typeKey))
  const groups = (type?.valikuGrupid ?? []).filter(g => g.valikud.length > 0)
  if (groups.length === 0) return null

  const library = new Map(settings.tooValikud.map(o => [o.id, o]))
  const chosenFor = (g: WorkOptionGroup): string[] => state.optionsByType?.[typeKey]?.[g.key] ?? []

  function set(g: WorkOptionGroup, ids: string[]) {
    const forType = { ...(state.optionsByType?.[typeKey] ?? {}) }
    if (ids.length > 0) forType[g.key] = ids
    else delete forType[g.key]
    patch({ optionsByType: { ...(state.optionsByType ?? {}), [typeKey]: forType } })
  }

  return (
    <div className="flex flex-col gap-4">
      {groups.map(g => {
        const chosen = chosenFor(g)
        // Archived options are not offered, unless this job already has one.
        const offered = g.valikud
          .map(id => library.get(id))
          .filter((o): o is WorkOption => !!o && (!o.arhiivis || chosen.includes(o.id)))
        if (offered.length === 0) return null
        return (
          <div key={g.key} className="flex flex-col gap-2">
            <span className="text-base font-semibold text-ink-soft">
              {g.nimi || t('wizard.options')}
              {g.mitu && <span className="ml-2 text-sm font-normal text-ink-muted">{t('wizard.optionPickMany')}</span>}
            </span>
            <div role={g.mitu ? 'group' : 'radiogroup'} aria-label={g.nimi} className="flex flex-wrap gap-2">
              {offered.map(o => {
                const on = chosen.includes(o.id)
                const toggle = () => set(g, g.mitu ? (on ? chosen.filter(x => x !== o.id) : [...chosen, o.id]) : (on ? [] : [o.id]))
                return <OptionButton key={o.id} option={o} type={type} on={on} multi={g.mitu} onClick={toggle} />
              })}
              {!g.mitu && (
                <button
                  type="button"
                  role="radio"
                  aria-checked={chosen.length === 0}
                  onClick={() => set(g, [])}
                  className={buttonClass(chosen.length === 0)}
                >
                  {t('wizard.optionNone')}
                </button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

const buttonClass = (on: boolean) => [
  'relative min-h-[56px] rounded-xl px-4 py-2 text-base transition-colors flex items-center gap-3', FOCUS_RING,
  on ? 'border-2 border-accent bg-accent/10 font-bold text-ink' : 'border border-ink-faint/40 bg-bg-card text-ink-soft hover:text-ink',
].join(' ')

function OptionButton({ option, type, on, multi, onClick }: {
  option: WorkOption
  /** The item's type: its own price for the option counts over the default. */
  type: WorkType | undefined
  on: boolean
  multi: boolean
  onClick: () => void
}) {
  const img = workOptionImage(option.id, option.nimi)
  const { price, priceUnit } = effectiveOption(option, type)
  const extra = price
    ? priceUnit === 'hammas'
      ? t('wizard.optionExtraTooth', { amount: price.toFixed(2) })
      : t('wizard.optionExtraJob', { amount: price.toFixed(2) })
    : null
  return (
    <button
      type="button"
      role={multi ? 'checkbox' : 'radio'}
      aria-checked={on}
      onClick={onClick}
      className={buttonClass(on)}
    >
      {img && <img src={img} alt="" className="w-12 h-12 rounded-lg bg-white object-contain flex-shrink-0" />}
      <span className="flex flex-col items-start text-left">
        <span>{option.nimi}</span>
        {extra && <span className="text-sm font-normal text-ink-muted tabular-nums">{extra}</span>}
      </span>
      {on && <Check className="w-4 h-4 text-accent absolute top-1.5 right-1.5" aria-hidden="true" />}
    </button>
  )
}
