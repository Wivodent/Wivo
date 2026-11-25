/**
 * Settings → Prices: work type options (shared/pricing/workOptions).
 *
 * OptionLibrarySection ("Option library"): the clinic's options, each
 * defined once with its DEFAULT extra price for the client and cost to us, per
 * job or per tooth. The only place the default is changed. An option is
 * archived, never deleted: a job that chose it must still read and price.
 *
 * TypeOptionGroups: on one work type's price card, the groups it offers
 * ("Framework: Metal bar, Titanium mesh"), each pointing at library options,
 * pick one or pick any, with this type's own price and cost for each option
 * (work_types[].valikuHinnad), or the default when it has none. Nothing on a
 * card changes another work type.
 */
import { useState } from 'react'
import { Plus, X, Archive, ArchiveRestore, Layers, RotateCcw } from 'lucide-react'
import type { WorkType } from '@shared/pricing/workTypes'
import {
  newId, effectiveOption, withOptionPrice, withoutOptionPrice,
  type OptionPrice, type WorkOption, type WorkOptionGroup,
} from '@shared/pricing/workOptions'
import { useSettings } from '../../stores/useSettings'
import { workOptionImage } from '../../lib/workOptionImages'
import { DraftNumberInput, DraftTextInput } from '../ui/DraftInput'
import { InfoButton } from '../ui/InfoButton'
import { SectionCard } from '../ui/SectionCard'
import { t } from '@/lib/i18n'

const unitLabel = (o: Pick<WorkOption, 'yhik'>) => (o.yhik === 'hammas' ? t('settingsPage.tooth3') : t('settingsPage.job3'))

/** The library: name, extra price, cost, per job or per tooth, archive. */
export function OptionLibrarySection() {
  const { settings, setTooValikud } = useSettings()
  const [showArchived, setShowArchived] = useState(false)
  const [name, setName] = useState('')
  const library = settings.tooValikud
  const shown = library.filter(o => showArchived || !o.arhiivis)

  const patch = (id: string, p: Partial<WorkOption>) =>
    setTooValikud(library.map(o => (o.id === id ? { ...o, ...p } : o)))
  const add = () => {
    const nimi = name.trim()
    if (!nimi) return
    setTooValikud([...library, { id: newId(nimi, library.map(o => o.id)), nimi, yhik: 'too' }])
    setName('')
  }

  return (
    <SectionCard
      title={t('settingsPage.optionsLibrary')}
      subtitle={t('settingsPage.optionsLibrarySub')}
      icon={Layers}
      info={t('settingsPage.optionsLibraryInfo')}
    >
      {library.length === 0 && <p className="text-sm text-ink-muted">{t('settingsPage.noOptionsYet')}</p>}
      <div className="flex flex-col gap-2">
        {shown.map(o => {
          const img = workOptionImage(o.id, o.nimi)
          return (
            <div key={o.id}
              className={`grid grid-cols-[48px_minmax(0,1fr)_120px_120px_auto_44px] gap-2 items-center ${o.arhiivis ? 'opacity-60' : ''}`}>
              <span className="w-12 h-12 rounded-lg bg-white border border-ink-faint/20 flex items-center justify-center overflow-hidden">
                {img ? <img src={img} alt="" className="w-full h-full object-contain" /> : <Layers size={18} className="text-ink-faint" aria-hidden="true" />}
              </span>
              <DraftTextInput value={o.nimi} onCommit={v => v.trim() && patch(o.id, { nimi: v.trim() })}
                aria-label={t('settingsPage.optionName')} className="input h-11 text-base" />
              <label className="relative">
                <span className="sr-only">{t('settingsPage.optionExtraPrice')}</span>
                <DraftNumberInput allowEmpty value={o.lisahind} placeholder="+0.00" onCommit={v => patch(o.id, { lisahind: v })}
                  className="input h-11 pr-7 text-base text-right w-full" title={t('settingsPage.optionExtraPrice')} />
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-ink-faint pointer-events-none">€</span>
              </label>
              <label className="relative">
                <span className="sr-only">{t('settingsPage.optionCost')}</span>
                <DraftNumberInput allowEmpty value={o.kulu} placeholder={t('settingsPage.optionCostShort')} onCommit={v => patch(o.id, { kulu: v })}
                  className="input h-11 pr-7 text-base text-right w-full" title={t('settingsPage.optionCost')} />
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-ink-faint pointer-events-none">€</span>
              </label>
              <button type="button" onClick={() => patch(o.id, { yhik: o.yhik === 'hammas' ? 'too' : 'hammas' })}
                title={t('settingsPage.perJobPerTooth')}
                className="h-11 px-3 rounded-xl bg-bg-sidebar text-sm text-ink-soft hover:text-accent">
                {unitLabel(o)}
              </button>
              <button type="button" onClick={() => patch(o.id, { arhiivis: !o.arhiivis })}
                aria-label={o.arhiivis ? t('settingsPage.optionRestore') : t('settingsPage.optionArchive')}
                title={o.arhiivis ? t('settingsPage.optionRestore') : t('settingsPage.optionArchive')}
                className="w-11 h-11 rounded-xl border border-ink-faint/25 flex items-center justify-center text-ink-faint hover:text-ink">
                {o.arhiivis ? <ArchiveRestore size={16} /> : <Archive size={16} />}
              </button>
            </div>
          )
        })}
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        <input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add() }}
          placeholder={t('settingsPage.newOptionPlaceholder')} aria-label={t('settingsPage.optionName')}
          className="input h-11 text-base max-w-xs" />
        <button type="button" onClick={add} disabled={!name.trim()}
          className="min-h-[44px] px-3.5 rounded-xl border border-dashed border-ink-faint/60 bg-bg-card text-sm text-ink hover:border-accent disabled:opacity-50 inline-flex items-center gap-1.5">
          <Plus size={14} aria-hidden="true" /> {t('settingsPage.addOption')}
        </button>
        {library.some(o => o.arhiivis) && (
          <button type="button" onClick={() => setShowArchived(s => !s)} className="text-sm text-ink-muted hover:text-ink ml-auto">
            {showArchived ? t('settingsPage.hideArchivedOptions') : t('settingsPage.showArchivedOptions')}
          </button>
        )}
      </div>
    </SectionCard>
  )
}

