/**
 * The renderer's side of the interface language. The core — `t()` and the
 * language itself — is in shared/i18n.ts; this adds what only a window has:
 * switching, and the locales date-fns and Intl need.
 *
 * ── Per machine, not per person ─────────────────────────────────────────────
 * Stored like the theme, in its own localStorage key, rather than in
 * `profiles.ui_prefs`. The language has to be known before the first module
 * evaluates — the login screen is in it too — and a per-person value only
 * arrives after login, which would mean a second reload every time someone
 * signs in on a machine set to the other language.
 */
import { et, enGB, ru, lv } from 'date-fns/locale'
import { lang, uiLang, LANG_KEY, NETWORK_LANG_KEY, isNetworkLang, type Lang, type UiLang } from '@shared/i18n'

export { t, lang, uiLang, weekdays, decideLanguage, NETWORK_LANGUAGES, networkLanguageDecision, type Lang, type UiLang } from '@shared/i18n'

/** For date-fns `format(…, { locale })`: month and weekday names follow the UI (Latvian: Wivo Network only). */
export const dateLocale = uiLang === 'lv' ? lv : lang === 'en' ? enGB : lang === 'ru' ? ru : et

/**
 * For `toLocaleString` / `Intl`. en-GB rather than en-US: day before month and
 * a 24-hour clock, which is what an Estonian lab reads either way.
 */
export const intlLocale = uiLang === 'lv' ? 'lv-LV' : lang === 'en' ? 'en-GB' : lang === 'ru' ? 'ru-RU' : 'et-EE'

/**
 * Save and reload. See shared/i18n/index.ts for why this does not switch live.
 * Whatever is on screen is lost, so the only caller is the Seaded control,
 * where nothing is half-typed.
 */
export function setLang(next: Lang): void {
  if (next === lang) return
  try {
    localStorage.setItem(LANG_KEY, next)
  } catch {
    // Storage refused: reloading would only come back in the same language.
    return
  }
  window.location.reload()
}

// Screen readers and the spellchecker go by this, not by the text. Guarded
// because the tests import this file under Node, where there is no document.
if (typeof document !== 'undefined') document.documentElement.lang = uiLang

// Tell the main process, which starts Chromium's own controls — the date and
// time pickers, the right-click menu — in a locale it has to know BEFORE the
// window exists. It can only read it from the previous run, so this reports
// the language on every boot rather than only when it changes.
// See src/main/uiLanguage.ts.
//
// Guarded exactly like `document` above: under Node `window` is not a variable
// holding undefined, it does not exist, and reading a property of it throws a
// ReferenceError that would take down every suite importing this file.
if (typeof window !== 'undefined') void window.wivo?.setUiLanguage?.(lang)

/**
 * The languages offered in the interface, in the order they are shown.
 *
 * Here rather than in SettingsPage, where it used to live, because the login
 * screen offers the same choice and must not keep its own list — a language
 * added to one and not the other is a toggle that disagrees with itself.
 *
 * The labels are each language's own name on purpose. Someone who cannot read
 * the current language has to be able to find their own, and "Estonian" is no
 * help to a person who only reads Estonian.
 */
export const LANGUAGES: { key: Lang; label: string }[] = [
  { key: 'et', label: 'Eesti' },
  { key: 'en', label: 'English' },
]

/** Whether someone picked this machine's language (rather than it being the default). */
export function languageChosenHere(): boolean {
  try {
    return localStorage.getItem(LANG_KEY) !== null
  } catch {
    return false
  }
}

/**
 * Wivo Network's own choice (NETWORK_LANG_KEY, never the staff app's): saved
 * on this device, then the page reloads in it, as setLang does. The caller
 * saves it on the Network account first, when signed in.
 */
export function setNetworkLang(next: UiLang): void {
  if (!isNetworkLang(next)) return
  try {
    localStorage.setItem(NETWORK_LANG_KEY, next)
  } catch {
    return
  }
  if (next !== uiLang) window.location.reload()
}

/** Whether a Network language was chosen on this device (rather than taken from the browser). */
export function networkLanguageChosenHere(): boolean {
  try {
    return isNetworkLang(localStorage.getItem(NETWORK_LANG_KEY))
  } catch {
    return false
  }
}
