/**
 * Orders from outside (docs/PLAN-NETWORK-1.md): technicians, doctors, clinics
 * and labs with a Wivo Network account send orders straight into this Wivo.
 *
 * For an older owner who is not technical: big boxes, few words, an "i" for
 * the rest. Top to bottom: set it up (owner, once), who asks to connect, new
 * orders, then everything decided and everyone connected.
 */
import { useMemo, useState } from 'react'
import { Inbox, UserPlus, Check, X, Download, Send, Settings2, Globe2, Copy } from 'lucide-react'
import { format } from 'date-fns'
import {
  useNetworkSettings, useNetworkClients, useClientOrders, useOrderThread, usePortalLive,
  useSaveNetworkSettings, useConfirmClient, useClientVisibility, useEndClient,
  useAcceptOrder, useRejectOrder, usePostOrderMessage, defaultList, clientName,
  useDirectoryEntry, useSetDirectoryListed,
  type NetworkClientRow, type ClientOrderRow, type CanSee,
} from '../../hooks/useNetworkPortal'
import { useWorkflowTemplates } from '../../hooks/useWorkflowTemplates'
import { usePermissions } from '../../hooks/usePermissions'
import { saveOrderFile } from '../../lib/fileLink'
import { inviteLink, type DirectoryProblem } from '../../lib/networkDirectory'
import { confirmDialog } from '../../lib/confirm'
import { describeError } from '../Patients/errors'
import { InfoButton } from '../ui/InfoButton'
import { t, dateLocale } from '@/lib/i18n'

const SEE_KEYS: (keyof CanSee)[] = ['status', 'messages', 'files', 'prices']
const seeLabel = (k: keyof CanSee): string =>
  k === 'status' ? t('orders.seeStatus') : k === 'messages' ? t('orders.seeMessages') : k === 'files' ? t('orders.seeFiles') : t('orders.seePrices')
const roleLabel = (r: NetworkClientRow['role']): string =>
  r === 'technician' ? t('network.roleTechnician') : r === 'doctor' ? t('network.roleDoctor') : r === 'clinic' ? t('network.roleClinic') : t('network.roleLab')
const when = (iso: string) => format(new Date(iso), 'd MMM yyyy HH:mm', { locale: dateLocale })

export function OrdersView() {
  const { isOwner, can } = usePermissions()
  usePortalLive()
  const settings = useNetworkSettings(isOwner)
  const clients = useNetworkClients().data ?? []
  const orders = useClientOrders().data ?? []
  const [openId, setOpenId] = useState<string | null>(null)
  const byId = useMemo(() => new Map(clients.map(c => [c.id, c])), [clients])
  const requests = clients.filter(c => c.state === 'requested')
  const connected = clients.filter(c => c.state === 'confirmed')
  const fresh = orders.filter(o => o.status === 'received')
  const decided = orders.filter(o => o.status !== 'received')
  const open = orders.find(o => o.id === openId) ?? null
  const on = settings.data?.enabled ?? false

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex items-center gap-3">
        <Inbox size={28} className="text-accent" aria-hidden="true" />
        <h1 className="text-2xl font-bold text-ink">{t('orders.title')}</h1>
        <InfoButton label={t('orders.title')} text={t('orders.titleInfo')} />
      </div>

      {isOwner && <SetupCard key={settings.data?.org_id ?? 'none'} row={settings.data ?? null} />}
      {isOwner && !on && settings.isFetched && <p className="text-base text-ink-muted">{t('orders.offHint')}</p>}

      {requests.length > 0 && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-ink">
            <UserPlus size={20} aria-hidden="true" /> {t('orders.requests')} <span className="rounded-full bg-sky-500 px-2 text-sm text-white">{requests.length}</span>
            <InfoButton label={t('orders.requests')} text={t('orders.requestsInfo')} />
          </h2>
          {requests.map(c => <RequestCard key={c.id} client={c} canDecide={isOwner} />)}
        </section>
      )}

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-ink">
          {t('orders.newOrders')} {fresh.length > 0 && <span className="rounded-full bg-sky-500 px-2 text-sm text-white">{fresh.length}</span>}
        </h2>
        {fresh.length === 0 && <p className="card p-5 text-base text-ink-muted">{t('orders.noNewOrders')}</p>}
        {fresh.map(o => <OrderRow key={o.id} order={o} client={byId.get(o.client_id)} onOpen={() => setOpenId(o.id)} />)}
      </section>

      {decided.length > 0 && (
        <details className="card p-4">
          <summary className="cursor-pointer text-base font-semibold text-ink">{t('orders.decided', { n: decided.length })}</summary>
          <div className="mt-3 space-y-2">
            {decided.map(o => <OrderRow key={o.id} order={o} client={byId.get(o.client_id)} onOpen={() => setOpenId(o.id)} />)}
          </div>
        </details>
      )}

      {connected.length > 0 && (
        <details className="card p-4">
          <summary className="cursor-pointer text-base font-semibold text-ink">{t('orders.connected', { n: connected.length })}</summary>
          <div className="mt-3 space-y-3">
            {connected.map(c => <ConnectedRow key={c.id} client={c} canChange={isOwner} />)}
          </div>
        </details>
      )}

      {open && <OrderDialog order={open} client={byId.get(open.client_id)} canDecide={can('jobs.write')} onClose={() => setOpenId(null)} />}
    </div>
  )
}

