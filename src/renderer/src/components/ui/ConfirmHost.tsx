/**
 * Draws lib/confirm's questions: Wivo's own confirmation dialog. Mounted once
 * on the desktop (App) and once on the phone (mobile/main). Esc or a click
 * outside is "Cancel"; Enter is the focused button. A dangerous question
 * (ending, deleting) starts on "Cancel": Enter alone never confirms it, it
 * takes a deliberate click on the red button.
 */
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { AlertTriangle } from 'lucide-react'
import { answerConfirm, currentConfirm, registerConfirmHost, subscribeConfirm } from '../../lib/confirm'
import { t } from '@/lib/i18n'

export function ConfirmHost() {
  const request = useSyncExternalStore(subscribeConfirm, currentConfirm)
  const yes = useRef<HTMLButtonElement>(null)
  const no = useRef<HTMLButtonElement>(null)

  useEffect(() => registerConfirmHost(), [])

  useEffect(() => {
    if (!request) return
    ;(request.danger ? no : yes).current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); answerConfirm(false) } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [request])

  if (!request) return null
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 p-4" onClick={() => answerConfirm(false)}>
      <div role="alertdialog" aria-modal="true" aria-describedby="wivo-confirm-message" aria-labelledby={request.title ? 'wivo-confirm-title' : undefined}
        className="w-full max-w-sm space-y-4 rounded-2xl bg-bg-card p-5 shadow-panel" onClick={e => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          {request.danger && <AlertTriangle size={18} className="mt-0.5 flex-shrink-0 text-rose-500" aria-hidden="true" />}
          <div className="space-y-1">
            {request.title && <p id="wivo-confirm-title" className="text-base font-bold text-ink">{request.title}</p>}
            <p id="wivo-confirm-message" className="whitespace-pre-line text-sm text-ink">{request.message}</p>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button ref={no} type="button" onClick={() => answerConfirm(false)} className="btn-ghost text-sm">{request.cancelLabel ?? t('confirm.cancel')}</button>
          <button ref={yes} type="button" onClick={() => answerConfirm(true)}
            className={request.danger ? 'btn-primary text-sm !bg-rose-500 hover:!bg-rose-600' : 'btn-primary text-sm'}>
            {request.confirmLabel ?? t('confirm.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
