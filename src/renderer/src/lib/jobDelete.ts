/**
 * What deleting a job may do (sql/146), from what the database says it is
 * tied to (job_delete_check). Pure: the dialog and its test share it.
 */

export interface DeleteCheck {
  job_code: string | null
  order: { id: string; ref: string; client: string | null } | null
  invoice_lines: number
  payments: number
  pay_lines: number
  files: number
  blocked: 'money' | 'pay' | null
}

/**
 * blocked_money / blocked_pay: cannot be deleted; order: the client's order
 * is cancelled (the code typed, a reason); plain: a plain confirmation. No
 * check (a database before 146, or still loading): plain.
 */
export type DeleteVerdict = 'blocked_money' | 'blocked_pay' | 'order' | 'plain'

export function deleteVerdict(c: DeleteCheck | null): DeleteVerdict {
  if (!c) return 'plain'
  if (c.blocked === 'money' || c.invoice_lines > 0 || c.payments > 0) return 'blocked_money'
  if (c.blocked === 'pay' || c.pay_lines > 0) return 'blocked_pay'
  return c.order ? 'order' : 'plain'
}

/** The typed code, as the database compares it: trimmed, any case. */
export const codeMatches = (typed: string, code: string | null | undefined): boolean =>
  !!code && typed.trim().toLowerCase() === code.trim().toLowerCase()

/** The bin shows the last 30 days; older deleted jobs are behind "Show older". */
export const BIN_DAYS = 30
export function inBinWindow(deletedAt: string, now: Date = new Date()): boolean {
  return now.getTime() - new Date(deletedAt).getTime() <= BIN_DAYS * 86_400_000
}