// ── Setting it up (the owner, once) ────────────────────────────────────────
function SetupCard({ row }: { row: { enabled: boolean; network_public_key: string | null; network_clinic_id: string | null; session_hours: number } | null }) {
  const save = useSaveNetworkSettings()
  const [open, setOpen] = useState(!row?.enabled)
  const [enabled, setEnabled] = useState(row?.enabled ?? false)
  const [key, setKey] = useState(row?.network_public_key ?? '')
  const [clinicId, setClinicId] = useState(row?.network_clinic_id ?? '')
  const [hours, setHours] = useState(row?.session_hours ?? 8)
  const [error, setError] = useState<string | null>(null)
  const ready = /^[A-Za-z0-9_-]{43}$/.test(key.trim()) && /^[0-9a-f-]{36}$/i.test(clinicId.trim())

  async function submit() {
    setError(null)
    try {
      await save.mutateAsync({ p_enabled: enabled && ready, p_public_key: key.trim() || null, p_network_clinic: clinicId.trim() || null, p_session_hours: hours })
      setOpen(false)
    } catch (e) { setError(describeError(e)) }
  }

  return (
    <div className="card p-5">
      <button type="button" onClick={() => setOpen(o => !o)} className="flex w-full items-center gap-3 text-left">
        <Globe2 size={24} className="text-accent" aria-hidden="true" />
        <span className="flex-1">
          <span className="block text-lg font-semibold text-ink">{t('orders.setupTitle')}</span>
          <span className={`text-base ${row?.enabled ? 'text-emerald-600' : 'text-ink-muted'}`}>{row?.enabled ? t('orders.setupOn') : t('orders.setupOff')}</span>
        </span>
        <Settings2 size={20} className="text-ink-muted" aria-hidden="true" />
      </button>
      {row?.network_clinic_id && <DirectorySection ordersOn={row.enabled} />}
      {open && (
        <div className="mt-4 space-y-4">
          <label className="flex items-center gap-3 text-base">
            <input type="checkbox" className="h-6 w-6" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
            {t('orders.setupEnable')}
          </label>
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
          {enabled && !ready && <p className="text-sm text-amber-600">{t('orders.setupNeedsBoth')}</p>}
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <button type="button" onClick={submit} disabled={save.isPending} className="btn-primary h-12 px-6 text-base">{t('orders.save')}</button>
        </div>
      )}
    </div>
  )
}

// ── The directory and the invite link (the owner) ──────────────────────────
const directoryProblemText = (p: DirectoryProblem | undefined): string =>
  p === 'not_allowed' ? t('orders.directoryNotAllowed')
    : p === 'orders_off' ? t('orders.directoryOrdersOff')
    : p === 'try_again' ? t('orders.directoryTryAgain')
    : p === 'unreachable' ? t('orders.directoryUnreachable')
    : t('app.notAvailableYet')

