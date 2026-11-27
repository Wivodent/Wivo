/**
 * Orders from outside (docs/PLAN-NETWORK-1.md; layout docs/design/orders.html):
 * technicians, doctors, clinics and labs with a Wivo Network account send
 * orders straight into this Wivo.
 *
 * Top to bottom: the heading with "taking orders" and Settings (the owner);
 * four counts; the orders by tab (New, In progress, Ready, Sent, Received,
 * Problem, Rejected: sql/145)
 * beside who asks to connect, the invite link with the directory switch, and
 * the connected clients. Every number is counted from rows this person may
 * read; nothing is shown that Wivo does not have (no ratings, no "unread").
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Inbox, Check, X, Download, Send, Globe2, Copy } from 'lucide-react'
import { format, formatDistanceToNow } from 'date-fns'
import {
  useNetworkSettings, useNetworkClients, useClientOrders, useOrderThread, usePortalLive,
  useSaveNetworkSettings, useConfirmClient, useClientVisibility, useEndClient,
  useAcceptOrder, useRejectOrder, usePostOrderMessage, defaultList, clientName, useQuoteOrder, useSetOrderPrice,
  useDirectoryEntry, useSetDirectoryListed, useOrderCounts, useOrderJobs, useOrderJobsLive,
  type NetworkClientRow, type ClientOrderRow, type CanSee, type OrderCounts, PORTAL_KEY,
} from '../../hooks/useNetworkPortal'
import { useWorkflowTemplates } from '../../hooks/useWorkflowTemplates'
import { usePermissions } from '../../hooks/usePermissions'
import { usePipeline } from '../../context/PipelineContext'
import { useSettings, useWorkTypes, priceBookOf } from '../../stores/useSettings'
import { useCustomers } from '../../hooks/useCustomers'
import { orderPriceFor, clientPricingOf, parsePrice, type OrderPriceSuggestion } from '../../lib/orderPrice'
import { saveOrderFile } from '../../lib/fileLink'
import { inviteLink, type DirectoryProblem } from '../../lib/networkDirectory'
import { MarkSentButton } from './MarkSent'
import { OrderThread } from './OrderThread'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { orderTab, countByTab, teethLabel, parseTeeth, initials, chosenOptionLabels, networkConfigured, ORDER_TABS, type OrderTab, type OrderJobState } from '../../lib/orderView'
import { notConfirmed, reminderDays, isReceived } from '../../lib/delivery'
import { JobDelivery } from '../Delivery/JobDelivery'
import { RateClientRow } from '../Feedback/Feedback'
import { useAuth } from '../../context/AuthContext'
import { confirmDialog } from '../../lib/confirm'
import { describeError } from '../Patients/errors'
import { InfoButton } from '../ui/InfoButton'
import { WorkTypeArt } from '../ui/WorkTypeArt'
import { UNKNOWN_WORK_TYPE } from '@shared/pricing/workTypes'
import { orderImplants } from '@shared/network/order'
import { t, dateLocale } from '@/lib/i18n'

const SEE_KEYS: (keyof CanSee)[] = ['status', 'messages', 'files', 'prices']
const seeLabel = (k: keyof CanSee): string =>
  k === 'status' ? t('orders.seeStatus') : k === 'messages' ? t('orders.seeMessages') : k === 'files' ? t('orders.seeFiles') : t('orders.seePrices')
const roleLabel = (r: NetworkClientRow['role']): string =>
  r === 'technician' ? t('network.roleTechnician') : r === 'doctor' ? t('network.roleDoctor') : r === 'clinic' ? t('network.roleClinic') : t('network.roleLab')
const when = (iso: string) => format(new Date(iso), 'd MMM yyyy HH:mm', { locale: dateLocale })
const ago = (iso: string) => formatDistanceToNow(new Date(iso), { addSuffix: true, locale: dateLocale })
const tabLabel = (tab: OrderTab): string =>
  tab === 'new' ? t('orders.tabNew') : tab === 'in_progress' ? t('orders.tabInProgress') : tab === 'ready' ? t('orders.tabReady')
    : tab === 'sent' ? t('orders.tabSent') : tab === 'arrived' ? t('orders.tabReceived') : tab === 'problem' ? t('orders.tabProblem')
    : tab === 'cancelled' ? t('orders.tabCancelled') : t('orders.tabRejected')

/** What a bell notice asks this page to open (lib/notificationTarget). `n` grows with each ask. */
export interface OrdersFocus { orderId?: string; requests?: boolean; n: number }

