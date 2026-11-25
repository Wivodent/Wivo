/**
 * Desktop: this build is below the minimum version in the clinic's signed
 * release list (docs/RELEASE.md §6a, lib/releaseMinimum). A full screen says
 * so, with "Update now". Nothing is saved until Wivo is updated (the database
 * client refuses saves before they leave), but everything can still be read:
 * "View only" puts the full screen away, and a bar at the top stays with
 * "Update now".
 *
 * "Update now" restarts into the new version once it is downloaded; until
 * then it asks the updater for it at once and shows how far it is.
 */
import { useEffect, useState } from 'react'
import { AlertTriangle, Download, Eye, RefreshCw } from 'lucide-react'
import { useUpdate } from '../providers/UpdateProvider'
import { onReleaseMinimum, releaseMinimum, watchReleaseMinimum } from '../lib/releaseMinimum'
import { t } from '@/lib/i18n'

export function useReleaseMinimum() {
  const [status, setStatus] = useState(releaseMinimum)
  useEffect(() => {
    watchReleaseMinimum()
    setStatus(releaseMinimum())
    return onReleaseMinimum(setStatus)
  }, [])
  return status
}

export function PleaseUpdate() {
  const status = useReleaseMinimum()
  const { state, installNow, checkNow } = useUpdate()
  const [viewOnly, setViewOnly] = useState(false)
  const [asked, setAsked] = useState(false)
  const below = !!status?.below
  const ready = state.stage === 'ready'

  // Below the minimum and nothing downloaded: fetch it now, not at the next half-hourly check.
  useEffect(() => {
    if (below && !ready && !asked) { setAsked(true); checkNow() }
  }, [below, ready, asked, checkNow])

  if (!below || !status) return null

  const update = () => { if (ready) installNow(); else checkNow() }
  const progress = state.stage === 'downloading' ? t('pleaseUpdate.downloading', { percent: state.percent })
    : state.stage === 'checking' || state.stage === 'available' ? t('updateRequired.fetching')
    : state.stage === 'failed' ? t('pleaseUpdate.failed')
    : ready ? t('pleaseUpdate.ready', { version: state.version })
    : t('updateRequired.fetching')
  const button = (
    <button type="button" onClick={update} className="btn-primary">
      {ready ? <RefreshCw size={14} /> : <Download size={14} />} {ready ? t('pleaseUpdate.restart') : t('pleaseUpdate.updateNow')}
    </button>
  )

  if (viewOnly) {
    return (
      <div role="alert" className="fixed top-0 inset-x-0 z-[90] flex flex-wrap items-center justify-center gap-3 bg-amber-600 px-4 py-2 text-xs text-white shadow-card">
        <AlertTriangle size={14} aria-hidden="true" />
        <span className="font-semibold">{t('pleaseUpdate.bar')}</span>
        <span className="text-white/80">{progress}</span>
        <button type="button" onClick={update} className="btn-primary text-xs px-3 py-1">
          {ready ? t('pleaseUpdate.restart') : t('pleaseUpdate.updateNow')}
        </button>
      </div>
    )
  }

  return (
    <div role="alertdialog" aria-modal="true" aria-labelledby="please-update-title"
      className="fixed inset-0 z-[95] flex items-center justify-center bg-bg/95 backdrop-blur-sm p-6">
      <div className="max-w-md w-full rounded-2xl bg-bg-card shadow-panel border border-amber-200 p-8 text-center space-y-4">
        <div className="mx-auto w-12 h-12 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center">
          <AlertTriangle size={24} aria-hidden="true" />
        </div>
        <h1 id="please-update-title" className="text-xl font-semibold text-ink">{t('pleaseUpdate.title')}</h1>
        <p className="text-sm text-ink-soft">{t('pleaseUpdate.body', { running: status.running, minimum: status.minimum ?? '' })}</p>
        <p className="text-sm text-ink-muted">{t('pleaseUpdate.readOnly')}</p>
        <div className="flex flex-wrap justify-center gap-3 pt-2">
          {button}
          <button type="button" onClick={() => setViewOnly(true)} className="btn-ghost">
            <Eye size={14} /> {t('pleaseUpdate.viewOnly')}
          </button>
        </div>
        <p className="text-xs text-ink-muted" aria-live="polite">{progress}</p>
      </div>
    </div>
  )
}