/**
 * On a work type's price card: the option groups it offers, each a question
 * asked when a job is added ("Framework"), its options the answers, one row
 * each like a cost row: picture, name, the extra on the client's price, our
 * cost, remove.
 *
 * The amounts are THIS type's: typing one sets this type's own price for the
 * option, in this type's unit, and no other type's. Without one, the
 * library's default shows greyed, marked "Default price"; "Use default" takes
 * this type's own away again.
 */
export function TypeOptionGroups({ type, onPatch }: {
  type: WorkType
  onPatch: (patch: Partial<WorkType>) => void
}) {
  const { settings, setTooValikud } = useSettings()
  const library = settings.tooValikud
  const byId = new Map(library.map(o => [o.id, o]))
  const groups = type.valikuGrupid ?? []
  const mode = type.hinnaTyyp ?? 'too'

  const save = (next: WorkOptionGroup[]) => onPatch({ valikuGrupid: next.length > 0 ? next : undefined })
  const patchGroup = (key: string, p: Partial<WorkOptionGroup>) =>
    save(groups.map(g => (g.key === key ? { ...g, ...p } : g)))
  // Empty, with "e.g. Framework" in it: a ready-made name here was taken for
  // an option and overwritten with one ("Metal bar" as the group's name).
  const addGroup = () =>
    save([...groups, { key: newId('', groups.map(g => g.key), 'group'), nimi: '', mitu: false, valikud: [] }])

  /** This type's own price for an option; undefined = back to the default for that amount. */
  const setOwn = (id: string, p: OptionPrice) => onPatch({ valikuHinnad: withOptionPrice(type.valikuHinnad, id, p) })
  const useDefault = (id: string) => onPatch({ valikuHinnad: withoutOptionPrice(type.valikuHinnad, id) })

  /** Out of a group; its own price goes too once no group of this type offers it. */
  const removeFromGroup = (g: WorkOptionGroup, id: string) => {
    const next = groups.map(x => (x.key === g.key ? { ...x, valikud: x.valikud.filter(v => v !== id) } : x))
    const stillOffered = next.some(x => x.valikud.includes(id))
    onPatch({
      valikuGrupid: next.length > 0 ? next : undefined,
      ...(stillOffered ? {} : { valikuHinnad: withoutOptionPrice(type.valikuHinnad, id) }),
    })
  }

  /** A new library option (no default price yet), made here and put in the group at once. */
  const createInGroup = (g: WorkOptionGroup, nimi: string) => {
    const id = newId(nimi, library.map(o => o.id))
    setTooValikud([...library, { id, nimi, yhik: mode }])
    patchGroup(g.key, { valikud: [...g.valikud, id] })
  }

  return (
    <div className="flex flex-col gap-3 border-t border-ink-faint/15 pt-4">
      <div className="flex items-center gap-2">
        <h4 className="text-base font-bold text-ink">{t('settingsPage.optionsOfType')}</h4>
        <InfoButton label={t('settingsPage.optionsOfTypeInfoLabel')} text={t('settingsPage.optionsOfTypeInfo')} />
      </div>
      <p className="text-sm text-ink-muted -mt-1">{t('settingsPage.optionsOfTypeSub')}</p>
      {groups.length === 0 && <p className="text-sm text-ink-muted">{t('settingsPage.noOptionGroups')}</p>}
      {groups.map(g => (
        <div key={g.key} className="rounded-xl border border-ink-faint/20 p-3 flex flex-col gap-3">
          <div className="flex items-end gap-2">
            <label className="flex flex-col gap-1 flex-1 min-w-0 text-sm font-semibold text-ink-soft">
              {t('settingsPage.groupLabel')}
              <DraftTextInput value={g.nimi} onCommit={v => patchGroup(g.key, { nimi: v.trim() })}
                placeholder={t('settingsPage.groupNamePlaceholder')}
                className="input h-11 text-base font-semibold w-full" />
            </label>
            <button type="button" aria-label={t('settingsPage.removeGroup')} title={t('settingsPage.removeGroup')}
              onClick={() => save(groups.filter(x => x.key !== g.key))}
              className="w-11 h-11 rounded-xl border border-ink-faint/25 flex items-center justify-center text-ink-faint hover:text-red-500 flex-shrink-0">
              <X size={16} />
            </button>
          </div>
          <label className="flex items-center gap-2 text-sm text-ink-soft">
            <input type="checkbox" checked={g.mitu} onChange={e => patchGroup(g.key, { mitu: e.target.checked })} />
            {t('settingsPage.groupPickMany')}
          </label>

          <div className={OPTION_ROW}>
            <span />
            <span className="text-xs font-semibold text-ink-muted">{t('settingsPage.optionColName')}</span>
            <span className="text-xs font-semibold text-ink-muted text-right">{t('settingsPage.optionColPrice')}</span>
            <span className="text-xs font-semibold text-ink-muted text-right">{t('settingsPage.optionColCost')}</span>
            <span />
          </div>
          {g.valikud.length === 0 && <ExampleRow unit={unitOf(mode)} />}
          {g.valikud.map(id => {
            const o = byId.get(id)
            const e = o ? effectiveOption(o, type) : null
            const own = type.valikuHinnad?.[id]
            const hasOwn = !!e && (e.ownPrice || e.ownCost)
            return (
              <div key={id} className="flex flex-col gap-1">
                <div className={`${OPTION_ROW} ${o?.arhiivis ? 'opacity-60' : ''}`}>
                  <OptionPicture id={id} nimi={o?.nimi} />
                  {/* The name is the option's own, the same in every type:
                      renamed in the option library, not here. */}
                  <span className="text-base text-ink truncate">{o?.nimi ?? id}</span>
                  <MoneyCell label={t('settingsPage.optionExtraPrice')} value={own?.lisahind} plus
                    fallback={o?.lisahind} unit={unitOf(e?.priceUnit ?? mode)} disabled={!o}
                    onCommit={v => setOwn(id, { lisahind: v })} />
                  <MoneyCell label={t('settingsPage.optionCost')} value={own?.kulu}
                    fallback={o?.kulu} unit={unitOf(e?.costUnit ?? mode)} disabled={!o}
                    onCommit={v => setOwn(id, { kulu: v })} />
                  <button type="button" aria-label={t('settingsPage.removeFromGroup', { name: o?.nimi ?? id })}
                    title={t('settingsPage.removeFromGroup', { name: o?.nimi ?? id })}
                    onClick={() => removeFromGroup(g, id)}
                    className="w-11 h-11 rounded-xl border border-ink-faint/25 flex items-center justify-center text-ink-faint hover:text-red-500">
                    <X size={16} />
                  </button>
                </div>
                {o && (
                  <div className="flex items-center gap-2 pl-[52px] text-xs">
                    {hasOwn ? (
                      <>
                        <span className="px-1.5 py-0.5 rounded bg-accent/10 text-accent font-medium">{t('settingsPage.optionOwnPrice')}</span>
                        <button type="button" onClick={() => useDefault(id)}
                          className="inline-flex items-center gap-1 text-ink-muted hover:text-ink underline-offset-2 hover:underline">
                          <RotateCcw size={12} aria-hidden="true" /> {t('settingsPage.optionUseDefault')}
                        </button>
                      </>
                    ) : (
                      <span className="px-1.5 py-0.5 rounded bg-bg-sidebar text-ink-muted">{t('settingsPage.optionDefaultPrice')}</span>
                    )}
                  </div>
                )}
              </div>
            )
          })}
          <AddToGroup group={g} library={library} onAdd={id => patchGroup(g.key, { valikud: [...g.valikud, id] })}
            onCreate={nimi => createInGroup(g, nimi)} />
        </div>
      ))}
      <button type="button" onClick={addGroup}
        className="self-start min-h-[44px] px-3.5 rounded-xl border border-dashed border-ink-faint/60 bg-bg-card text-sm text-ink hover:border-accent inline-flex items-center gap-1.5">
        <Plus size={14} aria-hidden="true" /> {t('settingsPage.addOptionGroup')}
      </button>
    </div>
  )
}

