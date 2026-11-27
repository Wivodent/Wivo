/**
 * sql/151: automatic invoicing. A client's job confirmed Received (or Fitted)
 * becomes an invoice at once, or goes on the client's monthly invoice; sent
 * automatically or kept as a draft for review. A job without a price, a client
 * without an e-mail or a company's details, or e-mail switched off: a draft,
 * the owner told why. Never the same work on two invoices, by hand or not.
 */
import { describe, expect, it, beforeAll, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, createTenant, rowsAs, errorAs, type Tenant } from './harness'
import { invoiceLabels } from '@shared/billing/invoiceDoc'
import { teethLabel } from '../../src/renderer/src/lib/orderView'

let db: PGlite
let A: Tenant
let B: Tenant
let last: string
let client: string
const year = new Date().getFullYear()

const settings = (pricing: Record<string, unknown>, email: Record<string, unknown> = {}) => db.query(
  `insert into public.clinic_settings (clinic_id, pricing, email) values ($1, $2::jsonb, $3::jsonb)
   on conflict (clinic_id) do update set pricing = excluded.pricing, email = excluded.email`,
  [A.clinicId, JSON.stringify(pricing), JSON.stringify(email)])
const MAIL_ON = { saatmineLubatud: true, lubaArved: true, saatjaAadress: 'arved@dentiks.lv', paevaLimiit: 20 }
const policy = (autoArve: Record<string, unknown>, email: Record<string, unknown> = MAIL_ON) =>
  settings({ kmMaar: 21, makseTahtaegPaevades: 14, autoArve }, email)

/** A client's job at the last stage, sent. */
async function job(over: Record<string, unknown> = {}): Promise<string> {
  const cols = { clinic_id: A.clinicId, patsient: 'Jānis Bērziņš', status: last, customer_id: client, hind: 240,
    too: 'Zirconia crown', hambad: '11,21,22', customer_ref: 'TF-1001', ...over }
  const keys = Object.keys(cols)
  const { rows } = await db.query<{ id: string }>(
    `insert into public.jobs (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')}) returning id`, Object.values(cols))
  await db.query(`update public.jobs set delivery_status = 'teel' where id = $1`, [rows[0].id])
  return rows[0].id
}
const receive = (j: string) => rowsAs(db, { id: A.ownerId }, `select public.job_mark_received($1, false, null)`, [j])
const fit = (j: string) => rowsAs(db, { id: A.ownerId }, `select public.job_fit_decide($1, 'fitted', null, null)`, [j])
const invoicesOf = async (j: string) => (await db.query<{ id: string; number: string; status: string; language: string; vat_rate: string;
  gross_total: string; auto_trigger: string | null; auto_period: string | null; auto_reasons: string[] | null; due_date: string; issue_date: string }>(
  `select distinct i.id, i.number, i.status, i.language, i.vat_rate::text, i.gross_total::text, i.auto_trigger, i.auto_period, i.auto_reasons,
          i.due_date::text, i.issue_date::text
     from public.invoices i join public.invoice_lines l on l.invoice_id = i.id where l.job_id = $1`, [j])).rows
const linesOf = async (inv: string) => (await db.query<{ description: string; unit_price: string; revision_id: string | null }>(
  `select description, unit_price::text, revision_id from public.invoice_lines where invoice_id = $1 order by sort_order`, [inv])).rows
const item = async (j: string) => (await db.query<{ status: string; note: string | null; invoice_id: string | null }>(
  `select status, note, invoice_id from public.auto_invoice_item where job_id = $1`, [j])).rows[0]
const ownerNotes = async () => (await db.query<{ detail: { reasons: string[]; invoice?: string } }>(
  `select detail from public.notification where user_id = $1 and kind = 'invoice_ready' order by created_at`, [A.ownerId])).rows.map(r => r.detail)

beforeAll(async () => {
  db = await freshDb()
  A = await createTenant(db, 'Dentiks')
  B = await createTenant(db, 'Elsewhere')
  await db.query(`update public.clinics set country = 'LV' where id = $1`, [A.clinicId])
  ;[{ last }] = (await db.query<{ last: string }>(`select (public.stage_order($1))[array_length(public.stage_order($1), 1)] as last`, [A.clinicId])).rows
  ;[{ id: client }] = (await db.query<{ id: string }>(
    `insert into public.customers (clinic_id, name, email, reg_code, vat_number, address, kind)
     values ($1, 'SIA Zobu Klīnika', 'buh@zobi.lv', '40003000000', 'LV40003000000', 'Brīvības iela 1, Rīga', 'clinic') returning id`, [A.clinicId])).rows
}, 120_000)

