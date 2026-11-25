# Signed desktop releases for a clinic

**Status: built on `testing` (November 2026), not yet run with the real YubiKey.**
Names follow the clinic, never the country or the city. Dentiks (in Riga) is
the first clinic and the example throughout. Its settings are in
`clinics/dentiks.json` (clinics/README.md), and the next clinic is one more file
there.
Kevin's step-by-step guide is docs/CLINIC-ROLLOUT.md (in Estonian). This file
says how an update travels, what the signature covers and why that is safe.
Background: docs/ARCHITECTURE-INSTANCES.md §5a, 5e, 5g (phase 1, slices 1 and 9).

## 1. The path of one update

```
Kevin's Windows machine (clean `testing`)
  npm run release -- --clinic dentiks
                                  build the installer with the clinic's project, phone
                                  address and feed (clinics/dentiks.json), write
                                  releases/dentiks/<version>/ (nothing signed yet)
  npm run release:sign -- --clinic dentiks
                                  YubiKey C (PIN once, two touches) signs
                                    - the list (updates.json, update key, slot 9c)
                                    - the release statement (app key, slot 82)
                                  then checks both with the app's own code
  npm run release:publish -- --clinic dentiks
                                  uploads to the clinic's repository
                                  (Wivodent/wivo-dentiks-releases), release `stable`:
                                    Wivo-dentiks-Setup-<v>.exe, its .blockmap,
                                    updates.json, then latest.yml
            │
            ▼
A Dentiks desktop (installed from a Dentiks installer, 2.0.5 or later)
  every 30 minutes: electron-updater reads
      https://github.com/Wivodent/wivo-dentiks-releases/releases/download/stable/latest.yml
  a newer version → downloads the installer in the background (sha512 from latest.yml)
  before staging it: fetches updates.json from the same place and checks the signatures
  (src/main/releaseCheck.ts → shared/release checkAppUpdate); refused → stays on its version
  next start: checks it again, installs silently, opens the new version
```

**Where the app reads it:** scripts/build-clinic.mjs builds two values from
`clinics/<id>.json` into the app: the build id (`MAIN_VITE_WIVO_BUILD`, the
clinic's id) and its releases repository (`MAIN_VITE_WIVO_RELEASES_REPO`).
`clinicReleaseSource` in shared/release/release.ts turns the repository into the
address above, and refuses anything that is not `owner/name` and main's own
repository. The main process points electron-updater at that address
(`setFeedURL`), and the signature check reads the list from the same place. The
installer's `app-update.yml` says the same (scripts/electron-builder.clinic.cjs),
and the build checks it. A clinic's build without a repository has no source, so
it refuses every update.

On the command line, PowerShell may drop the `--` of `npm run release -- --clinic
dentiks`. The options still arrive, because npm passes them on as
`npm_config_clinic` (scripts/clinic-config.mjs `cliOptions`).
`node scripts/release.mjs build --clinic dentiks` also works.

## 2. What is signed

`updates.json` holds two tokens in shared/release's format. The key signs a
short statement with the SHA-256 of the signed text (docs/YUBIKEYS.md §2):

| Token | Signed by | Says |
|---|---|---|
| the list (`WIVOIDX1`) | YubiKey C's **update** key (D's is the spare) | channel `stable`, a serial that grows, an expiry (30 days by default, at most 30), and the latest desktop release: version, file name, **sha512 and exact size of the installer** |
| the release statement (`WIVOAPP1`) | YubiKey C's **app** key | the same version, file, sha512 and size, the build (the clinic's id, `dentiks`), and the database it needs (the newest migration, `schema`) |

`updates.json` also carries root A's four certificates for C's and D's keys
(shared/release/certificates.ts). They count only because a pinned root signed them.

## 3. What the app refuses

Every check runs on the downloaded bytes, before the update is staged and again
before it installs (src/main/updater.ts):

- **unsigned, or a bad signature:** the list and the statement must each be signed
  by a key with a valid certificate from a pinned root (A or B), for that
  purpose, and not revoked;
- **another file:** the installer's sha512 and size must equal both signed values;
- **another build:** the statement must name this clinic. A `main` release, or
  another clinic's, is refused even when it is signed;
- **an older or the same version:** it must be newer than the running app;
- **an old list:** an expired list, or a serial lower than one this computer has
  already accepted (`release-floor.json` in userData), is refused.