export function OrdersView({ focus, onOpenJob }: { focus?: OrdersFocus; onOpenJob?: (jobId: string) => void } = {}) {
  const { isOwner, can } = usePermissions()
  usePortalLive()
  useOrderJobsLive()
  const { doneStageKey } = usePipeline()
  const settings = useNetworkSettings(isOwner)
  const clients = useNetworkClients().data ?? []
  const orders = useClientOrders().data ?? []
  const jobs = useOrderJobs(orders.filter(o => o.status === 'accepted' && o.job_id).map(o => o.job_id!)).data
  const counts = useOrderCounts(orders.map(o => o.id)).data
  const configured = networkConfigured(settings.data)
  const entry = useDirectoryEntry(isOwner && configured).data
  const [openId, setOpenId] = useState<string | null>(null)
  const [tab, setTab] = useState<OrderTab>('new')

  const byId = useMemo(() => new Map(clients.map(c => [c.id, c])), [clients])
  const tabOf = (o: ClientOrderRow) => orderTab(o, o.job_id ? jobs?.get(o.job_id) : undefined, doneStageKey)
  const perTab = countByTab(orders, tabOf)
  const shown = orders.filter(o => tabOf(o) === tab)
  const requests = clients.filter(c => c.state === 'requested')
  const connected = clients.filter(c => c.state === 'confirmed')
  const ordersPerClient = useMemo(() => {
    const m = new Map<string, number>()
    for (const o of orders) m.set(o.client_id, (m.get(o.client_id) ?? 0) + 1)
    return m
  }, [orders])
  const open = orders.find(o => o.id === openId) ?? null
  const on = settings.data?.enabled ?? false

  // A bell notice: open its order (or the job an accepted order became), or go to who asks to connect.
  const requestsRef = useRef<HTMLElement>(null)
  const handled = useRef(0)
  const ordersLoaded = orders.length > 0
  useEffect(() => {
    if (!focus || focus.n === handled.current) return
    if (focus.requests) {
      handled.current = focus.n
      requestsRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
      return
    }
    const o = focus.orderId ? orders.find(x => x.id === focus.orderId) : undefined
    if (!o) return  // not loaded yet: the next render tries again
    handled.current = focus.n
    // A cancelled order's job is in the bin: the order itself opens (sql/146).
    if (o.status === 'accepted' && o.job_id && !o.cancelled_at && onOpenJob) { onOpenJob(o.job_id); return }
    setTab(tabOf(o))
    setOpenId(o.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.n, ordersLoaded, orders])

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-2xl font-bold text-ink">
            <Inbox size={26} className="text-accent" aria-hidden="true" /> {t('orders.heading')}
            <InfoButton label={t('orders.heading')} text={t('orders.titleInfo')} />
          </h1>
          <p className="text-base text-ink-muted">{t('orders.subtitle')}</p>
        </div>
        {isOwner && settings.isFetched && (
          <div className="card flex flex-wrap items-center gap-2 px-4 py-2" data-testid="orders-state">
            <span className={`h-2.5 w-2.5 rounded-full ${on ? 'bg-emerald-600' : 'bg-ink-faint'}`} aria-hidden="true" />
            <span className="text-base font-semibold text-ink">{on ? t('orders.taking') : t('orders.notTaking')}</span>
            {on && entry?.listed && <span className="text-sm text-ink-muted">· {t('orders.visibleInDirectory')}</span>}
          </div>
        )}
      </div>

      {isOwner && configured && !on && <p className="text-base text-ink-muted">{t('orders.offHint')}</p>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t('orders.statNew')} value={perTab.new} sub={t('orders.statNewSub')} strong onClick={() => setTab('new')} />
        <Stat label={t('orders.statInProgress')} value={perTab.in_progress} sub={t('orders.statInProgressSub')} onClick={() => setTab('in_progress')} />
        <Stat label={t('orders.statReady')} value={perTab.ready} sub={t('orders.statReadySub')} onClick={() => setTab('ready')} />
        <Stat label={t('orders.statClients')} value={connected.length}
          sub={requests.length > 0 ? t('orders.statAsking', { n: requests.length }) : t('orders.statConnected')} warn={requests.length > 0} />
      </div>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-3">
        <section className="card overflow-hidden p-0 lg:col-span-2" aria-label={t('orders.heading')}>
          <div className="flex flex-wrap gap-2 border-b border-ink-faint/20 px-4 py-3" role="tablist">
            {ORDER_TABS.map(k => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                className={`h-10 rounded-full px-4 text-sm ${tab === k ? 'bg-accent font-bold text-white'
                  : k === 'problem' && perTab.problem > 0 ? 'border-2 border-rose-400 font-semibold text-rose-700 hover:bg-rose-500/10'
                  : 'border border-ink-faint/30 text-ink hover:bg-bg-sidebar'}`}>
                {/* Every tab shows its count, the same way. */}
                {tabLabel(k)} · {perTab[k]}
              </button>
            ))}
          </div>
          {shown.length === 0 && <p className="p-6 text-base text-ink-muted">{tab === 'new' ? t('orders.noNewOrders') : t('orders.tabEmpty')}</p>}
          {shown.map(o => (
            <OrderRow key={o.id} order={o} tab={tab} client={byId.get(o.client_id)} counts={counts}
              canAccept={can('jobs.write')} onOpen={() => setOpenId(o.id)} job={o.job_id ? jobs?.get(o.job_id) : undefined} />
          ))}
        </section>

        <div className="space-y-5">
          {requests.length > 0 && (
            <section ref={requestsRef} className="space-y-3 rounded-2xl border-2 border-amber-300 bg-amber-500/10 p-4">
              <h2 className="flex items-center gap-2 text-lg font-bold text-ink">{t('orders.requests')}
                <InfoButton label={t('orders.requests')} text={t('orders.requestsInfo')} /></h2>
              {requests.map(c => <RequestCard key={c.id} client={c} canDecide={isOwner} />)}
            </section>
          )}
          {isOwner && settings.isFetched && <NetworkCard key={settings.data?.org_id ?? 'none'} row={settings.data ?? null} />}
          {connected.length > 0 && <ConnectedClients clients={connected} ordersPerClient={ordersPerClient} canChange={isOwner} />}
        </div>
      </div>

      {open && <OrderDialog order={open} client={byId.get(open.client_id)} canDecide={can('jobs.write')} canWrite={can('jobs.read') || can('jobs.write')}
        job={open.job_id ? jobs?.get(open.job_id) : undefined} onClose={() => setOpenId(null)} />}
    </div>
  )
}

function Stat({ label, value, sub, strong, warn, onClick }: { label: string; value: number; sub: string; strong?: boolean; warn?: boolean; onClick?: () => void }) {
  const body = (
    <>
      <span className={`text-sm font-semibold ${strong ? 'text-accent' : 'text-ink-muted'}`}>{label}</span>
      <span className="text-3xl font-bold text-ink">{value}</span>
      <span className={`text-sm ${warn ? 'font-semibold text-amber-700' : 'text-ink-muted'}`}>{sub}</span>
    </>
  )
  const cls = `card flex flex-col gap-1 p-4 text-left ${strong ? 'border-2 border-accent' : ''}`
  return onClick
    ? <button type="button" onClick={onClick} className={`${cls} hover:ring-2 hover:ring-accent/30`}>{body}</button>
    : <div className={cls}>{body}</div>
}