/**
 * Listed or not in the Wivo Network directory, and the invite link. Read and
 * changed through the clinic's network-directory function (the owner and the
 * second factor, then a request signed with the clinic's own key); the app
 * never writes to the Network itself.
 */
function DirectorySection({ ordersOn }: { ordersOn: boolean }) {
  const entry = useDirectoryEntry(true)
  const setListed = useSetDirectoryListed()
  const [copied, setCopied] = useState(false)
  const e = entry.data
  const link = e ? inviteLink(e.inviteCode) : null
  const problem = setListed.error?.problem ?? entry.error?.problem
  const place = e ? [e.city, e.country].filter(Boolean).join(', ') : ''

  async function copy() {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch { /* the clipboard refused: the link is on screen to select */ }
  }

  return (
    <div className="mt-4 space-y-4 border-t border-ink-faint pt-4" data-testid="network-directory">
      {entry.isLoading && <p className="text-base text-ink-muted">{t('orders.directoryLoading')}</p>}
      {e && (
        <>
          <div>
            <label className="flex items-center gap-3 text-base">
              <input type="checkbox" className="h-6 w-6" checked={e.listed}
                disabled={setListed.isPending || (!ordersOn && !e.listed)}
                onChange={ev => setListed.mutate(ev.target.checked)} />
              {t('orders.directoryListed')}
              <InfoButton label={t('orders.directoryListed')} text={t('orders.directoryListedInfo')} />
            </label>
            <p className="ml-9 text-sm text-ink-muted">{t('orders.directoryShownAs', { name: e.name, place: place || '—' })}</p>
            {!ordersOn && e.listed && <p className="ml-9 text-sm text-amber-600">{t('orders.directoryListedButOff')}</p>}
          </div>
          {link && (
            <div>
              <span className="label flex items-center gap-1">{t('orders.inviteLink')} <InfoButton label={t('orders.inviteLink')} text={t('orders.inviteLinkInfo')} /></span>
              <div className="flex flex-wrap gap-2">
                <input className="input h-11 min-w-0 flex-1 font-mono text-sm" value={link} readOnly onFocus={ev => ev.currentTarget.select()} aria-label={t('orders.inviteLink')} />
                <button type="button" onClick={() => void copy()} className="btn-ghost h-11 px-4 text-base">
                  <Copy size={16} aria-hidden="true" /> {copied ? t('orders.inviteCopied') : t('orders.copyInvite')}
                </button>
              </div>
            </div>
          )}
        </>
      )}
      {(entry.isError || setListed.isError) && <p className="text-sm text-rose-600" role="alert">{directoryProblemText(problem)}</p>}
    </div>
  )
}

// ── Someone asks to connect ─────────────────────────────────────────────────
function SeeToggles({ value, onChange, disabled }: { value: CanSee; onChange: (v: CanSee) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap gap-4">
      {SEE_KEYS.map(k => (
        <label key={k} className="flex items-center gap-2 text-base">
          <input type="checkbox" className="h-5 w-5" disabled={disabled} checked={value[k]} onChange={e => onChange({ ...value, [k]: e.target.checked })} />
          {seeLabel(k)}
        </label>
      ))}
    </div>
  )
}

