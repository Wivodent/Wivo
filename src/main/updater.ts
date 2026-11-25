/**
 * Silent auto-update. Stage during the session, install at the next launch.
 *
 * ── The shape, and why ───────────────────────────────────────────────────────
 *   session N    check → download in the background → write a marker → quiet toast
 *   quit         nothing happens
 *   session N+1  marker present → splash → install silently → relaunch as new
 *
 * The owner's words were "like Discord": every launch checks, does it itself,
 * and comes up as the new version. Manual reinstall was the thing to kill — the
 * designer works in another building and nobody can walk a .exe over to them.
 *
 * ── Facts this file depends on, read out of electron-updater 6.8.9 ───────────
 * 1. `quitAndInstall(isSilent, isForceRunAfter)` calls
 *    `install(isSilent, isSilent ? isForceRunAfter : autoRunAppAfterInstall)`.
 *    `isForceRunAfter` is HONOURED ONLY WHEN `isSilent` IS TRUE. The old call
 *    was `(false, true)` — it showed the installer wizard and threw the `true`
 *    away, which is exactly the "unprofessional" part being removed.
 * 2. A staged file CANNOT be installed without `downloadUpdate()` running in
 *    this process. `install()` needs both `downloadedUpdateHelper.file` and
 *    `.downloadedFileInfo`; the cache path sets only the first. So the launch
 *    flow always calls `downloadUpdate()` — on a cache hit it costs ~nothing,
 *    because the helper re-verifies the sha512 on disk and returns at once.
 * 3. `download-progress` is only emitted when something is already listening
 *    (`listenerCount > 0`), so handlers are registered before any call.
 * 4. `autoInstallOnAppQuit` only arms itself after a download completes IN THIS
 *    process — a file staged in an earlier session is not installed on quit.
 *    It is therefore off, and the launch path owns installing.
 *
 * ── The one rule that outranks everything here ───────────────────────────────
 * AN UPDATE MUST NEVER STOP SOMEBODY WORKING. Every failure path in this file
 * ends the same way: open the app on the version already installed, quietly.
 * This is a dental lab; the app opening is worth more than the app being new.
 */