// ── Wivo Network: the owner's card ─────────────────────────────────────────
type SettingsRow = { enabled: boolean; network_public_key: string | null; network_clinic_id: string | null; session_hours: number }

const directoryProblemText = (p: DirectoryProblem | undefined): string =>
  p === 'not_allowed' ? t('orders.directoryNotAllowed')
    : p === 'orders_off' ? t('orders.directoryOrdersOff')
    : p === 'try_again' ? t('orders.directoryTryAgain')
    : p === 'unreachable' ? t('orders.directoryUnreachable')
    : t('app.notAvailableYet')

/**
 * What the owner sees: "Take orders from outside", "Show my clinic in the
 * directory", the invite link and Copy. No key and no number: Wivo connects
 * the clinic (scripts/network-connect.mjs). Before it has, the card says so,
 * and the fields are under "Advanced (Wivo support)".
 */
function NetworkCard({ row }: { row: SettingsRow | null }) {
  const configured = networkConfigured(row)
  return (
    <section className="card space-y-3 p-4" data-testid="network-card">
      <h2 className="flex items-center gap-2 text-lg font-bold text-ink">
        <Globe2 size={20} className="text-accent" aria-hidden="true" /> {t('orders.setupTitle')}
        <InfoButton label={t('orders.setupTitle')} text={t('orders.titleInfo')} />
      </h2>
      {configured ? <NetworkSwitches row={row!} /> : (
        <>
          <p className="text-base text-ink">{t('orders.wivoSetsUp')}</p>
          <details>
            <summary className="cursor-pointer text-sm text-ink-muted">{t('orders.advanced')}</summary>
            <AdvancedSetup row={row} />
          </details>
        </>
      )}
    </section>
  )
}

function NetworkSwitches({ row }: { row: SettingsRow }) {
  const save = useSaveNetworkSettings()
  const entry = useDirectoryEntry(true)
  const setListed = useSetDirectoryListed()
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const e = entry.data
  const link = e ? inviteLink(e.inviteCode) : null
  const problem = setListed.error?.problem ?? entry.error?.problem
  const place = e ? [e.city, e.country].filter(Boolean).join(', ') : ''

  async function setOrders(on: boolean) {
    setError(null)
    // Turning off ends every client's session at once: asked first, as any change that cannot simply be taken back.
    if (!on && !(await confirmDialog({ message: t('orders.turnOffAsk'), confirmLabel: t('orders.turnOff'), danger: true }))) return
    try {
      await save.mutateAsync({ p_enabled: on, p_public_key: row.network_public_key, p_network_clinic: row.network_clinic_id, p_session_hours: row.session_hours })
    } catch (err) { setError(describeError(err)) }
  }

  async function copy() {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch { /* the clipboard refused: the link is on screen to select */ }
  }

  return (
    <div className="space-y-3">
      <label className="flex items-center justify-between gap-3 text-base font-semibold text-ink">
        <span>{t('orders.takeOrders')}</span>
        <input type="checkbox" className="h-6 w-6 shrink-0" checked={row.enabled} disabled={save.isPending}
          aria-label={t('orders.takeOrders')} onChange={ev => void setOrders(ev.target.checked)} />
      </label>
      {e && (
        <div className="space-y-1">
          <label className="flex items-center justify-between gap-3 text-base font-semibold text-ink">
            <span className="flex items-center gap-1">{t('orders.directoryShort')}
              <InfoButton label={t('orders.directoryListed')} text={t('orders.directoryListedInfo')} /></span>
            <input type="checkbox" className="h-6 w-6 shrink-0" checked={e.listed} aria-label={t('orders.directoryListed')}
              disabled={setListed.isPending || (!row.enabled && !e.listed)}
              onChange={ev => setListed.mutate(ev.target.checked)} />
          </label>
          <p className="text-sm text-ink-muted">{t('orders.directoryShownAs', { name: e.name, place: place || '—' })}</p>
          {!row.enabled && e.listed && <p className="text-sm text-amber-600">{t('orders.directoryListedButOff')}</p>}
        </div>
      )}
      {entry.isLoading && <p className="text-sm text-ink-muted">{t('orders.directoryLoading')}</p>}
      {link && (
        <div className="space-y-2 border-t border-ink-faint/20 pt-3">
          <span className="flex items-center gap-1 text-sm font-semibold text-ink">{t('orders.inviteLink')}
            <InfoButton label={t('orders.inviteLink')} text={t('orders.inviteLinkInfo')} /></span>
          <p className="text-sm text-ink-muted">{t('orders.inviteText')}</p>
          <div className="flex gap-2">
            <input className="input h-11 min-w-0 flex-1 truncate font-mono text-sm" value={link} readOnly
              onFocus={ev => ev.currentTarget.select()} aria-label={t('orders.inviteLink')} />
            <button type="button" onClick={() => void copy()} aria-label={t('orders.copyInvite')}
              className="h-11 shrink-0 rounded-xl border border-accent px-3 text-sm font-bold text-accent hover:bg-accent/10">
              <Copy size={16} className="mr-1 inline" aria-hidden="true" />{copied ? t('orders.inviteCopied') : t('orders.copy')}
            </button>
          </div>
        </div>
      )}
      {(entry.isError || setListed.isError) && <p className="text-sm text-rose-600" role="alert">{directoryProblemText(problem)}</p>}
      {error && <p className="text-sm text-rose-600" role="alert">{error}</p>}
    </div>
  )
}

