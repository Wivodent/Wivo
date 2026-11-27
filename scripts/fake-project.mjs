/**
 * Which Supabase projects may hold fake data, for scripts/seed-fake-clinic.mjs
 * and for `npm run dev:fake` (config/testFakeEnv.ts).
 *
 * A fake project is a project of its own: never production (Tallinn's old
 * project), never the test copy (made from production, it holds real data),
 * never a clinic's own project (each in clinics/<id>.json as `supabaseRef`).
 * These three are refused by their ids, so a wrong paste stops before anything
 * is sent.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Kept in step with src/renderer/src/lib/testCopy.ts (the test checks it). */
export const PRODUCTION_REF = 'wrtucsfmpbwekugzzzxw'
export const TEST_COPY_REF = 'jhqyvancrzykxhzwnost'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Every clinic's own project, from clinics/*.json. */
export function clinicRefs(root = ROOT) {
  const dir = join(root, 'clinics')
  const out = []
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue
    try {
      const ref = JSON.parse(readFileSync(join(dir, name), 'utf8')).supabaseRef
      if (typeof ref === 'string' && ref) out.push(ref)
    } catch { /* not a clinic file */ }
  }
  return out
}

/** Why this project may not hold fake data, or null when it may. */
export function refusedRef(ref, root = ROOT) {
  if (!/^[a-z0-9]{20}$/.test(ref ?? '')) return 'that is not a Supabase project id (20 lowercase letters and digits)'
  if (ref === PRODUCTION_REF) return 'that is PRODUCTION'
  if (ref === TEST_COPY_REF) return 'that is the TEST COPY, which holds real data'
  if (clinicRefs(root).includes(ref)) return "that is a clinic's own project"
  return null
}

/**
 * The project id in a Postgres connection string: the session pooler's user
 * (`postgres.<ref>`) or the direct host (`db.<ref>.supabase.co`). Null when
 * neither says it, and then nothing is sent: a project that cannot be named
 * cannot be checked.
 */
export function refOfConnection(conn) {
  let url
  try { url = new URL(conn) } catch { return null }
  if (!/^postgres(ql)?:$/.test(url.protocol)) return null
  const user = decodeURIComponent(url.username)
  const fromUser = /^postgres\.([a-z0-9]{20})$/.exec(user)?.[1]
  const fromHost = /^db\.([a-z0-9]{20})\.supabase\.co$/.exec(url.hostname)?.[1]
  if (fromUser && fromHost && fromUser !== fromHost) return null
  return fromUser ?? fromHost ?? null
}

/** The psql environment for a connection string; the password from it, if any, is moved out of it. */
export function psqlEnv(conn, password) {
  const url = new URL(conn)
  return {
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGDATABASE: decodeURIComponent(url.pathname.replace(/^\//, '')) || 'postgres',
    PGPASSWORD: password || decodeURIComponent(url.password),
    PGSSLMODE: 'require',
  }
}

/** The ref in a Supabase project URL (https://<ref>.supabase.co), or null. */
export function refOfProjectUrl(u) {
  try {
    const url = new URL(u)
    if (url.protocol !== 'https:' || url.pathname.replace(/\/$/, '') !== '' || url.search || url.hash) return null
    return /^([a-z0-9]{20})\.supabase\.co$/.exec(url.hostname)?.[1] ?? null
  } catch { return null }
}
