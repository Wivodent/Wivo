/**
 * electron-builder's configuration for a clinic's installer
 * (scripts/build-clinic.mjs, which names the clinic in WIVO_CLINIC and has
 * already checked clinics/<id>.json). package.json's `build` block, with four
 * changes:
 *
 *  - no `.env` resource. Nothing reads it at run time (the address and the
 *    public key are built into the app); shipping it would ship whatever the
 *    root .env holds, production's address included;
 *  - the output goes to dist-<id>/, not dist/;
 *  - the installer is named Wivo-<id>-Setup-<version>.exe, so it cannot be
 *    mistaken for the one main's releases publish;
 *  - updates come from the clinic's own releases (docs/RELEASE.md): the
 *    `stable` release of its repository, never main's GitHub releases. Written
 *    into the installer's app-update.yml; the app sets the same feed from the
 *    repository built into it (src/main/releaseCheck.ts feedUrlFor), and
 *    scripts/clinicBuild.test.ts keeps the two equal.
 *
 * The app's identity (appId, productName) stays main's, so an installed Wivo
 * is updated in place, never installed twice.
 */
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { build } = require('../package.json')

const id = process.env.WIVO_CLINIC
if (!id || !/^[a-z][a-z0-9-]{0,30}$/.test(id) || id === 'main') {
  throw new Error('WIVO_CLINIC must name a clinic (clinics/<id>.json): run npm run dist:clinic -- --clinic <id>')
}
const clinic = JSON.parse(readFileSync(join(__dirname, '..', 'clinics', `${id}.json`), 'utf8'))
if (clinic.id !== id || !/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(clinic.releasesRepo || '')) {
  throw new Error(`clinics/${id}.json is not right: run npm run dist:clinic -- --clinic ${id}, which says why`)
}

module.exports = {
  ...build,
  directories: { ...build.directories, output: `dist-${id}` },
  extraResources: build.extraResources.filter(r => r.from !== '.env'),
  artifactName: `Wivo-${id}-Setup-` + '${version}.${ext}',
  publish: [{ provider: 'generic', url: `https://github.com/${clinic.releasesRepo}/releases/download/stable` }],
}
