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
import { ChevronLeft, Plus, Search, LogOut, Send, Download, Paperclip, Check, Clock, Building2, MoreHorizontal, X, Undo2, Bolt, Bell } from 'lucide-react'
import { format } from 'date-fns'
import {
  network, networkConfigured, myAccount, saveAccount, directory, clinicByInvite, myConnections,
  requestConnection, endConnection, connect, clinicApi, NetworkError, acceptTerms, signInMetadata,
  type Account, type Connection, type DirectoryClinic, type ClinicSession, type ClientOrderSummary, type ClientOrderDetail, type ClientNotice, type OrderFeedback,
} from '../../lib/network'
import { versionLine } from '../../lib/buildInfo'
import {
  LEGAL_PATHS, LEGAL_PUBLISHED, TERMS_VERSION, legalDocOf, legalPage, needsTermsAcceptance, signUpTermsMetadata, acceptedAtSignUp, type LegalDoc,
} from '../../lib/legal'
import { RichText } from '../../components/ui/RichText'
import { emptyOrder, orderProblems, orderImplants, type CatalogueItem, type ClientOrderStatus, type WivoOrderV1 } from '@shared/network/order'
import { InfoButton } from '../../components/ui/InfoButton'
import { WorkTypeArt } from '../../components/ui/WorkTypeArt'
import { ToothPicker } from '../../components/teeth/ToothPicker'
import { applyPaint } from '../../components/teeth/toothDrag'
import { AbutmentPicker } from '../../components/NewJobWizard/teeth/AbutmentPicker'
import { Stars, AdjustFields } from '../../components/Feedback/FeedbackFields'
import { ProblemFields } from '../../components/Delivery/DeliveryFields'
import { problemReasonText, resolutionText } from '../../lib/delivery'
import { newestAt } from '../../lib/threadFold'
import { useThreadFold, ThreadHeader } from '../../components/Network/ThreadFold'
import { teethCountLabel } from '../../components/NewJobWizard/teeth/WorkTypeTabs'
import {
  teethLabel, parseTeeth, formatTeeth, initials, dayPart, chosenOptionLabels, fileBadge, stepNumber, orderTouched,
  catalogueRules, expectedImplants, withAutoImplants, implantSummary, wireOrder, catalogueEstimate, cataloguePriceText, priceAmount,
  threadItems, reviewAnswer, isImageFile, type ThreadMessage, type ThreadFile,
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
  // /network/terms and /network/privacy: readable by anyone, signed in or not, Network set up or not.
  const legal = legalDocOf(location.pathname)
  if (legal) return <LegalPage doc={legal} />
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
      {/* Which build this is: shown only (lib/buildInfo). */}
      <footer className="space-y-1 pb-4 text-center text-[11px] text-ink-faint">
        <LegalLinks />
        <p>{versionLine('Wivo Network', __APP_VERSION__)}</p>
      </footer>
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
  const [agreed, setAgreed] = useState(false)
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (mode === 'up' && !agreed) return
    setBusy(true); setNote(null)
    // Sign-up keeps the accepted terms version in the user's metadata; the
    // account (made after the second factor) takes it over (lib/legal).
    const r = mode === 'in'
      ? await n.auth.signInWithPassword({ email: email.trim(), password })
      : await n.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: `${location.origin}/network`, data: signUpTermsMetadata() } })
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
        {mode === 'up' && <AgreeCheckbox checked={agreed} onChange={setAgreed} />}
        {note && <p className="text-base text-ink">{note}</p>}
        <button type="submit" disabled={busy || (mode === 'up' && !agreed)} className={`btn-primary justify-center ${big}`}>{mode === 'in' ? t('network.signIn') : t('network.signUp')}</button>
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
  // Network 003: e-mails from clinics about orders (subject and a link only). Shown once the Network has it.
  const hasMailChoice = account?.email_notifications !== undefined
  const [mail, setMail] = useState(account?.email_notifications ?? true)
  // Network 004: the address the clinics send invoices to (optional). Shown once the Network has it.
  const hasBilling = account?.billing_email !== undefined
  const [billing, setBilling] = useState(account?.billing_email ?? '')
  const billingOk = !billing.trim() || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(billing.trim())
  const roles: Account['role'][] = ['technician', 'doctor', 'clinic', 'lab']
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      await saveAccount({ kind, role, display_name: name.trim(), company_name: company.trim() || null,
        country: /^[A-Za-z]{2}$/.test(country.trim()) ? country.trim().toUpperCase() : null, city: city.trim() || null,
        ...(hasMailChoice ? { email_notifications: mail } : {}),
        ...(hasBilling ? { billing_email: billing.trim() || null } : {}) }, !account)
      // A new account: the terms accepted at sign-up go onto it (Network 005). Without
      // 005, or without that acceptance, the acceptance screen asks instead.
      if (!account && acceptedAtSignUp(await signInMetadata().catch(() => null))) await acceptTerms(TERMS_VERSION).catch(() => undefined)
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
      {hasMailChoice && (
        <label className="flex items-start gap-3 text-base">
          <input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={mail} onChange={e => setMail(e.target.checked)} />
          <span>{t('network.emailNotices')}<span className="block text-sm text-ink-muted">{t('network.emailNoticesHelp')}</span></span>
        </label>
      )}
      {hasBilling && (
        <label className="block"><span className="label">{t('network.billingEmail')}</span>
          <input type="email" className="input h-12 text-base" maxLength={254} value={billing} onChange={e => setBilling(e.target.value)} autoComplete="email" />
          <span className={`block text-sm ${billingOk ? 'text-ink-muted' : 'text-rose-600'}`}>{billingOk ? t('network.billingEmailHelp') : t('network.billingEmailBad')}</span></label>
      )}
      {error && <p className="text-base text-rose-600">{error}</p>}
      <button type="submit" disabled={!name.trim() || !billingOk} className={`btn-primary justify-center ${big}`}>{t('network.saveProfile')}</button>
      <p className="text-center text-xs text-ink-faint">{versionLine('Wivo Network', __APP_VERSION__)}</p>
    </form>
  )
}

// ── Home: greeting, New order, my clinics, recent orders ────────────────────
type LiveConn = Connection & { clinic: DirectoryClinic }

/** What one clinic says right now: its state and, with a session, the account's orders there. */
interface ClinicOverview { state: Connection['state']; session?: ClinicSession; orders?: ClientOrderSummary[]; notices?: ClientNotice[] }

const OPEN: readonly ClientOrderStatus[] = ['received', 'in_progress', 'ready', 'problem']