A refusal never stops anyone working. The app stays on its version, the log
(`updater.log`) says why, and Settings → Licence → Updates shows it.

## 4. Why this is safe

- **The address is not trusted.** GitHub, the network or a stolen GitHub
  sign-in can withhold an update or serve an old one. None of them can make a
  clinic's desktop install anything: that needs a signature from a hardware
  key, with its PIN and a touch. The private keys never leave YubiKeys C and D.
- **Main's releases can never reach a clinic, and one clinic's never reaches
  another.** There are three separate locks:
  - main's CI publishes to `Wivodent/Wivo`, which a clinic's app never reads,
    and the tool and the app both refuse that repository as a clinic's;
  - main's `GITHUB_TOKEN` cannot write to a clinic's repository;
  - a clinic's app refuses any release statement that does not name its clinic.
- **The checker is the one the app runs.** `release:sign` checks the new
  `updates.json` against the installer on disk with `checkAppUpdate`, the same
  function the desktop calls, before it writes anything. `publish` checks it
  again. A test signs through a stand-in `ykman` and verifies with the app's code
  (scripts/releaseTool.test.ts).
- **Why GitHub Releases, with a repository per clinic:**
  - the installer is ~90 MB, and Cloudflare Pages takes files up to 25 MiB;
  - R2 would need a new account and API token;
  - GitHub Releases is free and already Kevin's (hardware second factor);
  - it serves `releases/download/<tag>/<file>`, which matches the list's address
    format (`<source>/stable/updates.json`) exactly;
  - a repository per clinic keeps each clinic apart from main and from the other
    clinics.

  The repository holds only release files and is public. The clinic's address
  and public key are in its phone app's bundle anyway, and the installer holds
  nothing else (the build refuses any secret).

**What this does not cover:**
- The first install (2.0.5, the last one by hand) is trusted through its SHA-256,
  handed over by another channel. The `.exe` carries no Authenticode certificate,
  so Windows still says "unknown publisher".
- The phone app (Cloudflare `wivo-dentiks`, which builds the `riga` branch) runs
  whatever Cloudflare serves (ARCHITECTURE-INSTANCES.md §5g, decision 25).
- A Mac or Windows machine with malware could ask the key to sign something else
  while Kevin touches it for a release. The tool shows what is signed.

## 5. Database migrations: by hand, before signing

`wivo-update` (signed database packages) is not switched on for any clinic yet
(docs/DB-UPDATES-PLAN.md). Until it is:

1. `npm run release -- --clinic <id>` prints the newest migration this version
   needs (`schema`) and the migrations added since the last published release.
2. **Run them in the clinic's database before signing.** Kevin runs them after
   the test copy, in the SQL Editor, then `notify pgrst, 'reload schema';` and the
   read-only checks (`sql/checks/schema_check.sql`, `trigger_check.sql`).
3. `release:sign` lists them again and asks you to confirm that they are
   applied.

If a desktop updates before its database does, it keeps working. Screens that
need a new column fall back (the existing "database is behind" handling), and
Settings → Database shows what is missing. It never tells anyone to run SQL.

## 6. The list's expiry

The list expires **30 days** after signing. That is the default and also the
most (Kevin, November 2026; before that 14 days, §5g). Every release makes a new
list. A clinic's desktops read the list only when they download a new version,
so an expired list matters only for a computer that downloads after it expired:
that computer waits for the next list.

To re-sign without a new version (one touch):

```
npm run release:sign -- --clinic dentiks --refresh
npm run release:publish -- --clinic dentiks --refresh
```

`--days N` signs a shorter list.

## 6a. The minimum version (from 2.2.1)

The list can say which desktop version is the oldest that may still save:
`min_version`, signed with the list by the update key (YubiKey C, slot 9c).
It needs no SQL and no access to the clinic's database. It reaches every
desktop within 30 minutes, the same way as an update.

**What a desktop below it does:**
- a full screen: "Please update Wivo", the running version and the minimum,
  with **Update now** and **View only**;
- **Update now** fetches the update at once, then becomes **Restart and
  update**;
- **View only** hides the full screen; a bar stays at the top with **Update
  now**;
- **nothing is saved**: the app refuses every save before it is sent (tables,
  saving functions, uploads, deletions, account changes) with the same "Update
  Wivo" message the database gives an old build (docs/MIN-VERSION.md);
