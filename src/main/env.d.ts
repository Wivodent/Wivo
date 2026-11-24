/// <reference types="vite/client" />

// Build-time variables electron-vite exposes to the main process (MAIN_VITE_*).
interface ImportMetaEnv {
  /** Optional. Without it Sentry is not loaded in the main process. */
  readonly MAIN_VITE_SENTRY_DSN?: string
  /**
   * Which installer this is (docs/RELEASE.md): the clinic's id from
   * scripts/build-clinic.mjs (clinics/<id>.json, e.g. `dentiks`), unset for
   * main's. Decides which release statements count (releaseCheck.ts).
   */
  readonly MAIN_VITE_WIVO_BUILD?: string
  /** A clinic's build: its releases repository (`owner/name`), where its updates come from. */
  readonly MAIN_VITE_WIVO_RELEASES_REPO?: string
  /**
   * A clinic's build: its organisation (clinics/<id>.json orgId), the one a
   * licence delivered with the updates must name (licenceDelivery.ts).
   */
  readonly MAIN_VITE_WIVO_ORG?: string
  /** A clinic's build: its database address, the one a delivered licence must name. */
  readonly MAIN_VITE_WIVO_API?: string
}
