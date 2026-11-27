/**
 * What an invoice SAYS, once. Not how it looks.
 *
 * The invoice is about to exist twice: the printed page (`InvoicePrintView`,
 * Tailwind, modern CSS) and the emailed one (an edge function, tables and
 * inline styles, because mail clients strip everything else). Those two cannot
 * share markup — the constraints are genuinely different — so what they share
 * is this: every derived number, every composed line of the address block, and
 * every string ALREADY FORMATTED.
 *
 * Pre-formatted on purpose. If one renderer writes `toFixed(2)` and the other
 * writes its own, the day someone changes a separator only one of them changes,
 * and the document in the accountant's folder stops matching the one in the
 * patient's mailbox. This file is the only place a number becomes text.
 *
 * NO DEPENDENCIES — `shared/README.md`. That includes date-fns, so the date
 * formatting below is hand-rolled, and it includes the renderer's own `Clinic`
 * and `InvoiceFull` types, so the inputs are declared structurally here and the
 * caller's objects satisfy them by shape.
 *
 * The words come in the document's language (et, lv, en; sql/148): Estonian
 * unless the invoice says otherwise, so an Estonian invoice reads exactly as
 * it always has. Latvian exists only here; Estonian and English equal the
 * app's own `invoiceDoc.*` texts (invoiceLabels.test.ts).
 */
import type { DocLanguage } from './countryInvoice.ts'

// ── The words, in the document's language ───────────────────────────────────
export interface InvoiceLabels {
  invoice: string
  /** A draft's number until it is issued (sql/149: a draft has none yet). */
  draft: string
  number: string
  date: string
  dueDate: string
  serviceDate: string
  payer: string
  description: string
  quantity: string
  /** "Qty": the quantity column's heading on a narrow screen. */
  quantityShort: string
  unitPrice: string
  /** "Hind": the unit price column's heading where the whole one does not fit on one line. */
  unitPriceShort: string
  amount: string
  /** The amount before VAT, at one rate (or exempt). Estonian keeps "Summa", as its invoices always said. */
  net: (rate: number, exempt: boolean) => string
  vat: (rate: number) => string
  vatExempt: string
  totalDue: string
  received: string
  outstanding: string
  payment: string
  reference: (reference: string) => string
  /** "arve 2026-0007": the payment reference's word. */
  referenceOf: (number: string) => string
  cancelled: string
  regNo: (code: string) => string
  vatNo: (code: string) => string
  /** The words an invoice line is written with (lib/invoiceCandidates), so a line reads in the invoice's language too. */
  line: { work: string; teeth: (list: string) => string; remake: (n: number) => string; design: string; extraService: string
    rush: (factor: number) => string; model: string }
}

const ET: InvoiceLabels = {
  invoice: 'ARVE', draft: 'MUSTAND', number: 'Number', date: 'Kuupäev', dueDate: 'Maksetähtaeg', serviceDate: 'Teenuse osutamise kuupäev',
  payer: 'Maksja', description: 'Kirjeldus', quantity: 'Kogus', quantityShort: 'Kogus', unitPrice: 'Ühiku hind', unitPriceShort: 'Hind', amount: 'Summa',
  net: () => 'Summa',
  vat: rate => `Käibemaks ${rate}%`, vatExempt: 'Käibemaksuta',
  totalDue: 'Kokku tasuda', received: 'Laekunud', outstanding: 'Tasumata', payment: 'Makse',
  reference: r => `Selgitus: ${r}`, referenceOf: n => `arve ${n}`, cancelled: 'Tühistatud',
  regNo: c => `Reg nr ${c}`, vatNo: c => `KMKR ${c}`,
  line: { work: 'Töö', teeth: l => `hambad ${l}`, remake: n => `muudatus #${n}`, design: 'Disain', extraService: 'Lisateenus',
    rush: k => `Kiirtöö ×${k}`, model: 'Mudel' },
}

const EN: InvoiceLabels = {
  invoice: 'INVOICE', draft: 'DRAFT', number: 'Number', date: 'Date', dueDate: 'Due date', serviceDate: 'Date of service',
  payer: 'Payer', description: 'Description', quantity: 'Quantity', quantityShort: 'Qty', unitPrice: 'Unit price', unitPriceShort: 'Price', amount: 'Amount',
  net: (rate, exempt) => (exempt ? 'Amount (VAT exempt)' : `Taxable amount at ${rate}%`),
  vat: rate => `VAT ${rate}%`, vatExempt: 'VAT exempt',
  totalDue: 'Total due', received: 'Received', outstanding: 'Outstanding', payment: 'Payment',
  reference: r => `Reference: ${r}`, referenceOf: n => `invoice ${n}`, cancelled: 'Cancelled',
  regNo: c => `Reg. no. ${c}`, vatNo: c => `VAT no. ${c}`,
  line: { work: 'Work', teeth: l => `teeth ${l}`, remake: n => `remake #${n}`, design: 'Design', extraService: 'Extra service',
    rush: k => `Rush ×${k}`, model: 'Model' },
}