function useClinicOverviews(conns: LiveConn[]) {
  return useQueries({
    queries: conns.slice(0, 10).map(c => ({
      queryKey: ['network', 'overview', c.clinic_id],
      staleTime: 60_000,
      retry: false,
      queryFn: async (): Promise<ClinicOverview> => {
        const r = await connect(c)
        if (!r.session) return { state: r.state }
        const api = clinicApi(c.clinic_id, c.clinic.api_url, r.session.session)
        const [orders, notices] = await Promise.all([api.orders(), api.notices()])
        return { state: r.state, session: r.session, orders, notices }
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
  const [bell, setBell] = useState(false)
  const conns = useQuery({ queryKey: ['network', 'connections'], queryFn: myConnections, enabled: !!account.data })
  const live = (conns.data ?? []).filter((c): c is LiveConn => !!c.clinic && c.state !== 'ended')
  const overviews = useClinicOverviews(live)
  const home = () => {
    history.replaceState(null, '', '/network')
    setScreen({ name: 'home' })
    void qc.invalidateQueries({ queryKey: ['network', 'overview'] })
  }

  if (account.isLoading) return <Shell><p className="py-10 text-center text-ink-muted">…</p></Shell>
  if (account.data && !editing && needsTermsAcceptance(account.data)) {
    return <Shell><TermsGate onAccepted={() => void qc.invalidateQueries({ queryKey: ['network', 'account'] })} /></Shell>
  }
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

  // The client's notices from every clinic, newest first (sql/142); the Network keeps none of them.
  const allNotices: NoticeRow[] = live
    .flatMap(c => (overviewOf(c)?.notices ?? []).map(n => ({ ...n, conn: c })))
    .sort((x, y) => y.created_at.localeCompare(x.created_at))
  const unread = allNotices.filter(n => !n.read_at).length
  const apiOf = (c: LiveConn) => {
    const session = overviewOf(c)?.session
    return session ? clinicApi(c.clinic_id, c.clinic.api_url, session.session) : null
  }
  const openNotice = (n: NoticeRow) => {
    setBell(false)
    void apiOf(n.conn)?.readNotices([n.id]).catch(() => 0).then(() => qc.invalidateQueries({ queryKey: ['network', 'overview', n.conn.clinic_id] }))
    setScreen({ name: 'clinic', conn: n.conn, orderId: n.order_id ?? undefined })
  }
  const readAll = () => {
    for (const c of live) if ((overviewOf(c)?.notices ?? []).some(n => !n.read_at)) void apiOf(c)?.readNotices().catch(() => 0)
    void qc.invalidateQueries({ queryKey: ['network', 'overview'] })
  }

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
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => { setBell(b => !b); setMenu(false) }} aria-expanded={bell}
                aria-label={unread > 0 ? t('network.noticesUnread', { n: unread }) : t('network.notices')}
                className="relative flex h-10 w-10 items-center justify-center rounded-full bg-white/20">
                <Bell size={18} aria-hidden="true" />
                {unread > 0 && <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[11px] font-bold">{unread > 99 ? '99+' : unread}</span>}
              </button>
              <button type="button" onClick={() => { setMenu(m => !m); setBell(false) }} aria-expanded={menu} aria-label={t('network.accountMenu')}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20 text-sm font-bold">{initials(a.display_name)}</button>
            </div>
            {bell && <NoticeList notices={allNotices} onOpen={openNotice} onReadAll={readAll} />}
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
              {(o?.notices ?? []).some(x => !x.read_at) && (
                <span className="rounded-full bg-rose-500 px-2 py-1 text-xs font-bold text-white">
                  {t('network.nNew', { n: (o?.notices ?? []).filter(x => !x.read_at).length })}</span>
              )}
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

type NoticeRow = ClientNotice & { conn: LiveConn }

/** What a notice says: what happened, on which order, at which clinic. Never a message's text. */
export function noticeText(n: Pick<ClientNotice, 'kind' | 'ref' | 'reason'>, clinic: string): string {
  const ref = n.ref ?? ''
  switch (n.kind) {
    case 'message': return t('network.noticeMessage', { ref, clinic })
    case 'accepted': return t('network.noticeAccepted', { ref, clinic })
    case 'rejected': return n.reason ? t('network.noticeRejectedWhy', { ref, clinic, reason: n.reason }) : t('network.noticeRejected', { ref, clinic })
    case 'ready': return t('network.noticeReady', { ref, clinic })
    case 'sent': return t('network.noticeSent', { ref, clinic })
    case 'connected': return t('network.noticeConnected', { clinic })
    case 'declined': return t('network.noticeDeclined', { clinic })
    // sql/145
    case 'received_reminder': return t('network.noticeDidItArrive', { ref, clinic })
    case 'problem_resolved': return t('network.noticeProblemResolved', { ref, clinic })
    // sql/146: the clinic deleted the job (with its reason), or restored it.
    case 'cancelled': return n.reason ? t('network.noticeCancelledWhy', { ref, clinic, reason: n.reason }) : t('network.noticeCancelled', { ref, clinic })
    case 'reinstated': return t('network.noticeReinstated', { ref, clinic })
    // sql/153: the clinic's price, to approve or decline.
    case 'quoted': return t('network.noticeQuoted', { ref, clinic, price: n.reason ?? '' })
  }
}

function NoticeList({ notices, onOpen, onReadAll }: { notices: NoticeRow[]; onOpen: (n: NoticeRow) => void; onReadAll: () => void }) {
  return (
    <div className="absolute right-0 top-12 z-50 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl bg-bg-card text-ink shadow-lg" role="dialog" aria-label={t('network.notices')}>
      <div className="flex items-center px-4 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-ink-muted">{t('network.notices')}</span>
        {notices.some(n => !n.read_at) && (
          <button type="button" onClick={onReadAll} className="ml-auto text-xs font-semibold text-accent">{t('network.markAllRead')}</button>
        )}
      </div>
      {notices.length === 0
        ? <p className="px-4 pb-4 text-sm text-ink-muted">{t('network.noNotices')}</p>
        : (
          <ul className="max-h-96 overflow-y-auto">
            {notices.map(n => (
              <li key={`${n.conn.clinic_id}:${n.id}`}>
                <button type="button" onClick={() => onOpen(n)}
                  className={`w-full px-4 py-3 text-left text-sm hover:bg-bg-sidebar ${n.read_at ? 'text-ink-muted' : 'font-semibold text-ink'}`}>
                  {noticeText(n, n.conn.clinic.name)}
                  <span className="block text-xs font-normal text-ink-muted">{format(new Date(n.created_at), 'd MMM HH:mm', { locale: dateLocale })}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
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
  // Opening an order marks what it was told about it read (sql/142).
  const qcClinic = useQueryClient()
  useEffect(() => {
    if (!api || !openOrder) return
    void (async () => {
      const notices = await api.notices()
      const ids = notices.filter(n => n.order_id === openOrder && !n.read_at).map(n => n.id)
      if (ids.length) {
        await api.readNotices(ids).catch(() => 0)
        void qcClinic.invalidateQueries({ queryKey: ['network', 'overview', conn.clinic_id] })
      }
    })()
  }, [api, openOrder]) // eslint-disable-line react-hooks/exhaustive-deps

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
      <NewOrder api={api} clinicId={conn.clinic_id} clinicName={conn.clinic.name}
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
  sent: 'bg-emerald-600 text-white', arrived: 'bg-emerald-800 text-white', problem: 'bg-rose-600 text-white', rejected: 'bg-rose-500/15 text-rose-700',
  cancelled: 'bg-ink-faint/25 text-ink',
}
/** 'received' is the clinic having the order (New); 'arrived' is the client having the work (Received, sql/145). */
const statusLabel = (s: ClientOrderStatus): string =>
  s === 'received' ? t('network.statusReceived') : s === 'in_progress' ? t('network.statusInProgress')
    : s === 'ready' ? t('network.statusReady') : s === 'sent' ? t('network.statusSent')
    : s === 'arrived' ? t('network.statusArrived') : s === 'problem' ? t('network.statusProblem')
    : s === 'cancelled' ? t('network.statusCancelled') : t('network.statusRejected')

/** My orders' tabs (sql/145): everything, or one status. */
const MY_TABS: readonly ('all' | ClientOrderStatus)[] = ['all', 'received', 'in_progress', 'ready', 'sent', 'arrived', 'problem', 'rejected', 'cancelled']
const myTabLabel = (k: 'all' | ClientOrderStatus): string => (k === 'all' ? t('network.tabAll') : k === 'received' ? t('network.tabNew') : statusLabel(k))

function StatusBadge({ status }: { status: ClientOrderStatus }) {
  return <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLE[status]}`}>{statusLabel(status)}</span>
}

/** A work type's picture in the clinic's catalogue: by its name, as the desktop's new-job form finds it. */
function TypeArt({ name, size }: { name: string; size: number }) {
  return <WorkTypeArt size={size} iconSize={Math.round(size * 0.6)} type={{ nimi: name, match: [] }} />
}

function MyOrders({ api, clinicId, onOpen }: { api: Api; clinicId: string; onOpen: (id: string) => void }) {
  const orders = useQuery<ClientOrderSummary[]>({ queryKey: ['network', 'orders', clinicId], queryFn: api.orders, refetchInterval: 60_000 })
  const [tab, setTab] = useState<'all' | ClientOrderStatus>('all')
  if (orders.error) return <p className="text-base text-rose-600">{errorText(orders.error)}</p>
  const all = orders.data ?? []
  if (all.length === 0) return <p className="card p-5 text-base text-ink-muted">{t('network.noOrders')}</p>
  const count = (k: 'all' | ClientOrderStatus) => (k === 'all' ? all.length : all.filter(o => o.status === k).length)
  const shown = tab === 'all' ? all : all.filter(o => o.status === tab)
  return (
    <div className="space-y-2">
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="tablist" aria-label={t('network.myOrders')}>
        {MY_TABS.filter(k => k === 'all' || k === tab || count(k) > 0).map(k => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`min-h-10 shrink-0 rounded-full px-3 text-sm ${tab === k ? 'bg-accent font-bold text-white'
              : k === 'problem' ? 'border-2 border-rose-400 font-semibold text-rose-700' : 'border border-ink-faint/30 bg-bg-card'}`}>
            {myTabLabel(k)} · {count(k)}
          </button>
        ))}
      </div>
      {shown.length === 0 && <p className="card p-4 text-base text-ink-muted">{t('network.tabEmpty')}</p>}
      {shown.map(o => (
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
function NewOrder({ api, clinicId, clinicName, withClinicStep, onLeave, onSent }: {
  api: Api; clinicId: string; clinicName: string; withClinicStep: boolean; onLeave: () => void; onSent: (id: string) => void
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
  // sql/153: "Other / custom request": the client's own title and description, quoted by the clinic.
  const [custom, setCustom] = useState(false)
  // The clinic's next reference (sql/140), filled in once; the client may write its own instead.
  const nextRef = useQuery<string>({ queryKey: ['network', 'next_ref', clinicId], queryFn: api.nextRef, staleTime: 0, retry: false })
  const autoRef = nextRef.data ?? null
  useEffect(() => {
    if (autoRef) setOrder(o => (o.patient_ref === '' ? { ...o, patient_ref: autoRef } : o))
  }, [autoRef])
  const item = custom ? undefined : (catalog.data ?? []).find(c => c.name === order.work_type)
  const today = new Date().toISOString().slice(0, 10)
  const problems = orderProblems(custom ? { ...order, version: 2, implants: '', abutment: null, custom: true } : order, catalog.data, today)
  const needsTeeth = custom || (!!item && item.teeth !== 'none')
  const workOk = custom
    ? order.work_type.trim().length > 0 && order.work_type.trim().length <= 80 && !problems.includes('teeth')
    : !!item && !problems.some(p => WORK_PROBLEMS.has(p)) && (!needsTeeth || order.teeth !== '')
  // What it comes to at the prices shown (sql/153), or that the clinic will send a price to approve.
  // Prices are shown where the catalogue has them: the clinic decides there, on every call, whether this
  // client sees prices. The session's own copy of its rights can be hours old (the "Prices" fix, 2026-11-28).
  const estimate = !custom ? catalogueEstimate(item, order.teeth, order.options) : null
  const quoted = custom || item?.price_form === 'request'
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
      const id = await api.newOrder(wireOrder(order, { implants, abutmentAll, abutmentTeeth, custom }, v2))
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
                    setCustom(false)
                    if (c.name === order.work_type && !custom) return
                    const keep = c.teeth === 'none' ? '' : order.teeth
                    set({ work_type: c.name, options: {}, teeth: keep })
                    // Implants follow the new work's own rule: built on implants, its teeth are implants at once.
                    const r = catalogueRules(c)
                    setImplants(r.implantBased && r.toothMode === 'tooth' ? parseTeeth(keep) : [])
                  }}
                  className={`flex flex-col items-center gap-1.5 rounded-2xl bg-bg-card px-1.5 py-2.5 ${on ? 'border-2 border-accent' : 'border border-ink-faint/30'}`}>
                  <TypeArt name={c.name} size={44} />
                  <span className={`text-center text-xs leading-tight ${on ? 'font-bold' : ''}`}>{c.name}</span>
                  {catalogPriceText(c) && <span className="text-xs text-ink-muted">{catalogPriceText(c)}</span>}
                </button>
              )
            })}
            {/* sql/153: anything the catalogue does not have: described, the clinic sends a price to approve. */}
            {v2 && (
              <button type="button" aria-pressed={custom}
                onClick={() => { if (!custom) { setCustom(true); set({ work_type: '', options: {} }); setImplants([]) } }}
                className={`flex flex-col items-center justify-center gap-1.5 rounded-2xl bg-bg-card px-1.5 py-2.5 ${custom ? 'border-2 border-accent' : 'border border-dashed border-ink-faint/50'}`}>
                <Plus size={28} className="text-accent" aria-hidden="true" />
                <span className={`text-center text-xs leading-tight ${custom ? 'font-bold' : ''}`}>{t('network.customRequest')}</span>
              </button>
            )}
          </div>
          {custom && (
            <div className="card space-y-2 rounded-2xl p-3">
              <label className="block"><span className="label">{t('network.customTitle')}</span>
                <input className="input h-12 text-base" maxLength={80} value={order.work_type} onChange={e => set({ work_type: e.target.value })} /></label>
              <p className="text-sm text-ink-muted">{t('network.customHelp')}</p>
            </div>
          )}
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
                      {/* sql/153: its price for this client, as the type's own price shows. */}
                      {op.price ? <span className="ml-1 text-xs text-ink-muted">+{priceAmount(op.price)} €{op.unit === 'hammas' ? ` / ${t('network.perTooth')}` : ''}</span> : null}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}

          {needsTeeth && (
            <TeethPicker value={order.teeth} implants={implants} arch={item?.teeth === 'arch'} workType={order.work_type}
              canMarkImplants={v2 && !custom} autoImplants={!custom && !!rules?.implantBased && rules.toothMode === 'tooth'}
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
            <label className="block sm:col-span-2"><span className="label">{custom ? t('network.customDescription') : t('network.notes')}</span>
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
            {/* sql/153: what it comes to at the prices shown, or that a price comes to approve first. */}
            {quoted
              ? <p className="rounded-xl bg-accent/10 p-3 text-sm text-ink">{t('network.priceToApprove')}</p>
              : estimate && <p className="text-base font-semibold">{estimate.from ? t('network.estimateFrom', { price: money(estimate.amount) }) : t('network.estimate', { price: money(estimate.amount) })}</p>}
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

/**
 * The order's conversation, as the client sees it (sql/138, 143): messages
 * both ways with their files (a picture is a preview, a tap opens it large;
 * a scan or a PDF is an icon and a name), files sent with the order, and the
 * clinic's "Needs your review" with Approve and Request changes (a comment
 * is required). Every file comes through the clinic's network-client: only
 * this client's own order, a short link signed by the clinic.
 */
function ClientThread({ api, orderId, clinicName, detail, onError }: {
  api: Api; orderId: string; clinicName: string; detail: UseQueryResult<ClientOrderDetail>; onError: (e: string | null) => void
}) {
  const d = detail.data!
  const messages = (d.messages ?? []) as ThreadMessage[]
  const { messages: items, orderFiles } = threadItems(messages, (d.files ?? []) as ThreadFile[])
  const [large, setLarge] = useState<{ url: string; name: string } | null>(null)
  const [text, setText] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [changesFor, setChangesFor] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  // Folds: open by itself with unread messages from the clinic, else as the client left it (this device).
  const fold = useThreadFold('network', orderId, 'client', messages, true)
  const open = async (f: ThreadFile) => {
    try {
      const { url } = await api.download(f.id, f.file_name)
      if (isImageFile(f)) setLarge({ url, name: f.file_name })
      else window.open(url, '_blank', 'noopener')
    } catch (e) { onError(errorText(e)) }
  }
  async function send() {
    setBusy(true); onError(null)
    try {
      const id = await api.message(orderId, text.trim())
      for (const f of files) await api.messageUpload(id, f)
      setText(''); setFiles([])
      void detail.refetch()
    } catch (e) { onError(errorText(e)) } finally { setBusy(false) }
  }
  async function review(messageId: string, decision: 'approved' | 'changes') {
    if (decision === 'changes' && !comment.trim()) return
    setBusy(true); onError(null)
    try {
      await api.review(messageId, decision, decision === 'changes' ? comment.trim() : undefined)
      setChangesFor(null); setComment('')
      void detail.refetch()
    } catch (e) { onError(errorText(e)) } finally { setBusy(false) }
  }

  return (
    <>
      {orderFiles.length > 0 && (
        <div className="card space-y-2 rounded-2xl p-4">
          <p className="text-sm font-bold">{t('network.files')}</p>
          <ClientFiles api={api} files={orderFiles} onOpen={open} />
        </div>
      )}
      {d.messages && (
        <div className="card space-y-2.5 rounded-2xl p-4">
          <ThreadHeader compact count={messages.length} last={newestAt(messages)} unread={fold.unread} open={fold.open} onToggle={fold.toggle} />
          {fold.open && <>
          {items.map(m => {
            // sql/144, 145: the client's own fit and delivery answers, and the clinic's resolution of a problem.
            if (m.delivery_state || m.fit_state) {
              const mine = m.from_client
              const title = m.delivery_state === 'received' ? t('network.youSaidReceived')
                : m.delivery_state === 'problem' ? t('network.youReportedProblem', { reason: problemReasonText(m.delivery_reason ?? '') })
                : m.delivery_state === 'resolved' ? t('network.clinicResolved', { clinic: clinicName, resolution: resolutionText(m.delivery_reason ?? '') })
                : m.fit_state === 'fitted' ? t('network.youSaidFitted') : t('network.youAskedAdjustment')
              const tone = m.delivery_state === 'problem' ? 'bg-rose-600 text-white' : m.delivery_state === 'resolved' ? 'bg-bg-sidebar' : m.fit_state === 'adjust' ? 'bg-amber-500 text-white' : 'bg-emerald-600 text-white'
              return (
                <div key={m.id} className={`max-w-[80%] space-y-2 rounded-2xl px-3 py-2 text-sm ${mine ? 'ml-auto rounded-br-md' : 'rounded-bl-md'} ${tone}`}>
                  <p className="font-semibold">{title}</p>
                  {m.body !== '✓' && <p className="whitespace-pre-wrap">{m.body}</p>}
                  {m.files.length > 0 && <ClientFiles api={api} files={m.files} onOpen={open} />}
                  <p className={`text-[11px] ${mine ? 'text-white/80' : 'text-ink-muted'}`}>{format(new Date(m.created_at), 'd MMM HH:mm', { locale: dateLocale })}</p>
                </div>
              )
            }
            if (m.review_of && m.review_state) {
              return (
                <div key={m.id} className={`ml-auto max-w-[80%] rounded-2xl rounded-br-md px-3 py-2 text-sm ${m.review_state === 'approved' ? 'bg-emerald-600 text-white' : 'bg-amber-500 text-white'}`}>
                  <p className="font-semibold">{m.review_state === 'approved' ? t('network.youApproved') : t('network.youAskedChanges')}</p>
                  {m.body !== '✓' && <p className="whitespace-pre-wrap">{m.body}</p>}
                  <p className="mt-1 text-[11px] text-white/80">{format(new Date(m.created_at), 'HH:mm', { locale: dateLocale })}</p>
                </div>
              )
            }
            const answer = m.needs_review ? reviewAnswer(m.id, messages) : null
            return (
              <div key={m.id} className={`max-w-[80%] space-y-2 px-3 py-2 text-sm ${m.from_client
                ? 'ml-auto rounded-2xl rounded-br-md bg-accent text-white'
                : 'rounded-2xl rounded-bl-md bg-bg-sidebar'}`}>
                <p className="whitespace-pre-wrap">{m.body}</p>
                {m.files.length > 0 && <ClientFiles api={api} files={m.files} onOpen={open} />}
                {m.needs_review && !m.from_client && !answer && (
                  changesFor === m.id ? (
                    <div className="space-y-2">
                      <textarea className="input min-h-16 w-full text-base" maxLength={4000} autoFocus value={comment}
                        onChange={e => setComment(e.target.value)} placeholder={t('network.whatToChange')} aria-label={t('network.whatToChange')} />
                      <div className="flex gap-2">
                        <button type="button" onClick={() => { setChangesFor(null); setComment('') }} className="min-h-10 flex-1 rounded-xl border border-ink-faint/40 bg-bg-card text-sm">{t('network.backStep')}</button>
                        <button type="button" disabled={busy || !comment.trim()} onClick={() => void review(m.id, 'changes')} className="btn-primary min-h-10 flex-1 justify-center rounded-xl text-sm">{t('network.sendChanges')}</button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <button type="button" disabled={busy} onClick={() => void review(m.id, 'approved')} className="btn-primary min-h-10 justify-center rounded-xl px-4 text-sm">{t('network.approve')}</button>
                      <button type="button" disabled={busy} onClick={() => setChangesFor(m.id)} className="min-h-10 rounded-xl border border-ink-faint/40 bg-bg-card px-4 text-sm">{t('network.requestChanges')}</button>
                    </div>
                  )
                )}
                {m.needs_review && answer && (
                  <p className="text-xs font-semibold">{answer.review_state === 'approved' ? t('network.youApproved') : t('network.youAskedChanges')}</p>
                )}
                <p className={`text-[11px] ${m.from_client ? 'text-white/80' : 'text-ink-muted'}`}>
                  {m.from_client ? '' : `${clinicName} · `}{format(new Date(m.created_at), 'HH:mm', { locale: dateLocale })}</p>
              </div>
            )
          })}
          {files.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {files.map((f, i) => (
                <li key={`${f.name}:${i}`} className="flex items-center gap-1 rounded-lg bg-accent/5 px-2 py-1 text-xs">
                  <span className="max-w-[9rem] truncate">{f.name}</span>
                  <button type="button" aria-label={t('network.removeFile', { name: f.name })} onClick={() => setFiles(list => list.filter((_, j) => j !== i))}
                    className="rounded p-1 text-ink-muted"><X size={14} aria-hidden="true" /></button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <label className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-ink-faint/40" aria-label={t('network.attachFiles')}>
              <Paperclip size={18} aria-hidden="true" />
              <input type="file" multiple className="hidden" onChange={e => setFiles(f => [...f, ...(e.target.files ?? [])].slice(0, 20))} />
            </label>
            <input className="input h-11 flex-1 rounded-xl text-base" maxLength={4000} value={text} onChange={e => setText(e.target.value)} placeholder={t('network.writeMessage')} />
            <button type="button" disabled={busy || !text.trim()} aria-label={t('network.send')} className="btn-primary h-11 w-11 justify-center rounded-xl p-0" onClick={() => void send()}>
              <Send size={18} aria-hidden="true" />
            </button>
          </div>
          </>}
        </div>
      )}
      {large && (
        <div role="dialog" aria-modal="true" aria-label={large.name} className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 p-3" onClick={() => setLarge(null)}>
          <img src={large.url} alt={large.name} className="max-h-full max-w-full rounded-lg object-contain" />
          <button type="button" aria-label={t('network.close')} className="absolute right-3 top-3 h-11 w-11 rounded-full bg-white/20 text-white"><X size={22} className="mx-auto" /></button>
        </div>
      )}
    </>
  )
}

/** Files of the client's own order: a picture as a preview (its short link), anything else an icon and its name. */
function ClientFiles({ api, files, onOpen }: { api: Api; files: ThreadFile[]; onOpen: (f: ThreadFile) => void }) {
  return (
    <ul className="flex flex-wrap gap-2">
      {files.map(f => (
        <li key={f.id}>
          {isImageFile(f) ? <ClientImage api={api} file={f} onOpen={onOpen} /> : (
            <button type="button" onClick={() => onOpen(f)} className="flex h-12 items-center gap-2 rounded-xl border border-ink-faint/30 bg-bg-card px-2 text-left text-xs text-ink">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-[10px] font-bold text-accent">{fileBadge(f.file_name) || <Paperclip size={14} aria-hidden="true" />}</span>
              <span className="max-w-[9rem] truncate">{f.file_name}</span>
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}

function ClientImage({ api, file, onOpen }: { api: Api; file: ThreadFile; onOpen: (f: ThreadFile) => void }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let stale = false
    api.download(file.id, file.file_name).then(r => { if (!stale) setUrl(r.url) }).catch(() => { /* the badge stays */ })
    return () => { stale = true }
  }, [api, file.id, file.file_name])
  return (
    <button type="button" onClick={() => onOpen(file)} aria-label={file.file_name} title={file.file_name}
      className="block h-20 w-20 overflow-hidden rounded-xl border border-ink-faint/30 bg-bg-card">
      {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : <span className="text-[10px] font-bold text-ink-muted">{fileBadge(file.file_name)}</span>}
    </button>
  )
}

/**
 * After the work is sent (sql/144, the clinic's module `ratings`): "Fitted"
 * or "Needs adjustment" (a reason, a text, photos if any: the clinic makes a
 * remake), and an optional 1–5 rating of the clinic with a comment. What the
 * client already said is shown; it stays in the clinic's database.
 */
function ClientFeedback({ api, orderId, clinicName, onDone }: { api: Api; orderId: string; clinicName: string; onDone: () => void }) {
  const fb = useQuery<OrderFeedback>({ queryKey: ['network', 'feedback', orderId], queryFn: () => api.feedback(orderId) })
  const [adjusting, setAdjusting] = useState(false)
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [photos, setPhotos] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const data = fb.data
  if (!data?.enabled) return null

  async function fit(decision: 'fitted' | 'adjust') {
    setBusy(true); setError(null)
    try {
      const msg = await api.fit(orderId, decision, reason || undefined, note.trim() || undefined)
      for (const f of photos) await api.messageUpload(msg, f)
      setAdjusting(false); setReason(''); setNote(''); setPhotos([])
      void fb.refetch(); onDone()
    } catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }

  return (
    <div className="card space-y-3 rounded-2xl p-4">
      <p className="text-sm font-bold">{t('network.howDidItFit')}</p>
      {data.fit && (
        <p className={`text-sm font-semibold ${data.fit.decision === 'fitted' ? 'text-emerald-700' : 'text-amber-700'}`}>
          {data.fit.decision === 'fitted' ? t('network.youSaidFitted') : t('network.youAskedAdjustment')}</p>
      )}
      {!adjusting ? (
        <div className="flex flex-wrap gap-2">
          {data.fit?.decision !== 'fitted' && (
            <button type="button" disabled={busy} onClick={() => void fit('fitted')} className="btn-primary min-h-11 justify-center rounded-xl px-4 text-sm">
              <Check size={16} aria-hidden="true" /> {t('feedback.fitted')}</button>
          )}
          <button type="button" disabled={busy} onClick={() => setAdjusting(true)} className="min-h-11 rounded-xl border border-ink-faint/40 bg-bg-card px-4 text-sm">{t('feedback.needsAdjustment')}</button>
        </div>
      ) : (
        <div className="space-y-2">
          <AdjustFields reason={reason} note={note} onReason={setReason} onNote={setNote} />
          <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-dashed border-ink-faint px-3 text-sm text-ink-soft">
            <Paperclip size={16} aria-hidden="true" /> {photos.length ? t('network.filesChosen', { n: photos.length }) : t('network.addPhotos')}
            <input type="file" multiple accept="image/*,.pdf,.stl" className="hidden" onChange={e => setPhotos([...(e.target.files ?? [])].slice(0, 20))} />
          </label>
          <p className="text-xs text-ink-muted">{t('network.adjustMakesRemake', { clinic: clinicName })}</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setAdjusting(false)} className="min-h-11 flex-1 rounded-xl border border-ink-faint/40 bg-bg-card text-sm">{t('network.backStep')}</button>
            <button type="button" disabled={busy || !reason || !note.trim()} onClick={() => void fit('adjust')} className="btn-primary min-h-11 flex-1 justify-center rounded-xl text-sm">{t('feedback.sendAdjustment')}</button>
          </div>
        </div>
      )}
      {/* Made only once what the client gave before has loaded, so the form shows it (sql/146). */}
      <ClinicRating key={data.rating?.updated_at ?? 'none'} clinicName={clinicName} current={data.rating}
        onSave={async (score, comment) => { await api.rateClinic(orderId, score, comment ?? undefined); await fb.refetch() }} />
      {error && <p className="text-sm text-rose-600" role="alert">{error}</p>}
    </div>
  )
}

/**
 * After the work is sent (sql/145): "Received ✓", or "Problem with delivery"
 * (a reason, what happened, photos if any). The clinic hears a problem at
 * once and the order shows it until the clinic resolves it; Received can
 * still be said then (the resent work arrived). No `ratings` module needed.
 */
function ClientDelivery({ api, orderId, clinicName, status, onDone }: { api: Api; orderId: string; clinicName: string; status: 'sent' | 'problem'; onDone: () => void }) {
  const fb = useQuery<OrderFeedback>({ queryKey: ['network', 'feedback', orderId], queryFn: () => api.feedback(orderId) })
  const [reporting, setReporting] = useState(false)
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [photos, setPhotos] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const problem = fb.data?.problem && !fb.data.problem.resolved_at ? fb.data.problem : null

  async function received() {
    if (!(await confirmDialog({ message: t('network.receivedAsk', { clinic: clinicName }), confirmLabel: t('delivery.received') }))) return
    setBusy(true); setError(null)
    try { await api.received(orderId); void fb.refetch(); onDone() }
    catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }
  async function report() {
    setBusy(true); setError(null)
    try {
      const msg = await api.reportProblem(orderId, reason, note.trim())
      for (const f of photos) await api.messageUpload(msg, f)
      setReporting(false); setReason(''); setNote(''); setPhotos([])
      void fb.refetch(); onDone()
    } catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }

  return (
    <div className={`card space-y-3 rounded-2xl p-4 ${status === 'problem' ? 'border-2 border-rose-300' : ''}`}>
      <p className="text-sm font-bold">{status === 'problem' ? t('network.problemOpen') : t('network.didItArrive')}</p>
      {problem && (
        <p className="text-sm text-rose-700">{t('network.problemReported', { reason: problemReasonText(problem.reason), clinic: clinicName })}</p>
      )}
      {!reporting ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => void received()} className="btn-primary min-h-11 justify-center rounded-xl px-4 text-sm">
            <Check size={16} aria-hidden="true" /> {t('delivery.received')}</button>
          {status === 'sent' && (
            <button type="button" disabled={busy} onClick={() => setReporting(true)} className="min-h-11 rounded-xl border border-ink-faint/40 bg-bg-card px-4 text-sm">{t('delivery.problem')}</button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <ProblemFields reason={reason} note={note} onReason={setReason} onNote={setNote} />
          <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-dashed border-ink-faint px-3 text-sm text-ink-soft">
            <Paperclip size={16} aria-hidden="true" /> {photos.length ? t('network.filesChosen', { n: photos.length }) : t('network.addPhotos')}
            <input type="file" multiple accept="image/*,.pdf,.stl" className="hidden" onChange={e => setPhotos([...(e.target.files ?? [])].slice(0, 20))} />
          </label>
          <p className="text-xs text-ink-muted">{t('network.problemTells', { clinic: clinicName })}</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setReporting(false)} className="min-h-11 flex-1 rounded-xl border border-ink-faint/40 bg-bg-card text-sm">{t('network.backStep')}</button>
            <button type="button" disabled={busy || !reason || !note.trim()} onClick={() => void report()} className="btn-primary min-h-11 flex-1 justify-center rounded-xl text-sm">{t('delivery.sendProblem')}</button>
          </div>
        </div>
      )}
      {error && <p className="text-sm text-rose-600" role="alert">{error}</p>}
    </div>
  )
}

/** The client's 1–5 of the clinic: what it gave before, changed at any time (one row, sql/146). */
export function ClinicRating({ clinicName, current, onSave }: {
  clinicName: string
  current: OrderFeedback['rating']
  onSave: (score: number, comment: string | null) => Promise<void>
}) {
  const [score, setScore] = useState<number | null>(current?.score ?? null)
  const [comment, setComment] = useState(current?.comment ?? '')
  const [state, setState] = useState<'idle' | 'busy' | 'saved' | { error: string }>('idle')
  const changed = !!current?.updated_at && !!current.created_at && current.updated_at.slice(0, 19) !== current.created_at.slice(0, 19)
  async function save() {
    if (score === null) return
    setState('busy')
    try { await onSave(score, comment.trim() || null); setState('saved') } catch (e) { setState({ error: errorText(e) }) }
  }
  return (
    <div className="space-y-2 border-t border-ink-faint/15 pt-3">
      <p className="text-sm font-semibold">{t('network.rateClinic', { clinic: clinicName })} <span className="font-normal text-ink-muted">({t('feedback.optional')})</span></p>
      {current && <p className="text-xs text-ink-muted">{changed
        ? t('feedback.changedOn', { date: format(new Date(current.updated_at!), 'd MMM yyyy', { locale: dateLocale }) })
        : t('feedback.canChange')}</p>}
      <Stars value={score} onChange={n => { setScore(n); setState('idle') }} label={t('network.rateClinic', { clinic: clinicName })} />
      <div className="flex gap-2">
        <input className="input h-11 flex-1 rounded-xl text-base" maxLength={1000} value={comment} onChange={e => { setComment(e.target.value); setState('idle') }} placeholder={t('feedback.comment')} aria-label={t('feedback.comment')} />
        <button type="button" disabled={state === 'busy' || score === null} onClick={() => void save()} className="btn-primary h-11 rounded-xl px-4 text-sm">{state === 'saved' ? t('feedback.saved') : t('feedback.save')}</button>
      </div>
      {typeof state === 'object' && <p className="text-sm text-rose-600" role="alert">{state.error}</p>}
    </div>
  )
}

/** The steps an order goes through as the client sees them; a date only where Wivo has one. */
const PROGRESS: { key: 'received' | 'accepted' | 'production' | 'ready' | 'sent' | 'arrived'; label: () => string }[] = [
  { key: 'received', label: () => t('network.progressReceived') },
  { key: 'accepted', label: () => t('network.progressAccepted') },
  { key: 'production', label: () => t('network.progressProduction') },
  { key: 'ready', label: () => t('network.progressReady') },
  { key: 'sent', label: () => t('network.progressSent') },
  { key: 'arrived', label: () => t('network.progressArrived') },
]
/** How far an order is along PROGRESS: the index of its current step. A delivery problem stays at Sent. */
export const progressIndex = (s: Exclude<ClientOrderStatus, 'rejected' | 'cancelled'>): number =>
  s === 'received' ? 0 : s === 'in_progress' ? 2 : s === 'ready' ? 3 : s === 'arrived' ? 5 : 4

function OrderScreen({ api, clinicId, clinicName, orderId, detail }: {
  api: Api; clinicId: string; clinicName: string; orderId: string; detail: UseQueryResult<ClientOrderDetail>
}) {
  const catalog = useQuery<CatalogueItem[]>({ queryKey: ['network', 'catalog', clinicId], queryFn: api.catalog })
  const [error, setError] = useState<string | null>(null)
  const d = detail.data
  if (detail.error) return <p className="text-base text-rose-600">{errorText(detail.error)}</p>
  if (!d) return <p className="py-10 text-center text-ink-muted">…</p>
  const p = d.payload
  const item = (catalog.data ?? []).find(c => c.name === p.work_type)
  const options = chosenOptionLabels(p.options, (key, id) => item?.groups.find(g => g.key === key)?.options.find(o => o.id === id)?.name)
  const teeth = teethLabel(p.teeth)
  const at = d.status === 'rejected' || d.status === 'cancelled' ? -1 : progressIndex(d.status)

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
        : d.status === 'cancelled'
        ? <p className="rounded-2xl bg-rose-500/10 p-4 text-base text-rose-700">{d.cancel_reason ? t('network.cancelledBecause', { clinic: clinicName, reason: d.cancel_reason }) : t('network.cancelledNoReason', { clinic: clinicName })}</p>
        : (
          <div className="card space-y-3 rounded-2xl p-4">
            <p className="text-sm font-bold">{t('network.progress')}</p>
            {PROGRESS.map((s, i) => {
              const done = i < at || i === 0 || (i === at && (d.status === 'sent' || d.status === 'problem' || d.status === 'arrived'))
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

      {/* sql/153: the price and its state; a price to approve, with Approve / Decline. */}
      <OrderPrice api={api} orderId={orderId} detail={d} onDone={() => void detail.refetch()} onError={setError} />

      {(d.status === 'sent' || d.status === 'problem') && <ClientDelivery api={api} orderId={orderId} clinicName={clinicName} status={d.status} onDone={() => void detail.refetch()} />}
      {d.status === 'arrived' && <ClientFeedback api={api} orderId={orderId} clinicName={clinicName} onDone={() => void detail.refetch()} />}
      <ClientThread api={api} orderId={orderId} clinicName={clinicName} detail={detail} onError={setError} />
      {error && <p className="text-base text-rose-600">{error}</p>}
    </div>
  )
}

// ── Prices (sql/153) ────────────────────────────────────────────────────────

const money = priceAmount

/** A work type's price as the catalogue shows it to this client, in the client's language (lib/orderView cataloguePriceText). */
const catalogPriceText = (c: CatalogueItem): string => cataloguePriceText(c, {
  perTooth: t('network.perTooth'), from: price => t('network.priceFrom', { price }), onRequest: t('network.priceOnRequest'),
})

/** The order's price and its state; the clinic's price to approve or decline. */
function OrderPrice({ api, orderId, detail, onDone, onError }: {
  api: Api; orderId: string; detail: ClientOrderDetail; onDone: () => void; onError: (e: string | null) => void
}) {
  const [busy, setBusy] = useState(false)
  const s = detail.price_state
  if (!s) return null
  const price = detail.price != null ? `${money(detail.price)} €` : ''
  async function decide(approve: boolean) {
    setBusy(true); onError(null)
    try { await api.priceDecision(orderId, approve); onDone() } catch (e) { onError(errorText(e)) } finally { setBusy(false) }
  }
  return (
    <div className={`card space-y-2 rounded-2xl p-4 ${s === 'quoted' ? 'border-2 border-accent' : ''}`}>
      <p className="text-sm font-bold">{t('network.price')}</p>
      {s === 'estimated' && <p className="text-base">{t('network.priceEstimated', { price })}</p>}
      {s === 'needs_quote' && <p className="text-base text-ink-muted">{t('network.priceWaiting')}</p>}
      {s === 'quoted' && (
        <>
          <p className="text-lg font-bold">{t('network.priceQuoted', { price })}</p>
          <p className="text-sm text-ink-muted">{t('network.priceQuotedHelp')}</p>
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={() => void decide(true)} className="btn-primary min-h-12 flex-1 justify-center rounded-2xl text-base font-bold">
              <Check size={18} aria-hidden="true" /> {t('network.approvePrice')}</button>
            <button type="button" disabled={busy} onClick={() => void decide(false)} className="min-h-12 flex-1 rounded-2xl border border-ink-faint/40 text-base font-semibold">
              {t('network.declinePrice')}</button>
          </div>
        </>
      )}
      {s === 'approved' && <p className="text-base">{t('network.priceApproved', { price })}</p>}
      {s === 'declined' && <p className="text-base text-ink-muted">{t('network.priceDeclined', { price })}</p>}
      {s === 'confirmed' && <p className="text-base">{t('network.priceConfirmed', { price })}</p>}
    </div>
  )
}

// ── Terms of Use and Privacy Notice (lib/legal, docs/legal/) ────────────────

/** "Terms of Use · Privacy Notice", for the footer. Each opens in a new tab, so a form in progress stays. */
function LegalLinks() {
  return (
    <p className="space-x-2">
      <a href={LEGAL_PATHS.terms} target="_blank" rel="noreferrer" className="underline underline-offset-2">{t('network.legalTerms')}</a>
      <span aria-hidden="true">·</span>
      <a href={LEGAL_PATHS.privacy} target="_blank" rel="noreferrer" className="underline underline-offset-2">{t('network.legalPrivacy')}</a>
    </p>
  )
}

/** "I agree to the Terms of Use and have read the Privacy Notice", the two names as links. */
function AgreeCheckbox({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  const link = (doc: LegalDoc, key: number) => (
    <a key={key} href={LEGAL_PATHS[doc]} target="_blank" rel="noreferrer" className="font-medium text-accent underline underline-offset-2">
      {/* The sentence's own forms of the names (Estonian needs a case ending). */}
      {doc === 'terms' ? t('network.legalAgreeTerms') : t('network.legalAgreePrivacy')}
    </a>
  )
  const parts = t('network.legalAgree').split(/(\{terms\}|\{privacy\})/)
  return (
    <label className="flex items-start gap-3 text-base">
      <input type="checkbox" required className="mt-1 h-5 w-5 shrink-0" checked={checked} onChange={e => onChange(e.target.checked)} />
      <span>{parts.map((p, i) => (p === '{terms}' ? link('terms', i) : p === '{privacy}' ? link('privacy', i) : <span key={i}>{p}</span>))}</span>
    </label>
  )
}

/** An account that has not accepted the current version: once, before anything else. */
function TermsGate({ onAccepted }: { onAccepted: () => void }) {
  const [agreed, setAgreed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function accept(e: React.FormEvent) {
    e.preventDefault()
    if (!agreed) return
    setBusy(true); setError(null)
    try { await acceptTerms(TERMS_VERSION); onAccepted() } catch { setError(t('network.errFailed')) } finally { setBusy(false) }
  }
  return (
    <form onSubmit={accept} className="card space-y-4 p-5">
      <h1 className="text-xl font-bold">{t('network.legalUpdatedTitle')}</h1>
      <p className="text-base text-ink-muted">{t('network.legalUpdatedIntro')}</p>
      <AgreeCheckbox checked={agreed} onChange={setAgreed} />
      {error && <p className="text-base text-rose-600">{error}</p>}
      <button type="submit" disabled={!agreed || busy} className={`btn-primary justify-center ${big}`}>{t('network.legalContinue')}</button>
      <button type="button" className="btn-ghost w-full justify-center" onClick={() => void network!.auth.signOut()}>{t('network.signOut')}</button>
    </form>
  )
}

/** /network/terms and /network/privacy: the text from docs/legal/, a Draft banner until LEGAL_PUBLISHED. */
function LegalPage({ doc }: { doc: LegalDoc }) {
  const page = legalPage(doc)
  const other: LegalDoc = doc === 'terms' ? 'privacy' : 'terms'
  return (
    <Shell onBack={() => location.assign('/network')}>
      {!LEGAL_PUBLISHED && (
        <p role="note" className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm font-semibold text-ink">{t('network.legalDraft')}</p>
      )}
      <article className="card space-y-3 p-5">
        <h1 className="text-xl font-bold">{page.title}</h1>
        {page.blocks.map((b, i) => b.kind === 'heading' ? (
          <h2 key={i} className="pt-2 text-base font-semibold text-ink"><RichText text={b.text} /></h2>
        ) : b.kind === 'list' ? (
          <ul key={i} className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-ink-soft">
            {b.items.map((item, j) => <li key={j}><RichText text={item} /></li>)}
          </ul>
        ) : (
          <p key={i} className="text-sm leading-relaxed text-ink-soft"><RichText text={b.text} /></p>
        ))}
      </article>
      <p className="text-center text-sm">
        <a href={LEGAL_PATHS[other]} className="font-medium text-accent underline underline-offset-2">
          {other === 'terms' ? t('network.legalTerms') : t('network.legalPrivacy')}</a>
      </p>
    </Shell>
  )
}
