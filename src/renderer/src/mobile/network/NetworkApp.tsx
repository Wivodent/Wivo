/**
 * The phone app's Network mode, at /network (docs/PLAN-NETWORK-1.md, D): for
 * an outside technician, doctor, clinic or lab with a Wivo Network account.
 * Works in a computer's browser too.
 *
 *   sign up / sign in → the second factor → the profile
 *   → my clinics (connected, waiting) and finding a clinic (the directory, or
 *     an invite link /network/join/<code>)
 *   → a clinic: New order, My orders, an order's messages and files
 *
 * Nothing here talks to the clinic's database directly: the Network gives a
 * token for one clinic, the clinic's network-client gives a session (lib/network).
 */
import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, Plus, Search, LogOut, Send, Download, Paperclip, Check, Clock, Building2 } from 'lucide-react'
import { format } from 'date-fns'
import {
  network, networkConfigured, myAccount, saveAccount, directory, clinicByInvite, myConnections,
  requestConnection, endConnection, connect, clinicApi, NetworkError,
  type Account, type Connection, type DirectoryClinic, type ClinicSession, type ClientOrderSummary,
} from '../../lib/network'
import { emptyOrder, orderProblems, type CatalogueItem, type ClientOrderStatus, type WivoOrderV1 } from '@shared/network/order'
import { InfoButton } from '../../components/ui/InfoButton'
import { confirmDialog } from '../../lib/confirm'
import { t, dateLocale } from '@/lib/i18n'

type Screen =
  | { name: 'home' }
  | { name: 'find' }
  | { name: 'join'; code: string }
  | { name: 'clinic'; conn: Connection & { clinic: DirectoryClinic } }

/** The invite code in /network/join/<code>, if this is one. */
export function inviteCodeOf(pathname: string): string | null {
  const m = /^\/network\/join\/([a-z0-9]{12,40})\/?$/.exec(pathname)
  return m ? m[1] : null
}

const big = 'h-12 w-full rounded-xl text-base font-semibold'
const errorText = (e: unknown): string => {
  const code = e instanceof NetworkError ? e.code : ''
  if (code === 'session' || code === 'signed_out') return t('network.errSession')
  if (code === 'not_taking_orders') return t('network.errNotTaking')
  if (code === 'not_allowed' || code === 'no_token') return t('network.errNotAllowed')
  if (code === 'invalid') return t('network.errInvalid')
  if (code === 'too_many') return t('network.errTooMany')
  return t('network.errFailed')
}

export function NetworkApp() {
  if (!networkConfigured || !network) {
    return <Shell><p className="py-10 text-center text-base text-ink-muted">{t('network.notConfigured')}</p></Shell>
  }
  return <SignedIn />
}

function Shell({ children, onBack, title }: { children: React.ReactNode; onBack?: () => void; title?: string }) {
  return (
    <div className="min-h-[100dvh] bg-bg text-ink" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <header className="sticky top-0 z-40 flex items-center gap-2 border-b border-ink-faint/20 bg-bg-card px-3 py-3"
        style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}>
        {onBack
          ? <button type="button" onClick={onBack} className="-ml-1 flex items-center gap-1 py-1 text-base text-accent"><ChevronLeft size={20} aria-hidden="true" /> {t('mobile.back')}</button>
          : <span className="text-base font-bold">{t('network.title')}</span>}
        {title && <span className="ml-2 truncate text-base font-semibold">{title}</span>}
      </header>
      <main className="mx-auto max-w-2xl space-y-4 p-4">{children}</main>
    </div>
  )
}

// ── Signing in, the second factor, the profile ──────────────────────────────
function SignedIn() {
  const n = network!
  const [stage, setStage] = useState<'loading' | 'out' | 'mfa' | 'in'>('loading')
  useEffect(() => {
    const check = async () => {
      const { data } = await n.auth.getSession()
      if (!data.session) return setStage('out')
      const { data: aal } = await n.auth.mfa.getAuthenticatorAssuranceLevel()
      setStage(aal?.currentLevel === 'aal2' ? 'in' : 'mfa')
    }
    void check()
    const { data: sub } = n.auth.onAuthStateChange(() => { void check() })
    return () => sub.subscription.unsubscribe()
  }, [n])
  if (stage === 'loading') return <Shell><p className="py-10 text-center text-ink-muted">…</p></Shell>
  if (stage === 'out') return <SignInForm />
  if (stage === 'mfa') return <SecondFactor onDone={() => setStage('in')} />
  return <Home />
}

