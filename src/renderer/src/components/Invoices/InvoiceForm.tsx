/**
 * Create an invoice from a client's or a patient's unbilled work
 * (lib/invoiceCandidates: whose work, and the lines each job becomes).
 *
 * The line list is built by COPYING description and price off the job at this
 * moment. It is not a live join: once this document is issued, editing the job's
 * price must not restate what the customer was told to pay.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { startingInvoiceLanguage } from '../../lib/invoiceLanguage'
import { motion } from 'framer-motion'
import { X, Plus, Trash2, Loader2, FileText } from 'lucide-react'
import { format, addDays, parseISO } from 'date-fns'
import type { Job } from '../../types/job'
import { useSettings, priceBookOf } from '../../stores/useSettings'
import { billedKeys, unbilledCandidates, candidateMonths, monthOf, type Candidate } from '../../lib/invoiceCandidates'
import { buyerDetailsMissing } from '../../lib/invoiceBuyer'
import { docLanguageFor, DOC_LANGUAGES, type DocLanguage } from '@shared/billing/countryInvoice'
import { invoiceLabels } from '@shared/billing/invoiceDoc'
import { clinicCountry } from '../../lib/country'
import { useAuth } from '../../context/AuthContext'
import { useCreateInvoice, useInvoices, type CreateInvoiceInput } from '../../hooks/useInvoices'
import { PatientPicker } from '../Patients/PatientPicker'
import { describeError } from '../Patients/errors'
import { useCustomers } from '../../hooks/useCustomers'
import type { BillToKind } from '../../types/customer'
import { toDate } from '../../lib/dates'
import { instalmentSchedule, scheduleProblems } from '@shared/billing/instalments'
import { useCreatePaymentPlan } from '../../hooks/usePaymentPlans'
import { t } from '@/lib/i18n'
import { useHoldRestart } from '../../lib/restartGuard'

interface DraftLine {
  key: string
  job_id: string | null
  revision_id: string | null
  description: string
  qty: number
  unit_price: number
}

interface InvoiceFormProps {
  jobs: Job[]
  initialPatient?: { id: string | null; nimi: string }
  /** Clients → "Invoice unbilled work": the form opens addressed to this client. */
  initialCustomerId?: string | null
  onClose: () => void
  onCreated?: (invoiceId: string) => void
}

