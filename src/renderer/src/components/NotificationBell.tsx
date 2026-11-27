/**
 * The bell in the top bar. Says what happened and to which job (by code) —
 * the same and only facts the e-mail carries.
 */
import { useEffect, useState } from 'react'
import { takeOpenNotificationsRequest, onOpenNotificationsRequest } from '../lib/openNotifications'
import { formatDistanceToNow } from 'date-fns'
import { Bell } from 'lucide-react'
import { useNotifications, type AppNotification } from '../hooks/useNotifications'
import { usePipeline } from '../context/PipelineContext'
import { t, dateLocale } from '@/lib/i18n'

/**
 * The stages a stage_assigned notification names (sql/126): `stages` when the
 * person was put on several at once, else the one `stage`.
 */
export function assignedStages(detail: Record<string, unknown>): string[] {
  const list = Array.isArray(detail.stages) ? detail.stages.filter((s): s is string => typeof s === 'string' && s !== '') : []
  if (list.length > 0) return list
  return typeof detail.stage === 'string' && detail.stage !== '' ? [detail.stage] : []
}

export const text = (n: AppNotification, stageLabel: (key: string) => string): string => {
  const code = n.job_code ?? '—'
  if (n.kind === 'mfa_removed') {
    return n.detail.signed_out ? t('notifications.mfaRemovedLast') : t('notifications.mfaRemoved', { name: String(n.detail.name ?? '') })
  }
  if (n.kind === 'mfa_reset') {
    return t('notifications.mfaReset', { by: String(n.detail.by ?? ''), reason: String(n.detail.reason ?? '') })
  }
  if (n.kind === 'stage_reached') {
    const stage = stageLabel(String(n.detail.to ?? ''))
    return n.detail.revision ? t('notifications.remakeReachedStage', { code, stage }) : t('notifications.reachedStage', { code, stage })
  }
  // sql/123: the job moved (for someone else on it who asked); put on one of its stages.
  if (n.kind === 'stage_progress') return t('notifications.stageProgress', { code, stage: stageLabel(String(n.detail.to ?? '')) })
  if (n.kind === 'stage_assigned') {
    const stages = assignedStages(n.detail).map(stageLabel)
    if (stages.length > 1) {
      const list = stages.join(', ')
      return n.detail.new ? t('notifications.newJobOnStages', { code, stages: list }) : t('notifications.putOnStages', { code, stages: list })
    }
    const stage = stages[0] ?? ''
    return n.detail.new ? t('notifications.newJobOnStage', { code, stage }) : t('notifications.putOnStage', { code, stage })
  }
  // sql/138: an order or a request to connect from outside (Wivo Network). Nothing about the patient.
  if (n.kind === 'client_order') return t('notifications.clientOrder')
  if (n.kind === 'client_request') return t('notifications.clientRequest')
  // sql/142: a client wrote on an order, or answered a review (sql/143).
  if (n.kind === 'client_message') return t('notifications.clientMessage', { ref: String(n.detail.ref ?? '') })
  // sql/144: a job needs adjustment; a client said how the sent work fitted.
  if (n.kind === 'job_adjust') return t('notifications.jobAdjust', { code })
  if (n.kind === 'client_fit') {
    return n.detail.decision === 'fitted'
      ? t('notifications.clientFitted', { ref: String(n.detail.ref ?? '') })
      : t('notifications.clientAdjust', { ref: String(n.detail.ref ?? '') })
  }
  if (n.kind === 'client_review') {
    return n.detail.decision === 'approved'
      ? t('notifications.clientApproved', { ref: String(n.detail.ref ?? '') })
      : t('notifications.clientChanges', { ref: String(n.detail.ref ?? '') })
  }
  // sql/130: made the one who makes an option of the job ("Metal bar").
  if (n.kind === 'option_assigned') {
    const options = Array.isArray(n.detail.options) ? n.detail.options.filter((o): o is string => typeof o === 'string').join(', ') : ''
    return t('notifications.optionAssigned', { code, options })
  }
  if (n.kind === 'assigned') {
    return n.detail.role === 'designer' ? t('notifications.assignedDesigner', { code }) : t('notifications.assignedTechnician', { code })
  }
  if (n.kind === 'job_shared') return t('notifications.jobShared', { code, from: String(n.detail.from_org ?? '') })
  if (n.kind === 'stage_handover') return t('notifications.handedOver', { code })
  if (n.kind === 'files_added') return t('notifications.filesAdded', { code })
  // This clinic's Wivo updates (sql/119), for approvers.
  if (n.kind === 'update_installed') return t('notifications.updateInstalled', { version: String(n.detail.to ?? '') })
  if (n.kind === 'update_failed') return t('notifications.updateFailed', { version: String(n.detail.to ?? '') })
  if (n.kind === 'update_stale') return t('notifications.updateStale')
  // sql/125: Resend's limit, for owners.
  if (n.kind === 'mail_quota') return n.detail.limit === 'monthly' ? t('notifications.mailQuotaMonthly') : t('notifications.mailQuotaDaily')
  return t('notifications.question', { code })
}

export function NotificationBell({ onOpen }: { onOpen: (n: AppNotification) => void }) {
  const { items, unread, markRead } = useNotifications()
  const { stageMap } = usePipeline()
  const stageLabel = (key: string): string => stageMap[key]?.label ?? key
  const [open, setOpen] = useState(false)
  // A tapped push opens this list (sw.js, lib/openNotifications).
  useEffect(() => {
    if (takeOpenNotificationsRequest()) setOpen(true)
    return onOpenNotificationsRequest(() => setOpen(true))
  }, [])

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(o => !o)} aria-label={t('notifications.notifications')}
        title={t('notifications.notifications')}
        className="relative btn-ghost text-nav hover:text-nav border border-nav/20 px-2">
        <Bell size={14} />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 text-[10px] font-bold rounded-full bg-red-500 text-white min-w-[16px] h-[16px] px-1 flex items-center justify-center">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-80 z-50 rounded-xl bg-bg-card shadow-panel border border-ink-faint/20 p-2">
          <div className="flex items-center px-2 py-1">
            <span className="text-xs font-semibold text-ink-muted uppercase tracking-wider">{t('notifications.notifications')}</span>
            {unread > 0 && (
              <button type="button" onClick={() => markRead.mutate(undefined)} className="ml-auto text-xs text-accent hover:underline">
                {t('notifications.markAllRead')}
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <p className="px-2 py-3 text-sm text-ink-muted">{t('notifications.none')}</p>
          ) : (
            <ul className="max-h-96 overflow-y-auto">
              {items.map(n => (
                <li key={n.id}>
                  <button type="button"
                    onClick={() => { if (!n.read_at) markRead.mutate([n.id]); setOpen(false); onOpen(n) }}
                    className={`w-full text-left rounded-lg px-2 py-2 text-sm hover:bg-bg-sidebar ${n.read_at ? 'text-ink-muted' : 'text-ink font-medium'}`}>
                    {text(n, stageLabel)}
                    <span className="block text-[11px] font-normal text-ink-muted">
                      {formatDistanceToNow(new Date(n.created_at), { addSuffix: true, locale: dateLocale })}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