function SignInForm() {
  const n = network!
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setNote(null)
    const r = mode === 'in'
      ? await n.auth.signInWithPassword({ email: email.trim(), password })
      : await n.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: `${location.origin}/network` } })
    setBusy(false)
    if (r.error) setNote(mode === 'in' ? t('network.signInFailed') : t('network.signUpFailed'))
    else if (mode === 'up') setNote(t('network.checkEmail'))
  }
  return (
    <Shell>
      <p className="text-base text-ink-muted">{t('network.intro')}</p>
      <form onSubmit={submit} className="card space-y-4 p-5">
        <h1 className="text-xl font-bold">{mode === 'in' ? t('network.signIn') : t('network.signUp')}</h1>
        <label className="block"><span className="label">{t('network.email')}</span>
          <input className="input h-12 text-base" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} /></label>
        <label className="block"><span className="label">{t('network.password')}</span>
          <input className="input h-12 text-base" type="password" autoComplete={mode === 'in' ? 'current-password' : 'new-password'} minLength={12} required value={password} onChange={e => setPassword(e.target.value)} /></label>
        {mode === 'up' && <p className="text-sm text-ink-muted">{t('network.passwordRule')}</p>}
        {note && <p className="text-base text-ink">{note}</p>}
        <button type="submit" disabled={busy} className={`btn-primary justify-center ${big}`}>{mode === 'in' ? t('network.signIn') : t('network.signUp')}</button>
        <button type="button" className="btn-ghost w-full justify-center text-base" onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setNote(null) }}>
          {mode === 'in' ? t('network.noAccount') : t('network.haveAccount')}
        </button>
      </form>
    </Shell>
  )
}

