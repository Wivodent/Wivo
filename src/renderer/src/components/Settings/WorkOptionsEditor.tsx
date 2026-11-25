/**
 * Settings → Prices: work type options (shared/pricing/workOptions).
 *
 * OptionLibrarySection: the clinic's options, each defined once with its
 * extra price for the client and its cost to us, per job or per tooth. An
 * option is archived, never deleted: a job that chose it must still read and
 * price.
 *
 * TypeOptionGroups: on one work type's price card, the groups it offers
 * ("Framework: Metal bar, Titanium mesh"), each pointing at library options,
 * pick one or pick any. Prices are never typed here: they are the library's.
 */
import { useState } from 'react'
import { Plus, X, Archive, ArchiveRestore, Layers } from 'lucide-react'
import type { WorkType } from '@shared/pricing/workTypes'
import { newId, type WorkOption, type WorkOptionGroup } from '@shared/pricing/workOptions'
import { useSettings } from '../../stores/useSettings'
import { workOptionImage } from '../../lib/workOptionImages'
import { DraftNumberInput, DraftTextInput } from '../ui/DraftInput'
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
          const img = workOptionImage(o.id)
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

/** On a work type's price card: the option groups it offers. */
export function TypeOptionGroups({ type, onPatch }: {
  type: WorkType
  onPatch: (patch: Partial<WorkType>) => void
}) {
  const { settings, setTooValikud } = useSettings()
  const library = settings.tooValikud
  const byId = new Map(library.map(o => [o.id, o]))
  const groups = type.valikuGrupid ?? []

  const save = (next: WorkOptionGroup[]) => onPatch({ valikuGrupid: next.length > 0 ? next : undefined })
  const patchGroup = (key: string, p: Partial<WorkOptionGroup>) =>
    save(groups.map(g => (g.key === key ? { ...g, ...p } : g)))
  const addGroup = () => {
    const nimi = t('settingsPage.newGroupName')
    save([...groups, { key: newId(nimi, groups.map(g => g.key), 'group'), nimi, mitu: false, valikud: [] }])
  }

  /** A new library option, made here and put in the group at once. */
  const createInGroup = (g: WorkOptionGroup, nimi: string) => {
    const id = newId(nimi, library.map(o => o.id))
    setTooValikud([...library, { id, nimi, yhik: 'too' }])
    patchGroup(g.key, { valikud: [...g.valikud, id] })
  }

  return (
    <div className="flex flex-col gap-3 border-t border-ink-faint/15 pt-4">
      <h4 className="text-base font-bold text-ink">{t('settingsPage.optionsOfType')}</h4>
      {groups.length === 0 && <p className="text-sm text-ink-muted">{t('settingsPage.noOptionGroups')}</p>}
      {groups.map(g => (
        <div key={g.key} className="rounded-xl border border-ink-faint/20 p-3 flex flex-col gap-2.5">
          <div className="flex items-center gap-2">
            <DraftTextInput value={g.nimi} onCommit={v => patchGroup(g.key, { nimi: v })}
              aria-label={t('settingsPage.groupName')} placeholder={t('settingsPage.groupNamePlaceholder')}
              className="input h-10 text-base font-semibold flex-1 min-w-0" />
            <button type="button" aria-label={t('settingsPage.removeGroup')} title={t('settingsPage.removeGroup')}
              onClick={() => save(groups.filter(x => x.key !== g.key))}
              className="w-10 h-10 rounded-xl border border-ink-faint/25 flex items-center justify-center text-ink-faint hover:text-red-500">
              <X size={16} />
            </button>
          </div>
          <label className="flex items-center gap-2 text-sm text-ink-soft">
            <input type="checkbox" checked={g.mitu} onChange={e => patchGroup(g.key, { mitu: e.target.checked })} />
            {t('settingsPage.groupPickMany')}
          </label>
          <div className="flex flex-wrap gap-1.5">
            {g.valikud.map(id => {
              const o = byId.get(id)
              return (
                <span key={id} className={`inline-flex items-center gap-1 rounded-lg bg-bg-sidebar px-2.5 py-1 text-sm ${o?.arhiivis ? 'opacity-60' : ''}`}>
                  {o?.nimi ?? id}
                  {o?.lisahind ? <span className="text-ink-muted tabular-nums">+{o.lisahind.toFixed(2)} €{o.yhik === 'hammas' ? ` / ${t('settingsPage.tooth3')}` : ''}</span> : null}
                  <button type="button" aria-label={t('settingsPage.removeFromGroup', { name: o?.nimi ?? id })}
                    onClick={() => patchGroup(g.key, { valikud: g.valikud.filter(x => x !== id) })}
                    className="text-ink-faint hover:text-red-500"><X size={13} /></button>
                </span>
              )
            })}
          </div>
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
