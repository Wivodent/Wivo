/**
 * Settings → Prices → Add from catalogue: Wivo's catalogue of common lab work
 * (shared/pricing/workTypeCatalogue) as large 3D tiles, grouped by kind, with
 * a search over the names in every language. "+ Add" makes an ordinary work
 * type in the clinic's language, with no price (the owner sets it) and the
 * entry's suggested options (the owner can take them off). Added: "Added ✓".
 *
 * Existing work types are never changed. When the clinic already has work of
 * the same kind under another name, the tile still offers "+ Add" and says
 * "You already have: X": names differ from clinic to clinic.
 */
import { useMemo, useState } from 'react'
import { Plus, Check, X, AlertTriangle } from 'lucide-react'
import {
  CATALOGUE, CATALOGUE_KINDS, catalogueLang, entryWords, workTypeFromCatalogue, type CatalogueEntry, type CatalogueKind,
} from '@shared/pricing/workTypeCatalogue'
import type { WorkType } from '@shared/pricing/workTypes'
import { useSettings } from '../../stores/useSettings'
import { useAuth } from '../../context/AuthContext'
import { workKindFor } from '../NewJobWizard/jobtype/WorkKindIcon'
import { WorkTypeArt } from '../ui/WorkTypeArt'
import { t } from '@/lib/i18n'

const KIND_LABEL: Record<CatalogueKind, () => string> = {
  crown: () => t('catalogue.kindCrown'),
  bridge: () => t('catalogue.kindBridge'),
  implant: () => t('catalogue.kindImplant'),
  denture: () => t('catalogue.kindDenture'),
  guard: () => t('catalogue.kindGuard'),
  model: () => t('catalogue.kindModel'),
  digital: () => t('catalogue.kindDigital'),
  other: () => t('catalogue.kindOther'),
}

const tokensOf = (type: Pick<WorkType, 'nimi' | 'match'>) => [type.nimi, ...(type.match ?? [])]

export function WorkTypeCatalogue({ onClose }: { onClose: () => void }) {
  const { settings, addCatalogueType } = useSettings()
  const { clinic } = useAuth()
  const lang = catalogueLang(clinic?.default_language)
  const [search, setSearch] = useState('')
  const types = settings.tooTuubid

  const q = search.trim().toLowerCase()
  const shown = useMemo(
    () => CATALOGUE.filter(e => !q || entryWords(e).some(w => w.includes(q)) || e.id.includes(q)),
    [q],
  )

  /** "Added ✓": a type made from this entry. */
  const added = (e: CatalogueEntry) => types.some(type => type.katalog === e.id)
  /** Work of the same kind the clinic already has, under its own names. */
  const sameKind = (e: CatalogueEntry): string[] => {
    const kind = workKindFor(entryWords(e))
    if (kind === 'tooth') return []
    return types.filter(type => type.katalog !== e.id && workKindFor(tokensOf(type)) === kind).map(type => type.nimi)
  }

  function add(e: CatalogueEntry) {
    const { type, newOptions } = workTypeFromCatalogue(e, lang, types, settings.tooValikud)
    addCatalogueType(type, newOptions)
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="catalogue-h"
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="card w-full max-w-6xl max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex flex-wrap items-center gap-3 p-5 border-b border-ink-faint/15">
          <div className="min-w-0 flex-1">
            <h2 id="catalogue-h" className="text-2xl font-bold text-ink">{t('catalogue.title')}</h2>
            <p className="text-base text-ink-muted">{t('catalogue.subtitle')}</p>
          </div>
          <input type="search" value={search} onChange={e => setSearch(e.target.value)} autoFocus
            placeholder={t('catalogue.search')} aria-label={t('catalogue.search')} className="input h-12 w-64 text-base" />
          <button type="button" onClick={onClose} aria-label={t('catalogue.close')}
            className="w-11 h-11 rounded-xl flex items-center justify-center text-ink-muted hover:text-ink hover:bg-bg-sidebar">
            <X size={20} />
          </button>
        </div>

        <div className="overflow-y-auto p-5 flex flex-col gap-7">
          {shown.length === 0 && <p className="text-base text-ink-muted">{t('catalogue.nothingFound')}</p>}
          {CATALOGUE_KINDS.map(kind => {
            const entries = shown.filter(e => e.kind === kind)
            if (entries.length === 0) return null
            return (
              <section key={kind} className="flex flex-col gap-3">
                <h3 className="text-sm font-bold text-ink-soft uppercase tracking-wider">{KIND_LABEL[kind]()}</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                  {entries.map(e => {
                    const isAdded = added(e)
                    const others = isAdded ? [] : sameKind(e)
                    return (
                      <div key={e.id} className="rounded-2xl border border-ink-faint/25 bg-bg-card p-3 flex flex-col items-center gap-2 text-center">
                        <WorkTypeArt type={{ nimi: e.names[lang], match: entryWords(e), katalog: e.id } as WorkType} size={128} iconSize={64} />
                        <span className="text-base font-semibold text-ink leading-snug">{e.names[lang]}</span>
                        <span className="text-sm text-ink-muted">
                          {e.unit === 'hammas' ? t('catalogue.perTooth') : t('catalogue.perJob')}
                        </span>
                        {others.length > 0 && (
                          <span className="text-xs text-amber-600 flex items-start gap-1 text-left">
                            <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" aria-hidden="true" />
                            {t('catalogue.alreadyHave', { names: others.join(', ') })}
                          </span>
                        )}
                        {isAdded ? (
                          <span className="mt-auto min-h-[44px] w-full rounded-xl bg-emerald-50 text-emerald-700 text-base font-semibold flex items-center justify-center gap-1.5">
                            <Check size={16} aria-hidden="true" /> {t('catalogue.added')}
                          </span>
                        ) : (
                          <button type="button" onClick={() => add(e)}
                            className="mt-auto min-h-[44px] w-full rounded-xl bg-accent text-white text-base font-bold flex items-center justify-center gap-1.5 hover:opacity-90">
                            <Plus size={16} aria-hidden="true" /> {t('catalogue.add')}
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}