/** Wivo support's fields, for a clinic the script has not connected yet. Orders stay off until the owner turns them on. */
function AdvancedSetup({ row }: { row: SettingsRow | null }) {
  const save = useSaveNetworkSettings()
  const [key, setKey] = useState(row?.network_public_key ?? '')
  const [clinicId, setClinicId] = useState(row?.network_clinic_id ?? '')
  const [hours, setHours] = useState(row?.session_hours ?? 8)
  const [error, setError] = useState<string | null>(null)
  const ready = /^[A-Za-z0-9_-]{43}$/.test(key.trim()) && /^[0-9a-f-]{36}$/i.test(clinicId.trim())

  async function submit() {
    setError(null)
    try {
      await save.mutateAsync({ p_enabled: false, p_public_key: key.trim() || null, p_network_clinic: clinicId.trim() || null, p_session_hours: hours })
    } catch (e) { setError(describeError(e)) }
  }

  return (
    <div className="mt-3 space-y-3">
      <div>
        <span className="label flex items-center gap-1">{t('orders.setupKey')} <InfoButton label={t('orders.setupKey')} text={t('orders.setupKeyInfo')} /></span>
        <input className="input h-11 font-mono" value={key} onChange={e => setKey(e.target.value)} spellCheck={false} />
      </div>
      <div>
        <span className="label flex items-center gap-1">{t('orders.setupClinicId')} <InfoButton label={t('orders.setupClinicId')} text={t('orders.setupClinicIdInfo')} /></span>
        <input className="input h-11 font-mono" value={clinicId} onChange={e => setClinicId(e.target.value)} spellCheck={false} />
      </div>
      <div>
        <span className="label">{t('orders.setupHours')}</span>
        <input type="number" min={1} max={24} className="input h-11 w-32" value={hours} onChange={e => setHours(Math.max(1, Math.min(24, Number(e.target.value) || 8)))} />
      </div>
      {!ready && (key || clinicId) && <p className="text-sm text-amber-600">{t('orders.setupNeedsBoth')}</p>}
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <button type="button" onClick={submit} disabled={save.isPending || !ready} className="btn-primary h-11 px-5 text-base">{t('orders.save')}</button>
    </div>
  )
}

// ── Someone asks to connect ─────────────────────────────────────────────────
function SeeToggles({ value, onChange, disabled }: { value: CanSee; onChange: (v: CanSee) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2">
      {SEE_KEYS.map(k => (
        <label key={k} className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-5 w-5" disabled={disabled} checked={value[k]} onChange={e => onChange({ ...value, [k]: e.target.checked })} />
          {seeLabel(k)}
        </label>
      ))}
    </div>
  )
}

function Avatar({ name }: { name: string }) {
  return <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent font-bold text-white" aria-hidden="true">{initials(name)}</span>
}

function RequestCard({ client, canDecide }: { client: NetworkClientRow; canDecide: boolean }) {
  const confirm = useConfirmClient()
  const end = useEndClient()
  const [list, setList] = useState<'clients' | 'clinics'>(defaultList(client))
  const [see, setSee] = useState<CanSee>({ status: true, messages: true, files: true, prices: false })
  const [error, setError] = useState<string | null>(null)
  const run = async (fn: () => Promise<unknown>) => { setError(null); try { await fn() } catch (e) { setError(describeError(e)) } }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Avatar name={clientName(client)} />
        <div className="min-w-0">
          <p className="truncate text-base font-bold text-ink">{clientName(client)}</p>
          <p className="text-sm text-ink-muted">{roleLabel(client.role)}{client.country ? ` · ${client.country}` : ''} · {ago(client.requested_at)}</p>
        </div>
      </div>
      {canDecide ? (
        <>
          <label className="block text-sm font-semibold text-ink">{t('orders.addAs')}
            <select className="input mt-1 h-11 text-base" value={list} onChange={e => setList(e.target.value as 'clients' | 'clinics')}>
              <option value="clients">{t('orders.addToClients')}</option>
              <option value="clinics">{t('orders.addToClinics')}</option>
            </select>
          </label>
          <details>
            <summary className="cursor-pointer text-sm font-semibold text-ink">{t('orders.theySee')}</summary>
            <div className="mt-2"><SeeToggles value={see} onChange={setSee} /></div>
          </details>
          <div className="flex gap-2">
            <button type="button" disabled={confirm.isPending}
              onClick={() => run(() => confirm.mutateAsync({ p_client: client.id, p_list: list, p_can_see: see }))}
              className="btn-primary h-11 flex-1 justify-center text-sm"><Check size={16} aria-hidden="true" /> {t('orders.confirm')}</button>
            <button type="button" disabled={end.isPending}
              onClick={() => run(async () => { if (await confirmDialog({ message: t('orders.declineAsk', { name: clientName(client) }), danger: true })) await end.mutateAsync({ p_client: client.id }) })}
              className="btn-ghost h-11 flex-1 justify-center border border-ink-faint/30 text-sm"><X size={16} aria-hidden="true" /> {t('orders.decline')}</button>
          </div>
        </>
      ) : <p className="text-sm text-ink-muted">{t('orders.ownerDecides')}</p>}
      {error && <p className="text-sm text-rose-600">{error}</p>}
    </div>
  )
}

// ── Connected clients ───────────────────────────────────────────────────────
const ordersCount = (n: number) => (n === 1 ? t('orders.oneOrder') : t('orders.nOrders', { n }))

function ConnectedClients({ clients, ordersPerClient, canChange }: { clients: NetworkClientRow[]; ordersPerClient: Map<string, number>; canChange: boolean }) {
  const [all, setAll] = useState(false)
  const feedback = useClientFeedbackSummary()
  const sorted = [...clients].sort((a, b) => (ordersPerClient.get(b.id) ?? 0) - (ordersPerClient.get(a.id) ?? 0))
  return (
    <section className="card space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-bold text-ink">{t('orders.connectedTitle')}</h2>
        <button type="button" className="text-sm font-semibold text-accent hover:underline" onClick={() => setAll(a => !a)} aria-expanded={all}>
          {all ? t('orders.showFewer') : t('orders.allN', { n: clients.length })}
        </button>
      </div>
      {!all && sorted.slice(0, 3).map(c => (
        <div key={c.id} className="flex justify-between gap-3 text-base">
          <span className="truncate text-ink">{clientName(c)}</span>
          <span className="shrink-0 text-ink-muted">
            {feedbackLine(feedback.get(c.id))}{ordersCount(ordersPerClient.get(c.id) ?? 0)}
          </span>
        </div>
      ))}
      {all && sorted.map(c => <ConnectedRow key={c.id} client={c} orders={ordersPerClient.get(c.id) ?? 0} canChange={canChange} feedback={feedback.get(c.id)} />)}
    </section>
  )
}

