/// <reference types="vite/client" />

// Compile-time constant injected by electron.vite.config.ts (`renderer.define`)
// from package.json. Declared here rather than in a root-level d.ts because
// tsconfig.web.json only includes src/renderer/src/**/*.
declare const __APP_VERSION__: string

// Optional: another instance's stand-in login domain (see lib/supabase.ts).
interface ImportMetaEnv {
  readonly VITE_STANDIN_DOMAIN?: string
  /** Optional. Without it Sentry is not loaded at all. */
  readonly VITE_SENTRY_DSN?: string
  /** Phone app only (lib/push.ts). Without it "Notifications on this phone" says push is not set up. */
  readonly VITE_VAPID_PUBLIC_KEY?: string
  /**
   * The clinic's own phone app, shown in "What's new" (lib/releaseNotes.ts).
   * A clinic's build: its phoneUrl (clinics/<id>.json, Cloudflare), e.g. https://wivo.dentiks.lv. Without it, app.wivodent.com.
   */
  readonly VITE_PHONE_URL?: string
  /** Wivo's own address for "Request a feature" and "Ask Wivo" (config/contact.ts). Without it those buttons are hidden. */
  readonly VITE_WIVO_CONTACT_EMAIL?: string
  /**
   * The Wivo Network project (docs/NETWORK-SETUP.md), for the phone app's
   * Network mode at /network. Both public. Without them the mode says it is
   * not set up.
   */
  readonly VITE_NETWORK_URL?: string
  readonly VITE_NETWORK_ANON_KEY?: string
}

// Preload bridge (src/preload/index.ts). Optional: during `dev` the renderer can
// also be opened in a plain browser tab, where no preload has run.
interface Window {
  wivo?: {
    getVersion: () => Promise<string>
    setUiLanguage: (lang: string) => Promise<void>
    relaunch: () => Promise<void>
    checkRemoteUpdate: () => Promise<boolean>
    gitPull: () => Promise<string | null>
    // The 3D tooth model's bytes, or null when it is not installed. Read in
    // the main process because Chromium refuses fetch() on file:// — see
    // readTeethModel in src/main/index.ts.
    getTeethModel: () => Promise<ArrayBuffer | null>
    // Auto-update. One channel, and every listener hands back its remover —
    // see the note in src/preload/index.ts about the leak this replaced.
    updateState: () => Promise<import('../../types/update').UpdateState>
    onUpdateState: (
      cb: (s: import('../../types/update').UpdateState) => void
    ) => () => void
    installNow: () => Promise<void>
    checkNow: () => Promise<void>
    /** Where this installer's updates come from (docs/RELEASE.md). Older preloads lack it. */
    updateInfo?: () => Promise<import('../../types/update').UpdateInfo>
    /** The minimum version from the signed release list (main/releaseMinimum.ts). From 2.2.1. */
    releaseMinimum?: () => Promise<import('../../types/update').ReleaseMinimum>
    onReleaseMinimum?: (cb: (m: import('../../types/update').ReleaseMinimum) => void) => () => void
    /** Older builds of the preload do not have it. */
    busy?: () => Promise<{ downloads: number; otherWindows: number }>
    onSplashState: (
      cb: (s: import('../../types/update').UpdaterSplashState) => void
    ) => () => void
    /**
     * The licence's modules, and the API addresses it allows.
     *
     * Both optional: a build whose preload predates them must keep working,
     * and the renderer reads their absence as "no restriction" — see
     * hooks/useLicense.ts and lib/licensedApi.ts.
     */
    licenseModules?: () => Promise<string[]>
    licensedApi?: () => string[]
    /** A licence delivered with the updates, until the owner has seen it (main/licenceDelivery.ts). From 2.0.7. */
    licenceChange?: () => Promise<unknown>
    licenceChangeSeen?: () => Promise<void>
    onLicenceUpdated?: (cb: (change: unknown) => void) => () => void
    htmlToPdf?: (html: string) => Promise<Uint8Array>
    readSound?: (file: string) => Promise<ArrayBuffer | null>
    // The scanner export folder — src/main/watchFolder.ts.
    watchFolder?: {
      get: () => Promise<string | null>
      choose: () => Promise<string | null>
      list: () => Promise<{ path: string; name: string; size: number; modifiedAt: number; key: string }[]>
      read: (path: string) => Promise<Uint8Array>
      handled: (key: string, jobId: string | null) => Promise<void>
      onChanged: (cb: () => void) => () => void
    }
  }
}
