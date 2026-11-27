/**
 * What a database refusal is really about.
 *
 * The database answers 42501 ("insufficient privilege") for far more than a
 * missing permission: a job that is gone, a move the clinic's stage rules do
 * not allow, a move into a stage switched off for the job, a paused
 * partnership, a sign-in that ran out. Shown as one "You don't have permission
 * for this. Ask your clinic's owner." it sent an owner to ask themselves.
 *
 * The messages matched here are the database's own (sql/, `raise exception`),
 * in English and stable: a message not listed stays "no permission".
 */
import type { MessageKey } from '@shared/i18n/en'

export type Refusal =
  | 'noPermission'
  | 'gone'
  | 'stageMoveRefused'
  | 'stageRule'
  | 'notYourStage'
  | 'partnerStage'
  | 'partnershipPaused'
  | 'signIn'
  | 'secondFactor'
  | 'tooMany'
  | 'permanent'
  | 'notClinicMember'
  | 'noClinic'

const RULES: readonly (readonly [RegExp, Refusal])[] = [
  // Job, File, Order, Question, Patient, Item, Partnership not found; sql/134, 136.
  [/\bnot found$|^This job cannot be changed$/i, 'gone'],
  // sql/123 stage_move_verdict refused: not on the stage, or the target is switched off for the job.
  [/^You may not move this job from /, 'stageMoveRefused'],
  // sql/071 stage_transition: the clinic's stage rules.
  [/^Moving from .+ to .+ is not allowed$/, 'stageRule'],
  [/^Stage .+ is not yours to move$/, 'partnerStage'],
  [/^This stage is not yours$/, 'notYourStage'],
  [/^The partnership is not active$/, 'partnershipPaused'],
  [/^Sign in first$|^Session not valid$/, 'signIn'],
  [/second factor first|two-factor authentication first|authenticator app first/i, 'secondFactor'],
  [/^Too many /, 'tooMany'],
  [/append-only$|^Stock movements cannot be (changed|removed)$/, 'permanent'],
  [/^Only members of the clinic can be put on a stage$/, 'notClinicMember'],
  [/^Not a member of a clinic$|^No clinic$/, 'noClinic'],
]

/** Is this the database refusing (42501, or a row-security denial)? */
export function isRefusal(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null
  return e?.code === '42501' || /row-level security/i.test(e?.message ?? '')
}

/** The reason behind a refusal; null for an error that is not one. Pure. */
export function refusalOf(err: unknown): Refusal | null {
  if (!isRefusal(err)) return null
  const msg = ((err as { message?: string } | null)?.message ?? '').trim()
  for (const [re, reason] of RULES) if (re.test(msg)) return reason
  return 'noPermission'
}

/** What each reason says on screen. */
export const REFUSAL_TEXT: Readonly<Record<Refusal, MessageKey>> = {
  noPermission: 'app.noPermission',
  gone: 'conflict.gone',
  stageMoveRefused: 'workflow.moveRefused',
  stageRule: 'workflow.moveAgainstRule',
  notYourStage: 'workflow.notYourStage',
  partnerStage: 'workflow.partnerStageNotYours',
  partnershipPaused: 'workflow.partnershipPaused',
  signIn: 'security.signInAgain',
  secondFactor: 'team.errorMfa',
  tooMany: 'app.tooManyTries',
  permanent: 'app.permanentRecord',
  notClinicMember: 'workflow.onlyClinicMembers',
  noClinic: 'settingsPage.yourAccountHasNoClinic',
}