const OPTION_ROW = 'grid grid-cols-[44px_minmax(0,1fr)_130px_130px_44px] gap-2 items-center'

const unitOf = (mode: WorkOption['yhik']): string => (mode === 'hammas' ? t('settingsPage.tooth') : t('settingsPage.job'))

/** The option's picture from the library (assets/worktypes/3d/options), or a plain mark. */
function OptionPicture({ id, nimi }: { id: string; nimi?: string }) {
  const img = workOptionImage(id, nimi)
  return (
    <span className="w-11 h-11 rounded-lg bg-white border border-ink-faint/20 flex items-center justify-center overflow-hidden">
      {img ? <img src={img} alt="" className="w-full h-full object-contain" /> : <Layers size={16} className="text-ink-faint" aria-hidden="true" />}
    </span>
  )
}

/**
 * An amount in euros, per job or per tooth, as on the type's own price. Empty
 * shows the default (`fallback`) greyed, as the placeholder.
 */
function MoneyCell({ label, value, fallback, unit, plus, disabled, onCommit }: {
  label: string
  value: number | undefined
  fallback?: number
  unit: string
  plus?: boolean
  disabled?: boolean
  onCommit: (v: number | undefined) => void
}) {
  const shown = (fallback ?? 0).toFixed(2)
  return (
    <label className="relative">
      <span className="sr-only">{label}</span>
      <DraftNumberInput allowEmpty value={value} placeholder={plus ? `+${shown}` : shown} onCommit={onCommit} disabled={disabled}
        title={label} className="input h-11 pr-14 text-base text-right w-full tabular-nums" />
      <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-ink-faint pointer-events-none">{unit}</span>
    </label>
  )
}