beforeEach(async () => {
  await db.query(`update public.customers set auto_invoice_on = null, auto_invoice_trigger = null, auto_invoice_mode = null, auto_invoice_send = null,
                  email = 'buh@zobi.lv', reg_code = '40003000000', address = 'Brīvības iela 1, Rīga', invoice_language = null, country = null where id = $1`, [client])
})

describe('Received → an invoice at once', () => {
  it('off by default: nothing', async () => {
    await settings({ kmMaar: 21 }, MAIL_ON)
    const j = await job()
    await receive(j)
    expect(await invoicesOf(j)).toEqual([])
    expect(await item(j)).toBeUndefined()
  })

  it('sent automatically: issued with its number, the job’s lines in the client’s language, the clinic’s VAT', async () => {
    await policy({ on: true, trigger: 'received', mode: 'per_job', send: 'auto' })
    const j = await job({ disain_hind: 15, extras: JSON.stringify([{ id: 'e1', nimi: 'Express delivery', hind: 5 }]) })
    await receive(j)
    const [inv] = await invoicesOf(j)
    expect(inv).toMatchObject({ status: 'saadetud', language: 'lv', vat_rate: '21.00', auto_trigger: 'received', auto_period: null, auto_reasons: [] })
    expect(inv.number).toMatch(new RegExp(`^${year}-\\d{4}$`))
    expect(inv.gross_total).toBe(String(((240 + 15 + 5) * 1.21).toFixed(2)))
    // 14 days to pay.
    expect((Date.parse(inv.due_date) - Date.parse(inv.issue_date)) / 86_400_000).toBe(14)
    expect(await linesOf(inv.id)).toEqual([
      { description: 'TF-1001 · Zirconia crown · zobi 11–22', unit_price: '240.00', revision_id: null },
      { description: 'TF-1001 · Dizains', unit_price: '15.00', revision_id: null },
      { description: 'TF-1001 · Express delivery', unit_price: '5.00', revision_id: null },
    ])
    expect(await item(j)).toMatchObject({ status: 'invoiced', invoice_id: inv.id })
    // Not a draft: nobody is asked to check it. The audit says it was automatic.
    expect((await ownerNotes()).some(n => n.invoice === inv.id)).toBe(false)
    const [audit] = (await db.query<{ detail: { auto: boolean } }>(`select detail from public.audit_log where object = $1`, [`invoice:${inv.id}`])).rows
    expect(audit.detail.auto).toBe(true)
  })

  it('created as a draft for review: no number of the sequence, the owner told “Invoice ready to check”', async () => {
    await policy({ on: true, trigger: 'received', mode: 'per_job', send: 'draft' })
    const j = await job()
    await receive(j)
    const [inv] = await invoicesOf(j)
    expect(inv.status).toBe('mustand')
    expect(inv.number).toMatch(/^draft:/)
    expect(inv.auto_reasons).toEqual(['review'])
    expect((await ownerNotes()).find(n => n.invoice === inv.id)?.reasons).toEqual([])
  })

  it('the client’s own language; English for a client abroad', async () => {
    await policy({ on: true, trigger: 'received', mode: 'per_job', send: 'draft' })
    await db.query(`update public.customers set country = 'EE' where id = $1`, [client])
    const j = await job({ hambad: '17,16,15,14' })
    await receive(j)
    const [inv] = await invoicesOf(j)
    expect(inv.language).toBe('en')
    expect((await linesOf(inv.id))[0].description).toBe('TF-1001 · Zirconia crown · teeth 17–14')
  })
})

describe('the client’s card overrides the clinic', () => {
  it('off for one client while the clinic has it on; on for one while the clinic has it off', async () => {
    await policy({ on: true, trigger: 'received', mode: 'per_job', send: 'draft' })
    await db.query(`update public.customers set auto_invoice_on = false where id = $1`, [client])
    const off = await job()
    await receive(off)
    expect(await invoicesOf(off)).toEqual([])
    await policy({ on: false })
    await db.query(`update public.customers set auto_invoice_on = true, auto_invoice_send = 'draft' where id = $1`, [client])
    const on = await job()
    await receive(on)
    expect(await invoicesOf(on)).toHaveLength(1)
  })

  it('when the client confirms Fitted: Received alone does nothing', async () => {
    await policy({ on: true, trigger: 'fitted', mode: 'per_job', send: 'draft' })
    await db.query(`update public.clinic_settings set features = coalesce(features, '{}'::jsonb) || '{"ratings": true}'::jsonb where clinic_id = $1`, [A.clinicId])
    const j = await job()
    await receive(j)
    expect(await invoicesOf(j)).toEqual([])
    await fit(j)
    const [inv] = await invoicesOf(j)
    expect(inv.auto_trigger).toBe('fitted')
  })
})

