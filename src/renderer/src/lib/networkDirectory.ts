/**
 * This clinic's entry in the Wivo Network directory, as its owner sees and
 * changes it in Orders → Wivo Network: listed or not, and the invite link.
 *
 * The app never writes to the Network: the clinic's Edge Function
 * network-directory checks the owner and the second factor in this clinic's
 * database, then signs a request with the clinic's own key
 * (shared/network/clinicRequest.ts). docs/NETWORK-SETUP.md, A8 and B5.
 */
import { supabase } from './supabase'
import { phoneUrl } from './releaseNotes'
import { directoryEntryOf, INVITE_CODE, type DirectoryEntry } from '@shared/network/clinicRequest'

export type { DirectoryEntry }

/** Why the entry could not be read or changed, as the card says it. */
export type DirectoryProblem = 'not_available' | 'not_allowed' | 'orders_off' | 'try_again' | 'unreachable'

export class DirectoryError extends Error {
  constructor(public problem: DirectoryProblem) { super(problem) }
}

/** The function's answer, by its status and error, as one of the card's few messages. */
export function directoryProblemOf(status: number | undefined, error: unknown): DirectoryProblem {
  if (status === 403) return 'not_allowed'
  if (error === 'orders_off') return 'orders_off'
  if (error === 'try_again') return 'try_again'
  if (error === 'network_unreachable' || error === 'network_refused') return 'unreachable'
  // Not deployed (404), the secrets missing, the Network number not set: nothing the owner can fix here.
  return 'not_available'
}

async function invoke(body: Record<string, unknown>): Promise<DirectoryEntry> {
  const { data, error } = await supabase.functions.invoke('network-directory', { body })
  if (error) {
    const res = 'context' in error ? (error as { context?: Response }).context : undefined
    let code: unknown = null
    try { code = res ? ((await res.clone().json()) as { error?: unknown })?.error : null } catch { /* not JSON */ }
    throw new DirectoryError(directoryProblemOf(res?.status, code))
  }
  const entry = directoryEntryOf(data)
  if (!entry) throw new DirectoryError('unreachable')
  return entry
}

export const readDirectoryEntry = (): Promise<DirectoryEntry> => invoke({ action: 'get' })
export const setDirectoryListed = (listed: boolean): Promise<DirectoryEntry> => invoke({ action: 'set_listed', listed })

/** The link that opens this clinic in the Network mode of this clinic's phone app. */
export function inviteLink(code: string, base: string = phoneUrl()): string | null {
  return INVITE_CODE.test(code) ? `${base}/network/join/${code}` : null
}