function ConnectedRow({ client, orders, canChange, feedback }: { client: NetworkClientRow; orders: number; canChange: boolean; feedback?: ClientFeedbackRow }) {
  const visibility = useClientVisibility()
  const end = useEndClient()
  return (
    <div className="space-y-2 rounded-xl border border-ink-faint/20 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-base font-semibold text-ink">{clientName(client)} <span className="font-normal text-ink-muted">· {roleLabel(client.role)} · {feedbackLine(feedback)}{ordersCount(orders)}</span></p>
        {canChange && (
          <button type="button" className="btn-ghost h-9 text-sm text-rose-600"
            onClick={async () => { if (await confirmDialog({ message: t('orders.endAsk', { name: clientName(client) }), danger: true })) end.mutate({ p_client: client.id }) }}>
            {t('orders.end')}
          </button>
        )}
      </div>
      <SeeToggles value={client.can_see} disabled={!canChange || visibility.isPending}
        onChange={v => visibility.mutate({ p_client: client.id, p_can_see: v })} />
    </div>
  )
}

// ── Orders ──────────────────────────────────────────────────────────────────
function statusText(o: ClientOrderRow): string {
  if (o.cancelled_at) return t('orders.statusCancelled')
  return o.status === 'received' ? t('orders.statusNew') : o.status === 'accepted' ? t('orders.statusAccepted') : t('orders.statusRejected')
}

/** The order's work type picture: the clinic's own type when the name matches one, else by the name alone. */
function OrderArt({ workType, size }: { workType: string; size: number }) {
  const { resolve } = useWorkTypes()
  const known = resolve(workType)
  return <WorkTypeArt size={size} iconSize={Math.round(size * 0.6)} type={known === UNKNOWN_WORK_TYPE ? { nimi: workType, match: [] } : known} />
}

/** An order's chosen options by their names in this clinic's option library. */
function useOptionLabels(): (options: Record<string, string[]> | null | undefined) => string[] {
  const library = useSettings().settings.tooValikud
  return options => chosenOptionLabels(options, (_g, id) => library.find(o => o.id === id)?.nimi)
}

function Chip({ children, tone }: { children: React.ReactNode; tone?: 'blue' }) {
  return <span className={`rounded-lg px-2 py-0.5 text-sm ${tone === 'blue' ? 'bg-sky-500/15 font-semibold text-sky-800' : 'border border-ink-faint/30 bg-bg-card text-ink'}`}>{children}</span>
}

function OrderRow({ order, tab, client, counts, canAccept, onOpen, job }: {
  order: ClientOrderRow; tab: OrderTab; client?: NetworkClientRow; counts?: OrderCounts; canAccept: boolean; onOpen: () => void
  /** The job the order became, as the board has it (for Mark as sent, and the delivery: sql/145). */
  job?: OrderJobState
}) {
  const accept = useAcceptOrder()
  const optionLabels = useOptionLabels()
  const days = reminderDays(useSettings().settings.vastuvotuPaevad)
  // sql/153: accepted here only with a price the engine could work out and nothing for the client to approve.
  const suggestion = useOrderPriceSuggestion(order, client)
  const waitsForPrice = suggestion.needsQuote || isQuoteState(order.price_state)
  const quickAccept = tab === 'new' && canAccept && !waitsForPrice && suggestion.amount != null
  const noPrice = order.status === 'accepted' && !!job && !(Number(job.hind ?? 0) > 0) && !order.cancelled_at
  const late = !!job && notConfirmed(job, !!job.problem, days)
  const [error, setError] = useState<string | null>(null)
  const p = order.payload
  const teeth = teethLabel(p?.teeth ?? '')
  const files = counts?.files.get(order.id) ?? 0
  const messages = counts?.messages.get(order.id) ?? 0
  const title = [order.work_type, ...optionLabels(p?.options)].join(' · ')
  const who = client ? `${clientName(client)} (${roleLabel(client.role)})` : clientName(client)

  return (
    <div className={`flex gap-4 border-b border-ink-faint/15 p-4 last:border-b-0 ${tab === 'new' ? 'bg-accent/5' : ''}`}>
      <OrderArt workType={order.work_type} size={56} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap justify-between gap-2">
          <button type="button" onClick={onOpen} className="min-w-0 truncate text-left text-lg font-bold text-ink hover:underline">{title}</button>
          <span className="text-sm text-ink-muted">{ago(order.created_at)}</span>
        </div>
        <p className="truncate text-base text-ink-soft">{who} · {t('orders.refShort')} {order.patient_ref}</p>
        <div className="flex flex-wrap gap-2">
          {teeth && <Chip>{parseTeeth(p?.teeth ?? '').length === 1 ? t('orders.toothChip', { teeth }) : t('orders.teethChip', { teeth })}</Chip>}
          {p?.shade && <Chip>{t('orders.shadeChip', { shade: p.shade })}</Chip>}
          {order.due && <Chip>{t('orders.dueChip', { date: format(new Date(order.due), 'dd.MM', { locale: dateLocale }) })}</Chip>}
          {files > 0 && <Chip>{files === 1 ? t('orders.oneFile') : t('orders.nFiles', { n: files })}</Chip>}
          {messages > 0 && <Chip tone="blue">{messages === 1 ? t('orders.oneMessage') : t('orders.nMessages', { n: messages })}</Chip>}
          {tab === 'problem' && <span className="rounded-lg bg-rose-600 px-2 py-0.5 text-sm font-bold text-white">{t('delivery.problemBadge')}</span>}
          {late && <span className="rounded-lg bg-amber-500/20 px-2 py-0.5 text-sm font-bold text-amber-800">{t('delivery.notConfirmed')}</span>}
          {/* sql/153: the price: one to give, one the client is deciding on, one it declined; or a job without one. */}
          {tab === 'new' && <PriceChip order={order} suggestion={suggestion} />}
          {noPrice && <span className="rounded-lg bg-amber-500/20 px-2 py-0.5 text-sm font-bold text-amber-800">{t('orders.noPrice')}</span>}
        </div>
        {tab === 'rejected' && order.reject_reason && <p className="text-sm text-rose-700">{t('orders.rejectedBecause', { reason: order.reject_reason })}</p>}
        {tab === 'cancelled' && <p className="text-sm text-rose-700">{order.cancel_reason ? t('orders.cancelledBecause', { reason: order.cancel_reason }) : t('orders.statusCancelled')}</p>}
        {error && <p className="text-sm text-rose-600">{error}</p>}
      </div>
      <div className="flex shrink-0 flex-col gap-2">
        {quickAccept && (
          <button type="button" disabled={accept.isPending} className="btn-primary h-10 justify-center px-4 text-sm"
            onClick={async () => { setError(null); try { await accept.mutateAsync({ p_order: order.id, p_template: null, p_price: suggestion.amount }) } catch (e) { setError(describeError(e)) } }}>
            {t('orders.acceptForPrice', { price: euros(suggestion.amount!) })}
          </button>
        )}
        {noPrice && canAccept && (
          <button type="button" onClick={onOpen} className="btn-primary h-10 justify-center px-4 text-sm">{t('orders.setPrice')}</button>
        )}
        {tab === 'ready' && order.job_id && job && <MarkSentButton job={job} orderId={order.id} />}
        <button type="button" onClick={onOpen} className="btn-ghost h-10 justify-center border border-ink-faint/30 px-4 text-sm">{t('orders.open')}</button>
      </div>
    </div>
  )
}

