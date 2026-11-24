/// <reference types="vite/client" />

// Build-time variables electron-vite exposes to the main process (MAIN_VITE_*).
interface ImportMetaEnv {
  /** Optional. Without it Sentry is not loaded in the main process. */
  readonly MAIN_VITE_SENTRY_DSN?: string
  /**
   * Which installer this is (docs/RELEASE.md): `riga` from scripts/build-riga.mjs,
   * unset for main's. Decides where updates come from and which release
   * statements count (releaseCheck.ts).
   */
  readonly MAIN_VITE_WIVO_BUILD?: string
}
