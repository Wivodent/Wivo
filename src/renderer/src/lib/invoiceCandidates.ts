/**
 * The unbilled work an invoice offers, and the lines each piece becomes.
 *
 * Whose work: a client invoice covers every job with that client
 * (jobs.customer_id: a Network order's job gets its client's record when the
 * order is accepted, sql/138); a patient invoice, that patient's jobs. Work
 * already on an invoice (not cancelled) is not offered again.
 *
 * Each job is one or more lines: each work item and each chosen option with
 * its own price (an All-on-4 and its Metal bar apart), the rush, the model,
 * the design fee, the extra services, exactly as the price engine
 * (shared/pricing/quote) adds them up. When that does not come to the job's
 * own price (it was set by hand, or the price list changed since), the job is
 * one line at its own price: an invoice never says a job cost something other
 * than what the job says. A client's reference (a Network order's TF-…) leads
 * every line of its job. A remake with a price is its own line, as before.
 * The words a line is written with ("teeth", "remake") are the invoice's
 * language (sql/148: Estonian, Latvian, English), Estonian unless told.
 *
 * Copied, not joined: once issued, editing the job must not restate the
 * invoice (InvoiceForm).
 */
import type { Job } from '../types/job'
import { revisionReasonLabel, jobWorkItems } from '../types/job'
import { jobTotalValue } from './jobPayments'
import { quoteJob, ITEM_SOURCES } from '@shared/pricing/quote'
import { invoiceLabels, type InvoiceLabels } from '@shared/billing/invoiceDoc'
import type { PriceBook } from '@shared/pricing/priceBook'
import { workWithOptionsLabel, type WorkOption } from '@shared/pricing/workOptions'
import { teethLabel } from './orderView'

/** Teeth as an invoice line says them: neighbours in an arch as a range ("17–27"), as on the Orders page. */
const teethText = (teeth: string): string => teethLabel(teeth) || teeth.trim()

export interface CandidateLine { description: string; unit_price: number }

export interface Candidate {
  /** `${job_id}:${revision_id ?? ''}`, as billed lines are keyed. */
  key: string
  job_id: string
  revision_id: string | null
  /** The job's date for the month filter (finished, else created). */
  date: string | null
  title: string
  ref: string | null
  lines: CandidateLine[]
  total: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

export function billedKeys(invoices: readonly { status: string; lines: readonly { job_id: string | null; revision_id: string | null }[] }[]): Set<string> {
  const set = new Set<string>()
  for (const inv of invoices) {
    if (inv.status === 'tuhistatud') continue
    for (const l of inv.lines) if (l.job_id) set.add(`${l.job_id}:${l.revision_id ?? ''}`)
  }
  return set
}

/** The lines of one job (its remakes are separate candidates). */
type LineWords = InvoiceLabels['line']
const ESTONIAN: LineWords = invoiceLabels('et').line

export function jobLines(job: Job, book: PriceBook, library: readonly WorkOption[] | undefined, prefix: string | null, words: LineWords = ESTONIAN): CandidateLine[] {
  const items = jobWorkItems(job)
  const lead = (s: string) => [prefix, s].filter(Boolean).join(' · ')
  const total = jobTotalValue(job)
  const quote = quoteJob({
    items: items.map(i => ({ too: i.too, hambad: i.hambad, materjal: i.materjal ?? null, valikud: i.valikud ?? null })),
    materjal: job.materjal, kiirtoo: job.kiirtoo ?? false, mudel: job.mudel ?? false,
    disainHind: job.disain_hind, extras: job.extras ?? [],
  }, book)
  const matches = quote.unpriced.length === 0 && round2(quote.production) === round2(Number(job.hind ?? 0))
    && round2(quote.total) === total && quote.lines.length > 0
  if (matches) {
    // The quote's lines come item by item: the item, then its options; then the rush, model, design, extras.
    const out: CandidateLine[] = []
    let item = -1
    for (const l of quote.lines) {
      if (ITEM_SOURCES.includes(l.source)) {
        item++
        const teeth = items[item]?.hambad?.trim()
        out.push({ description: lead([l.label, teeth ? words.teeth(teethText(teeth)) : null].filter(Boolean).join(' · ')), unit_price: l.amount })
      } else {
        out.push({ description: lead(l.label), unit_price: l.amount })
      }
    }
    return out
  }
  // One line at the job's own price, its design fee and extras apart as before.
  const work = workWithOptionsLabel(items, library) || job.too?.trim() || words.work
  const out: CandidateLine[] = [{
    description: lead([work, job.hambad ? words.teeth(teethText(job.hambad)) : null].filter(Boolean).join(' · ')),
    unit_price: round2(Number(job.hind ?? 0)),
  }]
  if (Number(job.disain_hind ?? 0) > 0) out.push({ description: lead(words.design), unit_price: round2(Number(job.disain_hind)) })
  for (const e of job.extras ?? []) {
    if (Number(e.hind ?? 0) !== 0) out.push({ description: lead(e.nimi || words.extraService), unit_price: round2(Number(e.hind)) })
  }
  return out
}

export function unbilledCandidates(jobs: readonly Job[], who: { billTo: 'customer' | 'patient'; customerId: string | null; patientId: string | null; patientName: string },
  billed: ReadonlySet<string>, book: PriceBook, library: readonly WorkOption[] | undefined, words: LineWords = ESTONIAN): Candidate[] {
  const name = who.patientName.trim().toLowerCase()
  if (who.billTo === 'customer' ? !who.customerId : !name && !who.patientId) return []
  const out: Candidate[] = []
  for (const j of jobs) {
    const mine = who.billTo === 'customer'
      ? j.customer_id === who.customerId
      : (!!who.patientId && j.patient_id === who.patientId) || (!!name && (j.patsient ?? '').trim().toLowerCase() === name)
    if (!mine) continue
    const ref = who.billTo === 'customer' ? (j.customer_ref?.trim() || j.patsient?.trim() || null) : null
    const date = j.valmis_kuupaev ?? j.kuupaev ?? null
    const title = workWithOptionsLabel(jobWorkItems(j), library) || j.too?.trim() || words.work
    if (!billed.has(`${j.id}:`)) {
      const lines = jobLines(j, book, library, ref, words)
      out.push({ key: `${j.id}:`, job_id: j.id, revision_id: null, date, title, ref, lines, total: round2(lines.reduce((s, l) => s + l.unit_price, 0)) })
    }
    for (const [i, r] of (j.revisions ?? []).entries()) {
      const key = `${j.id}:${r.id}`
      if (billed.has(key) || !r.price) continue
      const description = [ref, `${j.too?.trim() || words.work} — ${words.remake(i + 1)}${revisionReasonLabel(r) ? ` (${revisionReasonLabel(r)})` : ''}`].filter(Boolean).join(' · ')
      out.push({ key, job_id: j.id, revision_id: r.id, date, title: description, ref, lines: [{ description, unit_price: Number(r.price) }], total: Number(r.price) })
    }
  }
  return out
}

/** "2026-11" of a date, for the month filter; null without one. */
export const monthOf = (date: string | null): string | null => (date && /^\d{4}-\d{2}/.test(date) ? date.slice(0, 7) : null)

/** The months the candidates fall in, newest first. */
export function candidateMonths(cands: readonly Candidate[]): string[] {
  return [...new Set(cands.map(c => monthOf(c.date)).filter((m): m is string => !!m))].sort().reverse()
}