- **reading goes on**: lists, jobs, files, previews, exports, chat history,
  and the audit entries that reading leaves (opening a job, a download, an
  export).

**Which desktops:** 2.2.1 and later. A build before 2.2.1 doesn't read the
minimum, so the first release that can ask anything is the one after 2.2.1.
Before that, the only ways are a restart (the update installs at the next start)
or the database minimum (docs/MIN-VERSION.md).

**Setting it, with a release:**

```
npm run release -- --clinic dentiks --min-version 2.2.1
npm run release:sign -- --clinic dentiks
npm run release:publish -- --clinic dentiks
```

`--min-version` can also be given to `release:sign`. There it wins over the one
given to the build.

**Setting it without a release** (one touch, the published release stays):

```
npm run release:sign -- --clinic dentiks --refresh --min-version 2.2.1
npm run release:publish -- --clinic dentiks --refresh
```

**Removing it:** `--min-version off`, the same way.

**Rules the tool keeps:**
- not given: the next list keeps the published minimum. A release never
  drops it by accident;
- **never above the release the list names**: a desktop below the minimum
  would have nothing to update to. The tool refuses it before the key signs;
- the tool shows "Minimum version: … (new / unchanged / was …)" before
  signing, and the key's prompt names it too.

**What the desktop accepts:** only a list it would accept for an update:
- signed by a certified update key;
- the `stable` channel;
- not expired;
- a serial not lower than one it has already seen;
- a release statement for **its own clinic's build**.

A list copied from another clinic, or from main, sets nothing.

The last minimum accepted is kept in userData (`release-minimum.json`). It
holds from the first second after a restart. It also holds while the list
can't be reached or has expired. Only a newer valid list raises it, lowers it
or takes it away. `updater.log` says when it changed.

**Beware:**
- A desktop below the minimum can update only if the update installs. Set a
  minimum only once that release is published and you have seen one machine
  install it.
- If the update fails, lower the minimum or turn it off (`--refresh
  --min-version off`). Desktops follow at their next check: within 30
  minutes, or at once with Settings → Updates → Check now.
- The phone app is not affected. It loads the newest version from Cloudflare
  on every start.

## 7. A licence, with the updates

From 2.0.7 a clinic's desktops take a new licence from the clinic's own
releases. Nobody pastes it. YubiKey C signs it, the same tool publishes it:

```
node scripts/make-license.mjs renew WIVO1.… --months 12 --publish --clinic dentiks
node scripts/make-license.mjs sign --org <uuid> --name "Dentiks" --api https://<ref>.supabase.co --modules … --months 12 --publish --clinic dentiks
```

The tool checks before the key is asked to sign:
- `clinics/<id>.json` has the clinic's `orgId`;
- `--org` is that organisation;
- `--api` names the clinic's database.

After signing, it judges the token with the app's own rules
(`shared/license/published.ts`). Then it uploads `licence.json` to the
`stable` release and reads it back from the public address. The token is
printed either way, so pasting stays possible.

Each desktop checks `licence.json` with every update check: 30 seconds after
start, every 30 minutes, and on "Check now". It installs the licence only when
all of these hold:
- the file names this clinic's build;
- a pinned licence key (C or D) signed it;
- it is a v2 key;
- its organisation is the clinic's: the build's `orgId`, else the installed
  licence's;
- it names the address the app uses;
- it was **issued on a later day** than the licence installed now.

Anything else is refused. The machine keeps its licence, and `updater.log`
says why. The owner then sees **"Licence updated"** with what changed: modules,
users, expiry, plan. A licence fixed on the same day goes by pasting in Settings
→ Licence, which stays the fallback.

The licence is a public signed statement, like the release list. Nothing secret
is in `licence.json`.

## 8. Files

| Where | What |
|---|---|
| `clinics/<id>.json` | the clinic's public settings (tracked) |
| `clinics/<id>.env` | its public key, on Kevin's machine only (not tracked) |
| `dist-<id>/` | the installer the build made (not tracked) |
| `releases/<id>/<version>/` | the installer, `latest.yml`, `release.json`, then the signed `updates.json` (not tracked) |
| `releases/<id>/refresh/` | a re-signed list |
| `releases/<id>/licence/licence.json` | the last licence published with `--publish` (not tracked) |
| userData `release-minimum.json` | on each desktop: the last minimum version accepted (§6a) |
