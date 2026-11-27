/**
 * The version line ("Wivo Network · 2.2.7 · 7ca8c95"): package.json's version
 * and the short commit the build was made from (VITE_APP_COMMIT, put in at
 * build time by scripts/build-commit.mjs). Only shown, so a screenshot says
 * exactly which build it is; updates are checked by version, never by this.
 */
export const APP_COMMIT: string = (import.meta.env.VITE_APP_COMMIT ?? '').slice(0, 7)

/** "<product> · <version> · <commit>", each part left out when it is not there. */
export function versionLine(product: string | null, version: string, commit: string = APP_COMMIT): string {
  return [product, version, commit].filter(Boolean).join(' · ')
}
