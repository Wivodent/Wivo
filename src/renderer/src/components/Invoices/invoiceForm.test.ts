/**
 * Two things found in testing: "Bill to: Client" said "Select a patient to see
 * their unbilled jobs" even with a client chosen (the list looked at the
 * patient only), and the Orders tabs showed a count on some tabs and not others.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const read = (p: string) => readFileSync(p, 'utf8')

describe('the invoice form and the Orders tabs', () => {
  it('Unbilled work follows the addressee: a client, or a patient', () => {
    const form = read('src/renderer/src/components/Invoices/InvoiceForm.tsx')
    expect(form).toContain("const addresseeChosen = billTo === 'customer' ? !!customerId : !!patientKey")
    expect(form).toContain("{!addresseeChosen ? (")
    expect(form).toContain("billTo === 'customer' ? t('invoices.selectAClientToSee') : t('invoices.selectAPatientToSeeTheir')")
    expect(form).not.toMatch(/\{!patientKey \? \(/)
    // Ticked, and opened from Clients addressed to that client.
    expect(form).toContain('type="checkbox"')
    expect(form).toContain("useState<BillToKind>(initialCustomerId ? 'customer' : 'patient')")
    expect(read('src/renderer/src/components/Customers/CustomersView.tsx')).toContain('<InvoiceForm jobs={jobs} initialCustomerId={invoicing}')
  })

  it('every Orders tab shows its count, the same way', () => {
    const orders = read('src/renderer/src/components/Network/OrdersView.tsx')
    expect(orders).toContain('{tabLabel(k)} · {perTab[k]}')
    expect(orders).not.toContain('COUNTED')
  })
})