function OrderDialog({ order, client, canDecide, canWrite, job, onClose }: { order: ClientOrderRow; client?: NetworkClientRow; canDecide: boolean; canWrite: boolean; job?: OrderJobState; onClose: () => void }) {
  const templates = (useWorkflowTemplates().data ?? []).filter(tpl => !tpl.archived)
  const accept = useAcceptOrder()
  const reject = useRejectOrder()
  const quote = useQuoteOrder()
  const setOrderPrice = useSetOrderPrice()
  const [template, setTemplate] = useState<string>('')
  // sql/153: the job's price: the engine's, with the client's prices; the clinic may change it, and must give one where there is none.
  const suggestion = useOrderPriceSuggestion(order, client)
  const quoteFlow = suggestion.needsQuote || isQuoteState(order.price_state)
  const [priceText, setPriceText] = useState(() => (order.price != null ? String(order.price) : suggestion.amount != null ? String(suggestion.amount) : ''))
  const typedPrice = parsePrice(priceText)
  // The client's prices may arrive after the dialog opened: the engine's price fills in until the clinic types its own.
  const touched = useRef(false)
  const typePrice = (v: string) => { touched.current = true; setPriceText(v) }
  useEffect(() => {
    if (!touched.current && order.price == null && suggestion.amount != null) setPriceText(String(suggestion.amount))
  }, [suggestion.amount, order.price])
  const noPrice = order.status === 'accepted' && !!job && !(Number(job.hind ?? 0) > 0) && !order.cancelled_at
  const [reason, setReason] = useState('')
  const [rejecting, setRejecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async (fn: () => Promise<unknown>) => { setError(null); try { await fn() } catch (e) { setError(describeError(e)) } }
  const p = order.payload
  const optionNames = useOptionLabels()(p?.options)
  // sql/146: only someone on the job (its technician or designer) or the owner rates the client.
  const { user } = useAuth()
  const { isOwner } = usePermissions()
  const onJob = isOwner || (!!user && !!job && (job.assigned_to === user.id || job.designed_by === user.id))

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="order-h" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="card max-h-[92vh] w-full max-w-3xl overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-start gap-3">
          <div className="flex-1">
            <h2 id="order-h" className="text-2xl font-bold text-ink">{order.work_type}</h2>
            <p className="text-base text-ink-muted">{clientName(client)} · {when(order.created_at)} · {statusText(order)}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('orders.close')} className="h-11 w-11 rounded-xl text-ink-muted hover:bg-bg-sidebar"><X size={22} className="mx-auto" /></button>
        </div>

        <dl className="grid grid-cols-1 gap-3 text-base sm:grid-cols-2">
          <Field label={t('orders.ref')} value={order.patient_ref} info={t('orders.refInfo')} />
          <Field label={t('orders.teeth')} value={teethLabel(p?.teeth ?? '') || '—'} />
          <Field label={t('orders.shade')} value={p?.shade || '—'} />
          {/* Version 2 (sql/141): accepting makes the job with exactly these. */}
          {p && orderImplants(p) && <Field label={t('orders.implants')} value={orderImplants(p).split(',').join(', ')} />}
          {p?.version === 2 && p.abutment && (
            <Field label={t('orders.abutment')} value={[p.abutment.all, ...Object.entries(p.abutment.teeth).map(([tooth, code]) => `${tooth}: ${code}`)].filter(Boolean).join('; ')} />
          )}
          <Field label={t('orders.due')} value={order.due ? format(new Date(order.due), 'd MMM yyyy', { locale: dateLocale }) : '—'} />
          {optionNames.length > 0 && <Field label={t('orders.options')} value={optionNames.join(' · ')} />}
          {p?.notes && <div className="sm:col-span-2"><Field label={t('orders.notes')} value={p.notes} /></div>}
        </dl>

        {/* sql/153: accepted before prices: the job has none. Its price, once. */}
        {noPrice && canDecide && (
          <div className="mt-5 space-y-2 rounded-xl border-2 border-amber-400/60 bg-amber-50 p-4">
            <p className="text-base font-semibold text-amber-900">{t('orders.noPriceHelp')}</p>
            <div className="flex flex-wrap items-end gap-3">
              <label className="block"><span className="label">{t('orders.priceLabel')}</span>
                <input className="input h-12 w-40 text-base" inputMode="decimal" value={priceText} onChange={e => typePrice(e.target.value)} /></label>
              <button type="button" disabled={setOrderPrice.isPending || !(typedPrice != null && typedPrice > 0)} className="btn-primary h-12 px-5 text-base"
                onClick={() => run(async () => { await setOrderPrice.mutateAsync({ p_order: order.id, p_price: typedPrice! }); onClose() })}>
                {t('orders.setPrice')}</button>
            </div>
          </div>
        )}

        {/* sql/145: Sent → Received, or a delivery problem until the clinic resolves it. */}
        {order.status === 'accepted' && job && <div className="mt-5 empty:hidden"><JobDelivery job={job} orderId={order.id} /></div>}

        {/* sql/144: the clinic rates the client's input (module ratings), once received (sql/145), and changes it later. */}
        {order.status === 'accepted' && order.job_id && job && isReceived(job) && onJob && (
          <div className="mt-5 rounded-xl border border-ink-faint/20 p-3"><RateClientRow orderId={order.id} jobId={order.job_id} /></div>
        )}

        {/* The conversation, its files and reviews (sql/143): the same component as on the job page. */}
        <div className="mt-5">
          <OrderThread orderId={order.id} clientName={clientName(client)} canWrite={canWrite} />
        </div>

        {order.status === 'rejected' && <p className="mt-5 rounded-xl bg-rose-50 p-3 text-base text-rose-700">{t('orders.rejectedBecause', { reason: order.reject_reason ?? '' })}</p>}
        {/* sql/146: the job was deleted; restoring it takes the order back to where it was. */}
        {order.cancelled_at && order.job_id && <CancelledOrder jobId={order.job_id} reason={order.cancel_reason ?? null} when={order.cancelled_at} />}

        {order.status === 'received' && canDecide && (
          <div className="mt-6 space-y-4 rounded-xl border-2 border-ink-faint/20 p-4">
            {!rejecting ? (
              <>
                <PriceField order={order} suggestion={suggestion} quoteFlow={quoteFlow} value={priceText} onChange={typePrice} valid={typedPrice != null} />
                <div>
                  <span className="label flex items-center gap-1">{t('orders.template')} <InfoButton label={t('orders.template')} text={t('orders.templateInfo')} /></span>
                  <select className="input h-12 text-base" value={template} onChange={e => setTemplate(e.target.value)}>
                    <option value="">{t('orders.templateDefault')}</option>
                    {templates.map(tpl => <option key={tpl.id} value={tpl.id}>{tpl.name}</option>)}
                  </select>
                </div>
                <div className="flex flex-wrap gap-3">
                  {quoteFlow ? (
                    <button type="button" disabled={quote.isPending || typedPrice == null} className="btn-primary h-12 px-6 text-base"
                      onClick={() => run(async () => { await quote.mutateAsync({ p_order: order.id, p_price: typedPrice!, p_template: template || null }); onClose() })}>
                      <Send size={18} aria-hidden="true" /> {order.price_state === 'quoted' ? t('orders.sendNewPrice') : t('orders.sendPrice')}
                    </button>
                  ) : (
                    <button type="button" disabled={accept.isPending || typedPrice == null} className="btn-primary h-12 px-6 text-base"
                      onClick={() => run(async () => { await accept.mutateAsync({ p_order: order.id, p_template: template || null, p_price: typedPrice }); onClose() })}>
                      <Check size={18} aria-hidden="true" /> {t('orders.accept')}
                    </button>
                  )}
                  <button type="button" className="btn-ghost h-12 px-5 text-base" onClick={() => setRejecting(true)}>
                    <X size={18} aria-hidden="true" /> {t('orders.reject')}
                  </button>
                </div>
              </>
            ) : (
              <>
                <label className="label" htmlFor="reject-reason">{t('orders.rejectWhy')}</label>
                <textarea id="reject-reason" className="input min-h-24 text-base" value={reason} maxLength={500} onChange={e => setReason(e.target.value)} />
                <div className="flex flex-wrap gap-3">
                  <button type="button" disabled={!reason.trim() || reject.isPending} className="btn-primary h-12 bg-rose-600 px-6 text-base hover:bg-rose-700"
                    onClick={() => run(async () => { await reject.mutateAsync({ p_order: order.id, p_reason: reason.trim() }); onClose() })}>
                    {t('orders.rejectSend')}
                  </button>
                  <button type="button" className="btn-ghost h-12 px-5 text-base" onClick={() => setRejecting(false)}>{t('orders.back')}</button>
                </div>
              </>
            )}
          </div>
        )}
        {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
      </div>
    </div>
  )
}

