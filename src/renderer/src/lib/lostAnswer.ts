/**
 * A request whose answer never came back: the network dropped it, not the
 * database. supabase-js reports it as "TypeError: Failed to fetch" (Chrome),
 * "NetworkError …" (Firefox) or "Load failed" (Safari). The request may well
 * have reached the database and done its work, so the caller checks before it
 * reports a failure (the invoice delete, 2026-11-27).
 */
export function isLostAnswer(e: unknown): boolean {
  const m = (e as { message?: string } | null)?.message ?? ''
  return /Failed to fetch|NetworkError|Load failed|network request failed/i.test(m)
}
