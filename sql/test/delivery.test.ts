/**
 * sql/145: Sent → Received → Fitted, a delivery problem until the clinic
 * resolves it, the "Did your order arrive?" reminder, and feedback that can be
 * changed later on both sides (every change kept). Received and the problem
 * work without the `ratings` module; only the ratings need it.
 */
import { describe, expect, it, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, createTenant, createUser, rowsAs, errorAs, grant, type Tenant } from './harness'

let db: PGlite
let A: Tenant
let B: Tenant
let doctor: string
let last: string
const NET = 'aaaaaaaa-0000-4000-8000-000000000052'

async function service<T = unknown>(sql: string, params: unknown[] = []): Promise<T> {
  await db.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', false)`)
  await db.exec('set role service_role')
  try {
    const { rows } = await db.query<{ r: T }>(sql, params)
    return rows[0]?.r as T
  } finally {
    await db.exec('reset role')
    await db.query(`select set_config('request.jwt.claims', '', false)`)
  }
}
async function serviceError(sql: string, params: unknown[] = []): Promise<string | null> {
  try { await service(sql, params); return null } catch (e) { return (e as Error).message }
}
const features = (org: string, f: Record<string, unknown>) => db.query(`insert into public.clinic_settings (clinic_id, features) values ($1, $2::jsonb)
  on conflict (clinic_id) do update set features = coalesce(public.clinic_settings.features, '{}'::jsonb) || excluded.features`, [org, JSON.stringify(f)])

