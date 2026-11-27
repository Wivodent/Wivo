/**
 * Who may give which feedback on a job (sql/146), as the database decides it,
 * so the job page shows each person only what they may save:
 *
 *   mayFit      Fitted / Needs adjustment: our own job only (an order from
 *               outside: the client says it); the doctor who ordered it, a
 *               doctor of the clinic, or the owner
 *   rateWork    the doctor who ordered it (or the owner, for our own job with
 *               no doctor on it) rates the technician and the designer
 *   rateInput   the technician or designer rates the doctor who ordered it
 *   rateClient  an order from outside: the technician, the designer or the
 *               owner rates the client's input
 *
 * Until it is known whether the job came from an order, nothing that differs
 * between the two is offered.
 */
export interface FeedbackRoles { mayFit: boolean; rateWork: boolean; rateInput: boolean; rateClient: boolean }

export function feedbackRoles(
  job: { order_doctor?: string | null; assigned_to?: string | null; designed_by?: string | null },
  who: { me: string | null; isOwner: boolean; isDoctor: boolean; fromOutside: boolean; orderKnown: boolean },
): FeedbackRoles {
  const { me, isOwner, isDoctor, fromOutside, orderKnown } = who
  if (!me) return { mayFit: false, rateWork: false, rateInput: false, rateClient: false }
  const maker = job.assigned_to === me || job.designed_by === me
  const own = orderKnown && !fromOutside
  return {
    mayFit: own && (isOwner || isDoctor || job.order_doctor === me),
    rateWork: own && (job.order_doctor === me || (!job.order_doctor && isOwner)),
    rateInput: maker && !!job.order_doctor && job.order_doctor !== me,
    rateClient: orderKnown && fromOutside && (maker || isOwner),
  }
}