/** What a row looks like, in an empty group: greyed, not a field. */
function ExampleRow({ unit }: { unit: string }) {
  const cell = 'h-11 rounded-xl border border-dashed border-ink-faint/40 flex items-center px-3 text-base text-ink-faint'
  return (
    <div className={OPTION_ROW} aria-label={t('settingsPage.optionExample')}>
      <OptionPicture id="metal-bar" />
      <span className={cell}>{t('settingsPage.optionExampleName')}</span>
      <span className={`${cell} justify-end tabular-nums`}>+400.00 <span className="ml-1 text-xs">{unit}</span></span>
      <span className={`${cell} justify-end tabular-nums`}>120.00 <span className="ml-1 text-xs">{unit}</span></span>
      <span className="text-xs text-ink-faint text-center">{t('settingsPage.optionExample')}</span>
    </div>
  )
}

/** Add a library option to a group, or make a new one there. */
function AddToGroup({ group, library, onAdd, onCreate }: {
  group: WorkOptionGroup
  library: WorkOption[]
  onAdd: (id: string) => void
  onCreate: (nimi: string) => void
}) {
  const [name, setName] = useState('')
  const available = library.filter(o => !o.arhiivis && !group.valikud.includes(o.id))
  return (
    <div className="flex flex-wrap gap-2 items-center">
      {available.length > 0 && (
        <select value="" onChange={e => e.target.value && onAdd(e.target.value)}
          aria-label={t('settingsPage.addFromLibrary')} className="input h-10 text-sm max-w-[220px]">
          <option value="">{t('settingsPage.addFromLibrary')}</option>
          {available.map(o => <option key={o.id} value={o.id}>{o.nimi}</option>)}
        </select>
      )}
      <input value={name} onChange={e => setName(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && name.trim()) { onCreate(name.trim()); setName('') } }}
        placeholder={t('settingsPage.newOptionPlaceholder')} aria-label={t('settingsPage.optionName')}
        className="input h-10 text-sm max-w-[200px]" />
      <button type="button" disabled={!name.trim()} onClick={() => { onCreate(name.trim()); setName('') }}
        className="h-10 px-3 rounded-xl border border-dashed border-ink-faint/60 text-sm text-ink hover:border-accent disabled:opacity-50">
        {t('settingsPage.addOption')}
      </button>
    </div>
  )
}
