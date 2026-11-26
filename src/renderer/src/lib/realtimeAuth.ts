/**
 * Realtime carries the sign-in with the second factor (2.2.3).
 *
 * Every table answers only a session signed in with the second factor
 * (sql/098), realtime's changes included: the database checks the token the
 * realtime connection holds. supabase-js hands realtime a new token on
 * SIGNED_IN, TOKEN_REFRESHED and INITIAL_SESSION, but not on
 * MFA_CHALLENGE_VERIFIED. So after signing in and typing the code, the
 * connection kept the token from BEFORE the code, every change was refused
 * to it, and a job changed on another computer (a note, a price) reached
 * this screen only at the next token refresh, up to an hour, or on Ctrl+R.
 * A session already verified when the app started was not affected.
 *
 * This passes on every new token, whatever the event; the same token twice
 * changes nothing.
 */
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'

export interface TokenFollowerDeps {
  onAuthStateChange: (cb: (event: AuthChangeEvent, session: Session | null) => void) => unknown
  setRealtimeAuth: (token?: string) => unknown
}

export function followTokenForRealtime(deps: TokenFollowerDeps): void {
  let last: string | undefined
  deps.onAuthStateChange((event, session) => {
    const token = session?.access_token
    if (event === 'SIGNED_OUT' || !token) { last = undefined; return }
    if (token === last) return
    last = token
    // Off the auth callback: a call back into the client from inside it can deadlock auth-js.
    setTimeout(() => { void Promise.resolve(deps.setRealtimeAuth(token)).catch(() => {}) }, 0)
  })
}