export function InvoiceForm({ jobs, initialPatient, initialCustomerId, onClose, onCreated }: InvoiceFormProps) {
  // An update restart waits while an invoice is being written (lib/restartGuard).
  useHoldRestart()
  const { settings } = useSettings()
  const createInvoice = useCreateInvoice()
  const createPlan = useCreatePaymentPlan()
  const { data: invoices = [] } = useInvoices()
  const { data: customers = [] } = useCustomers()

  const [patsient, setPatsient] = useState(initialPatient?.nimi ?? '')
  const [patientId, setPatientId] = useState<string | null>(initialPatient?.id ?? null)
  // Who this document is addressed to. A lab bills the ordering practice; the
  // patient route stays because clinic work and legacy documents both use it.
  const [billTo, setBillTo] = useState<BillToKind>(initialCustomerId ? 'customer' : 'patient')
  const [customerId, setCustomerId] = useState<string | null>(initialCustomerId ?? null)
  const [issueDate, setIssueDate] = useState(() => format(new Date(), 'yyyy-MM-dd'))
  // VAT exempt (sql/148): rate 0 and the reason, printed on the invoice; from the clinic's setting, changeable here.
  const [exempt, setExempt] = useState(settings.kmVaba)
  const [exemptNote, setExemptNote] = useState(settings.kmVabaViide)
  const [vatRate, setVatRate] = useState(settings.kmVaba ? 0 : settings.kmMaar)
  // The date of the service, only when it differs from the invoice date.
  const [serviceDate, setServiceDate] = useState('')
  const { clinic } = useAuth()
  const [note, setNote] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([])
  // Split into equal monthly instalments. Generated up front as real documents
  // rather than as a recurring rule: a desktop app has nothing running when it
  // is closed, so a rule that "fires next month" would simply never fire.
  const [instalments, setInstalments] = useState(1)
  // The plan's own two questions, asked only once the split is more than one.
  const [planDay, setPlanDay] = useState(2)
  const [planTerm, setPlanTerm] = useState(settings.makseTahtaegPaevades)
  const [error, setError] = useState<string | null>(null)

  // Clearing the issue date leaves '' here, and parseISO('') is an Invalid Date
  // that format() throws on — during render, so the whole invoice screen went
  // behind the error boundary instead of showing an empty due date.
  const dueDate = useMemo(() => {
    const d = toDate(issueDate)
    return d ? format(addDays(d, settings.makseTahtaegPaevades), 'yyyy-MM-dd') : ''
  }, [issueDate, settings.makseTahtaegPaevades])

  // Work already on an invoice (not cancelled) is not offered: billing a job twice is
  // the mistake this screen most needs to prevent (lib/invoiceCandidates).
  const billed = useMemo(() => billedKeys(invoices), [invoices])
  // The lines' own words ("teeth", "remake") in the invoice's language (sql/148).
  // The invoice's language (sql/149): the client's, English for a client abroad (suggested), else the
  // clinic's default; changed here for this invoice only, and kept on it.
  const clinicLanguage = docLanguageFor(clinicCountry(clinic), settings.arveKeel)
  const client = billTo === 'customer' ? customers.find(c => c.id === customerId) ?? null : null
  const starting = startingInvoiceLanguage(client, { country: clinicCountry(clinic), defaultLanguage: clinicLanguage })
  const [chosenLanguage, setChosenLanguage] = useState<DocLanguage | null>(null)
  const language: DocLanguage = chosenLanguage ?? starting.language
  // The lines' own words ("teeth", "remake") in that language.
  const words = invoiceLabels(language).line
  const patientKey = patsient.trim().toLowerCase()
  const addresseeChosen = billTo === 'customer' ? !!customerId : !!patientKey
  // WHOSE work depends on the addressee: a client invoice covers everything that
  // client ordered (a Network order's job too), whoever the patients were.
  const candidates = useMemo(
    () => unbilledCandidates(jobs, { billTo, customerId, patientId, patientName: patsient }, billed, priceBookOf(settings), settings.tooValikud, words),
    [jobs, billTo, customerId, patientId, patsient, billed, settings, words],
  )
  const months = useMemo(() => candidateMonths(candidates), [candidates])
  // The language changed: the lines already ticked say the same in the new one (typed lines are left as they are).
  const shownLanguage = useRef(language)
  useEffect(() => {
    if (shownLanguage.current === language) return
    shownLanguage.current = language
    setLines(prev => prev.map(l => {
      const m = /^(.*)#(\d+)$/.exec(l.key)
      const now = m ? candidates.find(c => c.key === m[1])?.lines[Number(m[2])] : undefined
      return now ? { ...l, description: now.description } : l
    }))
  }, [language, candidates])
  // Another addressee: the language starts from theirs again.
  useEffect(() => { setChosenLanguage(null) }, [customerId, billTo])
  const [month, setMonth] = useState<string>('')
  const shownCandidates = month ? candidates.filter(c => monthOf(c.date) === month) : candidates
  const picked = (c: Candidate) => lines.some(l => l.key.startsWith(`${c.key}#`))
  const linesOf = (c: Candidate): DraftLine[] => c.lines.map((l, i) => ({
    key: `${c.key}#${i}`, job_id: c.job_id, revision_id: c.revision_id, description: l.description, qty: 1, unit_price: l.unit_price,
  }))
  const toggle = (c: Candidate) => setLines(prev => (prev.some(l => l.key.startsWith(`${c.key}#`))
    ? prev.filter(l => !l.key.startsWith(`${c.key}#`))
    : [...prev, ...linesOf(c)]))
  // A month's invoice: everything unbilled in the month shown, on this one invoice.
  const pickAll = () => setLines(prev => [...prev, ...shownCandidates.filter(c => !prev.some(l => l.key.startsWith(`${c.key}#`))).flatMap(linesOf)])

  const net = Math.round(lines.reduce((s, l) => s + l.qty * l.unit_price, 0) * 100) / 100
  const vat = exempt ? 0 : Math.round(net * vatRate) / 100
  const gross = Math.round((net + vat) * 100) / 100

  // The plan, laid out exactly as the generator will write it. One source for
  // the preview and the documents, so the screen cannot promise a date or an
  // amount the invoices do not carry.
  const planInput = useMemo(() => ({
    total: gross,
    count: instalments,
    firstIssue: issueDate,
    dayOfMonth: planDay,
    termDays: planTerm,
  }), [gross, instalments, issueDate, planDay, planTerm])
  const planProblems = useMemo(
    () => (instalments > 1 ? scheduleProblems(planInput) : []),
    [instalments, planInput]
  )
  const planPreview = useMemo(
    () => (instalments > 1 ? instalmentSchedule(planInput) : []),
    [instalments, planInput]
  )

  const addBlank = () => setLines(prev => [...prev, {
    key: `manual-${prev.length}-${prev.reduce((n, x) => n + x.key.length, 0)}`,
    job_id: null, revision_id: null, description: '', qty: 1, unit_price: 0,
  }])
  const patchLine = (key: string, patch: Partial<DraftLine>) =>
    setLines(prev => prev.map(l => (l.key === key ? { ...l, ...patch } : l)))
  const removeLine = (key: string) => setLines(prev => prev.filter(l => l.key !== key))

  const addresseeOk = billTo === 'customer' ? !!customerId : patsient.trim().length > 0
  const chosenCustomer = billTo === 'customer' ? customers.find(c => c.id === customerId) ?? null : null
  // A company client without its registry code, VAT number or address: said, not refused.
  const buyerMissing = chosenCustomer ? buyerDetailsMissing(chosenCustomer) : []
  // VAT exempt needs its reason: an exempt invoice must say why.
  const exemptOk = !exempt || exemptNote.trim().length > 0
  // An invoice with no issue date has no period, no due date and no place in a
  // sequence. Blocked here rather than left to Postgres, because the instalment
  // path formats this date and would throw before the insert was even attempted.
  const canSave =
    addresseeOk && lines.length > 0 && !!toDate(issueDate) && exemptOk
    // Both mutations, not just the single-invoice one: a plan is a LOOP of
    // inserts, so a second click during it would write a second plan and a
    // second run of documents.
    && !createInvoice.isPending && !createPlan.isPending

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!canSave) return
    const input: CreateInvoiceInput = {
      // The check constraint in sql/035 requires these to agree: a customer
      // invoice carries customer_id and no patient_id, and vice versa.
      patient_id: billTo === 'customer' ? null : patientId,
      patsient: billTo === 'customer'
        ? (customers.find(c => c.id === customerId)?.name ?? '')
        : patsient.trim(),
      customer_id: billTo === 'customer' ? customerId : null,
      bill_to_kind: billTo,
      issue_date: issueDate,
      due_date: dueDate || null,
      vat_rate: exempt ? 0 : vatRate,
      note: note.trim() || null,
      // Kept on the invoice (sql/148): its language, the service date, why no VAT, the client's details.
      language,
      service_date: serviceDate && serviceDate !== issueDate ? serviceDate : null,
      vat_exempt_note: exempt ? exemptNote.trim().slice(0, 500) || null : null,
      buyer_reg_code: billTo === 'customer' ? chosenCustomer?.reg_code?.trim() || null : null,
      buyer_vat_number: billTo === 'customer' ? chosenCustomer?.vat_number?.trim() || null : null,
      buyer_address: billTo === 'customer' ? chosenCustomer?.address?.trim() || null : null,
      lines: lines.map((l, i) => ({
        job_id: l.job_id,
        revision_id: l.revision_id,
        description: l.description.trim() || words.work,
        qty: l.qty,
        unit_price: l.unit_price,
        sort_order: i,
      })),
    }
    try {
      if (instalments <= 1) {
        const invoice = await createInvoice.mutateAsync(input)
        onCreated?.(invoice.id)
        onClose()
        return
      }

      // One call, because a plan is one agreement: the row that says these
      // documents belong together and the documents themselves are written by
      // the same mutation. Creating the invoices here and the plan somewhere
      // else is how five invoices end up belonging to nothing.
      if (planProblems.length > 0) {
        setError(planProblems.join(' '))
        return
      }
      const { firstInvoiceId } = await createPlan.mutateAsync({
        plan: {
          patient_id: input.patient_id,
          patsient: input.patsient,
          kogusumma: gross,
          osamakseid: instalments,
          esimene_arve: input.issue_date,
          arve_paev: planDay,
          maksetahtaeg_paevi: planTerm,
          staatus: 'aktiivne',
          markus: null,
          created_by: null,
        },
        invoice: {
          patient_id: input.patient_id,
          patsient: input.patsient,
          customer_id: input.customer_id,
          bill_to_kind: input.bill_to_kind,
          vat_rate: input.vat_rate,
          note: input.note,
          language: input.language,
          service_date: input.service_date,
          vat_exempt_note: input.vat_exempt_note,
          buyer_reg_code: input.buyer_reg_code,
          buyer_vat_number: input.buyer_vat_number,
          buyer_address: input.buyer_address,
        },
        lines: input.lines,
      })

      if (firstInvoiceId) onCreated?.(firstInvoiceId)
      onClose()
    } catch (err) {
      setError(describeError(err))
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-6"
      onClick={onClose}
    >
      <motion.form
        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }}
        onClick={e => e.stopPropagation()}
        onSubmit={handleSubmit}
        className="bg-bg-card rounded-2xl shadow-panel w-[720px] max-w-dialog max-h-panel flex flex-col overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-ink-faint/15 flex-shrink-0">
          <h2 className="text-sm font-bold text-ink flex items-center gap-2">
            <FileText size={15} className="text-accent" /> {t('invoices.newInvoice')}
          </h2>
          <button type="button" onClick={onClose} className="btn-ghost p-1.5"><X size={14} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">{t('invoices.billTo')}</label>
              {/* Switching clears the other side's selection: an invoice
                  addressed to a customer must not carry a patient_id, and the
                  DB refuses the row if it does. */}
              <div className="flex items-center gap-1 bg-bg-sidebar rounded-lg p-0.5 w-fit mb-2">
                {([
                  { key: 'customer' as const, label: t('invoices.client') },
                  { key: 'patient'  as const, label: t('invoices.patient') },
                ]).map(o => (
                  <button
                    key={o.key}
                    type="button"
                    onClick={() => {
                      setBillTo(o.key)
                      setLines([]); setMonth('')
                      if (o.key === 'customer') { setPatsient(''); setPatientId(null) }
                      else setCustomerId(null)
                    }}
                    className={`text-xs font-medium px-3 py-1 rounded-md transition-colors ${
                      billTo === o.key ? 'chip-active' : 'text-ink-muted hover:text-ink'
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              {billTo === 'customer' ? (
                <select
                  value={customerId ?? ''}
                  onChange={e => { setCustomerId(e.target.value || null); setLines([]); setMonth('') }}
                  className="input"
                >
                  <option value="">{t('invoices.selectClient')}</option>
                  {customers.filter(c => !c.archived_at).map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              ) : (
                <PatientPicker
                  name={patsient}
                  patientId={patientId}
                  onChange={(nimi, pid) => { setPatsient(nimi); setPatientId(pid) }}
                  required
                />
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">{t('invoices.date')}</label>
                <input
                  type="date" value={issueDate}
                  onChange={e => setIssueDate(e.target.value)}
                  className="input"
                />
              </div>
              <div>
                <label className="label">{t('invoices.paymentDue')}</label>
                <input type="date" value={dueDate} readOnly className="input opacity-70" />
              </div>
              <div className="col-span-2">
                <label className="label">{t('invoices.language')}</label>
                <select value={language} onChange={e => setChosenLanguage(e.target.value as DocLanguage)} className="input">
                  {DOC_LANGUAGES.map(l => <option key={l} value={l}>{l === 'et' ? t('invoiceSettings.langEt') : l === 'lv' ? t('invoiceSettings.langLv') : t('invoiceSettings.langEn')}</option>)}
                </select>
                {!chosenLanguage && starting.abroad && <p className="text-[11px] text-ink-faint mt-0.5">{t('invoices.languageAbroadHint')}</p>}
              </div>
              <div className="col-span-2">
                <label className="label">{t('invoices.serviceDate')}</label>
                <input type="date" value={serviceDate} onChange={e => setServiceDate(e.target.value)} className="input" aria-describedby="service-date-hint" />
                <p id="service-date-hint" className="text-[11px] text-ink-faint mt-0.5">{t('invoices.serviceDateHint')}</p>
              </div>
            </div>
          </div>

          {buyerMissing.length > 0 && (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5" role="status">
              {t('invoices.buyerMissing', { fields: buyerMissing.map(f => t(`invoices.buyerField_${f}` as 'invoices.buyerField_reg')).join(', ') })}
            </p>
          )}

          {/* ── Unbilled work ── */}
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <p className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider flex-1">
                {t('invoices.unbilledWork')} {addresseeChosen && `(${shownCandidates.length})`}
              </p>
              {months.length > 0 && (
                <select value={month} onChange={e => setMonth(e.target.value)} className="input h-8 w-auto py-0 text-xs" aria-label={t('invoices.month')}>
                  <option value="">{t('invoices.allMonths')}</option>
                  {months.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              )}
              {shownCandidates.length > 0 && (
                <button type="button" onClick={pickAll} className="btn-ghost h-8 text-xs border border-ink-faint/25">
                  {month ? t('invoices.selectAllMonth', { month }) : t('invoices.selectAll')}
                </button>
              )}
            </div>
            {!addresseeChosen ? (
              <p className="text-xs text-ink-faint">{billTo === 'customer' ? t('invoices.selectAClientToSee') : t('invoices.selectAPatientToSeeTheir')}</p>
            ) : shownCandidates.length === 0 ? (
              <p className="text-xs text-ink-faint">
                {t('invoices.noUnbilledJobsAllOfThis')}
              </p>
            ) : (
              <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
                {shownCandidates.map(c => (
                  <label key={c.key}
                    className={`flex items-start gap-2 px-2 py-1.5 rounded-lg border cursor-pointer transition-colors ${picked(c) ? 'border-accent/50 bg-accent/5' : 'border-ink-faint/20 hover:border-accent/40'}`}>
                    <input type="checkbox" className="mt-0.5 h-4 w-4 flex-shrink-0" checked={picked(c)} onChange={() => toggle(c)} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="text-xs font-medium text-ink truncate flex-1">{[c.ref, c.revision_id ? null : c.title].filter(Boolean).join(' · ') || c.title}</span>
                        {c.date && <span className="text-[11px] text-ink-faint flex-shrink-0">{c.date.slice(0, 10)}</span>}
                        <span className="text-xs font-semibold text-ink tabular-nums flex-shrink-0">{c.total.toFixed(2)} €</span>
                      </span>
                      {(c.lines.length > 1 || c.revision_id) && (
                        <span className="block space-y-0.5 mt-0.5">
                          {c.lines.map((l, i) => (
                            <span key={i} className="flex gap-2 text-[11px] text-ink-muted">
                              <span className="truncate flex-1">{l.description}</span>
                              <span className="tabular-nums">{l.unit_price.toFixed(2)} €</span>
                            </span>
                          ))}
                        </span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* ── Lines ── */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider">
                {t('invoices.invoiceLines')} ({lines.length})
              </p>
              <button type="button" onClick={addBlank} className="btn-ghost text-xs border border-ink-faint/25">
                <Plus size={12} /> {t('invoices.addLine')}
              </button>
            </div>

            {lines.length === 0 ? (
              <p className="text-xs text-ink-faint">{t('invoices.noLinesAddFromAboveOr')}</p>
            ) : (
              <div className="space-y-1.5">
                <div className="grid grid-cols-[1fr_60px_90px_28px] gap-2 px-1">
                  <span className="text-[10px] font-semibold text-ink-faint uppercase">{t('invoices.description')}</span>
                  <span className="text-[10px] font-semibold text-ink-faint uppercase text-center">{t('invoices.qty')}</span>
                  <span className="text-[10px] font-semibold text-ink-faint uppercase text-right">{t('invoices.price')}</span>
                  <span />
                </div>
                {lines.map(l => (
                  <div key={l.key} className="grid grid-cols-[1fr_60px_90px_28px] gap-2 items-center">
                    <input
                      value={l.description}
                      onChange={e => patchLine(l.key, { description: e.target.value })}
                      placeholder={t('invoices.description')}
                      className="input py-1.5 text-sm"
                    />
                    <input
                      type="number" min="0" step="0.5" value={l.qty}
                      onChange={e => patchLine(l.key, { qty: parseFloat(e.target.value) || 0 })}
                      className="input py-1.5 text-sm text-center"
                    />
                    <input
                      type="number" min="0" step="0.01" value={l.unit_price}
                      onChange={e => patchLine(l.key, { unit_price: parseFloat(e.target.value) || 0 })}
                      className="input py-1.5 text-sm text-right"
                    />
                    <button
                      type="button" onClick={() => removeLine(l.key)}
                      className="p-1.5 rounded text-ink-faint hover:text-red-500 transition-colors"
                      title={t('invoices.removeLine')}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="label">{t('invoices.splitIntoInstalments')}</label>
            <div className="flex items-center gap-2">
              <input
                type="number" min="1" max="60" value={instalments}
                onChange={e => setInstalments(Math.max(1, Math.min(60, parseInt(e.target.value) || 1)))}
                className="input py-1.5 text-sm w-20 text-right"
              />
              <span className="text-xs text-ink-muted">
                {instalments > 1
                  ? t('invoices.invoicesOneAMonthEach', { instalments, value: (gross / instalments).toFixed(2) })
                  : t('invoices.months1OneInvoice')}
              </span>
            </div>

            {instalments > 1 && (
              <div className="mt-2 space-y-2 rounded-xl bg-bg-sidebar p-3">
                <div className="flex items-end gap-3 flex-wrap">
                  <div>
                    <label className="label">{t('invoices.invoiceDay')}</label>
                    <input
                      type="number" min="1" max="28" value={planDay}
                      onChange={e => setPlanDay(Math.max(1, Math.min(28, parseInt(e.target.value) || 1)))}
                      className="input py-1.5 text-sm w-20 text-right"
                    />
                  </div>
                  <div>
                    <label className="label">{t('invoices.paymentDue')}</label>
                    <div className="relative w-24">
                      <input
                        type="number" min="0" max="180" value={planTerm}
                        onChange={e => setPlanTerm(Math.max(0, Math.min(180, parseInt(e.target.value) || 0)))}
                        className="input py-1.5 pr-8 text-sm text-right"
                      />
                      <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-ink-faint pointer-events-none">
                        {t('invoices.d')}
                      </span>
                    </div>
                  </div>
                  {/* 28 and not 31, said on screen rather than only enforced: a
                      plan "on the 31st" would quietly become the 28th every
                      February and the 31st again in March. */}
                  <p className="text-[11px] text-ink-faint flex-1 min-w-[160px] leading-snug">
                    {t('invoices.upTo28SoTheDate')}
                  </p>
                </div>

                {/* The schedule as it will actually be written down — same two
                    functions the generator calls, so the preview cannot promise
                    a date the documents do not carry. */}
                {planProblems.length > 0 ? (
                  <ul className="space-y-0.5">
                    {planProblems.map((p, i) => (
                      <li key={i} className="text-[11px] text-rose-600">· {p}</li>
                    ))}
                  </ul>
                ) : (
                  <div className="space-y-0.5">
                    {planPreview.map(part => (
                      <div key={part.no} className="flex items-center gap-2 text-[11px]">
                        <span className="w-8 text-ink-faint tabular-nums">{part.no}/{instalments}</span>
                        <span className="text-ink-muted tabular-nums">{part.issueDate}</span>
                        <span className="text-ink-faint">{t('invoices.due')}</span>
                        <span className="text-ink-muted tabular-nums">{part.dueDate}</span>
                        <span className="ml-auto tabular-nums font-medium text-ink">
                          {part.amount.toFixed(2)} €
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                <p className="text-[11px] text-ink-faint leading-relaxed">
                  {t('invoices.allInvoicesAreCreatedNowDated')}{' '}
                  <strong>{t('invoices.eachInstalmentLinksTheWorkTo')}</strong>
                  {t('invoices.soOutstandingGoesDownWithEvery')}
                </p>
              </div>
            )}
          </div>

          <div className="space-y-1">
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" className="h-4 w-4" checked={exempt} onChange={e => setExempt(e.target.checked)} />
              {t('invoices.vatExempt')}
            </label>
            {exempt && (
              <>
                <textarea value={exemptNote} onChange={e => setExemptNote(e.target.value)} rows={2} maxLength={500}
                  placeholder={t('invoices.vatExemptNoteHint')} aria-label={t('invoices.vatExemptNote')} className="input resize-none" />
                {!exemptOk && <p className="text-[11px] text-red-700">{t('invoices.vatExemptNoteNeeded')}</p>}
              </>
            )}
          </div>

          <div>
            <label className="label">{t('invoices.noteOnInvoice')}</label>
            <textarea
              value={note} onChange={e => setNote(e.target.value)} rows={2}
              placeholder={t('invoices.shownOnTheInvoice')} className="input resize-none"
            />
          </div>
        </div>

        {/* ── Totals + actions ── */}
        <div className="border-t border-ink-faint/15 px-5 py-3 flex-shrink-0 space-y-2">
          {error && (
            <p className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-2 py-1.5">
              {error}
            </p>
          )}
          <div className="flex items-end justify-between gap-4">
            <div className="flex items-end gap-3">
              <div>
                <label className="label">{t('invoices.vAT')}</label>
                <input
                  type="number" min="0" max="30" step="0.5" value={exempt ? 0 : vatRate} disabled={exempt}
                  onChange={e => setVatRate(parseFloat(e.target.value) || 0)}
                  className="input py-1.5 text-sm w-20 text-right"
                />
              </div>
              <div className="text-xs text-ink-muted space-y-0.5 pb-1">
                <div className="flex gap-3 justify-between"><span>{t('invoices.net')}</span><span className="tabular-nums font-medium text-ink">{net.toFixed(2)} €</span></div>
                <div className="flex gap-3 justify-between"><span>{t('invoices.vAT2')}</span><span className="tabular-nums font-medium text-ink">{vat.toFixed(2)} €</span></div>
                <div className="flex gap-3 justify-between border-t border-ink-faint/20 pt-0.5">
                  <span className="font-semibold text-ink">{t('invoices.total')}</span>
                  <span className="tabular-nums font-bold text-accent">{gross.toFixed(2)} €</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button type="button" onClick={onClose} className="btn-ghost border border-ink-faint/25">
                {t('invoices.cancel')}
              </button>
              <button type="submit" disabled={!canSave} className="btn-primary disabled:opacity-50">
                {createInvoice.isPending || createPlan.isPending
                  ? <Loader2 size={13} className="animate-spin" />
                  : <FileText size={13} />}
                {t('invoices.createInvoice')}
              </button>
            </div>
          </div>
        </div>
      </motion.form>
    </motion.div>
  )
}
