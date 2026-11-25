/**
 * "Ordered by" on the job (sql/128): our clinic names a doctor and no client;
 * another clinic or a dentist names the client and their order number; an
 * old draft that never answered keeps its client and says nothing.
 */
import { describe, it, expect } from 'vitest'
import { createEmptyNewJobState } from '@shared/wizard'
import { toJobInput } from './toJobInput'

const ctx = { defaultStatus: 'disain', quote: { production: 0, unpriced: [] } as never, types: [] }
const base = { ...createEmptyNewJobState(), customer: 'cust-1', customerReference: ' T-118 ', orderDoctor: 'doc-1' }

describe('who ordered the job', () => {
  it('our clinic: the doctor, no client, no order number', () => {
    const j = toJobInput({ ...base, orderSource: 'own' }, ctx)
    expect(j).toMatchObject({ order_source: 'own', order_doctor: 'doc-1', customer_id: null, customer_ref: null })
  })

  it.each(['clinic', 'person'] as const)('%s: the client and their order number, no doctor', source => {
    const j = toJobInput({ ...base, orderSource: source }, ctx)
    expect(j).toMatchObject({ order_source: source, order_doctor: null, customer_id: 'cust-1', customer_ref: 'T-118' })
  })

  it('not answered (a draft from before 2.2.0): the client as before, the source unsaid', () => {
    const j = toJobInput({ ...base, orderSource: null }, ctx)
    expect(j).toMatchObject({ order_source: null, order_doctor: null, customer_id: 'cust-1', customer_ref: 'T-118' })
  })
})
