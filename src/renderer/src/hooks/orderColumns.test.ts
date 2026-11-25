/**
 * sql/128 in the app: a database without "who ordered it" refuses a job that
 * names order_source or order_doctor; the app saves the same job without them.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../lib/supabase', () => ({ supabase: {} }))
const { lacksOrderColumns, withoutOrderColumns } = await import('./useJobs')

describe("a database without sql/128's columns", () => {
  it('recognises the refusal: PostgREST, or create_job naming the field', () => {
    expect(lacksOrderColumns({ code: 'PGRST204', message: "Could not find the 'order_source' column of 'jobs' in the schema cache" })).toBe(true)
    expect(lacksOrderColumns({ code: '42703', message: 'Unknown job field: order_source, order_doctor' })).toBe(true)
  })

  it('anything else is not this', () => {
    expect(lacksOrderColumns({ code: '42703', message: 'Unknown job field: template_id' })).toBe(false)
    expect(lacksOrderColumns({ code: '42501', message: 'order_source' })).toBe(false)
    expect(lacksOrderColumns(null)).toBe(false)
  })

  it('the job is kept whole but for the two columns', () => {
    expect(withoutOrderColumns({ patsient: 'X', order_source: 'own', order_doctor: 'u1', customer_id: null }))
      .toEqual({ patsient: 'X', customer_id: null })
  })
})