function RequestCard({ client, canDecide }: { client: NetworkClientRow; canDecide: boolean }) {
  const confirm = useConfirmClient()
  const end = useEndClient()
  const [list, setList] = useState<'clients' | 'clinics'>(defaultList(client))
  const [see, setSee] = useState<CanSee>({ status: true, messages: true, files: true, prices: false })
  const [error, setError] = useState<string | null>(null)
  const run = async (fn: () => Promise<unknown>) => { setError(null); try { await fn() } catch (e) { setError(describeError(e)) } }

  return (
    <div className="card space-y-4 border-2 border-sky-400/50 p-5">
      <div>
        <p className="text-lg font-semibold text-ink">{clientName(client)}</p>
        <p className="text-base text-ink-muted">{roleLabel(client.role)}{client.country ? ` · ${client.country}` : ''} · {when(client.requested_at)}</p>
      </div>
      {canDecide ? (
        <>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('orders.addTo')}>
            {(['clients', 'clinics'] as const).map(l => (
              <button key={l} type="button" role="radio" aria-checked={list === l} onClick={() => setList(l)}
                className={`h-11 rounded-xl border-2 px-4 text-base ${list === l ? 'border-accent bg-accent/10 font-semibold' : 'border-ink-faint/30'}`}>
                {l === 'clients' ? t('orders.addToClients') : t('orders.addToClinics')}
              </button>
            ))}
          </div>
          <div>
            <p className="label">{t('orders.theySee')}</p>
            <SeeToggles value={see} onChange={setSee} />
          </div>
          <div className="flex flex-wrap gap-3">
            <button type="button" disabled={confirm.isPending}
              onClick={() => run(() => confirm.mutateAsync({ p_client: client.id, p_list: list, p_can_see: see }))}
              className="btn-primary h-12 px-6 text-base"><Check size={18} aria-hidden="true" /> {t('orders.confirm')}</button>
            <button type="button" disabled={end.isPending}
              onClick={() => run(async () => { if (await confirmDialog({ message: t('orders.declineAsk', { name: clientName(client) }), danger: true })) await end.mutateAsync({ p_client: client.id }) })}
              className="btn-ghost h-12 px-5 text-base"><X size={18} aria-hidden="true" /> {t('orders.decline')}</button>
          </div>
        </>
      ) : <p className="text-sm text-ink-muted">{t('orders.ownerDecides')}</p>}
      {error && <p className="text-sm text-rose-600">{error}</p>}
    </div>
  )
}

function ConnectedRow({ client, canChange }: { client: NetworkClientRow; canChange: boolean }) {
  const visibility = useClientVisibility()
  const end = useEndClient()
  return (
    <div className="rounded-xl border border-ink-faint/20 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="flex-1 text-base font-semibold text-ink">{clientName(client)} <span className="font-normal text-ink-muted">· {roleLabel(client.role)}</span></p>
        {canChange && (
          <button type="button" className="btn-ghost h-10 text-sm text-rose-600"
            onClick={async () => { if (await confirmDialog({ message: t('orders.endAsk', { name: clientName(client) }), danger: true })) end.mutate({ p_client: client.id }) }}>
            {t('orders.end')}
          </button>
        )}
      </div>
      <div className="mt-2">
        <SeeToggles value={client.can_see} disabled={!canChange || visibility.isPending}
          onChange={v => visibility.mutate({ p_client: client.id, p_can_see: v })} />
      </div>
    </div>
  )
}

// ── Orders ──────────────────────────────────────────────────────────────────
function statusText(o: ClientOrderRow): string {
  return o.status === 'received' ? t('orders.statusNew') : o.status === 'accepted' ? t('orders.statusAccepted') : t('orders.statusRejected')
}

function OrderRow({ order, client, onOpen }: { order: ClientOrderRow; client?: NetworkClientRow; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen}
      className={`card flex w-full items-center gap-4 p-4 text-left hover:ring-2 hover:ring-accent/30 ${order.status === 'received' ? 'border-l-4 border-sky-500' : ''}`}>
      <div className="min-w-0 flex-1">
        <p className="truncate text-lg font-semibold text-ink">{order.work_type}{order.payload?.teeth ? ` · ${order.payload.teeth}` : ''}</p>
        <p className="truncate text-base text-ink-muted">{clientName(client)} · {t('orders.ref')}: {order.patient_ref}</p>
      </div>
      <div className="text-right">
        <p className="text-sm font-semibold">{statusText(order)}</p>
        <p className="text-sm text-ink-muted">{order.due ? t('orders.dueOn', { date: format(new Date(order.due), 'd MMM', { locale: dateLocale }) }) : when(order.created_at)}</p>
      </div>
    </button>
  )
}

