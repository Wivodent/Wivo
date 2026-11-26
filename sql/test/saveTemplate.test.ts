/**
 * sql/133: a workflow template is saved in one step.
 *
 * The four requests it replaced could leave a template with no stages when
 * the connection broke after the delete. One function call is one statement:
 * whatever fails inside it, the template is as it was.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, createTenant, createUser, rowsAs, errorAs, type Tenant } from './harness'

let db: PGlite
let A: Tenant
let B: Tenant

const call = `select public.save_workflow_template($1::uuid, $2::text, $3::jsonb, $4::timestamptz) as r`
const stage = (key: string, extra: Record<string, unknown> = {}) => ({
  stage_key: key, task: null, optional: false, default_on: false, only_if: [], orderer: false, pay_role: null, people: [], ...extra,
})

async function save(actor: { id: string }, id: string | null, name: string, stages: unknown[], expected: string | null = null) {
  const [row] = await rowsAs<{ r: { id: string; updated_at: string } }>(db, actor, call, [id, name, JSON.stringify(stages), expected])
  return row.r
}
async function stagesOf(id: string): Promise<{ stage_key: string; position: number; people: string[] }[]> {
  return (await db.query<{ stage_key: string; position: number; people: string[] }>(`
    select s.stage_key, s.position,
           coalesce(array_agg(p.profile_id::text order by p.profile_id) filter (where p.profile_id is not null), '{}') as people
      from public.workflow_template_stage s
      left join public.workflow_template_stage_person p on p.template_stage_id = s.id
     where s.template_id = $1 group by s.id order by s.position`, [id])).rows
}

beforeAll(async () => {
  db = await freshDb()
  A = await createTenant(db, 'Lab A')
  B = await createTenant(db, 'Lab B')
}, 120_000)

describe('save_workflow_template (sql/133)', () => {
  it('a new template with its stages and people, in one call', async () => {
    const owner = { id: A.ownerId }
    const t = await save(owner, null, 'Crowns', [stage('disain', { people: [A.workerId], pay_role: 'disain' }), stage('print'), stage('valmis')])
    expect(t.id).toBeTruthy()
    expect(await stagesOf(t.id)).toEqual([
      { stage_key: 'disain', position: 0, people: [A.workerId] },
      { stage_key: 'print', position: 1, people: [] },
      { stage_key: 'valmis', position: 2, people: [] },
    ])
  })

  it('saved again over its own version: the stages are replaced, updated_at moves', async () => {
    const owner = { id: A.ownerId }
    const t = await save(owner, null, 'Bridges', [stage('disain'), stage('valmis')])
    const again = await save(owner, t.id, 'Bridges 2', [stage('mudel'), stage('disain'), stage('valmis')], t.updated_at)
    expect(again.id).toBe(t.id)
    expect(again.updated_at).not.toBe(t.updated_at)
    expect((await stagesOf(t.id)).map(s => s.stage_key)).toEqual(['mudel', 'disain', 'valmis'])
  })

  it('somebody else saved first: WV003, and nothing changes', async () => {
    const owner = { id: A.ownerId }
    const t = await save(owner, null, 'Veneers', [stage('disain'), stage('valmis')])
    await save(owner, t.id, 'Veneers', [stage('disain'), stage('print'), stage('valmis')], t.updated_at)   // the other one
    const err = await errorAs(db, owner, call, [t.id, 'Veneers mine', JSON.stringify([stage('valmis')]), t.updated_at])
    expect(err).toMatch(/Someone else saved this template/)
    expect((await stagesOf(t.id)).map(s => s.stage_key)).toEqual(['disain', 'print', 'valmis'])
    expect((await db.query<{ name: string }>(`select name from public.workflow_template where id = $1`, [t.id])).rows[0].name).toBe('Veneers')
  })

  it('a failure part way through (the third stage is refused) leaves the template as it was: never without stages', async () => {
    const owner = { id: A.ownerId }
    const t = await save(owner, null, 'Dentures', [stage('disain'), stage('valmis')])
    // Two stages with the same pay kind: the database refuses the second, after
    // the delete and the first insert have run inside the call.
    const err = await errorAs(db, owner, call, [t.id, 'Dentures', JSON.stringify([
      stage('mudel', { pay_role: 'too' }), stage('disain'), stage('print', { pay_role: 'too' }),
    ]), t.updated_at])
    expect(err).not.toBeNull()
    expect((await stagesOf(t.id)).map(s => s.stage_key)).toEqual(['disain', 'valmis'])
  })

  it('a person of another clinic on a stage: refused, and nothing is saved', async () => {
    const owner = { id: A.ownerId }
    const t = await save(owner, null, 'Inlays', [stage('disain')])
    const err = await errorAs(db, owner, call, [t.id, 'Inlays', JSON.stringify([stage('print'), stage('disain', { people: [B.workerId] })]), t.updated_at])
    expect(err).not.toBeNull()
    expect((await stagesOf(t.id)).map(s => s.stage_key)).toEqual(['disain'])
  })

  it('without "Manage stages", another clinic, or signed out: refused', async () => {
    const t = await save({ id: A.ownerId }, null, 'Guards', [stage('disain')])
    // A worker of the same clinic, without pipeline.write.
    expect(await errorAs(db, { id: A.workerId }, call, [t.id, 'X', JSON.stringify([stage('x')]), null])).not.toBeNull()
    // Another clinic's owner, by id.
    expect(await errorAs(db, { id: B.ownerId }, call, [t.id, 'X', JSON.stringify([stage('x')]), null])).not.toBeNull()
    // Nobody signed in.
    expect(await errorAs(db, 'anon', call, [t.id, 'X', JSON.stringify([stage('x')]), null])).not.toBeNull()
    expect((await stagesOf(t.id)).map(s => s.stage_key)).toEqual(['disain'])
    // A user with no clinic at all.
    const stray = await createUser(db, 'No clinic')
    expect(await errorAs(db, { id: stray }, call, [null, 'X', JSON.stringify([]), null])).toMatch(/No clinic|permission|row-level/i)
  })
})