const LV: InvoiceLabels = {
  invoice: 'RĒĶINS', draft: 'MELNRAKSTS', number: 'Numurs', date: 'Datums', dueDate: 'Apmaksas termiņš', serviceDate: 'Pakalpojuma sniegšanas datums',
  payer: 'Maksātājs', description: 'Apraksts', quantity: 'Daudzums', quantityShort: 'Daudz.', unitPrice: 'Vienības cena', unitPriceShort: 'Cena', amount: 'Summa',
  net: (rate, exempt) => (exempt ? 'Summa (atbrīvots no PVN)' : `Ar PVN ${rate}% apliekamā summa`),
  vat: rate => `PVN ${rate}%`, vatExempt: 'Atbrīvots no PVN',
  totalDue: 'Kopā apmaksai', received: 'Saņemts', outstanding: 'Neapmaksāts', payment: 'Maksājums',
  reference: r => `Maksājuma mērķis: ${r}`, referenceOf: n => `rēķins ${n}`, cancelled: 'Anulēts',
  regNo: c => `Reģ. Nr. ${c}`, vatNo: c => `PVN reģ. Nr. ${c}`,
  line: { work: 'Darbs', teeth: l => `zobi ${l}`, remake: n => `labojums #${n}`, design: 'Dizains', extraService: 'Papildpakalpojums',
    rush: k => `Steidzams darbs ×${k}`, model: 'Modelis' },
}

const ALL: Record<DocLanguage, InvoiceLabels> = { et: ET, en: EN, lv: LV }

export const invoiceLabels = (lang: DocLanguage): InvoiceLabels => ALL[lang] ?? ET


/** The subset of an invoice line this document needs. */
export interface DocInvoiceLine {
  description: string
  qty: number | string
  unit_price: number | string
}

/** The subset of an invoice this document needs. */
export interface DocInvoice {
  number: string
  status: string
  patsient: string
  issue_date: string | null
  due_date: string | null
  vat_rate: number | string
  net_total: number | string
  vat_total: number | string
  gross_total: number | string
  note: string | null
  lines: DocInvoiceLine[]
  payments?: { amount: number | string }[]
  /** sql/148: kept on the invoice when it was made. Absent on older invoices. */
  language?: string | null
  service_date?: string | null
  vat_exempt_note?: string | null
  buyer_reg_code?: string | null
  buyer_vat_number?: string | null
  buyer_address?: string | null
}

/** The subset of the clinic that appears on the document. */
export interface DocClinic {
  name?: string | null
  address?: string | null
  postal_code?: string | null
  city?: string | null
  reg_code?: string | null
  vat_number?: string | null
  phone?: string | null
  email?: string | null
  bank_name?: string | null
  bank_account?: string | null
}

export interface DocLine {
  description: string
  qty: number
  unitPrice: number
  total: number
  qtyText: string
  unitPriceText: string
  totalText: string
}

export interface InvoiceDoc {
  language: DocLanguage
  labels: InvoiceLabels
  number: string
  /** 'dd.MM.yyyy', or '—' when the date is missing or unreadable. */
  issueDate: string
  dueDate: string
  hasDueDate: boolean
  /** Not issued yet (sql/149): its number is the word "draft", not one of the sequence. */
  draft: boolean
  /** The date of the service, only when it differs from the issue date (else null). */
  serviceDate: string | null
  cancelled: boolean

  seller: {
    name: string
    /** Address, reg code, VAT number, phone, email — already composed, blanks
     *  dropped. A renderer just prints the lines it is given. */
    lines: string[]
  }
  /** The buyer's address, reg code and VAT number as kept on the invoice (sql/148); none on older ones. */
  buyer: { name: string; lines: string[] }

  lines: DocLine[]

  totals: {
    net: number; netText: string
    vatRate: number; vatLabel: string
    /** The amount before VAT, named for its rate (or exempt). */
    netLabel: string
    /** No VAT charged, and why (printed on the invoice). */
    vatExempt: boolean; vatExemptNote: string | null
    vat: number; vatText: string
    gross: number; grossText: string
    paid: number; paidText: string
    due: number; dueText: string
    /** Only worth showing the paid/outstanding pair once money has arrived. */
    showPaid: boolean
  }

  /** Null when the clinic has filled in no bank details at all. */
  payment: { bankName: string | null; iban: string | null; reference: string } | null
  note: string | null

  /**
   * Clinic details an Estonian invoice is expected to carry and this one does
   * not. Non-empty means the document goes out incomplete — the caller decides
   * whether to warn or to refuse.
   */
  missing: string[]
}

const num = (v: number | string | null | undefined): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? n : 0
}

const round2 = (n: number): number => Math.round(n * 100) / 100

/** A draft's placeholder until it is issued (sql/149: 'draft:<id>'): never a number of the sequence. */
export const isDraftNumber = (n: string | null | undefined): boolean => !n || n.startsWith('draft:')

/** `1234.5` → `'1234.50 €'`. The one place a sum becomes text. */
export const money = (v: number | string | null | undefined): string =>
  `${num(v).toFixed(2)} €`