// ── Prices (sql/153) ────────────────────────────────────────────────────────

const euros = (n: number): string => `${Number.isInteger(n) ? n : n.toFixed(2)} €`
/** The order waits for a price to be given or approved by the client. */
const isQuoteState = (s: ClientOrderRow['price_state']): boolean => s === 'needs_quote' || s === 'quoted' || s === 'declined'

/** What accepting this order would put on the job: the price engine with this client's prices. */
function useOrderPriceSuggestion(order: ClientOrderRow, client?: NetworkClientRow): OrderPriceSuggestion {
  const { settings } = useSettings()
  const customers = useCustomers().data ?? []
  const customer = client?.customer_id ? customers.find(c => c.id === client.customer_id) : undefined
  return useMemo(() => orderPriceFor(order, priceBookOf(settings), clientPricingOf(customer)),
    [order, settings, customer])
}

/** The price an order waits on, in a word, on the list. */
function PriceChip({ order, suggestion }: { order: ClientOrderRow; suggestion: OrderPriceSuggestion }) {
  if (order.price_state === 'quoted') return <span className="rounded-lg bg-accent/15 px-2 py-0.5 text-sm font-bold text-accent">{t('orders.priceWaiting', { price: euros(Number(order.price ?? 0)) })}</span>
  if (order.price_state === 'declined') return <span className="rounded-lg bg-rose-500/15 px-2 py-0.5 text-sm font-bold text-rose-700">{t('orders.priceDeclinedChip')}</span>
  if (suggestion.needsQuote || order.price_state === 'needs_quote') return <span className="rounded-lg bg-amber-500/20 px-2 py-0.5 text-sm font-bold text-amber-800">{t('orders.needsPrice')}</span>
  if (suggestion.amount == null) return <span className="rounded-lg bg-amber-500/20 px-2 py-0.5 text-sm font-bold text-amber-800">{t('orders.noPriceInList')}</span>
  return <span className="rounded-lg bg-bg-sidebar px-2 py-0.5 text-sm font-semibold text-ink">{euros(suggestion.amount)}</span>
}

