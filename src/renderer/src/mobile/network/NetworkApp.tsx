/**
 * The phone app's Network mode, at /network (docs/PLAN-NETWORK-1.md, D): for
 * an outside technician, doctor, clinic or lab with a Wivo Network account.
 * Works in a computer's browser too.
 *
 *   sign up / sign in → the second factor → the profile
 *   → home (layout docs/design/network-phone.html): the greeting, New order,
 *     my clinics (connected, waiting; open orders where the clinic answered),
 *     recent orders; finding a clinic (the directory, or an invite link
 *     /network/join/<code>)
 *   → a clinic: New order (Work & teeth → Details → Review, with the clinic
 *     first when it was picked), My orders, an order's progress, messages and
 *     files; ending the connection only from the clinic's "⋯" menu, asked first
 *
 * Nothing final sits beside an ordinary button or happens without a question:
 * ending a connection asks, with the clinic's name; leaving a filled-in order
 * asks "Discard this order?".
 *
 * Only what Wivo has is shown: no rating, no stage names, no dates it does
 * not keep.
 *
 * Nothing here talks to the clinic's database directly: the Network gives a
 * token for one clinic, the clinic's network-client gives a session (lib/network).
 */
import { useEffect, useMemo, useState } from 'react'
import { useQueries, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { ChevronLeft, Plus, Search, LogOut, Send, Download, Paperclip, Check, Clock, Building2, MoreHorizontal, X, Undo2, Bolt } from 'lucide-react'
import { format } from 'date-fns'
import {
  network, networkConfigured, myAccount, saveAccount, directory, clinicByInvite, myConnections,
  requestConnection, endConnection, connect, clinicApi, NetworkError,
  type Account, type Connection, type DirectoryClinic, type ClinicSession, type ClientOrderSummary, type ClientOrderDetail,
} from '../../lib/network'
import { emptyOrder, orderProblems, orderImplants, type CatalogueItem, type ClientOrderStatus, type WivoOrderV1 } from '@shared/network/order'
import { InfoButton } from '../../components/ui/InfoButton'
import { WorkTypeArt } from '../../components/ui/WorkTypeArt'
import { ToothPicker } from '../../components/teeth/ToothPicker'
import { applyPaint } from '../../components/teeth/toothDrag'
import { AbutmentPicker } from '../../components/NewJobWizard/teeth/AbutmentPicker'
import { teethCountLabel } from '../../components/NewJobWizard/teeth/WorkTypeTabs'
import {
  teethLabel, parseTeeth, formatTeeth, initials, dayPart, chosenOptionLabels, fileBadge, stepNumber, orderTouched,
  catalogueRules, expectedImplants, withAutoImplants, implantSummary, wireOrder,
  UPPER_TEETH, LOWER_TEETH, type FormStep,
} from '../../lib/orderView'
import { confirmDialog } from '../../lib/confirm'
import { t, dateLocale } from '@/lib/i18n'

type Screen =
  | { name: 'home' }
  | { name: 'find' }
  | { name: 'pick' }
  | { name: 'join'; code: string }
  | { name: 'clinic'; conn: Connection & { clinic: DirectoryClinic }; startNew?: boolean; fromPick?: boolean; orderId?: string }

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

function Shell({ children, onBack, title, right }: { children: React.ReactNode; onBack?: () => void; title?: string; right?: React.ReactNode }) {
  return (
    <div className="min-h-[100dvh] bg-bg text-ink" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <header className="sticky top-0 z-40 flex items-center gap-2 border-b border-ink-faint/20 bg-bg-card px-3 py-3"
        style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}>
        {onBack
          ? <button type="button" onClick={onBack} className="-ml-1 flex items-center gap-1 py-1 text-base text-accent"><ChevronLeft size={20} aria-hidden="true" /> {t('mobile.back')}</button>
          : <span className="text-base font-bold">{t('network.title')}</span>}
        {title && <span className="ml-2 truncate text-base font-semibold">{title}</span>}
        {right && <span className="ml-auto">{right}</span>}
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

// ── Home: greeting, New order, my clinics, recent orders ────────────────────
type LiveConn = Connection & { clinic: DirectoryClinic }

/** What one clinic says right now: its state and, with a session, the account's orders there. */
interface ClinicOverview { state: Connection['state']; session?: ClinicSession; orders?: ClientOrderSummary[] }

const OPEN: readonly ClientOrderStatus[] = ['received', 'in_progress', 'ready']

function useClinicOverviews(conns: LiveConn[]) {
  return useQueries({
    queries: conns.slice(0, 10).map(c => ({
      queryKey: ['network', 'overview', c.clinic_id],
      staleTime: 60_000,
      retry: false,
      queryFn: async (): Promise<ClinicOverview> => {
        const r = await connect(c)
        if (!r.session) return { state: r.state }
        const orders = await clinicApi(c.clinic_id, c.clinic.api_url, r.session.session).orders()
        return { state: r.state, session: r.session, orders }
      },
    })),
  })
}

function Home() {
  const qc = useQueryClient()
  const account = useQuery({ queryKey: ['network', 'account'], queryFn: myAccount })
  const [screen, setScreen] = useState<Screen>(() => {
    const code = inviteCodeOf(location.pathname)
    return code ? { name: 'join', code } : { name: 'home' }
  })
  const [editing, setEditing] = useState(false)
  const [menu, setMenu] = useState(false)
  const conns = useQuery({ queryKey: ['network', 'connections'], queryFn: myConnections, enabled: !!account.data })
  const live = (conns.data ?? []).filter((c): c is LiveConn => !!c.clinic && c.state !== 'ended')
  const overviews = useClinicOverviews(live)
  const home = () => {
    history.replaceState(null, '', '/network')
    setScreen({ name: 'home' })
    void qc.invalidateQueries({ queryKey: ['network', 'overview'] })
  }

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
  if (screen.name === 'clinic') {
    return <ClinicScreen conn={screen.conn} startNew={screen.startNew} fromPick={screen.fromPick} startOrder={screen.orderId}
      onBack={() => { void conns.refetch(); home() }} onBackToPick={() => setScreen({ name: 'pick' })} />
  }

  const a = account.data
  const overviewOf = (c: LiveConn): ClinicOverview | undefined => overviews[live.indexOf(c)]?.data
  const stateOf = (c: LiveConn): Connection['state'] => overviewOf(c)?.state ?? c.state
  const ready = live.filter(c => stateOf(c) === 'confirmed')
  if (screen.name === 'pick') return <PickClinic conns={ready} onBack={home} onPick={c => setScreen({ name: 'clinic', conn: c, startNew: true, fromPick: true })} />

  const known = live.filter(c => overviewOf(c)?.orders)
  const openTotal = known.reduce((n, c) => n + (overviewOf(c)!.orders!.filter(o => OPEN.includes(o.status)).length), 0)
  const recent = known
    .flatMap(c => overviewOf(c)!.orders!.map(o => ({ o, c })))
    .sort((x, y) => y.o.created_at.localeCompare(x.o.created_at))
    .slice(0, 5)
  const newOrder = () => (ready.length === 1 ? setScreen({ name: 'clinic', conn: ready[0], startNew: true }) : setScreen({ name: 'pick' }))

  return (
    <div className="min-h-[100dvh] bg-bg text-ink" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <header className="bg-gradient-to-br from-accent to-accent-dark px-5 pb-6 text-white" style={{ paddingTop: 'max(1.5rem, env(safe-area-inset-top))' }}>
        <div className="mx-auto max-w-2xl space-y-4">
          <div className="relative flex items-center justify-between">
            <span className="text-base font-bold tracking-wide">{t('network.brand')}</span>
            <button type="button" onClick={() => setMenu(m => !m)} aria-expanded={menu} aria-label={t('network.accountMenu')}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20 text-sm font-bold">{initials(a.display_name)}</button>
            {menu && (
              <div className="absolute right-0 top-12 z-50 w-48 overflow-hidden rounded-xl bg-bg-card text-ink shadow-lg">
                <button type="button" className="block w-full px-4 py-3 text-left text-base hover:bg-bg-sidebar" onClick={() => { setMenu(false); setEditing(true) }}>{t('network.editProfile')}</button>
                <button type="button" className="flex w-full items-center gap-2 px-4 py-3 text-left text-base text-rose-600 hover:bg-bg-sidebar" onClick={() => void network!.auth.signOut()}>
                  <LogOut size={16} aria-hidden="true" /> {t('network.signOut')}</button>
              </div>
            )}
          </div>
          <div className="space-y-1">
            <p className="text-sm opacity-90">{greetingText(new Date().getHours())}</p>
            <p className="text-2xl font-bold">{a.display_name}</p>
            <p className="text-sm opacity-90">{[roleText(a.role), a.company_name].filter(Boolean).join(' · ')}</p>
          </div>
          {known.length > 0 && (
            <div className="flex gap-3">
              <div className="flex-1 rounded-2xl bg-white/15 px-3 py-2">
                <p className="text-xl font-bold">{openTotal}</p>
                <p className="text-xs opacity-90">{t('network.openOrders')}</p>
              </div>
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-4 p-4">
        {ready.length > 0 && (
          <button type="button" onClick={newOrder} className="btn-primary h-14 w-full justify-center rounded-2xl text-lg font-bold">
            <Plus size={20} aria-hidden="true" /> {t('network.newOrder')}
          </button>
        )}

        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-bold">{t('network.myClinics')}
            <InfoButton label={t('network.myClinics')} text={t('network.myClinicsInfo')} /></h2>
          <button type="button" onClick={() => setScreen({ name: 'find' })} className="flex items-center gap-1 text-sm font-semibold text-accent">
            <Search size={16} aria-hidden="true" /> {t('network.findClinic')}</button>
        </div>
        {live.length === 0 && <p className="card p-5 text-base text-ink-muted">{t('network.noClinics')}</p>}
        {live.map(c => {
          const o = overviewOf(c)
          const open = o?.orders ? o.orders.filter(x => OPEN.includes(x.status)).length : null
          const confirmed = stateOf(c) === 'confirmed'
          return (
            <button key={c.id} type="button" onClick={() => setScreen({ name: 'clinic', conn: c })}
              className="card flex w-full items-center gap-3 rounded-2xl p-4 text-left active:bg-bg-sidebar">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-lg font-bold text-accent" aria-hidden="true">{initials(c.clinic.name).slice(0, 1)}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-base font-bold">{c.clinic.name}</span>
                <span className="text-sm text-ink-muted">
                  {c.clinic.city ?? c.clinic.country}{open !== null ? ` · ${open === 1 ? t('network.oneOpenOrder') : t('network.nOpenOrders', { n: open })}` : ''}
                </span>
              </span>
              <span className={`flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold ${confirmed ? 'bg-emerald-500/15 text-emerald-700' : 'bg-amber-500/15 text-amber-700'}`}>
                {confirmed ? <Check size={14} aria-hidden="true" /> : <Clock size={14} aria-hidden="true" />}
                {confirmed ? t('network.connected') : t('network.waiting')}
              </span>
            </button>
          )
        })}

        {recent.length > 0 && (
          <>
            <h2 className="pt-1 text-lg font-bold">{t('network.recentOrders')}</h2>
            {recent.map(({ o, c }) => (
              <button key={`${c.clinic_id}:${o.id}`} type="button" onClick={() => setScreen({ name: 'clinic', conn: c, orderId: o.id })}
                className="card flex w-full flex-col gap-1 rounded-2xl p-4 text-left active:bg-bg-sidebar">
                <span className="flex items-start justify-between gap-2">
                  <span className="min-w-0 truncate text-base font-bold">{o.work_type}</span>
                  <StatusBadge status={o.status} />
                </span>
                <span className="text-sm text-ink-muted">{c.clinic.name} · {o.patient_ref}</span>
              </button>
            ))}
          </>
        )}
      </main>
    </div>
  )
}

const greetingText = (hour: number): string => {
  const p = dayPart(hour)
  return p === 'morning' ? t('network.goodMorning') : p === 'afternoon' ? t('network.goodAfternoon') : t('network.goodEvening')
}
const roleText = (r: Account['role']): string =>
  r === 'technician' ? t('network.roleTechnician') : r === 'doctor' ? t('network.roleDoctor') : r === 'clinic' ? t('network.roleClinic') : t('network.roleLab')

/** Where a new order is: only the steps the person sees are counted (lib/orderView stepNumber). */
function Steps({ number, total, label }: { number: number; total: number; label: string }) {
  return (
    <div className="space-y-2">
      <div className="flex gap-1.5" aria-hidden="true">
        {Array.from({ length: total }, (_, i) => <span key={i} className={`h-1.5 flex-1 rounded-full ${i < number ? 'bg-accent' : 'bg-ink-faint/30'}`} />)}
      </div>
      <p className="text-sm font-semibold uppercase text-ink-muted">{t('network.stepOf', { n: number, total })} · {label}</p>
    </div>
  )
}

function PickClinic({ conns, onBack, onPick }: { conns: LiveConn[]; onBack: () => void; onPick: (c: LiveConn) => void }) {
  return (
    <Shell onBack={onBack} title={t('network.newOrder')}>
      <Steps {...stepNumber('clinic', true)} label={t('network.stepClinic')} />
      {conns.map(c => (
        <button key={c.id} type="button" onClick={() => onPick(c)} className="card flex w-full items-center gap-3 rounded-2xl p-4 text-left active:bg-bg-sidebar">
          <Building2 size={22} className="text-accent" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-base font-bold">{c.clinic.name}</span>
            <span className="text-sm text-ink-muted">{c.clinic.city ? `${c.clinic.city}, ` : ''}{c.clinic.country}</span>
          </span>
        </button>
      ))}
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

// ── A clinic: its page, New order, an order ─────────────────────────────────
/**
 * The clinic's page: New order and My orders, nothing final beside them.
 * Ending the connection is in the "⋯" menu, in red, and asks first.
 * `fromPick`: New order was started from the clinic picker, so leaving the
 * form goes back there (the picker is its first step).
 */
function ClinicScreen({ conn, startNew, fromPick, startOrder, onBack, onBackToPick }: {
  conn: LiveConn; startNew?: boolean; fromPick?: boolean; startOrder?: string; onBack: () => void; onBackToPick?: () => void
}) {
  const [state, setState] = useState<{ state: Connection['state']; session?: ClinicSession } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<'home' | 'new'>(startNew ? 'new' : 'home')
  const [openOrder, setOpenOrder] = useState<string | null>(startOrder ?? null)
  const [menu, setMenu] = useState(false)
  const tryConnect = async () => { setError(null); try { setState(await connect(conn)) } catch (e) { setError(errorText(e)) } }
  useEffect(() => { void tryConnect() }, [conn.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const api = useMemo(() => state?.session ? clinicApi(conn.clinic_id, conn.clinic.api_url, state.session.session) : null, [state, conn])
  const detail = useQuery({ queryKey: ['network', 'order', openOrder], queryFn: () => api!.order(openOrder!), enabled: !!api && !!openOrder, refetchInterval: 30_000 })

  async function endIt() {
    setMenu(false)
    const yes = await confirmDialog({
      title: t('network.endTitle', { clinic: conn.clinic.name }),
      message: t('network.endExplain'),
      confirmLabel: t('network.endConfirm'),
      danger: true,
    })
    if (!yes) return
    if (api) await api.end().catch(() => {})
    await endConnection(conn.id)
    onBack()
  }

  if (mode === 'new' && api && state?.session) {
    return (
      <NewOrder api={api} clinicId={conn.clinic_id} clinicName={conn.clinic.name} prices={!!state.session.can_see.prices}
        withClinicStep={!!fromPick}
        onLeave={() => (fromPick && onBackToPick ? onBackToPick() : setMode('home'))}
        onSent={id => { setMode('home'); setOpenOrder(id) }} />
    )
  }

  const menuButton = state?.state !== 'ended' && (
    <div className="relative">
      <button type="button" onClick={() => setMenu(m => !m)} aria-expanded={menu} aria-label={t('network.clinicMenu')}
        className="flex h-10 w-10 items-center justify-center rounded-full text-ink-muted hover:bg-bg-sidebar"><MoreHorizontal size={20} aria-hidden="true" /></button>
      {menu && (
        <div className="absolute right-0 top-11 z-50 w-60 overflow-hidden rounded-xl bg-bg-card shadow-lg">
          <button type="button" className="block w-full px-4 py-3 text-left text-base text-rose-600 hover:bg-bg-sidebar" onClick={() => void endIt()}>
            {t('network.endConnection')}</button>
        </div>
      )}
    </div>
  )

  return (
    <Shell onBack={openOrder ? () => (startOrder ? onBack() : setOpenOrder(null)) : onBack}
      title={openOrder ? detail.data?.payload.patient_ref ?? '' : conn.clinic.name}
      right={openOrder ? (detail.data ? <StatusBadge status={detail.data.status} /> : undefined) : menuButton}>
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
          <button type="button" onClick={() => setMode('new')} className="btn-primary h-14 w-full justify-center rounded-2xl text-lg font-bold">
            <Plus size={20} aria-hidden="true" /> {t('network.newOrder')}
          </button>
          <h2 className="pt-1 text-lg font-bold">{t('network.myOrders')}</h2>
          <MyOrders api={api} clinicId={conn.clinic_id} onOpen={setOpenOrder} />
        </>
      )}
      {api && openOrder && <OrderScreen api={api} clinicId={conn.clinic_id} clinicName={conn.clinic.name} orderId={openOrder} detail={detail} />}
    </Shell>
  )
}

type Api = ReturnType<typeof clinicApi>

const STATUS_STYLE: Record<ClientOrderStatus, string> = {
  received: 'bg-sky-500/15 text-sky-800', in_progress: 'bg-blue-500/15 text-blue-700', ready: 'bg-emerald-500/15 text-emerald-700',
  sent: 'bg-emerald-600 text-white', rejected: 'bg-rose-500/15 text-rose-700',
}
const statusLabel = (s: ClientOrderStatus): string =>
  s === 'received' ? t('network.statusReceived') : s === 'in_progress' ? t('network.statusInProgress')
    : s === 'ready' ? t('network.statusReady') : s === 'sent' ? t('network.statusSent') : t('network.statusRejected')

function StatusBadge({ status }: { status: ClientOrderStatus }) {
  return <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLE[status]}`}>{statusLabel(status)}</span>
}

/** A work type's picture in the clinic's catalogue: by its name, as the desktop's new-job form finds it. */
function TypeArt({ name, size }: { name: string; size: number }) {
  return <WorkTypeArt size={size} iconSize={Math.round(size * 0.6)} type={{ nimi: name, match: [] }} />
}

function MyOrders({ api, clinicId, onOpen }: { api: Api; clinicId: string; onOpen: (id: string) => void }) {
  const orders = useQuery<ClientOrderSummary[]>({ queryKey: ['network', 'orders', clinicId], queryFn: api.orders, refetchInterval: 60_000 })
  if (orders.error) return <p className="text-base text-rose-600">{errorText(orders.error)}</p>
  if ((orders.data ?? []).length === 0) return <p className="card p-5 text-base text-ink-muted">{t('network.noOrders')}</p>
  return (
    <div className="space-y-2">
      {(orders.data ?? []).map(o => (
        <button key={o.id} type="button" onClick={() => onOpen(o.id)} className="card flex w-full items-center gap-3 rounded-2xl p-3 text-left active:bg-bg-sidebar">
          <TypeArt name={o.work_type} size={44} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-base font-bold">{o.work_type}</span>
            <span className="text-sm text-ink-muted">{o.patient_ref} · {format(new Date(o.created_at), 'd MMM', { locale: dateLocale })}
              {o.messages > 0 ? ` · ${o.messages === 1 ? t('network.oneMessage') : t('network.nMessages', { n: o.messages })}` : ''}</span>
          </span>
          <StatusBadge status={o.status} />
        </button>
      ))}
    </div>
  )
}

/** Which of an order's fields the first form step is about: a problem in these keeps Next off. */
const WORK_PROBLEMS = new Set(['work_type', 'teeth', 'options', 'not_in_catalogue', 'option_not_offered', 'one_option_only'])

/**
 * New order, as steps the person sees: Work & teeth → Details → Review (and
 * the clinic before them when it was picked). Back on the first of these
 * leaves the form: straight away when nothing is filled in, else only after
 * "Discard this order?".
 */
function NewOrder({ api, clinicId, clinicName, prices, withClinicStep, onLeave, onSent }: {
  api: Api; clinicId: string; clinicName: string; prices: boolean; withClinicStep: boolean; onLeave: () => void; onSent: (id: string) => void
}) {
  const catalog = useQuery<CatalogueItem[]>({ queryKey: ['network', 'catalog', clinicId], queryFn: api.catalog })
  const [step, setStep] = useState<FormStep>('work')
  const [order, setOrder] = useState<WivoOrderV1>(emptyOrder)
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refError, setRefError] = useState<string | null>(null)
  // Where the implants are and what sits on them (Wivo order v2, sql/141), as on the new-job form.
  const [implants, setImplants] = useState<number[]>([])
  const [abutmentAll, setAbutmentAll] = useState('')
  const [abutmentTeeth, setAbutmentTeeth] = useState<Record<string, string>>({})
  // The clinic's next reference (sql/140), filled in once; the client may write its own instead.
  const nextRef = useQuery<string>({ queryKey: ['network', 'next_ref', clinicId], queryFn: api.nextRef, staleTime: 0, retry: false })
  const autoRef = nextRef.data ?? null
  useEffect(() => {
    if (autoRef) setOrder(o => (o.patient_ref === '' ? { ...o, patient_ref: autoRef } : o))
  }, [autoRef])
  const item = (catalog.data ?? []).find(c => c.name === order.work_type)
  const today = new Date().toISOString().slice(0, 10)
  const problems = orderProblems(order, catalog.data, today)
  const needsTeeth = !!item && item.teeth !== 'none'
  const workOk = !!item && !problems.some(p => WORK_PROBLEMS.has(p)) && (!needsTeeth || order.teeth !== '')
  const detailsOk = problems.length === 0
  const set = (patch: Partial<WivoOrderV1>) => setOrder(o => ({ ...o, ...patch }))
  const { number, total } = stepNumber(step, withClinicStep)
  const options = chosenOptionLabels(order.options, (key, id) => item?.groups.find(g => g.key === key)?.options.find(o => o.id === id)?.name)
  // The clinic takes order v2 (sql/141): implants can be marked. Before it, the form is as it was.
  const v2 = (catalog.data ?? []).some(c => (c.order_version ?? 1) >= 2)
  const rules = item ? catalogueRules(item) : null
  const summary = implantSummary(parseTeeth(order.teeth), implants, !!rules?.isBridge, !!rules?.implantBased)

  async function back() {
    if (step === 'review') return setStep('details')
    if (step === 'details') return setStep('work')
    // The reference the clinic filled in is not something the person wrote.
    if (orderTouched({ ...order, patient_ref: order.patient_ref === autoRef ? '' : order.patient_ref }, files.length)) {
      const discard = await confirmDialog({
        title: t('network.discardTitle'), message: t('network.discardText'),
        confirmLabel: t('network.discard'), cancelLabel: t('network.keepEditing'), danger: true,
      })
      if (!discard) return
    }
    onLeave()
  }

  async function send() {
    setBusy(true); setError(null)
    try {
      const id = await api.newOrder(wireOrder(order, { implants, abutmentAll, abutmentTeeth }, v2))
      for (const f of files) await api.upload(id, f)
      onSent(id)
    } catch (e) {
      // A reference the clinic already has: back to the field, said there.
      if (e instanceof NetworkError && e.code === 'duplicate_reference') { setRefError(t('network.errDuplicateRef')); setStep('details') }
      else setError(errorText(e))
    } finally { setBusy(false) }
  }

  const label = step === 'work' ? t('network.stepWork') : step === 'details' ? t('network.stepDetails') : t('network.stepReview')
  const footer = (next: React.ReactNode) => (
    <div className="flex gap-2 pt-1">
      <button type="button" onClick={() => void back()} className="min-h-12 flex-1 rounded-2xl border border-ink-faint/40 bg-bg-card text-base font-semibold">{t('network.backStep')}</button>
      {next}
    </div>
  )

  return (
    <Shell onBack={() => void back()} title={t('network.newOrder')} right={<span className="truncate text-sm text-ink-muted">{t('network.toClinic', { clinic: clinicName })}</span>}>
      <Steps number={number} total={total} label={label} />

      {step === 'work' && (
        <>
          <div className="grid grid-cols-3 gap-2">
            {(catalog.data ?? []).map(c => {
              const on = order.work_type === c.name
              return (
                <button key={c.name} type="button" aria-pressed={on}
                  onClick={() => {
                    if (c.name === order.work_type) return
                    const keep = c.teeth === 'none' ? '' : order.teeth
                    set({ work_type: c.name, options: {}, teeth: keep })
                    // Implants follow the new work's own rule: built on implants, its teeth are implants at once.
                    const r = catalogueRules(c)
                    setImplants(r.implantBased && r.toothMode === 'tooth' ? parseTeeth(keep) : [])
                  }}
                  className={`flex flex-col items-center gap-1.5 rounded-2xl bg-bg-card px-1.5 py-2.5 ${on ? 'border-2 border-accent' : 'border border-ink-faint/30'}`}>
                  <TypeArt name={c.name} size={44} />
                  <span className={`text-center text-xs leading-tight ${on ? 'font-bold' : ''}`}>{c.name}</span>
                  {prices && c.price != null && <span className="text-xs text-ink-muted">{c.price} €{c.unit === 'hammas' ? ` / ${t('network.perTooth')}` : ''}</span>}
                </button>
              )
            })}
          </div>
          {catalog.isFetched && (catalog.data ?? []).length === 0 && <p className="card p-4 text-base text-ink-muted">{t('network.noCatalogue')}</p>}

          {item?.groups.map(g => (
            <div key={g.key} className="card space-y-2 rounded-2xl p-3">
              <p className="text-sm font-bold">{g.name}</p>
              <div className="flex flex-wrap gap-1.5">
                {g.options.map(op => {
                  const chosen = (order.options[g.key] ?? []).includes(op.id)
                  return (
                    <button key={op.id} type="button" aria-pressed={chosen}
                      onClick={() => {
                        const now = order.options[g.key] ?? []
                        const next = chosen ? now.filter(x => x !== op.id) : g.multi ? [...now, op.id] : [op.id]
                        set({ options: { ...order.options, [g.key]: next } })
                      }}
                      className={`min-h-10 rounded-xl px-3 text-sm ${chosen ? 'border-2 border-accent bg-accent/10 font-semibold' : 'border border-ink-faint/40'}`}>
                      {op.name}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}

          {needsTeeth && (
            <TeethPicker value={order.teeth} implants={implants} arch={item!.teeth === 'arch'} workType={order.work_type}
              canMarkImplants={v2} autoImplants={!!rules?.implantBased && rules.toothMode === 'tooth'}
              onChange={(teeth, nextImplants) => { set({ teeth }); setImplants(nextImplants) }} />
          )}
          {needsTeeth && v2 && rules?.implantBased && rules.toothMode === 'arch' && (
            <p className="rounded-xl bg-accent/10 p-3 text-sm text-ink">{t('network.tapImplants')}</p>
          )}
          {needsTeeth && summary.teeth > 0 && (
            <ImplantSummaryLine summary={summary} />
          )}
          {needsTeeth && v2 && expectedImplants(order.work_type) !== null && summary.teeth > 0 && summary.implants.length !== expectedImplants(order.work_type) && (
            <p className="rounded-xl bg-amber-500/10 p-3 text-sm text-amber-800" role="status">
              {t('network.implantCountWarning', { work: order.work_type, n: expectedImplants(order.work_type)!, marked: summary.implants.length })}</p>
          )}
          {v2 && summary.implants.length > 0 && (
            <div className="card rounded-2xl p-3">
              <AbutmentPicker
                types={[{ too: order.work_type, hex: ORDER_TOOTH_HEX, teeth: summary.implants }]}
                byType={{ [order.work_type]: abutmentAll }}
                byTooth={abutmentTeeth}
                onChangeType={(_too, code) => setAbutmentAll(code)}
                onChangeTooth={(tooth, code) => setAbutmentTeeth(a => ({ ...a, [tooth]: code }))}
              />
            </div>
          )}
          {footer(<button type="button" disabled={!workOk} onClick={() => setStep('details')} className="btn-primary min-h-12 flex-[2] justify-center rounded-2xl text-base font-bold">{t('network.next')}</button>)}
        </>
      )}

      {step === 'details' && (
        <>
          <div className="card grid grid-cols-1 gap-3 rounded-2xl p-3 sm:grid-cols-2">
            <label className="block sm:col-span-2"><span className="label flex items-center gap-1">{t('network.patientRef')} <InfoButton label={t('network.patientRef')} text={t('network.patientRefInfo')} /></span>
              <input className="input h-12 text-base" maxLength={40} value={order.patient_ref} aria-invalid={!!refError}
                onChange={e => { setRefError(null); set({ patient_ref: e.target.value }) }} />
              {refError
                ? <span className="mt-1 block text-sm text-rose-600" role="alert">{refError}</span>
                : autoRef && order.patient_ref === autoRef && <span className="mt-1 block text-sm text-ink-muted">{t('network.refFromClinic')}</span>}
              {autoRef && order.patient_ref !== autoRef && (
                <button type="button" className="mt-1 text-sm font-semibold text-accent" onClick={() => { setRefError(null); set({ patient_ref: autoRef }) }}>
                  {t('network.useClinicRef', { ref: autoRef })}</button>
              )}</label>
            <label className="block"><span className="label">{t('network.shade')}</span>
              <input className="input h-12 text-base" maxLength={20} placeholder="A2" value={order.shade ?? ''} onChange={e => set({ shade: e.target.value || null })} /></label>
            <label className="block"><span className="label">{t('network.due')}</span>
              <input className="input h-12 text-base" type="date" min={today} value={order.due ?? ''} onChange={e => set({ due: e.target.value || null })} /></label>
            <label className="block sm:col-span-2"><span className="label">{t('network.notes')}</span>
              <textarea className="input min-h-24 text-base" maxLength={2000} value={order.notes ?? ''} onChange={e => set({ notes: e.target.value || null })} /></label>
          </div>
          <div className="card space-y-2 rounded-2xl p-3">
            <p className="text-sm font-bold">{t('network.files')}</p>
            <label className="flex min-h-14 cursor-pointer items-center justify-center gap-1 rounded-xl border border-dashed border-ink-faint px-3 text-sm text-ink-soft">
              <Paperclip size={16} aria-hidden="true" /> {t('network.addScan')}
              <input type="file" multiple className="hidden" onChange={e => setFiles(f => [...f, ...(e.target.files ?? [])].slice(0, 30))} />
            </label>
            {files.map((f, i) => (
              <div key={`${f.name}:${i}`} className="flex items-center gap-2 rounded-xl bg-accent/5 px-2 py-1.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-[10px] font-bold text-accent">{fileBadge(f.name) || <Paperclip size={14} aria-hidden="true" />}</span>
                <span className="min-w-0 flex-1 truncate text-sm">{f.name}</span>
                <button type="button" aria-label={t('network.removeFile', { name: f.name })} onClick={() => setFiles(list => list.filter((_, j) => j !== i))}
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-muted hover:bg-bg-sidebar"><X size={16} aria-hidden="true" /></button>
              </div>
            ))}
          </div>
          {!detailsOk && order.patient_ref.trim() === '' && <p className="text-sm text-ink-muted">{t('network.fillIn')}</p>}
          {footer(<button type="button" disabled={!detailsOk} onClick={() => setStep('review')} className="btn-primary min-h-12 flex-[2] justify-center rounded-2xl text-base font-bold">{t('network.next')}</button>)}
        </>
      )}

      {step === 'review' && (
        <>
          <div className="card space-y-3 rounded-2xl p-4">
            <div className="flex items-center gap-3">
              <TypeArt name={order.work_type} size={48} />
              <div className="min-w-0">
                <p className="text-base font-bold">{[order.work_type, ...options].join(' · ')}</p>
                <p className="text-sm text-ink-muted">{t('network.toClinic', { clinic: clinicName })}</p>
              </div>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              {order.teeth && <><dt className="text-ink-muted">{t('network.teeth')}</dt><dd>{teethLabel(order.teeth)}</dd></>}
              {v2 && summary.implants.length > 0 && <><dt className="text-ink-muted">{t('network.implants')}</dt><dd>{summary.implants.join(', ')}</dd></>}
              {v2 && summary.pontics.length > 0 && <><dt className="text-ink-muted">{t('network.pontics')}</dt><dd>{summary.pontics.join(', ')}</dd></>}
              {v2 && summary.implants.length > 0 && (abutmentAll.trim() || Object.values(abutmentTeeth).some(v => v.trim())) && (
                <><dt className="text-ink-muted">{t('network.abutment')}</dt><dd className="break-words">{abutmentText(summary.implants, abutmentAll, abutmentTeeth)}</dd></>
              )}
              <dt className="text-ink-muted">{t('network.patientRef')}</dt><dd className="break-words">{order.patient_ref}</dd>
              {order.shade && <><dt className="text-ink-muted">{t('network.shade')}</dt><dd>{order.shade}</dd></>}
              {order.due && <><dt className="text-ink-muted">{t('network.due')}</dt><dd>{format(new Date(order.due), 'd MMM yyyy', { locale: dateLocale })}</dd></>}
              {files.length > 0 && <><dt className="text-ink-muted">{t('network.files')}</dt><dd>{files.map(f => f.name).join(', ')}</dd></>}
            </dl>
            {order.notes && <p className="whitespace-pre-wrap text-sm text-ink-muted">{order.notes}</p>}
          </div>
          {error && <p className="text-base text-rose-600">{error}</p>}
          {footer(
            <button type="button" disabled={busy || !detailsOk} onClick={() => void send()} className="btn-primary min-h-12 flex-[2] justify-center rounded-2xl text-base font-bold">
              <Send size={18} aria-hidden="true" /> {busy ? t('network.sending') : t('network.sendOrder')}
            </button>,
          )}
        </>
      )}
    </Shell>
  )
}

/** The one colour of an order's teeth on the chart (the design's accent). */
const ORDER_TOOTH_HEX = '#0a7f8a'

/**
 * Teeth on the same chart as Wivo's new-job form (components/teeth/ToothPicker),
 * with the same implant marking: a "+" over each chosen tooth, the Implants
 * mode in the toolbar (tap or sweep), and, for work built on implants, its
 * teeth marked at once (a bridge's pontics can then be unmarked). Tap a tooth
 * or press and sweep across a row (16 → 26 too); a sweep that starts on a
 * tooth does not scroll the page. Each tap or sweep is one change; Undo.
 */
function TeethPicker({ value, implants, arch, workType, canMarkImplants, autoImplants, onChange }: {
  value: string; implants: number[]; arch: boolean; workType: string
  /** The clinic takes order v2 (sql/141). */
  canMarkImplants: boolean
  /** Work built on implants, tooth by tooth: a tooth picked is an implant at once. */
  autoImplants: boolean
  onChange: (teeth: string, implants: number[]) => void
}) {
  const [history, setHistory] = useState<{ teeth: string; implants: number[] }[]>([])
  const [markMode, setMarkMode] = useState<'implant' | null>(null)
  const current = parseTeeth(value)
  const change = (nextTeeth: string, nextImplants: number[]) => {
    if (nextTeeth === value && formatTeeth(nextImplants) === formatTeeth(implants)) return
    setHistory(h => [...h.slice(-49), { teeth: value, implants }])
    onChange(nextTeeth, nextImplants)
  }
  const setTeeth = (next: number[]) =>
    change(formatTeeth(next), withAutoImplants(current, next, implants, autoImplants))
  const setMarks = (next: number[]) => change(value, parseTeeth(formatTeeth(next.filter(t => current.includes(t)))))
  const undo = () => {
    const last = history[history.length - 1]
    if (!last) return
    setHistory(h => h.slice(0, -1))
    onChange(last.teeth, last.implants)
  }
  const wholeArch = (teeth: readonly number[]) => {
    const all = teeth.every(n => current.includes(n))
    setTeeth(applyPaint(current, [...teeth], all ? 'remove' : 'add'))
  }
  const items = [{ id: 'order', too: workType, hambad: value, ...(implants.length ? { implantaadid: formatTeeth(implants) } : {}) }]
  return (
    <div className="card space-y-2 rounded-2xl p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1 text-sm font-bold">{t('network.teeth')} <InfoButton label={t('network.teeth')} text={t('network.teethInfo')} /></span>
        <span className="text-sm font-semibold text-accent">{teethLabel(value)}</span>
      </div>
      {arch && (
        <div className="flex gap-2">
          <button type="button" onClick={() => wholeArch(UPPER_TEETH)} className="min-h-10 flex-1 rounded-xl border border-ink-faint/40 text-sm">{t('network.wholeUpper')}</button>
          <button type="button" onClick={() => wholeArch(LOWER_TEETH)} className="min-h-10 flex-1 rounded-xl border border-ink-faint/40 text-sm">{t('network.wholeLower')}</button>
        </div>
      )}
      <ToothPicker
        items={items}
        activeItemId="order"
        colorMap={{ [workType]: ORDER_TOOTH_HEX }}
        onToggleTooth={tooth => setTeeth(applyPaint(current, [tooth], current.includes(tooth) ? 'remove' : 'add'))}
        onPaintTeeth={(teeth, paint) => setTeeth(applyPaint(current, teeth, paint))}
        onToggleImplant={canMarkImplants ? tooth => setMarks(applyPaint(implants, [tooth], implants.includes(tooth) ? 'remove' : 'add')) : undefined}
        onPaintImplants={canMarkImplants ? (teeth, on) => setMarks(applyPaint(implants, teeth, on ? 'add' : 'remove')) : undefined}
        implantButtons={canMarkImplants}
        markMode={markMode}
        externalControls
        toolbar={
          <>
            {canMarkImplants && (
              <button type="button" data-chrome="chart" aria-pressed={markMode === 'implant'} disabled={current.length === 0}
                onClick={() => setMarkMode(m => (m === 'implant' ? null : 'implant'))}
                className={`inline-flex min-h-9 items-center gap-1 rounded-lg border px-2.5 text-xs font-semibold disabled:opacity-40 ${markMode === 'implant' ? 'border-slate-900 bg-slate-900 text-white' : 'border-ink-faint/30 bg-bg-card text-ink-soft'}`}>
                <Bolt size={14} aria-hidden="true" /> {t('jobDetail.implants')}
              </button>
            )}
            <button type="button" data-chrome="chart" onClick={undo} disabled={history.length === 0}
              className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-ink-faint/30 bg-bg-card px-2.5 text-xs font-semibold text-ink-soft disabled:opacity-40">
              <Undo2 size={14} aria-hidden="true" /> {t('teeth.undo')}
            </button>
          </>
        }
      />
    </div>
  )
}

/** "12 teeth · 4 implants (15, 12, 22, 25) · 2 pontics (13, 12)", in the new-job form's words. */
function ImplantSummaryLine({ summary }: { summary: { teeth: number; implants: number[]; pontics: number[] } }) {
  const list = (xs: number[]) => xs.join(', ')
  const parts = [teethCountLabel(summary.teeth)]
  if (summary.implants.length > 0) {
    parts.push(summary.implants.length === 1
      ? t('wizard.summaryImplant1', { teeth: list(summary.implants) })
      : t('wizard.summaryImplants', { n: summary.implants.length, teeth: list(summary.implants) }))
  }
  if (summary.pontics.length > 0) {
    parts.push(summary.pontics.length === 1
      ? t('wizard.summaryPontic1', { teeth: list(summary.pontics) })
      : t('wizard.summaryPontics', { n: summary.pontics.length, teeth: list(summary.pontics) }))
  }
  return <p className="text-sm font-semibold text-ink" aria-live="polite">{parts.join(' · ')}</p>
}

/** "MIS C1; 12: Straumann BL" for the Review step and the order. */
function abutmentText(implants: readonly number[], all: string, byTooth: Record<string, string>): string {
  const parts = all.trim() ? [all.trim()] : []
  for (const tooth of implants) {
    const own = (byTooth[String(tooth)] ?? '').trim()
    if (own && own !== all.trim()) parts.push(`${tooth}: ${own}`)
  }
  return parts.join('; ')
}

/** The steps an order goes through as the client sees them; a date only where Wivo has one. */
const PROGRESS: { key: 'received' | 'accepted' | 'production' | 'ready' | 'sent'; label: () => string }[] = [
  { key: 'received', label: () => t('network.progressReceived') },
  { key: 'accepted', label: () => t('network.progressAccepted') },
  { key: 'production', label: () => t('network.progressProduction') },
  { key: 'ready', label: () => t('network.progressReady') },
  { key: 'sent', label: () => t('network.progressSent') },
]
/** How far an order is along PROGRESS: the index of its current step. */
export const progressIndex = (s: Exclude<ClientOrderStatus, 'rejected'>): number =>
  s === 'received' ? 0 : s === 'in_progress' ? 2 : s === 'ready' ? 3 : 4

function OrderScreen({ api, clinicId, clinicName, orderId, detail }: {
  api: Api; clinicId: string; clinicName: string; orderId: string; detail: UseQueryResult<ClientOrderDetail>
}) {
  const catalog = useQuery<CatalogueItem[]>({ queryKey: ['network', 'catalog', clinicId], queryFn: api.catalog })
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const d = detail.data
  if (detail.error) return <p className="text-base text-rose-600">{errorText(detail.error)}</p>
  if (!d) return <p className="py-10 text-center text-ink-muted">…</p>
  const p = d.payload
  const item = (catalog.data ?? []).find(c => c.name === p.work_type)
  const options = chosenOptionLabels(p.options, (key, id) => item?.groups.find(g => g.key === key)?.options.find(o => o.id === id)?.name)
  const teeth = teethLabel(p.teeth)
  const at = d.status === 'rejected' ? -1 : progressIndex(d.status)

  return (
    <div className="space-y-3">
      <div className="card flex items-center gap-3 rounded-2xl p-3">
        <TypeArt name={p.work_type} size={48} />
        <div className="min-w-0">
          <p className="text-base font-bold">{[p.work_type, ...options].join(' · ')}</p>
          <p className="text-sm text-ink-muted">{[clinicName, teeth && t('network.teethShort', { teeth }),
            p.due && t('network.dueShort', { date: format(new Date(p.due), 'dd.MM', { locale: dateLocale }) }), p.shade && t('network.shadeShort', { shade: p.shade })].filter(Boolean).join(' · ')}</p>
          {/* Version 2 (sql/141): the implants and what sits on them. */}
          {orderImplants(p) && <p className="text-sm text-ink-muted">{t('network.implants')}: {orderImplants(p).split(',').join(', ')}</p>}
          {p.version === 2 && p.abutment && (
            <p className="text-sm text-ink-muted">{t('network.abutment')}: {abutmentText(parseTeeth(p.implants), p.abutment.all ?? '', p.abutment.teeth)}</p>
          )}
        </div>
      </div>

      {d.status === 'rejected'
        ? <p className="rounded-2xl bg-rose-500/10 p-4 text-base text-rose-700">{t('network.rejectedBecause', { reason: d.reject_reason ?? '' })}</p>
        : (
          <div className="card space-y-3 rounded-2xl p-4">
            <p className="text-sm font-bold">{t('network.progress')}</p>
            {PROGRESS.map((s, i) => {
              const done = i < at || i === 0 || (i === at && d.status === 'sent')
              const current = i === at && !done
              return (
                <div key={s.key} className="flex items-center gap-3">
                  {done
                    ? <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent text-white"><Check size={14} aria-hidden="true" /></span>
                    : <span className={`h-6 w-6 rounded-full ${current ? 'border-[3px] border-accent' : 'border-2 border-ink-faint/50'}`} aria-hidden="true" />}
                  <span className={`text-base ${current ? 'font-bold' : done ? '' : 'text-ink-muted'}`}>{s.label()}</span>
                  {i === 0 && <span className="ml-auto text-xs text-ink-muted">{format(new Date(d.created_at), 'dd.MM', { locale: dateLocale })}</span>}
                </div>
              )
            })}
          </div>
        )}

      {p.notes && <p className="card whitespace-pre-wrap rounded-2xl p-4 text-base text-ink-muted">{p.notes}</p>}

      {d.files && d.files.length > 0 && (
        <div className="card space-y-2 rounded-2xl p-4">
          <p className="text-sm font-bold">{t('network.files')}</p>
          {d.files.map(f => (
            <button key={f.id} type="button" className="btn-ghost h-11 w-full justify-start text-base"
              onClick={async () => { try { const { url } = await api.download(f.id, f.file_name); window.open(url, '_blank', 'noopener') } catch (e) { setError(errorText(e)) } }}>
              <Download size={18} aria-hidden="true" /> <span className="truncate">{f.file_name}</span>
            </button>
          ))}
        </div>
      )}

      {d.messages && (
        <div className="card space-y-2.5 rounded-2xl p-4">
          <p className="text-sm font-bold">{t('network.messages')}</p>
          {d.messages.map(m => (
            <div key={m.id} className={`max-w-[80%] px-3 py-2 text-sm ${m.from_client
              ? 'ml-auto rounded-2xl rounded-br-md bg-accent text-white'
              : 'rounded-2xl rounded-bl-md bg-bg-sidebar'}`}>
              <p className="whitespace-pre-wrap">{m.body}</p>
              <p className={`mt-1 text-[11px] ${m.from_client ? 'text-white/80' : 'text-ink-muted'}`}>
                {m.from_client ? '' : `${clinicName} · `}{format(new Date(m.created_at), 'HH:mm', { locale: dateLocale })}</p>
            </div>
          ))}
          <div className="flex gap-2">
            <input className="input h-11 flex-1 rounded-xl text-base" maxLength={4000} value={text} onChange={e => setText(e.target.value)} placeholder={t('network.writeMessage')} />
            <button type="button" disabled={!text.trim()} aria-label={t('network.send')} className="btn-primary h-11 w-11 justify-center rounded-xl p-0"
              onClick={async () => { try { await api.message(orderId, text.trim()); setText(''); void detail.refetch() } catch (e) { setError(errorText(e)) } }}>
              <Send size={18} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
      {error && <p className="text-base text-rose-600">{error}</p>}
    </div>
  )
}