import { app, BrowserWindow, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import { appendFileSync, readFileSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import type { UpdateInfo, UpdateState, UpdaterSplashState } from '../types/update'
import { BUILD, CLINIC_SOURCE, SOURCES, feedUrlFor, releaseCheckDeps, verifyDownloadedApp } from './releaseCheck'
import { PINNED_ROOTS, limitedFetcher } from '../../shared/release/release'
import { checkDeliveredLicence } from './licenceDelivery'
import { checkReleaseMinimum, isBelow, storedMinimum, type MinimumStatus } from './releaseMinimum'

/**
 * Test mode (`npm run dev:test`) never checks, downloads or installs a
 * release: a release installed over the test setup would replace the code
 * under test. The renderer hides the notice and the buttons there too.
 */
const TEST_MODE = import.meta.env.MODE === 'test'

/** How long the launch-time feed check may take before we give up and open. */
const CHECK_MS = 6_000
/** Belt and braces around the whole launch flow. */
const TOTAL_MS = 20_000
/** First background check, once the window is up and auth has settled. */
const FIRST_CHECK_MS = 30_000
/**
 * 30 minutes, not 5. CI publishes a release on every version bump, and at five
 * minutes a busy afternoon would have every machine re-fetching repeatedly.
 */
const EVERY_MS = 30 * 60_000

// ── Logging ──────────────────────────────────────────────────────────────────
// `console.error` in a packaged Windows app goes nowhere, which is why "the
// update just didn't happen" has no answer without this. electron-updater logs
// every decision it makes, including "Update has already been downloaded to…"
// and the exact install flags — that file IS the diagnosis.
const logPath = (): string => join(app.getPath('userData'), 'updater.log')

function log(level: string, ...args: unknown[]): void {
  const line = `${new Date().toISOString()} ${level} ${args
    .map(a => (a instanceof Error ? a.stack ?? a.message : typeof a === 'string' ? a : JSON.stringify(a)))
    .join(' ')}\n`
  try {
    appendFileSync(logPath(), line)
  } catch {
    // A log that cannot be written must not take the app down with it.
  }
}

// ── The marker ───────────────────────────────────────────────────────────────
/**
 * Our own file, not electron-updater's `pending/update-info.json`.
 *
 * That one is marked `@private`, carries no version (only a filename and a
 * hash), and survives a completed install — so it cannot tell "staged" from
 * "already applied". This one can, and it carries the attempt counter that
 * stops a broken release relaunching forever.
 */
interface StagedUpdate {
  version: string
  stagedAt: string
  attempts: number
}

const markerPath = (): string => join(app.getPath('userData'), 'update-state.json')

function readMarker(): StagedUpdate | null {
  try {
    const raw = JSON.parse(readFileSync(markerPath(), 'utf-8')) as Partial<StagedUpdate>
    if (typeof raw.version !== 'string' || !raw.version) return null
    return {
      version: raw.version,
      stagedAt: typeof raw.stagedAt === 'string' ? raw.stagedAt : '',
      attempts: Number.isFinite(raw.attempts) ? Number(raw.attempts) : 0,
    }
  } catch {
    return null
  }
}

function writeMarker(m: StagedUpdate): void {
  try {
    writeFileSync(markerPath(), JSON.stringify(m, null, 2))
  } catch (err) {
    log('WARN', 'marker write failed', err)
  }
}

function clearMarker(): void {
  try {
    rmSync(markerPath(), { force: true })
  } catch {
    // Nothing to do: a stale marker costs at most three wasted launch checks.
  }
}

/**
 * Is `a` newer than `b`? Major.minor.patch only.
 *
 * Hand-rolled because `semver` is NOT shipped: it reaches node_modules only as
 * a Babel devDependency, and the packaged asar does not contain it. A
 * pre-release suffix is ignored, which is safe here — the worst case is a
 * marker that fails to clear, and the attempt counter already bounds that.
 */
function isNewer(a: string, b: string): boolean {
  const parts = (v: string): number[] =>
    v.split('-')[0].split('.').map(n => parseInt(n, 10) || 0)
  const x = parts(a)
  const y = parts(b)
  for (let i = 0; i < 3; i++) {
    const xi = x[i] ?? 0
    const yi = y[i] ?? 0
    if (xi !== yi) return xi > yi
  }
  return false
}

// ── State, pushed to whoever is listening ────────────────────────────────────
let lastState: UpdateState = { stage: 'idle' }
let mainWindow: BrowserWindow | null = null
let splash: BrowserWindow | null = null
/** True from the moment quitAndInstall is called, so window-all-closed stands down. */
let installing = false

export const isInstalling = (): boolean => installing
export const setMainWindow = (w: BrowserWindow | null): void => { mainWindow = w }

function pushState(s: UpdateState): void {
  lastState = s
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('wivo:update-state', s)
  }
}

function pushSplash(s: UpdaterSplashState): void {
  if (splash && !splash.isDestroyed()) {
    splash.webContents.send('wivo:splash-state', s)
  }
}

// ── The splash ───────────────────────────────────────────────────────────────
/**
 * Small, frameless, centred — and MOVABLE. A frameless always-on-top window
 * that cannot be dragged is a support call waiting to happen.
 *
 * Its own renderer entry (`updater.html`) rather than a route in the app: this
 * has to paint in a fraction of a second, and mounting React, framer-motion and
 * recharts to draw a progress bar defeats the point.
 */
function createSplash(from: string, to: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 420,
    height: 170,
    frame: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    center: true,
    show: false,
    backgroundColor: '#F7F9FA',
    title: 'Wivo',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false },
  })

  win.once('ready-to-show', () => {
    win.show()
    pushSplash({ stage: 'checking', percent: null, from, to })
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/updater.html`)
  } else {
    win.loadFile(join(__dirname, '../renderer/updater.html'))
  }
  return win
}

function closeSplash(): void {
  if (splash && !splash.isDestroyed()) splash.destroy()
  splash = null
}

// ── Shared wiring ────────────────────────────────────────────────────────────
let configuredOnce = false
/** When the feed last answered, for Settings (null: not yet this session). */
let lastCheckedAt: string | null = null

function configure(): void {
  autoUpdater.autoDownload = true
  // OFF on purpose: a file staged in an earlier session is not installed at
  // quit anyway (see fact 4), and the owner asked to SEE the update happen.
  autoUpdater.autoInstallOnAppQuit = false
  // We never build a web installer; without this electron-updater warns on
  // every single download.
  autoUpdater.disableWebInstaller = true
  autoUpdater.logger = {
    info: (...a: unknown[]) => log('INFO', ...a),
    warn: (...a: unknown[]) => log('WARN', ...a),
    error: (...a: unknown[]) => log('ERROR', ...a),
    debug: (...a: unknown[]) => log('DEBUG', ...a),
  } as never
  // A clinic's own installer reads its own release, never main's
  // GitHub releases (docs/RELEASE.md). Set here as well as in its
  // app-update.yml, so the build id alone decides.
  const feed = feedUrlFor(BUILD, CLINIC_SOURCE)
  if (feed) {
    autoUpdater.setFeedURL({ provider: 'generic', url: feed })
    if (!configuredOnce) log('INFO', `build ${BUILD}: updates from ${feed}`)
  }
  configuredOnce = true
  // Lets a non-packaged run talk to a feed, for testing. Off unless asked.
  if (process.env['WIVO_UPDATER_DEV'] === '1') {
    autoUpdater.forceDevUpdateConfig = true
    log('INFO', 'forceDevUpdateConfig enabled by WIVO_UPDATER_DEV')
  }
}

/**
 * Wivo's signature on a downloaded installer (releaseCheck.ts), checked
 * before it is staged and again before it installs. Refused: the app stays
 * on the version it has, and the log says why. Before the root keys are
 * pinned there is nothing to check against, and it installs as before.
 */
async function signedByWivo(file: string | undefined, version: string): Promise<boolean> {
  if (!file) {
    log('ERROR', `${version}: no downloaded file to check`)
    return false
  }
  try {
    const r = await verifyDownloadedApp(file, version, releaseCheckDeps(join(app.getPath('userData'), 'release-floor.json'), app.getVersion()))
    if (r.ok) {
      log('INFO', r.checked ? `${version}: Wivo's signature checks out (build ${BUILD})` : `${version}: not checked, no root keys pinned yet`)
      if (r.ok && r.schema) log('INFO', `${version} expects the database at ${r.schema}`)
      return true
    }
    log('ERROR', `${version}: refused, not Wivo's signed release (${r.reason})`)
    return false
  } catch (err) {
    log('ERROR', `${version}: the signature check failed`, err)
    return false
  }
}