/** The price field of the Accept box: filled in from the engine; required where there is none; a quote for the client to approve. */
function PriceField({ order, suggestion, quoteFlow, value, onChange, valid }: {
  order: ClientOrderRow; suggestion: OrderPriceSuggestion; quoteFlow: boolean; value: string; onChange: (v: string) => void; valid: boolean
}) {
  return (
    <div className="space-y-1">
      <label className="block"><span className="label">{quoteFlow ? t('orders.priceForClient') : t('orders.priceLabel')} *</span>
        <input className="input h-12 w-48 text-base" inputMode="decimal" value={value} aria-invalid={!valid} onChange={e => onChange(e.target.value)} /></label>
      {quoteFlow
        ? <p className="text-sm text-ink-muted">{order.price_state === 'quoted' ? t('orders.quotedWaiting', { price: euros(Number(order.price ?? 0)) })
            : order.price_state === 'declined' ? t('orders.quotedDeclined', { price: euros(Number(order.price ?? 0)) }) : t('orders.quoteHelp')}</p>
        : suggestion.amount != null
          ? <p className="text-sm text-ink-muted">{t('orders.priceFromEngine', { price: euros(suggestion.amount) })}</p>
          : <p className="text-sm font-semibold text-amber-800">{t('orders.priceMissing')}</p>}
      {order.estimated_price != null && <p className="text-sm text-ink-muted">{t('orders.clientEstimate', { price: euros(Number(order.estimated_price)) })}</p>}
    </div>
  )
}

function Field({ label, value, info }: { label: string; value: string; info?: string }) {
  return (
    <div>
      <dt className="label flex items-center gap-1">{label}{info && <InfoButton label={label} text={info} />}</dt>
      <dd className="whitespace-pre-wrap text-base text-ink">{value}</dd>
    </div>
  )
}

// ── Feedback on clients (sql/144, module ratings) ───────────────────────────
interface ClientFeedbackRow { client_id: string; average: number | null; ratings: number; adjustments: number }

/** For the owner: each client's average (the clinic's ratings of its input) and how many adjustments it asked for. */
function useClientFeedbackSummary(): Map<string, ClientFeedbackRow> {
  const { moduleOn, isOwner } = usePermissions()
  const rows = useQuery<ClientFeedbackRow[]>({
    queryKey: [...PORTAL_KEY, 'client-feedback'],
    enabled: moduleOn('ratings') && isOwner,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('client_feedback_summary')
      return error ? [] : (data ?? []) as ClientFeedbackRow[]
    },
  }).data ?? []
  return new Map(rows.map(r => [r.client_id, r]))
}

/** "★ 4.2 · 1 adjustment · " before the orders count, only what there is. */
function feedbackLine(f: ClientFeedbackRow | undefined): string {
  if (!f) return ''
  const parts: string[] = []
  if (f.ratings > 0 && f.average !== null) parts.push(`★ ${Number(f.average).toFixed(1)}`)
  if (f.adjustments > 0) parts.push(f.adjustments === 1 ? t('feedback.oneAdjustment') : t('feedback.nAdjustments', { n: f.adjustments }))
  return parts.length ? `${parts.join(' · ')} · ` : ''
}

/** An order whose job was deleted (sql/146): why, when, and Restore for whoever may restore jobs. */
function CancelledOrder({ jobId, reason, when: at }: { jobId: string; reason: string | null; when: string }) {
  const { can } = usePermissions()
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function restore() {
    setBusy(true); setError(null)
    const { error: e } = await supabase.rpc('restore_job', { p_job: jobId })
    setBusy(false)
    if (e) { setError(describeError(e)); return }
    void qc.invalidateQueries({ queryKey: [...PORTAL_KEY] })
    void qc.invalidateQueries({ queryKey: ['jobs'] })
    void qc.invalidateQueries({ queryKey: ['deleted_jobs'] })
  }
  return (
    <div className="mt-5 space-y-2 rounded-xl border-2 border-rose-200 bg-rose-50 p-3 text-base text-rose-800">
      <p className="font-semibold">{t('orders.cancelledOn', { date: when(at) })}</p>
      {reason && <p>{t('orders.cancelledBecause', { reason })}</p>}
      <p className="text-sm">{t('orders.cancelledRestoreHint')}</p>
      {can('jobs.delete') && (
        <button type="button" disabled={busy} onClick={() => void restore()} className="btn-primary h-10 px-4 text-sm">{t('orders.restoreJob')}</button>
      )}
      {error && <p className="text-sm text-rose-600" role="alert">{error}</p>}
    </div>
  )
}