/**
 * 'YYYY-MM-DD' → 'dd.MM.yyyy'. Strict, and '—' on anything else: a half-typed
 * date guessed into a real one would put a due date on a document nobody chose.
 */
export function docDate(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((iso ?? '').trim())
  if (!m) return '—'
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3])
  const t = new Date(Date.UTC(y, mo - 1, d))
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return '—'
  return `${m[3]}.${m[2]}.${m[1]}`
}

const trimmed = (v: string | null | undefined): string | null => {
  const s = (v ?? '').trim()
  return s ? s : null
}

/** Everything the document says, derived once. */
export function invoiceDoc(invoice: DocInvoice, clinic: DocClinic | null, language?: DocLanguage): InvoiceDoc {
  const c = clinic ?? {}
  const kept = invoice.language
  const lang: DocLanguage = kept === 'et' || kept === 'lv' || kept === 'en' ? kept : (language ?? 'et')
  const L = invoiceLabels(lang)

  const missing: string[] = []
  if (!trimmed(c.name)) missing.push('nimi')
  if (!trimmed(c.reg_code)) missing.push('registrikood')
  if (!trimmed(c.bank_account)) missing.push('IBAN')
  if (!trimmed(c.address)) missing.push('aadress')

  const sellerLines: string[] = []
  const addr = trimmed(c.address)
  if (addr) sellerLines.push(addr)
  const town = [trimmed(c.postal_code), trimmed(c.city)].filter(Boolean).join(' ')
  if (town) sellerLines.push(town)
  if (trimmed(c.reg_code)) sellerLines.push(L.regNo(trimmed(c.reg_code) as string))
  if (trimmed(c.vat_number)) sellerLines.push(L.vatNo(trimmed(c.vat_number) as string))
  if (trimmed(c.phone)) sellerLines.push(trimmed(c.phone) as string)
  if (trimmed(c.email)) sellerLines.push(trimmed(c.email) as string)

  const lines: DocLine[] = (invoice.lines ?? []).map(l => {
    const qty = num(l.qty)
    const unitPrice = num(l.unit_price)
    const total = round2(qty * unitPrice)
    return {
      description: l.description ?? '',
      qty,
      unitPrice,
      total,
      // An integer quantity prints as "1", not "1.00" — invoices say one crown,
      // not one-point-zero-zero crowns.
      qtyText: Number.isInteger(qty) ? String(qty) : String(qty),
      unitPriceText: money(unitPrice),
      totalText: money(total),
    }
  })

  const paid = round2((invoice.payments ?? []).reduce((s, p) => s + num(p.amount), 0))
  const gross = round2(num(invoice.gross_total))
  // Cancelled owes nothing regardless of what was billed, exactly as
  // `outstanding()` in types/invoice decided — restated here because shared/
  // cannot import it, and stated once so the two cannot disagree.
  const cancelled = invoice.status === 'tuhistatud'
  const due = cancelled ? 0 : round2(Math.max(0, gross - paid))
  const vatRate = num(invoice.vat_rate)
  const exemptNote = trimmed(invoice.vat_exempt_note)
  const vatExempt = !!exemptNote && vatRate === 0
  const buyerLines: string[] = []
  if (trimmed(invoice.buyer_address)) buyerLines.push(trimmed(invoice.buyer_address) as string)
  if (trimmed(invoice.buyer_reg_code)) buyerLines.push(L.regNo(trimmed(invoice.buyer_reg_code) as string))
  if (trimmed(invoice.buyer_vat_number)) buyerLines.push(L.vatNo(trimmed(invoice.buyer_vat_number) as string))
  const service = docDate(invoice.service_date)
  const serviceDate = service !== '—' && service !== docDate(invoice.issue_date) ? service : null

  const bankName = trimmed(c.bank_name)
  const iban = trimmed(c.bank_account)

  const draftNumber = isDraftNumber(invoice.number)
  return {
    language: lang,
    labels: L,
    number: draftNumber ? L.draft : invoice.number,
    draft: draftNumber || invoice.status === 'mustand',
    issueDate: docDate(invoice.issue_date),
    dueDate: docDate(invoice.due_date),
    hasDueDate: docDate(invoice.due_date) !== '—',
    serviceDate,
    cancelled,
    seller: { name: trimmed(c.name) ?? '—', lines: sellerLines },
    buyer: { name: invoice.patsient, lines: buyerLines },
    lines,
    totals: {
      net: round2(num(invoice.net_total)), netText: money(invoice.net_total),
      vatRate, vatLabel: vatExempt ? L.vatExempt : L.vat(vatRate),
      netLabel: L.net(vatRate, vatExempt),
      vatExempt, vatExemptNote: vatExempt ? exemptNote : null,
      vat: round2(num(invoice.vat_total)), vatText: money(invoice.vat_total),
      gross, grossText: money(gross),
      paid, paidText: money(paid),
      due, dueText: money(due),
      showPaid: paid > 0,
    },
    payment: (bankName || iban)
      ? { bankName, iban, reference: draftNumber ? L.draft : L.referenceOf(invoice.number) }
      : null,
    note: trimmed(invoice.note),
    missing,
  }
}