const UNSIGNED: UpdateState = {
  stage: 'failed', code: 'unsigned', message: "This update isn't Wivo's signed release.",
}

const withTimeout = <T,>(p: Promise<T>, ms: number, label: string): Promise<T> =>
  Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timeout`)), ms)),
  ])

// ── Launch-time install ──────────────────────────────────────────────────────
/**
 * Returns true when it has started an install and the app is going away.
 *
 * Every other outcome returns false and the caller opens the app normally. The
 * caller must NOT close the splash itself — `bail()` below closes it only once
 * the main window is painted, because `window-all-closed` quits the app and
 * destroying the last window before the main one exists would exit outright.
 */
export async function installPendingAtLaunch(): Promise<boolean> {
  if (TEST_MODE) return false
  configure()

  if (!autoUpdater.isUpdaterActive()) return false

  const marker = readMarker()
  if (!marker) return false

  const running = app.getVersion()
  if (!isNewer(marker.version, running)) {
    log('INFO', `marker ${marker.version} <= running ${running}, already applied`)
    clearMarker()
    return false
  }

  // Written BEFORE the attempt, which is what makes a crash-looping release
  // limit itself: three launches and the marker is abandoned.
  if (marker.attempts >= 3) {
    log('ERROR', `giving up on ${marker.version} after ${marker.attempts} attempts`)
    clearMarker()
    lastState = {
      stage: 'failed', code: 'installFailed', version: marker.version,
      message: `Update ${marker.version} did not install.`,
    }
    return false
  }
  writeMarker({ ...marker, attempts: marker.attempts + 1 })

  splash = createSplash(running, marker.version)

  try {
    return await withTimeout(runInstall(running, marker.version), TOTAL_MS, 'launch update')
  } catch (err) {
    log('ERROR', 'launch update failed', err)
    return false
  }
}

function runInstall(from: string, to: string): Promise<boolean> {
  return new Promise<boolean>(resolve => {
    const onProgress = (): void => {
      // A real transfer, not a cache hit. Abandon the launch install and let it
      // finish in the background — the next launch is then instant. This is
      // what guarantees a launch is never stuck behind 90 MB.
      log('INFO', 'real download at launch, deferring to next start')
      finish(false)
    }
    const onDownloaded = async (info: { downloadedFile?: string }): Promise<void> => {
      // Checked again here, not only when it was staged: the file sat on disk
      // between two sessions.
      if (!(await signedByWivo(info.downloadedFile, to))) {
        clearMarker()
        lastState = UNSIGNED
        finish(false)
        return
      }
      // WIVO_UPDATER_DEV makes the updater run unpackaged so the whole flow can
      // be exercised — but quitAndInstall would then run a real NSIS installer
      // against a developer's machine. Stop one step short and say so.
      if (!app.isPackaged) {
        log('INFO', `would install ${to} here (unpackaged run, stopping)`)
        finish(false)
        return
      }
      log('INFO', `installing ${to}, isSilent=true isForceRunAfter=true`)
      pushSplash({ stage: 'installing', percent: null, from, to })
      installing = true
      // Give the splash one frame to repaint before the process goes away.
      setTimeout(() => {
        try {
          autoUpdater.quitAndInstall(true, true)
        } catch (err) {
          log('ERROR', 'quitAndInstall threw', err)
          installing = false
          finish(false)
        }
      }, 300)
      finish(true)
    }
    // Named, so finish() removes exactly what was registered.
    const onDownloadedEvent = (info: { downloadedFile?: string }): void => void onDownloaded(info)
    const onError = (err: Error): void => {
      log('ERROR', 'updater error at launch', err)
      finish(false)
    }

    let settled = false
    const finish = (v: boolean): void => {
      if (settled) return
      settled = true
      // Hand the session back exactly as `wireUpdater` left it.
      //
      // This path turns autoDownload OFF so it can drive the download itself
      // and abandon a real transfer. Without restoring it, a launch that
      // bailed left the flag false for the WHOLE session: the background
      // checks would keep finding updates and never fetch one, and nothing
      // would say why.
      if (!v) autoUpdater.autoDownload = true
      // These were registered for this one attempt. Leaving them on would let
      // a launch that gave up keep reacting to the session's own downloads.
      autoUpdater.removeListener('download-progress', onProgress)
      autoUpdater.removeListener('update-downloaded', onDownloadedEvent)
      autoUpdater.removeListener('error', onError)
      resolve(v)
    }

    // Registered BEFORE any call — see fact 3.
    autoUpdater.once('update-downloaded', onDownloadedEvent)
    autoUpdater.on('download-progress', onProgress)
    autoUpdater.once('error', onError)

    // autoDownload off for THIS path: we want to drive the download ourselves
    // so the progress guard above can abandon it.
    autoUpdater.autoDownload = false
    withTimeout(autoUpdater.checkForUpdates(), CHECK_MS, 'check')
      .then(result => {
        if (!result || !result.isUpdateAvailable) {
          log('INFO', 'nothing to install at launch')
          clearMarker()
          finish(false)
          return
        }
        pushSplash({ stage: 'downloading', percent: null, from, to })
        return autoUpdater.downloadUpdate()
      })
      .catch(err => {
        log('WARN', 'launch check/download gave up', err)
        finish(false)
      })
  })
}

// ── The licence, delivered with the updates (licenceDelivery.ts) ─────────────
/** Checked with every update check; a new licence is announced to the window. */
function checkLicence(): void {
  void checkDeliveredLicence(log, change => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('wivo:licence-updated', change)
  }).catch(err => log('ERROR', 'licence check failed', err))
}

// ── The minimum version, from the signed list (releaseMinimum.ts) ────────────
/** The first look at the minimum: sooner than the update check, since it decides whether this build may save. */
const FIRST_MINIMUM_MS = 5_000
const minimumPath = (): string => join(app.getPath('userData'), 'release-minimum.json')
/** undefined until first read from userData; then what the last accepted list said. */
let minimum: string | null | undefined
let minimumLogged = ''

function currentMinimum(): string | null {
  if (minimum === undefined) minimum = TEST_MODE ? null : storedMinimum(minimumPath())?.min_version ?? null
  return minimum
}

function minimumStatus(): MinimumStatus {
  const running = app.getVersion()
  const min = currentMinimum()
  return { minimum: min, running, below: isBelow(running, min) }
}

/** Checked with every update check. Below a new minimum: told to the window, and the update fetched at once. */
function checkMinimum(): void {
  if (TEST_MODE) return
  const before = minimumStatus()
  void checkReleaseMinimum({
    pinned: PINNED_ROOTS, sources: SOURCES, fetch: limitedFetcher(fetch), channel: 'stable', build: BUILD,
    statePath: minimumPath(), floorPath: join(app.getPath('userData'), 'release-floor.json'), now: () => new Date(),
  }).then(r => {
    if ('refused' in r) {
      if (r.refused !== 'not_pinned' && r.refused !== 'no_source' && r.refused !== minimumLogged) {
        minimumLogged = r.refused
        log('WARN', `minimum version: list not read (${r.refused}); keeping ${currentMinimum() ?? 'none'}`)
      }
      return
    }
    minimumLogged = ''
    minimum = r.minimum
    const now = minimumStatus()
    if (r.changed) log('INFO', `minimum version: ${now.minimum ?? 'none'} (running ${now.running}${now.below ? ', below it: no saves until updated' : ''})`)
    if (now.below !== before.below || now.minimum !== before.minimum) {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('wivo:release-minimum', now)
    }
    if (now.below && !before.below && autoUpdater.isUpdaterActive() && lastState.stage !== 'ready') {
      void autoUpdater.checkForUpdates().catch(() => {})
    }
  }).catch(err => log('ERROR', 'minimum version check failed', err))
}

// ── Background checking during the session ───────────────────────────────────
export function wireUpdater(): void {
  if (TEST_MODE) {
    log('INFO', 'test mode: no update checks')
    return
  }
  // Before the updater's own guard: the licence and the minimum do not depend on it.
  setTimeout(checkLicence, FIRST_CHECK_MS)
  setInterval(checkLicence, EVERY_MS)
  setTimeout(checkMinimum, FIRST_MINIMUM_MS)
  setInterval(checkMinimum, EVERY_MS)
  configure()
  if (!autoUpdater.isUpdaterActive()) {
    log('INFO', 'updater inactive (not packaged) — background checks skipped')
    return
  }

  autoUpdater.on('checking-for-update', () => pushState({ stage: 'checking' }))
  autoUpdater.on('update-not-available', () => {
    lastCheckedAt = new Date().toISOString()
    pushState({ stage: 'idle' })
  })
  autoUpdater.on('update-available', info => {
    lastCheckedAt = new Date().toISOString()
    pushState({ stage: 'available', version: info.version })
  })
  autoUpdater.on('download-progress', p =>
    pushState({
      stage: 'downloading',
      version: lastState.stage === 'available' ? lastState.version : app.getVersion(),
      percent: Math.round(p.percent),
    })
  )
  autoUpdater.on('update-downloaded', info => void (async () => {
    // Staged only once Wivo's signature checks out (releaseCheck.ts).
    if (!(await signedByWivo(info.downloadedFile, info.version))) {
      clearMarker()
      pushState(UNSIGNED)
      return
    }
    log('INFO', `staged ${info.version}`)
    // attempts resets to 0: a NEWER update replacing an older staged one gets
    // its own three tries, and electron-updater has already wiped the old file.
    writeMarker({ version: info.version, stagedAt: new Date().toISOString(), attempts: 0 })
    pushState({ stage: 'ready', version: info.version })
  })())
  autoUpdater.on('error', err => {
    log('ERROR', 'updater error', err)
    const nospace = (err as NodeJS.ErrnoException)?.code === 'ENOSPC'
    pushState(nospace
      ? { stage: 'failed', code: 'noSpace', message: 'Not enough disk space for the update.' }
      : { stage: 'failed', code: 'downloadFailed', message: 'The update could not be downloaded.' })
  })

  setTimeout(() => void autoUpdater.checkForUpdates().catch(() => {}), FIRST_CHECK_MS)
  setInterval(() => void autoUpdater.checkForUpdates().catch(() => {}), EVERY_MS)
}

// ── IPC ──────────────────────────────────────────────────────────────────────
export function registerUpdaterIpc(): void {
  // Answers a renderer that mounted AFTER the push happened — pushes are not
  // replayed, so without this a reopened window never learns about a staged
  // update.
  ipcMain.handle('wivo:update-state', () => lastState)

  // The minimum version from the signed list, and whether this build is below it.
  ipcMain.handle('wivo:release-minimum', (): MinimumStatus => minimumStatus())

  // Settings → Updates: where this installer's updates come from, and whether
  // they must be Wivo's signed releases. Public facts only.
  ipcMain.handle('wivo:update-info', (): UpdateInfo => {
    const feed = feedUrlFor(BUILD, CLINIC_SOURCE)
    return {
      build: BUILD,
      source: feed ? new URL(feed).host + new URL(feed).pathname.replace(/\/releases\/download\/stable$/, '') : null,
      signedOnly: PINNED_ROOTS.length > 0,
      hasSource: SOURCES.length > 0,
      lastCheckedAt,
    }
  })

  // 'ready' is reached only after Wivo's signature checked out when it was staged.
  ipcMain.handle('wivo:install-now', () => {
    if (TEST_MODE || !autoUpdater.isUpdaterActive() || lastState.stage !== 'ready') return
    installing = true
    try {
      autoUpdater.quitAndInstall(true, true)
    } catch (err) {
      installing = false
      log('ERROR', 'install-now failed', err)
    }
  })

  ipcMain.handle('wivo:check-now', async () => {
    if (TEST_MODE) return
    checkLicence()
    checkMinimum()
    if (!autoUpdater.isUpdaterActive()) {
      pushState({
        stage: 'failed', code: 'devBuild',
        message: 'Updates are only available in an installed build.',
      })
      return
    }
    try {
      await autoUpdater.checkForUpdates()
    } catch (err) {
      log('WARN', 'manual check failed', err)
      pushState({ stage: 'failed', code: 'checkFailed', message: 'The update check failed.' })
    }
  })
}

export { closeSplash }
