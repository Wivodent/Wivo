/**
 * Settings → Prices: the owner chooses a work type's picture. Every 3D picture
 * there is (one per catalogue entry, named in the clinic's catalogue language)
 * and every line icon, in one grid; "Automatic" goes back to the picture found
 * from the type's name (lib/workType3d).
 *
 * The choice is stored on the type itself (work_types[].pildiValik), like its
 * option prices, so it holds everywhere the type is drawn: the new-job form's
 * first step, the Prices card, the catalogue's "Added".
 */
import { useMemo } from 'react'
import { Check, Sparkles, X } from 'lucide-react'
import type { WorkType } from '@shared/pricing/workTypes'
import { CATALOGUE, catalogueLang } from '@shared/pricing/workTypeCatalogue'
import { useAuth } from '../../context/AuthContext'
import { WorkKindIcon } from '../NewJobWizard/jobtype/WorkKindIcon'
import { WORK_KINDS, type WorkKind } from '../NewJobWizard/jobtype/workKindShapes'
import { all3dPictures, choiceValue, pictureChoice, workType3dImage } from '../../lib/workType3d'
import { t } from '@/lib/i18n'
import type { MessageKey } from '@shared/i18n'

const ICON_LABEL: Record<WorkKind, MessageKey> = {
  implantCrown: 'picturePicker.iconImplantCrown',
  implantBridge: 'picturePicker.iconImplantBridge',
  crown: 'picturePicker.iconCrown',
  bridge: 'picturePicker.iconBridge',
  veneer: 'picturePicker.iconVeneer',
  laminate: 'picturePicker.iconLaminate',
  inlay: 'picturePicker.iconInlay',
  onlay: 'picturePicker.iconOnlay',
  filling: 'picturePicker.iconFilling',
  denture: 'picturePicker.iconDenture',
  allOnX: 'picturePicker.iconAllOnX',
  nightGuard: 'picturePicker.iconNightGuard',
  retainer: 'picturePicker.iconRetainer',
  ibt: 'picturePicker.iconIbt',
  surgicalGuide: 'picturePicker.iconSurgicalGuide',
  tooth: 'picturePicker.iconTooth',
}

export function WorkTypePicturePicker({ type, onChoose, onClose }: {
  type: WorkType
  /** The new value of pildiValik; undefined: automatic. */
  onChoose: (value: string | undefined) => void
  onClose: () => void
}) {
  const { clinic } = useAuth()
  const lang = catalogueLang(clinic?.default_language)
  const current = type.pildiValik ?? null
  const chosen = pictureChoice(current)
  const automatic = workType3dImage({ ...type, pildiValik: undefined })

  const pictures = useMemo(() => all3dPictures().map(p => ({
    ...p, label: CATALOGUE.find(e => e.id === p.id)?.names[lang] ?? p.id,
  })).sort((a, b) => a.label.localeCompare(b.label)), [lang])

  const choose = (value: string | undefined) => { onChoose(value); onClose() }
  const tile = (selected: boolean) =>
    `relative rounded-2xl border-2 p-2 flex flex-col items-center gap-1.5 text-center bg-bg-card hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
      selected ? 'border-accent' : 'border-ink-faint/25'}`
  const tick = <span className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-accent text-white flex items-center justify-center"><Check size={14} aria-hidden="true" /></span>

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="picture-picker-h"
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="card w-full max-w-5xl max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 p-5 border-b border-ink-faint/15">
          <div className="min-w-0 flex-1">
            <h2 id="picture-picker-h" className="text-2xl font-bold text-ink">{t('picturePicker.title', { name: type.nimi })}</h2>
            <p className="text-base text-ink-muted">{t('picturePicker.subtitle')}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('catalogue.close')}
            className="w-11 h-11 rounded-xl flex items-center justify-center text-ink-muted hover:text-ink hover:bg-bg-sidebar">
            <X size={20} />
          </button>
        </div>

        <div className="overflow-y-auto p-5 flex flex-col gap-6">
          <button type="button" onClick={() => choose(undefined)} aria-pressed={!chosen}
            className={`${tile(!chosen)} flex-row justify-start gap-3 text-left max-w-md`}>
            {!chosen && tick}
            <span className="w-16 h-16 rounded-xl bg-white flex items-center justify-center overflow-hidden flex-shrink-0">
              {automatic ? <img src={automatic} alt="" className="h-full w-full object-contain" /> : <Sparkles size={24} className="text-accent" aria-hidden="true" />}
            </span>
            <span className="flex flex-col">
              <span className="text-base font-semibold text-ink">{t('picturePicker.automatic')}</span>
              <span className="text-sm text-ink-muted">{t('picturePicker.automaticSub')}</span>
            </span>
          </button>

          <section className="flex flex-col gap-3">
            <h3 className="text-sm font-bold text-ink-soft uppercase tracking-wider">{t('picturePicker.pictures')}</h3>
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3">
              {pictures.map(p => {
                const selected = current === p.id
                return (
                  <button key={p.id} type="button" onClick={() => choose(p.id)} aria-pressed={selected} className={tile(selected)}>
                    {selected && tick}
                    <img src={p.url} alt="" className="w-24 h-24 object-contain rounded-xl bg-white" draggable={false} />
                    <span className="text-sm text-ink leading-snug">{p.label}</span>
                  </button>
                )
              })}
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <h3 className="text-sm font-bold text-ink-soft uppercase tracking-wider">{t('picturePicker.icons')}</h3>
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-8 gap-3">
              {WORK_KINDS.map(kind => {
                const value = choiceValue({ kind })
                const selected = current === value
                return (
                  <button key={kind} type="button" onClick={() => choose(value)} aria-pressed={selected} className={tile(selected)}>
                    {selected && tick}
                    <WorkKindIcon kind={kind} size={56} />
                    <span className="text-sm text-ink leading-snug">{t(ICON_LABEL[kind])}</span>
                  </button>
                )
              })}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