function SecondFactor({ onDone }: { onDone: () => void }) {
  const n = network!
  const [factor, setFactor] = useState<{ id: string; qr?: string; secret?: string } | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    void (async () => {
      const { data } = await n.auth.mfa.listFactors()
      const verified = data?.totp?.find(f => f.status === 'verified')
      if (verified) return setFactor({ id: verified.id })
      const { data: made, error: e } = await n.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Wivo Network ${Date.now()}` })
      if (e || !made) return setError(t('network.errFailed'))
      setFactor({ id: made.id, qr: made.totp.qr_code, secret: made.totp.secret })
    })()
  }, [n])
  async function verify(e: React.FormEvent) {
    e.preventDefault()
    if (!factor) return
    const { error: err } = await n.auth.mfa.challengeAndVerify({ factorId: factor.id, code: code.trim() })
    if (err) setError(t('network.codeWrong'))
    else onDone()
  }
  return (
    <Shell>
      <form onSubmit={verify} className="card space-y-4 p-5">
        <h1 className="flex items-center gap-2 text-xl font-bold">{t('network.secondFactor')}
          <InfoButton label={t('network.secondFactor')} text={t('network.secondFactorInfo')} /></h1>
        {factor?.qr && (
          <>
            <p className="text-base">{t('network.scanQr')}</p>
            <img src={factor.qr} alt={t('network.qrAlt')} className="mx-auto h-48 w-48 rounded-lg bg-white p-2" />
            <p className="break-all text-center font-mono text-sm text-ink-muted">{factor.secret}</p>
          </>
        )}
        <label className="block"><span className="label">{t('network.code')}</span>
          <input className="input h-12 text-center font-mono text-xl tracking-widest" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} /></label>
        {error && <p className="text-base text-rose-600">{error}</p>}
        <button type="submit" disabled={code.length !== 6} className={`btn-primary justify-center ${big}`}>{t('network.verify')}</button>
        <button type="button" className="btn-ghost w-full justify-center" onClick={() => void n.auth.signOut()}>{t('network.signOut')}</button>
      </form>
    </Shell>
  )
}

function ProfileForm({ account, onSaved }: { account: Account | null; onSaved: () => void }) {
  const [kind, setKind] = useState<Account['kind']>(account?.kind ?? 'person')
  const [role, setRole] = useState<Account['role']>(account?.role ?? 'technician')
  const [name, setName] = useState(account?.display_name ?? '')
  const [company, setCompany] = useState(account?.company_name ?? '')
  const [country, setCountry] = useState(account?.country ?? '')
  const [city, setCity] = useState(account?.city ?? '')
  const [error, setError] = useState<string | null>(null)
  const roles: Account['role'][] = ['technician', 'doctor', 'clinic', 'lab']
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      await saveAccount({ kind, role, display_name: name.trim(), company_name: company.trim() || null,
        country: /^[A-Za-z]{2}$/.test(country.trim()) ? country.trim().toUpperCase() : null, city: city.trim() || null }, !account)
      onSaved()
    } catch { setError(t('network.errInvalid')) }
  }
  return (
    <form onSubmit={submit} className="card space-y-4 p-5">
      <h1 className="flex items-center gap-2 text-xl font-bold">{t('network.profile')}
        <InfoButton label={t('network.profile')} text={t('network.profileInfo')} /></h1>
      <div className="grid grid-cols-2 gap-2">
        {(['person', 'company'] as const).map(k => (
          <button key={k} type="button" onClick={() => setKind(k)} aria-pressed={kind === k}
            className={`h-12 rounded-xl border-2 text-base ${kind === k ? 'border-accent bg-accent/10 font-semibold' : 'border-ink-faint/30'}`}>
            {k === 'person' ? t('network.kindPerson') : t('network.kindCompany')}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {roles.map(r => (
          <button key={r} type="button" onClick={() => setRole(r)} aria-pressed={role === r}
            className={`h-12 rounded-xl border-2 text-base ${role === r ? 'border-accent bg-accent/10 font-semibold' : 'border-ink-faint/30'}`}>
            {r === 'technician' ? t('network.roleTechnician') : r === 'doctor' ? t('network.roleDoctor') : r === 'clinic' ? t('network.roleClinic') : t('network.roleLab')}
          </button>
        ))}
      </div>
      <label className="block"><span className="label">{t('network.name')}</span>
        <input className="input h-12 text-base" required maxLength={120} value={name} onChange={e => setName(e.target.value)} /></label>
      <label className="block"><span className="label">{t('network.company')}{kind === 'company' ? ' *' : ''}</span>
        <input className="input h-12 text-base" required={kind === 'company'} maxLength={160} value={company} onChange={e => setCompany(e.target.value)} /></label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block"><span className="label">{t('network.country')}</span>
          <input className="input h-12 text-base uppercase" maxLength={2} value={country} onChange={e => setCountry(e.target.value)} /></label>
        <label className="block"><span className="label">{t('network.city')}</span>
          <input className="input h-12 text-base" maxLength={120} value={city} onChange={e => setCity(e.target.value)} /></label>
      </div>
      {error && <p className="text-base text-rose-600">{error}</p>}
      <button type="submit" disabled={!name.trim()} className={`btn-primary justify-center ${big}`}>{t('network.saveProfile')}</button>
    </form>
  )
}

// ── Home: my clinics, finding one ───────────────────────────────────────────
function Home() {
  const qc = useQueryClient()
  const account = useQuery({ queryKey: ['network', 'account'], queryFn: myAccount })
  const [screen, setScreen] = useState<Screen>(() => {
    const code = inviteCodeOf(location.pathname)
    return code ? { name: 'join', code } : { name: 'home' }
  })
  const [editing, setEditing] = useState(false)
  const conns = useQuery({ queryKey: ['network', 'connections'], queryFn: myConnections, enabled: !!account.data })
  const home = () => { history.replaceState(null, '', '/network'); setScreen({ name: 'home' }) }

  if (account.isLoading) return <Shell><p className="py-10 text-center text-ink-muted">…</p></Shell>
  if (!account.data || editing) {
    return (
      <Shell onBack={account.data ? () => setEditing(false) : undefined}>
        <ProfileForm account={account.data ?? null} onSaved={() => { setEditing(false); void qc.invalidateQueries({ queryKey: ['network'] }) }} />
      </Shell>
    )
  }
  if (screen.name === 'find') return <FindClinic onBack={home} onAsked={() => { void conns.refetch(); home() }} />
  if (screen.name === 'join') return <JoinClinic code={screen.code} onBack={home} onAsked={() => { void conns.refetch(); home() }} />
  if (screen.name === 'clinic') return <ClinicScreen conn={screen.conn} onBack={() => { void conns.refetch(); home() }} />

  const live = (conns.data ?? []).filter((c): c is Connection & { clinic: DirectoryClinic } => !!c.clinic && c.state !== 'ended')
  return (
    <Shell>
      <div className="card flex items-center gap-3 p-4">
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-semibold">{account.data.display_name}</p>
          <p className="truncate text-sm text-ink-muted">{account.data.company_name ?? ''}</p>
        </div>
        <button type="button" className="btn-ghost" onClick={() => setEditing(true)}>{t('network.editProfile')}</button>
        <button type="button" className="btn-ghost" aria-label={t('network.signOut')} onClick={() => void network!.auth.signOut()}><LogOut size={18} /></button>
      </div>

      <h2 className="flex items-center gap-2 text-lg font-semibold">{t('network.myClinics')}
        <InfoButton label={t('network.myClinics')} text={t('network.myClinicsInfo')} /></h2>
      {live.length === 0 && <p className="card p-5 text-base text-ink-muted">{t('network.noClinics')}</p>}
      {live.map(c => (
        <button key={c.id} type="button" onClick={() => setScreen({ name: 'clinic', conn: c })}
          className="card flex w-full items-center gap-3 p-4 text-left active:bg-bg-sidebar">
          <Building2 size={24} className="text-accent" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-lg font-semibold">{c.clinic.name}</span>
            <span className="text-sm text-ink-muted">{c.clinic.city ? `${c.clinic.city}, ` : ''}{c.clinic.country}</span>
          </span>
          <span className={`flex items-center gap-1 text-sm ${c.state === 'confirmed' ? 'text-emerald-600' : 'text-amber-600'}`}>
            {c.state === 'confirmed' ? <Check size={16} /> : <Clock size={16} />}
            {c.state === 'confirmed' ? t('network.connected') : t('network.waiting')}
          </span>
        </button>
      ))}
      <button type="button" onClick={() => setScreen({ name: 'find' })} className={`btn-primary justify-center ${big}`}>
        <Search size={18} aria-hidden="true" /> {t('network.findClinic')}
      </button>
    </Shell>
  )
}

function ClinicCard({ clinic, onAsk }: { clinic: DirectoryClinic; onAsk: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="card space-y-3 p-4">
      <p className="text-lg font-semibold">{clinic.name}</p>
      <p className="text-sm text-ink-muted">{clinic.city ? `${clinic.city}, ` : ''}{clinic.country}</p>
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <button type="button" disabled={busy} className={`btn-primary justify-center ${big}`}
        onClick={async () => { setBusy(true); setError(null); try { await onAsk() } catch (e) { setError(errorText(e)) } finally { setBusy(false) } }}>
        {t('network.askToConnect')}
      </button>
    </div>
  )
}

function FindClinic({ onBack, onAsked }: { onBack: () => void; onAsked: () => void }) {
  const [q, setQ] = useState('')
  const found = useQuery({ queryKey: ['network', 'directory', q], queryFn: () => directory(q) })
  return (
    <Shell onBack={onBack} title={t('network.findClinic')}>
      <input className="input h-12 text-base" type="search" autoFocus placeholder={t('network.searchClinic')} value={q} onChange={e => setQ(e.target.value)} />
      <p className="text-sm text-ink-muted">{t('network.inviteHint')}</p>
      {(found.data ?? []).map(c => <ClinicCard key={c.id} clinic={c} onAsk={async () => { await requestConnection(c.id); onAsked() }} />)}
      {found.isFetched && (found.data ?? []).length === 0 && <p className="text-base text-ink-muted">{t('network.noneFound')}</p>}
    </Shell>
  )
}

function JoinClinic({ code, onBack, onAsked }: { code: string; onBack: () => void; onAsked: () => void }) {
  const clinic = useQuery({ queryKey: ['network', 'invite', code], queryFn: () => clinicByInvite(code) })
  return (
    <Shell onBack={onBack} title={t('network.invite')}>
      {clinic.data ? <ClinicCard clinic={clinic.data} onAsk={async () => { await requestConnection(clinic.data!.id); onAsked() }} />
        : clinic.isFetched && <p className="text-base text-ink-muted">{t('network.inviteUnknown')}</p>}
    </Shell>
  )
}

// ── A clinic: New order, My orders ──────────────────────────────────────────
function ClinicScreen({ conn, onBack }: { conn: Connection & { clinic: DirectoryClinic }; onBack: () => void }) {
  const [state, setState] = useState<{ state: Connection['state']; session?: ClinicSession } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'new' | 'mine'>('mine')
  const [openOrder, setOpenOrder] = useState<string | null>(null)
  const tryConnect = async () => { setError(null); try { setState(await connect(conn)) } catch (e) { setError(errorText(e)) } }
  useEffect(() => { void tryConnect() }, [conn.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const api = useMemo(() => state?.session ? clinicApi(conn.clinic_id, conn.clinic.api_url, state.session.session) : null, [state, conn])

  return (
    <Shell onBack={openOrder ? () => setOpenOrder(null) : onBack} title={conn.clinic.name}>
      {error && <div className="card space-y-3 p-5"><p className="text-base text-rose-600">{error}</p>
        <button type="button" className={`btn-primary justify-center ${big}`} onClick={() => void tryConnect()}>{t('network.tryAgain')}</button></div>}
      {state?.state === 'requested' && (
        <div className="card space-y-3 p-5">
          <p className="flex items-center gap-2 text-lg font-semibold"><Clock size={20} className="text-amber-600" /> {t('network.waitingTitle')}</p>
          <p className="text-base text-ink-muted">{t('network.waitingText', { clinic: conn.clinic.name })}</p>
          <button type="button" className={`btn-primary justify-center ${big}`} onClick={() => void tryConnect()}>{t('network.checkAgain')}</button>
        </div>
      )}
      {state?.state === 'ended' && (
        <div className="card space-y-3 p-5">
          <p className="text-base">{t('network.endedText')}</p>
          <button type="button" className={`btn-primary justify-center ${big}`} onClick={async () => { await requestConnection(conn.clinic_id); await tryConnect() }}>{t('network.askAgain')}</button>
        </div>
      )}
      {api && state?.session && !openOrder && (
        <>
          <div className="grid grid-cols-2 gap-2" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'new'} onClick={() => setTab('new')}
              className={`h-12 rounded-xl border-2 text-base ${tab === 'new' ? 'border-accent bg-accent/10 font-semibold' : 'border-ink-faint/30'}`}>
              <Plus size={16} className="mr-1 inline" aria-hidden="true" />{t('network.newOrder')}</button>
            <button type="button" role="tab" aria-selected={tab === 'mine'} onClick={() => setTab('mine')}
              className={`h-12 rounded-xl border-2 text-base ${tab === 'mine' ? 'border-accent bg-accent/10 font-semibold' : 'border-ink-faint/30'}`}>
              {t('network.myOrders')}</button>
          </div>
          {tab === 'new'
            ? <NewOrder api={api} clinicId={conn.clinic_id} prices={!!state.session.can_see.prices} onSent={id => { setTab('mine'); setOpenOrder(id) }} />
            : <MyOrders api={api} clinicId={conn.clinic_id} onOpen={setOpenOrder} />}
          <button type="button" className="btn-ghost mx-auto text-sm text-rose-600"
            onClick={async () => { if (await confirmDialog({ message: t('network.endAsk', { clinic: conn.clinic.name }), danger: true })) { await api.end().catch(() => {}); await endConnection(conn.id); onBack() } }}>
            {t('network.endConnection')}</button>
        </>
      )}
      {api && openOrder && <OrderScreen api={api} orderId={openOrder} />}
    </Shell>
  )
}

type Api = ReturnType<typeof clinicApi>

const STATUS_STYLE: Record<ClientOrderStatus, string> = {
  received: 'bg-sky-100 text-sky-800', in_progress: 'bg-amber-100 text-amber-800', ready: 'bg-emerald-100 text-emerald-800',
  sent: 'bg-emerald-600 text-white', rejected: 'bg-rose-100 text-rose-800',
}
const statusLabel = (s: ClientOrderStatus): string =>
  s === 'received' ? t('network.statusReceived') : s === 'in_progress' ? t('network.statusInProgress')
    : s === 'ready' ? t('network.statusReady') : s === 'sent' ? t('network.statusSent') : t('network.statusRejected')

function MyOrders({ api, clinicId, onOpen }: { api: Api; clinicId: string; onOpen: (id: string) => void }) {
  const orders = useQuery<ClientOrderSummary[]>({ queryKey: ['network', 'orders', clinicId], queryFn: api.orders, refetchInterval: 60_000 })
  if (orders.error) return <p className="text-base text-rose-600">{errorText(orders.error)}</p>
  if ((orders.data ?? []).length === 0) return <p className="card p-5 text-base text-ink-muted">{t('network.noOrders')}</p>
  return (
    <div className="space-y-2">
      {(orders.data ?? []).map(o => (
        <button key={o.id} type="button" onClick={() => onOpen(o.id)} className="card flex w-full items-center gap-3 p-4 text-left active:bg-bg-sidebar">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-lg font-semibold">{o.work_type}</span>
            <span className="text-sm text-ink-muted">{o.patient_ref} · {format(new Date(o.created_at), 'd MMM', { locale: dateLocale })}</span>
          </span>
          <span className={`rounded-full px-3 py-1 text-sm font-semibold ${STATUS_STYLE[o.status]}`}>{statusLabel(o.status)}</span>
        </button>
      ))}
    </div>
  )
}

function NewOrder({ api, clinicId, prices, onSent }: { api: Api; clinicId: string; prices: boolean; onSent: (id: string) => void }) {
  const catalog = useQuery<CatalogueItem[]>({ queryKey: ['network', 'catalog', clinicId], queryFn: api.catalog })
  const [order, setOrder] = useState<WivoOrderV1>(emptyOrder)
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const item = (catalog.data ?? []).find(c => c.name === order.work_type)
  const today = new Date().toISOString().slice(0, 10)
  const problems = orderProblems(order, catalog.data, today)
  const set = (patch: Partial<WivoOrderV1>) => setOrder(o => ({ ...o, ...patch }))

  async function send() {
    setBusy(true); setError(null)
    try {
      const id = await api.newOrder(order)
      for (const f of files) await api.upload(id, f)
      onSent(id)
    } catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }

  return (
    <div className="space-y-4">
      <div className="card space-y-3 p-4">
        <p className="label">{t('network.workType')}</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {(catalog.data ?? []).map(c => (
            <button key={c.name} type="button" aria-pressed={order.work_type === c.name}
              onClick={() => set({ work_type: c.name, options: {}, teeth: c.teeth === 'none' ? '' : order.teeth })}
              className={`min-h-12 rounded-xl border-2 px-3 py-2 text-left text-base ${order.work_type === c.name ? 'border-accent bg-accent/10 font-semibold' : 'border-ink-faint/30'}`}>
              {c.name}{prices && c.price != null ? <span className="block text-sm font-normal text-ink-muted">{c.price} €{c.unit === 'hammas' ? ` / ${t('network.perTooth')}` : ''}</span> : null}
            </button>
          ))}
        </div>
      </div>

      {item && item.teeth !== 'none' && (
        <label className="card block space-y-2 p-4">
          <span className="label flex items-center gap-1">{t('network.teeth')} <InfoButton label={t('network.teeth')} text={t('network.teethInfo')} /></span>
          <input className="input h-12 text-base" inputMode="numeric" placeholder="11,21" value={order.teeth}
            onChange={e => set({ teeth: e.target.value.replace(/[^0-9,]/g, '') })} />
        </label>
      )}

      {item?.groups.map(g => (
        <div key={g.key} className="card space-y-2 p-4">
          <p className="label">{g.name}</p>
          <div className="flex flex-wrap gap-2">
            {g.options.map(op => {
              const chosen = (order.options[g.key] ?? []).includes(op.id)
              return (
                <button key={op.id} type="button" aria-pressed={chosen}
                  onClick={() => {
                    const now = order.options[g.key] ?? []
                    const next = chosen ? now.filter(x => x !== op.id) : g.multi ? [...now, op.id] : [op.id]
                    set({ options: { ...order.options, [g.key]: next } })
                  }}
                  className={`h-11 rounded-xl border-2 px-3 text-base ${chosen ? 'border-accent bg-accent/10 font-semibold' : 'border-ink-faint/30'}`}>
                  {op.name}
                </button>
              )
            })}
          </div>
        </div>
      ))}

      <div className="card grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
        <label className="block"><span className="label">{t('network.shade')}</span>
          <input className="input h-12 text-base" maxLength={20} placeholder="A2" value={order.shade ?? ''} onChange={e => set({ shade: e.target.value || null })} /></label>
        <label className="block"><span className="label">{t('network.due')}</span>
          <input className="input h-12 text-base" type="date" min={today} value={order.due ?? ''} onChange={e => set({ due: e.target.value || null })} /></label>
        <label className="block sm:col-span-2"><span className="label flex items-center gap-1">{t('network.patientRef')} <InfoButton label={t('network.patientRef')} text={t('network.patientRefInfo')} /></span>
          <input className="input h-12 text-base" maxLength={40} value={order.patient_ref} onChange={e => set({ patient_ref: e.target.value })} /></label>
        <label className="block sm:col-span-2"><span className="label">{t('network.notes')}</span>
          <textarea className="input min-h-24 text-base" maxLength={2000} value={order.notes ?? ''} onChange={e => set({ notes: e.target.value || null })} /></label>
      </div>

      <label className="card flex cursor-pointer items-center gap-3 p-4 text-base">
        <Paperclip size={20} aria-hidden="true" />
        <span className="flex-1">{files.length ? t('network.filesChosen', { n: files.length }) : t('network.addFiles')}</span>
        <input type="file" multiple className="hidden" onChange={e => setFiles([...(e.target.files ?? [])].slice(0, 30))} />
      </label>

      {error && <p className="text-base text-rose-600">{error}</p>}
      <button type="button" disabled={busy || problems.length > 0} onClick={() => void send()} className={`btn-primary justify-center ${big}`}>
        <Send size={18} aria-hidden="true" /> {busy ? t('network.sending') : t('network.sendOrder')}
      </button>
      {problems.length > 0 && order.work_type && <p className="text-sm text-ink-muted">{t('network.fillIn')}</p>}
    </div>
  )
}

function OrderScreen({ api, orderId }: { api: Api; orderId: string }) {
  const detail = useQuery({ queryKey: ['network', 'order', orderId], queryFn: () => api.order(orderId), refetchInterval: 30_000 })
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const d = detail.data
  if (detail.error) return <p className="text-base text-rose-600">{errorText(detail.error)}</p>
  if (!d) return <p className="py-10 text-center text-ink-muted">…</p>
  const p = d.payload
  return (
    <div className="space-y-4">
      <div className="card space-y-2 p-4">
        <p className="text-xl font-bold">{p.work_type}</p>
        <span className={`inline-block rounded-full px-3 py-1 text-sm font-semibold ${STATUS_STYLE[d.status]}`}>{statusLabel(d.status)}</span>
        {d.status === 'rejected' && d.reject_reason && <p className="rounded-xl bg-rose-50 p-3 text-base text-rose-700">{d.reject_reason}</p>}
        <p className="text-base">{t('network.patientRef')}: {p.patient_ref}</p>
        {p.teeth && <p className="text-base">{t('network.teeth')}: {p.teeth}</p>}
        {p.shade && <p className="text-base">{t('network.shade')}: {p.shade}</p>}
        {p.due && <p className="text-base">{t('network.due')}: {format(new Date(p.due), 'd MMM yyyy', { locale: dateLocale })}</p>}
        {p.notes && <p className="whitespace-pre-wrap text-base text-ink-muted">{p.notes}</p>}
      </div>
      {d.files && d.files.length > 0 && (
        <div className="card space-y-2 p-4">
          <p className="label">{t('network.files')}</p>
          {d.files.map(f => (
            <button key={f.id} type="button" className="btn-ghost h-11 text-base"
              onClick={async () => { try { const { url } = await api.download(f.id, f.file_name); window.open(url, '_blank', 'noopener') } catch (e) { setError(errorText(e)) } }}>
              <Download size={18} aria-hidden="true" /> {f.file_name}
            </button>
          ))}
        </div>
      )}
      {d.messages && (
        <div className="card space-y-2 p-4">
          <p className="label">{t('network.messages')}</p>
          {d.messages.map(m => (
            <div key={m.id} className={`max-w-[85%] rounded-xl px-3 py-2 text-base ${m.from_client ? 'ml-auto bg-accent/10' : 'bg-bg-sidebar'}`}>
              <p className="whitespace-pre-wrap">{m.body}</p>
              <p className="text-xs text-ink-muted">{format(new Date(m.created_at), 'd MMM HH:mm', { locale: dateLocale })}</p>
            </div>
          ))}
          <div className="flex gap-2">
            <input className="input h-12 flex-1 text-base" maxLength={4000} value={text} onChange={e => setText(e.target.value)} placeholder={t('network.writeMessage')} />
            <button type="button" disabled={!text.trim()} className="btn-primary h-12"
              onClick={async () => { try { await api.message(orderId, text.trim()); setText(''); void detail.refetch() } catch (e) { setError(errorText(e)) } }}>
              <Send size={18} aria-label={t('network.send')} />
            </button>
          </div>
        </div>
      )}
      {error && <p className="text-base text-rose-600">{error}</p>}
    </div>
  )
}