/** Our own job at the last stage, sent ('teel') unless asked otherwise. */
async function ownJob(sent = true): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.jobs (clinic_id, patsient, status, order_doctor, assigned_to) values ($1, 'X', $2, $3, $4) returning id`,
    [A.clinicId, last, doctor, A.workerId])
  if (sent) await db.query(`update public.jobs set delivery_status = 'teel' where id = $1`, [rows[0].id])
  return rows[0].id
}
const jobRow = async (id: string) => (await db.query<{ sent_at: string | null; received_at: string | null; received_via: string | null; received_note: string | null; revisions: unknown[] | null }>(
  `select sent_at, received_at, received_via, received_note, revisions from public.jobs where id = $1`, [id])).rows[0]

beforeAll(async () => {
  db = await freshDb()
  A = await createTenant(db, 'Dentiks')
  B = await createTenant(db, 'Elsewhere')
  doctor = await createUser(db, 'Dr Doctor')
  await db.query(`update public.profiles set clinic_id = $1, role = 'worker', org_role = 'doctor' where id = $2`, [A.clinicId, doctor])
  await grant(db, A, A.workerId, ['jobs.read', 'jobs.write'])
  ;[{ last }] = (await db.query<{ last: string }>(`select (public.stage_order($1))[array_length(public.stage_order($1), 1)] as last`, [A.clinicId])).rows
  await db.query(`insert into public.clinic_settings (clinic_id, work_types) values ($1, $2::jsonb)
                  on conflict (clinic_id) do update set work_types = excluded.work_types`, [A.clinicId, JSON.stringify([{ nimi: 'Zirconia crown', hex: '#000', hind: 120 }])])
  await features(A.clinicId, { ratings: false })
}, 120_000)

describe('the delivery times follow the job, and only the functions write them', () => {
  it('sent: sent_at set; back at the lab: cleared; the app cannot write received', async () => {
    const j = await ownJob()
    expect((await jobRow(j)).sent_at).not.toBeNull()
    await rowsAs(db, { id: A.ownerId }, `update public.jobs set received_at = now(), received_via = 'client' where id = $1`, [j])
    expect((await jobRow(j)).received_at).toBeNull()
    await db.query(`update public.jobs set delivery_status = 'labor' where id = $1`, [j])
    expect((await jobRow(j)).sent_at).toBeNull()
  })

  it('handed over straight from the lab counts as received; a job sent before 145 (no sent_at) too', async () => {
    const j = await ownJob(false)
    await db.query(`update public.jobs set delivery_status = 'yle_antud' where id = $1`, [j])
    expect(await jobRow(j)).toMatchObject({ received_via: 'handed_over' })
    const old = await ownJob()
    await db.query(`select set_config('wivo.delivery', 'on', false)`)
    await db.query(`update public.jobs set sent_at = null where id = $1`, [old])
    await db.query(`select set_config('wivo.delivery', '', false)`)
    expect((await db.query<{ r: boolean }>(`select public.job_received($1) as r`, [old])).rows[0].r).toBe(true)
  })
})

describe('our own job: Sent → Received → Fitted', () => {
  it('Received by the doctor who ordered it, then Fitted (the ratings module on)', async () => {
    const j = await ownJob()
    await features(A.clinicId, { ratings: true })
    expect(await errorAs(db, { id: doctor }, `select public.job_fit_decide($1, 'fitted', null, null)`, [j])).toMatch(/Not received/)
    expect(await errorAs(db, { id: A.workerId }, `select public.job_mark_received($1, false, null)`, [j])).toMatch(/Only the doctor/)
    await rowsAs(db, { id: doctor }, `select public.job_mark_received($1, false, null)`, [j])
    expect(await jobRow(j)).toMatchObject({ received_via: 'orderer' })
    expect(await errorAs(db, { id: doctor }, `select public.job_fit_decide($1, 'fitted', null, null)`, [j])).toBeNull()
    await features(A.clinicId, { ratings: false })
  })

  it('works without the ratings module; the clinic can confirm by phone with a note', async () => {
    const j = await ownJob()
    await rowsAs(db, { id: A.workerId }, `select public.job_mark_received($1, true, 'Dr said on the phone')`, [j])
    expect(await jobRow(j)).toMatchObject({ received_via: 'phone', received_note: 'Dr said on the phone' })
    // Not before it is sent.
    const early = await ownJob(false)
    expect(await errorAs(db, { id: doctor }, `select public.job_mark_received($1, false, null)`, [early])).toMatch(/not sent/)
  })
})

describe('our own job: Sent → Problem → Resolved', () => {
  it('the doctor reports; the technician and the owner hear; one open at a time; resolved with a remake; the doctor hears', async () => {
    const j = await ownJob()
    expect(await errorAs(db, { id: doctor }, `select public.job_report_problem($1, 'damaged', '  ')`, [j])).toMatch(/What happened/)
    const [{ p }] = await rowsAs<{ p: string }>(db, { id: doctor }, `select public.job_report_problem($1, 'damaged', 'Cracked in the box') as p`, [j])
    expect(await errorAs(db, { id: doctor }, `select public.job_report_problem($1, 'other', 'Again')`, [j])).toMatch(/already open/)
    const told = (await db.query<{ user_id: string }>(`select user_id from public.notification where kind = 'delivery_problem' and job_id = $1`, [j])).rows
    expect(told.map(r => r.user_id).sort()).toEqual([A.ownerId, A.workerId].sort())

    expect(await errorAs(db, { id: A.workerId }, `select public.job_resolve_problem($1, 'other', null, false)`, [p])).toMatch(/note is needed/)
    const [{ rev }] = await rowsAs<{ rev: string }>(db, { id: A.workerId }, `select public.job_resolve_problem($1, 'replaced', 'New one made', true) as rev`, [p])
    expect(rev).toBeTruthy()
    const revisions = (await jobRow(j)).revisions as { id: string; reasons: string[] }[]
    expect(revisions.at(-1)).toMatchObject({ id: rev, reasons: ['Purunemine'] })
    const { rows: [solved] } = await db.query(`select resolution, resolution_note, resolved_by from public.delivery_problem where id = $1`, [p])
    expect(solved).toEqual({ resolution: 'replaced', resolution_note: 'New one made', resolved_by: A.workerId })
    expect((await db.query(`select 1 from public.notification where kind = 'problem_resolved' and user_id = $1 and job_id = $2`, [doctor, j])).rows).toHaveLength(1)
  })

  it('a remake only for damaged work or a wrong item', async () => {
    const j = await ownJob()
    const [{ p }] = await rowsAs<{ p: string }>(db, { id: doctor }, `select public.job_report_problem($1, 'not_arrived', 'Nothing came') as p`, [j])
    expect(await errorAs(db, { id: A.workerId }, `select public.job_resolve_problem($1, 'resend', null, true)`, [p])).toMatch(/only for damaged/)
    expect(await errorAs(db, { id: A.workerId }, `select public.job_resolve_problem($1, 'resend', null, false)`, [p])).toBeNull()
  })
})

describe('an order from outside', () => {
  let session: string
  let clientId: string
  async function order(ref: string): Promise<{ order: string; job: string }> {
    const id = await service<string>(`select public.client_new_order($1, $2::jsonb) as r`, [session, JSON.stringify({
      format: 'wivo-order', version: 1, work_type: 'Zirconia crown', teeth: '11', options: {}, shade: null, due: null, patient_ref: ref, notes: null })])
    const [{ job }] = await rowsAs<{ job: string }>(db, { id: A.ownerId }, `select public.accept_client_order($1, null) as job`, [id])
    return { order: id, job }
  }
  const status = (o: string) => service<{ status: string }>(`select public.client_order_detail($1, $2) as r`, [session, o]).then(d => d.status)

  beforeAll(async () => {
    await rowsAs(db, { id: A.ownerId }, `select public.network_save_settings(true, $1, $2, 8)`, ['A'.repeat(43), NET])
    const connect = () => service<{ state: string; session?: string }>(`select public.network_connect($1, $2, gen_random_uuid(), $3::jsonb) as r`,
      [NET, 'cccccccc-0000-4000-8000-000000000052', JSON.stringify({ name: 'Tess Fake', kind: 'person', role: 'technician', company: null, country: 'LV' })])
    await connect()
    ;[{ id: clientId }] = (await db.query<{ id: string }>(`select id from public.network_client where org_id = $1`, [A.clinicId])).rows
    await rowsAs(db, { id: A.ownerId }, `select public.network_confirm_client($1, 'clients', '{}'::jsonb)`, [clientId])
    session = (await connect()).session!
  })

  it('Sent → Received → Fitted: the status at each step, a line in the conversation', async () => {
    const { order: o, job: j } = await order('CASE-RECEIVED')
    await db.query(`update public.jobs set status = $2 where id = $1`, [j, last])
    expect(await status(o)).toBe('ready')
    expect(await serviceError(`select public.client_received($1, $2)`, [session, o])).toMatch(/not sent/)
    await db.query(`update public.jobs set delivery_status = 'teel' where id = $1`, [j])
    expect(await status(o)).toBe('sent')
    await service(`select public.client_received($1, $2)`, [session, o])
    expect(await status(o)).toBe('arrived')
    expect(await jobRow(j)).toMatchObject({ received_via: 'client' })
    const { rows: msgs } = await db.query<{ delivery_state: string }>(`select delivery_state from public.client_order_message where order_id = $1`, [o])
    expect(msgs.map(m => m.delivery_state)).toEqual(['received'])
    // No bell for it: the conversation says it.
    expect((await db.query(`select 1 from public.notification where detail->>'order' = $1 and kind <> 'client_order'`, [o])).rows).toHaveLength(0)
    await features(A.clinicId, { ratings: true })
    expect(await serviceError(`select public.client_fit($1, $2, 'fitted', null, null)`, [session, o])).toBeNull()
    await features(A.clinicId, { ratings: false })
  })

  it('Sent → Problem → Resolved: the bell, the conversation, the status; the client is told; then Received', async () => {
    const { order: o, job: j } = await order('CASE-PROBLEM')
    await db.query(`update public.jobs set status = $2, delivery_status = 'teel' where id = $1`, [j, last])
    expect(await serviceError(`select public.client_report_problem($1, $2, 'broken', 'x')`, [session, o])).toMatch(/reason is needed/)
    const msg = await service<string>(`select public.client_report_problem($1, $2, 'wrong_item', 'This is a bridge, not a crown') as r`, [session, o])
    expect(await status(o)).toBe('problem')
    const { rows: [m] } = await db.query(`select from_client, delivery_state, delivery_reason, body from public.client_order_message where id = $1`, [msg])
    expect(m).toEqual({ from_client: true, delivery_state: 'problem', delivery_reason: 'wrong_item', body: 'This is a bridge, not a crown' })
    const bell = await rowsAs<{ kind: string }>(db, { id: A.ownerId }, `select kind from public.notification where detail->>'order' = $1 and kind <> 'client_order'`, [o])
    expect(bell.map(b => b.kind)).toEqual(['delivery_problem'])
    // Its photos go with the message, as any client message's (sql/143).
    const slot = await service<{ file_id: string }>(`select public.client_message_file_slot($1, $2, 'box.jpg', 10, $3, 'image/jpeg') as r`, [session, msg, 'b'.repeat(64)])
    expect(slot.file_id).toBeTruthy()

    const [{ id: p }] = await rowsAs<{ id: string }>(db, { id: A.ownerId }, `select id from public.delivery_problem where order_id = $1`, [o])
    await rowsAs(db, { id: A.ownerId }, `select public.job_resolve_problem($1, 'resend', 'Sent again today', false)`, [p])
    expect(await status(o)).toBe('sent')
    const { rows: told } = await db.query<{ kind: string }>(`select kind from public.client_notification where order_id = $1 order by created_at`, [o])
    expect(told.map(n => n.kind)).toContain('problem_resolved')
    expect(told.map(n => n.kind)).not.toContain('message')
    const fb = await service<{ problem: { resolution: string }; received: boolean }>(`select public.client_feedback($1, $2) as r`, [session, o])
    expect(fb).toMatchObject({ received: false, problem: { resolution: 'resend' } })
    await service(`select public.client_received($1, $2)`, [session, o])
    expect(await status(o)).toBe('arrived')
  })

  it('the clinic marks it received for the client, confirmed by phone', async () => {
    const { order: o, job: j } = await order('CASE-PHONE')
    await db.query(`update public.jobs set status = $2, delivery_status = 'teel' where id = $1`, [j, last])
    expect(await errorAs(db, { id: A.ownerId }, `select public.job_mark_received($1, false, null)`, [j])).toMatch(/client says/)
    await rowsAs(db, { id: A.ownerId }, `select public.job_mark_received($1, true, 'Called Tess')`, [j])
    expect(await status(o)).toBe('arrived')
  })

  describe('the reminder', () => {
    it('after the clinic’s days: "Did your order arrive?" once, to the client; on our own job to the doctor', async () => {
      await features(A.clinicId, { received_reminder_days: 5 })
      const { order: o, job: j } = await order('CASE-REMIND')
      await db.query(`update public.jobs set status = $2, delivery_status = 'teel' where id = $1`, [j, last])
      const own = await ownJob()
      const backdate = async (id: string, days: number) => {
        await db.query(`select set_config('wivo.delivery', 'on', false)`)
        await db.query(`update public.jobs set sent_at = now() - make_interval(days => $2) where id = $1`, [id, days])
        await db.query(`select set_config('wivo.delivery', '', false)`)
      }
      await backdate(j, 4)
      await backdate(own, 4)
      await db.query(`select public.delivery_reminders()`)
      expect((await db.query(`select 1 from public.client_notification where order_id = $1 and kind = 'received_reminder'`, [o])).rows).toHaveLength(0)
      await backdate(j, 6)
      await backdate(own, 6)
      await db.query(`select public.delivery_reminders()`)
      await db.query(`select public.delivery_reminders()`)
      expect((await db.query(`select 1 from public.client_notification where order_id = $1 and kind = 'received_reminder'`, [o])).rows).toHaveLength(1)
      expect((await db.query(`select 1 from public.notification where job_id = $1 and kind = 'received_reminder' and user_id = $2`, [own, doctor])).rows).toHaveLength(1)
    })

    it('not with an open problem, not once received', async () => {
      const own = await ownJob()
      await rowsAs(db, { id: doctor }, `select public.job_report_problem($1, 'missing_parts', 'No screws')`, [own])
      const got = await ownJob()
      await rowsAs(db, { id: doctor }, `select public.job_mark_received($1, false, null)`, [got])
      await db.query(`select set_config('wivo.delivery', 'on', false)`)
      await db.query(`update public.jobs set sent_at = now() - interval '30 days' where id in ($1, $2)`, [own, got])
      await db.query(`select set_config('wivo.delivery', '', false)`)
      await db.query(`select public.delivery_reminders()`)
      expect((await db.query(`select 1 from public.notification where job_id in ($1, $2) and kind = 'received_reminder'`, [own, got])).rows).toHaveLength(0)
    })
  })

  describe('feedback changed later, both sides', () => {
    it('the client and the clinic change their ratings weeks later; every change is kept, for the owner only', async () => {
      await features(A.clinicId, { ratings: true })
      const { order: o, job: j } = await order('CASE-LATER')
      await db.query(`update public.jobs set status = $2, delivery_status = 'teel' where id = $1`, [j, last])
      expect(await serviceError(`select public.client_rate_clinic($1, $2, 4, null)`, [session, o])).toMatch(/Not received/)
      await service(`select public.client_received($1, $2)`, [session, o])
      await service(`select public.client_rate_clinic($1, $2, 4, 'Good')`, [session, o])
      await rowsAs(db, { id: A.ownerId }, `select public.rate_client($1, 5, 'Clear scan')`, [o])
      // Weeks later.
      await db.query(`update public.job_rating set created_at = now() - interval '40 days', updated_at = now() - interval '40 days' where job_id = $1`, [j])
      await service(`select public.client_rate_clinic($1, $2, 2, 'It chipped after a month')`, [session, o])
      await rowsAs(db, { id: A.ownerId }, `select public.rate_client($1, 3, 'Bite was missing')`, [o])
      const ratings = (await db.query<{ direction: string; score: number }>(`select direction, score from public.job_rating where job_id = $1 order by direction`, [j])).rows
      expect(ratings).toEqual([{ direction: 'client_to_clinic', score: 2 }, { direction: 'clinic_to_client', score: 3 }])
      const changes = await rowsAs<{ old_score: number; new_score: number; new_comment: string }>(db, { id: A.ownerId },
        `select c.old_score, c.new_score, c.new_comment from public.job_rating_change c join public.job_rating r on r.id = c.rating_id where r.job_id = $1 order by c.old_score`, [j])
      expect(changes).toEqual([
        { old_score: 4, new_score: 2, new_comment: 'It chipped after a month' },
        { old_score: 5, new_score: 3, new_comment: 'Bite was missing' },
      ])
      expect(await rowsAs(db, { id: A.workerId }, `select 1 from public.job_rating_change`)).toEqual([])
      const fb = await service<{ rating: { score: number } }>(`select public.client_feedback($1, $2) as r`, [session, o])
      expect(fb.rating.score).toBe(2)
    })

    it('our own job: the doctor and the technician change theirs later', async () => {
      const j = await ownJob()
      await rowsAs(db, { id: doctor }, `select public.job_mark_received($1, false, null)`, [j])
      await rowsAs(db, { id: doctor }, `select public.rate_job($1, 'work', 5, null)`, [j])
      await rowsAs(db, { id: A.workerId }, `select public.rate_job($1, 'input', 4, null)`, [j])
      await rowsAs(db, { id: doctor }, `select public.rate_job($1, 'work', 3, 'Contacts were light')`, [j])
      await rowsAs(db, { id: A.workerId }, `select public.rate_job($1, 'input', 2, 'No bite registration')`, [j])
      const n = (await db.query(`select 1 from public.job_rating_change c join public.job_rating r on r.id = c.rating_id where r.job_id = $1`, [j])).rows
      expect(n).toHaveLength(2)
    })
  })
})

describe('who sees what', () => {
  it('another clinic sees none of the problems; the client functions are the service role’s only', async () => {
    expect(await rowsAs(db, { id: B.ownerId }, `select 1 from public.delivery_problem`)).toEqual([])
    expect((await rowsAs(db, { id: A.workerId }, `select 1 from public.delivery_problem`)).length).toBeGreaterThan(0)
    expect(await errorAs(db, { id: A.ownerId }, `select public.client_received('x', gen_random_uuid())`)).toMatch(/permission denied/)
    expect(await errorAs(db, { id: A.ownerId }, `select public.delivery_reminders()`)).toMatch(/permission denied/)
    expect(await errorAs(db, 'anon', `select public.job_mark_received(gen_random_uuid(), true, null)`)).toMatch(/permission denied/)
  })
})