describe('only a draft, with the reason', () => {
  it('a job without a price: a draft, its line at 0, even when sending is chosen', async () => {
    await policy({ on: true, trigger: 'received', mode: 'per_job', send: 'auto' })
    const j = await job({ hind: null })
    await receive(j)
    const [inv] = await invoicesOf(j)
    expect(inv.status).toBe('mustand')
    expect(inv.auto_reasons).toEqual(['no_price'])
    expect((await linesOf(inv.id))[0].unit_price).toBe('0.00')
    expect((await ownerNotes()).find(n => n.invoice === inv.id)?.reasons).toEqual(['no_price'])
  })

  it('no invoice e-mail, a company without its registry code or address, e-mail switched off', async () => {
    await policy({ on: true, trigger: 'received', mode: 'per_job', send: 'auto' })
    await db.query(`update public.customers set email = null, address = null where id = $1`, [client])
    const j = await job()
    await receive(j)
    expect((await invoicesOf(j))[0]).toMatchObject({ status: 'mustand', auto_reasons: ['buyer_details', 'no_email'] })

    await db.query(`update public.customers set email = 'buh@zobi.lv', address = 'Rīga' where id = $1`, [client])
    await policy({ on: true, trigger: 'received', mode: 'per_job', send: 'auto' }, { ...MAIL_ON, saatmineLubatud: false })
    const k = await job()
    await receive(k)
    expect((await invoicesOf(k))[0]).toMatchObject({ status: 'mustand', auto_reasons: ['mail_off'] })
  })
})

describe('an error never undoes the confirmation', () => {
  it('Received stays; the item keeps the error and is tried again later', async () => {
    await policy({ on: true, trigger: 'received', mode: 'per_job', send: 'auto' })
    // An extra too large for an invoice line: the invoice cannot be written.
    const j = await job({ extras: JSON.stringify([{ id: 'e1', nimi: 'Huge', hind: '99999999999999' }]) })
    await receive(j)
    expect((await db.query<{ received_at: string | null }>(`select received_at from public.jobs where id = $1`, [j])).rows[0].received_at).not.toBeNull()
    expect(await invoicesOf(j)).toEqual([])
    expect(await item(j)).toMatchObject({ status: 'pending', note: 'error 22003' })
  })
})

describe('the client’s monthly invoice', () => {
  it('collects the month’s jobs once the month is over, one invoice, and only once', async () => {
    await policy({ on: true, trigger: 'received', mode: 'monthly', send: 'draft' })
    const a = await job({ customer_ref: 'TF-2001' })
    const b = await job({ customer_ref: 'TF-2002', hind: 100 })
    await receive(a)
    await receive(b)
    expect(await invoicesOf(a)).toEqual([])
    expect(await item(a)).toMatchObject({ status: 'pending' })
    // The month is not over yet: nothing.
    const [{ made: none }] = (await db.query<{ made: number }>(`select public.auto_invoice_run() as made`)).rows
    expect(none).toBe(0)
    // Last month's (as if the month had ended): one invoice with both.
    await db.query(`update public.auto_invoice_item set reached_at = date_trunc('month', now()) - interval '3 days' + (case when job_id = $1 then interval '0' else interval '1 hour' end) where job_id in ($1, $2)`, [a, b])
    const [{ made }] = (await db.query<{ made: number }>(`select public.auto_invoice_run() as made`)).rows
    expect(made).toBe(1)
    const [inv] = await invoicesOf(a)
    expect((await invoicesOf(b))[0].id).toBe(inv.id)
    expect(inv.auto_period).toMatch(/^\d{4}-\d{2}$/)
    expect((await linesOf(inv.id)).map(l => l.description)).toEqual(['TF-2001 · Zirconia crown · zobi 11–22', 'TF-2002 · Zirconia crown · zobi 11–22'])
    expect((await db.query<{ made: number }>(`select public.auto_invoice_run() as made`)).rows[0].made).toBe(0)
  })

  it('the last day of the month from 20:00 in the clinic’s time belongs to the next month', async () => {
    const period = async (at: string) => (await db.query<{ p: string }>(`select public.auto_invoice_period($1, $2::timestamptz) as p`, [A.clinicId, at])).rows[0].p
    expect(await period('2026-11-30T17:59:00Z')).toBe('2026-11') // 19:59 in Riga
    expect(await period('2026-11-30T18:01:00Z')).toBe('2026-12') // 20:01 in Riga
  })
})