function OrderDialog({ order, client, canDecide, onClose }: { order: ClientOrderRow; client?: NetworkClientRow; canDecide: boolean; onClose: () => void }) {
  const thread = useOrderThread(order.id).data
  const templates = (useWorkflowTemplates().data ?? []).filter(tpl => !tpl.archived)
  const accept = useAcceptOrder()
  const reject = useRejectOrder()
  const post = usePostOrderMessage()
  const [template, setTemplate] = useState<string>('')
  const [reason, setReason] = useState('')
  const [rejecting, setRejecting] = useState(false)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const run = async (fn: () => Promise<unknown>) => { setError(null); try { await fn() } catch (e) { setError(describeError(e)) } }
  const p = order.payload
  const options = Object.entries(p?.options ?? {}).filter(([, ids]) => ids.length > 0)

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
          <Field label={t('orders.teeth')} value={p?.teeth || '—'} />
          <Field label={t('orders.shade')} value={p?.shade || '—'} />
          <Field label={t('orders.due')} value={order.due ? format(new Date(order.due), 'd MMM yyyy', { locale: dateLocale }) : '—'} />
          {options.length > 0 && <Field label={t('orders.options')} value={options.map(([g, ids]) => `${g}: ${ids.join(', ')}`).join(' · ')} />}
          {p?.notes && <div className="sm:col-span-2"><Field label={t('orders.notes')} value={p.notes} /></div>}
        </dl>

        {(thread?.files.length ?? 0) > 0 && (
          <div className="mt-5">
            <p className="label">{t('orders.files')}</p>
            <ul className="space-y-2">
              {thread!.files.map(f => (
                <li key={f.id}>
                  <button type="button" className="btn-ghost h-11 text-base" onClick={() => run(() => saveOrderFile(f.id, f.file_name))}>
                    <Download size={18} aria-hidden="true" /> {f.file_name}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-5">
          <p className="label">{t('orders.messages')}</p>
          <div className="space-y-2">
            {(thread?.messages ?? []).map(m => (
              <div key={m.id} className={`max-w-[85%] rounded-xl px-3 py-2 text-base ${m.from_client ? 'bg-bg-sidebar' : 'ml-auto bg-accent/10'}`}>
                <p className="whitespace-pre-wrap">{m.body}</p>
                <p className="text-xs text-ink-muted">{m.from_client ? clientName(client) : t('orders.us')} · {when(m.created_at)}</p>
              </div>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <input className="input h-11 flex-1 text-base" value={text} onChange={e => setText(e.target.value)} placeholder={t('orders.writeMessage')} maxLength={4000} />
            <button type="button" disabled={!text.trim() || post.isPending} className="btn-primary h-11"
              onClick={() => run(async () => { await post.mutateAsync({ p_order: order.id, p_body: text.trim() }); setText('') })}>
              <Send size={16} aria-hidden="true" /> {t('orders.send')}
            </button>
          </div>
        </div>

        {order.status === 'rejected' && <p className="mt-5 rounded-xl bg-rose-50 p-3 text-base text-rose-700">{t('orders.rejectedBecause', { reason: order.reject_reason ?? '' })}</p>}

        {order.status === 'received' && canDecide && (
          <div className="mt-6 space-y-4 rounded-xl border-2 border-ink-faint/20 p-4">
            {!rejecting ? (
              <>
                <div>
                  <span className="label flex items-center gap-1">{t('orders.template')} <InfoButton label={t('orders.template')} text={t('orders.templateInfo')} /></span>
                  <select className="input h-12 text-base" value={template} onChange={e => setTemplate(e.target.value)}>
                    <option value="">{t('orders.templateDefault')}</option>
                    {templates.map(tpl => <option key={tpl.id} value={tpl.id}>{tpl.name}</option>)}
                  </select>
                </div>
                <div className="flex flex-wrap gap-3">
                  <button type="button" disabled={accept.isPending} className="btn-primary h-12 px-6 text-base"
                    onClick={() => run(async () => { await accept.mutateAsync({ p_order: order.id, p_template: template || null }); onClose() })}>
                    <Check size={18} aria-hidden="true" /> {t('orders.accept')}
                  </button>
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

function Field({ label, value, info }: { label: string; value: string; info?: string }) {
  return (
    <div>
      <dt className="label flex items-center gap-1">{label}{info && <InfoButton label={label} text={info} />}</dt>
      <dd className="whitespace-pre-wrap text-base text-ink">{value}</dd>
    </div>
  )
}
