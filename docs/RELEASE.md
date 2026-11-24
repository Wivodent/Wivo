# Signed desktop releases for Riga

**Status: built on `testing` (2026-11-25), not yet run with the real YubiKey.**
The step-by-step for Kevin is docs/RIGA-ROLLOUT.md (Estonian). This file says
how an update travels, what the signature covers and why that is safe.
Background: docs/ARCHITECTURE-INSTANCES.md §5a, 5e, 5g (phase 1, slices 1 and 9).

## 1. The path of one update

```
Kevin's Windows machine (clean `testing`)
  npm run release:riga            build the installer with Riga's address and feed,
                                  write release-riga/<version>/ (nothing signed yet)
  npm run release:riga:sign       YubiKey C (PIN once, two touches) signs
                                    - the list (updates.json, update key, slot 9c)
                                    - the release statement (app key, slot 82)
                                  then checks both with the app's own code
  npm run release:riga:publish    uploads to GitHub: SniperInSuit/wivo-riga-releases,
                                  the release tagged `stable`:
                                    Wivo-Riga-Setup-<v>.exe, its .blockmap,
                                    latest.yml, updates.json (the list last)
            │
            ▼
A Riga desktop (installed from a Riga installer, 2.0.5 or later)
  every 30 minutes: electron-updater reads
      https://github.com/SniperInSuit/wivo-riga-releases/releases/download/stable/latest.yml
  a newer version → downloads the installer in the background (sha512 from latest.yml)
  before staging it: fetches updates.json from the same place and checks the signatures
  (src/main/releaseCheck.ts → shared/release checkAppUpdate); refused → stays on its version
  next start: checks it again, installs silently, opens the new version
```

**Where the app reads it:** the build id `riga` is built into the app
(`MAIN_VITE_WIVO_BUILD`, set only by scripts/build-riga.mjs). `BUILD_UPDATE_SOURCES`
in shared/release/release.ts maps it to the address above; the main process
points electron-updater at it (`setFeedURL`) and the signature check reads the
list from the same address. A build without its own address (`main`) has no
source, so it refuses every update while roots are pinned.

## 2. What is signed

Two tokens in `updates.json`, in the format of shared/release (the key signs
a short statement with the SHA-256 of the signed text, docs/YUBIKEYS.md §2):

| Token | Signed by | Says |
|---|---|---|
| the list (`WIVOIDX1`) | YubiKey C's **update** key (D's is the spare) | channel `stable`, a serial that grows, an expiry (14 days by default, at most 30), and the latest desktop release: version, file name, **sha512 and exact size of the installer** |
| the release statement (`WIVOAPP1`) | YubiKey C's **app** key | the same version, file, sha512 and size, the build (`riga`), and the database it needs (the newest migration, `schema`) |

`updates.json` also carries root A's four certificates for C's and D's keys
(shared/release/certificates.ts). They count only because a pinned root signed them.

## 3. What the app refuses

Every check runs on the downloaded bytes, before the update is staged and again
before it installs (src/main/updater.ts):

- **unsigned, or a bad signature:** the list and the statement must each be signed
  by a key with a valid certificate from a pinned root (A or B), for that
  purpose, and not revoked;
- **another file:** the installer's sha512 and size must equal both signed values;
- **another build:** the statement must say `riga` (a `main` release, or any other
  clinic's, is refused even if it were signed);
- **an older or the same version:** it must be newer than the running app;
- **an old list:** an expired list, or a serial lower than one this computer has
  already accepted (`release-floor.json` in userData), is refused.

A refusal never stops anyone working: the app stays on its version, the log
(`updater.log`) says why, and Settings → Licence → Updates shows it.

## 4. Why this is safe

- **The address is not trusted.** GitHub, the network or a stolen GitHub
  sign-in can withhold an update or serve an old one, but cannot make a Riga
  desktop install anything: that needs a signature from a hardware key, with
  its PIN and a touch. The private keys never leave YubiKeys C and D.
- **Main's releases can never reach Riga.** Three separate locks: main's CI
  publishes to `SniperInSuit/Wivo`, which a Riga app never reads; its
  `GITHUB_TOKEN` cannot write to `wivo-riga-releases`; and a Riga app refuses
  any release statement that does not say `riga`.
- **The checker is the one the app runs.** `release:riga:sign` checks the new
  `updates.json` with `checkAppUpdate`, the same function the desktop calls, and
  against the installer on disk, before it writes anything; `publish` checks it
  again. A test signs through a stand-in `ykman` and verifies with the app's code
  (scripts/releaseRiga.test.ts).
- **Why GitHub Releases, and a repository of its own:** the installer is ~90 MB,
  and Cloudflare Pages takes files up to 25 MiB; R2 would need a new account and
  API token. GitHub Releases is free, already Kevin's (hardware second factor),
  serves `releases/download/<tag>/<file>`, which matches the list's address
  format (`<source>/stable/updates.json`) exactly, and keeps Riga apart from main
  by repository. The repository holds only release files and is public: Riga's
  address and public key are in the phone app's bundle anyway, and the installer
  holds nothing else (the build refuses any secret).

**What this does not cover:**
- The first install (2.0.5, the last one by hand) is trusted through its SHA-256,
  handed over by another channel. The `.exe` carries no Authenticode certificate,
  so Windows still says "unknown publisher".
- The phone app (Cloudflare `wivo-dentiks`, branch `riga`) runs whatever
  Cloudflare serves (ARCHITECTURE-INSTANCES.md §5g, decision 25).
- A Mac or Windows machine with malware could ask the key to sign something else
  while Kevin touches it for a release. The tool shows what is signed.

## 5. Database migrations: by hand, before signing

`wivo-update` (signed database packages) is not switched on for Riga yet
(docs/DB-UPDATES-PLAN.md). So:

1. `release:riga` prints the newest migration this version needs (`schema`) and
   the migrations added since the last published release.
2. **Run them in Riga's database before signing**, after the test copy, in the
   SQL Editor (Kevin), then `notify pgrst, 'reload schema';` and the read-only
   checks (`sql/checks/schema_check.sql`, `trigger_check.sql`).
3. `release:riga:sign` lists them again and asks you to confirm they are applied.

If a desktop updates before its database does, it keeps working: screens that
need a new column fall back (the existing "database is behind" handling), and
Settings → Database shows what is missing. It never tells anyone to run SQL.

## 6. The list's expiry

The list expires 14 days after signing (decided 2026-11-05, §5g). Riga's
desktops only read it when a new version is downloaded, so an expired list only
matters for a computer that downloads after it expired: it waits until the next
list. To re-sign without a new version: `npm run release:riga:sign -- --refresh`
then `npm run release:riga:publish` (one touch). `--days 30` is the most.