describe('never the same work on two invoices', () => {
  async function manual(j: string, extra: Record<string, unknown> = {}): Promise<string> {
    const cols = { clinic_id: A.clinicId, patsient: 'SIA Zobu Klīnika', customer_id: client, bill_to_kind: 'customer', status: 'saadetud', ...extra }
    const keys = Object.keys(cols)
    const [{ id }] = await rowsAs<{ id: string }>(db, { id: A.ownerId },
      `insert into public.invoices (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')}) returning id`, Object.values(cols))
    await rowsAs(db, { id: A.ownerId }, `insert into public.invoice_lines (invoice_id, job_id, description, qty, unit_price) values ($1, $2, 'Kronis', 1, 240)`, [id, j])
    return id
  }

  it('a job already on an invoice by hand: the automatic one leaves it, saying so', async () => {
    await policy({ on: true, trigger: 'received', mode: 'per_job', send: 'auto' })
    const j = await job()
    await manual(j)
    await receive(j)
    expect(await invoicesOf(j)).toHaveLength(1)
    expect(await item(j)).toMatchObject({ status: 'skipped', note: 'already_invoiced' })
  })

  it('by hand too: refused on a second live invoice; allowed once the first is cancelled or credited, and within one payment plan', async () => {
    await policy({ on: false })
    const j = await job()
    const first = await manual(j)
    expect(await errorAs(db, { id: A.ownerId }, `insert into public.invoices (clinic_id, patsient, customer_id, bill_to_kind) values ($1, 'x', $2, 'customer')`, [A.clinicId, client])).toBeNull()
    const [{ id: second }] = (await db.query<{ id: string }>(`select id from public.invoices where patsient = 'x' order by created_at desc limit 1`)).rows
    expect(await errorAs(db, { id: A.ownerId }, `insert into public.invoice_lines (invoice_id, job_id, description, qty, unit_price) values ($1, $2, 'Again', 1, 240)`, [second, j]))
      .toMatch(/already on invoice/)
    await rowsAs(db, { id: A.ownerId }, `select public.cancel_invoice($1, 'Wrong client')`, [first])
    expect(await errorAs(db, { id: A.ownerId }, `insert into public.invoice_lines (invoice_id, job_id, description, qty, unit_price) values ($1, $2, 'Again', 1, 240)`, [second, j])).toBeNull()

    const k = await job()
    const paid = await manual(k)
    await rowsAs(db, { id: A.ownerId }, `select public.create_credit_note($1, 'Returned')`, [paid])
    await manual(k)
    expect((await invoicesOf(k)).filter(i => i.status !== 'tuhistatud')).toHaveLength(3)

    const m = await job()
    const [{ id: plan }] = (await db.query<{ id: string }>(
      `insert into public.payment_plans (clinic_id, patsient, kogusumma, osamakseid, esimene_arve) values ($1, 'x', 200, 2, current_date) returning id`, [A.clinicId])).rows
    await manual(m, { payment_plan_id: plan })
    await manual(m, { payment_plan_id: plan })
  })
})

describe('who sees the queue', () => {
  it('its own clinic only', async () => {
    await policy({ on: true, trigger: 'received', mode: 'monthly', send: 'draft' })
    const j = await job()
    await receive(j)
    expect(await rowsAs(db, { id: A.ownerId }, `select job_id from public.auto_invoice_item where job_id = $1`, [j])).toHaveLength(1)
    expect(await rowsAs(db, { id: B.ownerId }, `select job_id from public.auto_invoice_item where job_id = $1`, [j])).toHaveLength(0)
    expect(await errorAs(db, { id: A.ownerId }, `insert into public.auto_invoice_item (org_id, job_id, customer_id, trigger, mode, send) values ($1, $2, $3, 'received', 'per_job', 'auto')`,
      [A.clinicId, await job(), client])).toMatch(/row-level security|permission/)
    expect(await errorAs(db, { id: A.ownerId }, `select public.auto_invoice_run()`)).toMatch(/permission denied/)
  })
})

describe('the database says a line as the app does', () => {
  it('the words and the teeth ranges match shared/billing/invoiceDoc and lib/orderView', async () => {
    for (const lang of ['et', 'lv', 'en'] as const) {
      const L = invoiceLabels(lang).line
      const word = async (w: string, arg: string | null = null) =>
        (await db.query<{ w: string }>(`select public.invoice_line_word($1, $2, $3) as w`, [lang, w, arg])).rows[0].w
      expect(await word('work')).toBe(L.work)
      expect(await word('design')).toBe(L.design)
      expect(await word('extra')).toBe(L.extraService)
      expect(await word('teeth', '11, 21')).toBe(L.teeth('11, 21'))
      expect(await word('remake', '2')).toBe(L.remake(2))
    }
    for (const teeth of ['11,21,22', '17,16,15,14', '18,28', '11', '36,35,34,44,45', 'x', '']) {
      const [{ t }] = (await db.query<{ t: string | null }>(`select public.teeth_label($1) as t`, [teeth])).rows
      expect(t ?? '', teeth).toBe(teethLabel(teeth) || teeth.trim())
    }
  })
})
