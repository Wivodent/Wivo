/**
 * A database refusal (42501) is told by its reason, not always as "no
 * permission": an owner moving a job into a stage switched off on it was told
 * to ask the clinic's owner.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { REFUSAL_TEXT, refusalOf, type Refusal } from './refusal'
import { describeError } from '../components/Patients/errors'
import { en } from '@shared/i18n/en'
import { t } from './i18n'

import { et } from '@shared/i18n/et'
import { ru } from '@shared/i18n/ru'

const refused = (message: string) => ({ code: '42501', message })

/** The database's own words (sql/), with what they are about. */
const CASES: [string, Refusal][] = [
  ['Job not found', 'gone'],
  ['File not found', 'gone'],
  ['Order not found', 'gone'],
  ['This job cannot be changed', 'gone'],
  ['You may not move this job from design to milling', 'stageMoveRefused'],
  ['Moving from design to milling is not allowed', 'stageRule'],
  ['Stage design is not yours to move', 'partnerStage'],
  ['This stage is not yours', 'notYourStage'],
  ['The partnership is not active', 'partnershipPaused'],
  ['Sign in first', 'signIn'],
  ['Session not valid', 'signIn'],
  ['Sign in with your second factor first', 'secondFactor'],
  ['Enter a code from your authenticator app first', 'secondFactor'],
  ['Too many wrong codes. Try again in an hour.', 'tooMany'],
  ['audit_log is append-only', 'permanent'],
  ['Stock movements cannot be removed', 'permanent'],
  ['Only members of the clinic can be put on a stage', 'notClinicMember'],
  ['Not a member of a clinic', 'noClinic'],
  ['No permission to move jobs', 'noPermission'],
  ['Only the owner can change this', 'noPermission'],
  ['new row violates row-level security policy for table "jobs"', 'noPermission'],
]

describe('refusalOf', () => {
  it.each(CASES)('"%s" → %s', (message, reason) => {
    expect(refusalOf(refused(message))).toBe(reason)
  })

  it('an error that is not a refusal is none', () => {
    expect(refusalOf({ code: '22023', message: 'Job not found' })).toBeNull()
    expect(refusalOf(null)).toBeNull()
    expect(refusalOf(new Error('network down'))).toBeNull()
  })

  it('a row-security denial without the code is a refusal too', () => {
    expect(refusalOf({ message: 'new row violates row-level security policy' })).toBe('noPermission')
  })

  it('the messages it reads are the ones the database raises', () => {
    // If a migration rewords one, the screen would fall back to "no permission":
    // the test says so first. Placeholders (%) are what the database fills in.
    const dir = join(__dirname, '../../../../sql')
    const raised = new Set<string>()
    for (const f of readdirSync(dir).filter(n => n.endsWith('.sql'))) {
      for (const m of readFileSync(join(dir, f), 'utf8').matchAll(/raise exception '((?:[^']|'')*)'[^;]*errcode = '42501'/g)) {
        raised.add(m[1].replace(/''/g, "'"))
      }
    }
    const asRaised = (msg: string) => [...raised].some(r => new RegExp(`^${r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.+')}$`).test(msg))
    for (const [message, reason] of CASES) {
      if (reason === 'noPermission' && /row-level/.test(message)) continue
      expect(asRaised(message), message).toBe(true)
    }
  })
})

describe('what it says', () => {
  it('every reason has its text in English, Estonian and Russian', () => {
    for (const key of Object.values(REFUSAL_TEXT)) {
      expect(en[key], key).toBeTruthy()
      expect((et as Record<string, string>)[key], `et ${key}`).toBeTruthy()
      expect((ru as Record<string, string>)[key], `ru ${key}`).toBeTruthy()
    }
  })

  it('describeError: a move against the stage rules is not "no permission"; a missing permission still is', () => {
    expect(describeError(refused('Moving from design to milling is not allowed'))).toBe(t('workflow.moveAgainstRule'))
    expect(describeError(refused('Job not found'))).toBe(t('conflict.gone'))
    expect(describeError(refused('No permission to move jobs'))).toBe(t('app.noPermission'))
  })
})
