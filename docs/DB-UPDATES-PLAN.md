# Riga's database updates through `wivo-update`: the plan

**Status: a plan only (2026-11-25), no code.** For the next night's build.
Phase 1, parts 2, 3 and 5 of docs/ARCHITECTURE-INSTANCES.md §9, narrowed to
what Riga needs first. Desktop releases are already signed and automatic
(docs/RELEASE.md); this is the database's half.

**Lühidalt (Kevin):** suur osa on juba olemas (pearaamat, kontroll, ühe
tehinguga paigaldus, Seadete vaade, värske kood). Puudu on neli asja: (1)
release-tööriist peab ehitama ja allkirjastama andmebaasi paketi, (2) Riia
olemasolev baas tuleb pearaamatusse „omaks võtta" ilma midagi uuesti
jooksutamata, (3) `wivo-update` peab teadma Riia aadressi, (4) töölaua uus
versioon peab ootama, kuni baas on uuendatud. Omanik kinnitab Seadetes
värske koodiga; ebaõnnestunud migratsioon ei muuda midagi (üks tehing).
Funktsioonide uuendused (token) jäävad hilisemaks. Otsused §7.

---

## 1. What exists (on `testing`, tested)

| Piece | Where | State |
|---|---|---|
| Signed formats: manifest, package, list, checks (`checkPackage`, `checkListed`, `planInstall`) | `shared/release/release.ts` | built, tested |
| The ledger and the records: `wivo_instance`, `wivo_schema_migration`, `wivo_trust`, `wivo_update_check`, `wivo_update_install`; approvers (`updates.install`) | sql/119 | built; **in Riga's baseline**, all empty |
| Fresh second-factor code (`fresh_second_factor`, `update_approval`) | sql/120 | built, in Riga's baseline |
| `wivo-update`: `check` (scheduled job or approver) and `install` (approver, code < 5 min): list checked, package checked against list and signature, planned against the ledger, every migration and its ledger row in **one transaction**, `transactionSafe` refusal, read-only checks after, every attempt recorded | `supabase/functions/_shared/wivoUpdate.ts`, `wivo-update/index.ts` | built, tested against the real migrations (PGlite); **not deployed anywhere** |
| Settings → Updates, the clinic's database: installed version, list freshness, last check, Check now, last installs, accepted keys; "Database update ready" with Install + fresh code | `DatabaseUpdatesSection.tsx` and the banner | built; shows nothing until `wivo_instance` has a row |
| Riga's signed list and address | `release-riga.mjs`, `BUILD_UPDATE_SOURCES.riga` | built tonight; the list's `versions` (database packages) is empty, and is carried over from list to list |

## 2. What is missing

1. **Packages.** `release:riga` builds no `wivo-update-<v>.json`. Needed:
   collect `sql/NNN_*.sql` (all of them: packages are cumulative) and
   `sql/checks/*.sql`, run `transactionSafe` on each migration before signing
   (refuse, never strip), write the manifest (`from_min`, `manual_only`,
   `auto_after`), and have **the update key sign the manifest** as a third
   statement (three touches). The list gets a `versions` entry with the
   package's sha256, exact size, note and migration names.
2. **Adopting Riga's existing database** ("first install" for a database that
   was built by hand). `install` refuses `not_set_up` until the ledger has a
   version, and `planInstall` with an empty ledger would run all 126 migrations
   again. Needed: a one-time **adopt** step that
   - creates the `wivo_instance` row (`wivo_instance_create('stable')`) and
     claims Riga's clinic (`wivo_instance_claim`);
   - runs the read-only checks first; adopts only if they return no rows (the
     schema really is 000–125);
   - writes one ledger row per baseline file with **the sha256 of the file in
     the signed package** and mode `setup`, without running any of them;
   - is allowed once, by the owner with a fresh code, and only while the
     ledger is empty; recorded in `wivo_update_install`.
   This replaces the setup secret of §5f for Riga (no setup tool yet).
3. **Where `wivo-update` reads.** Its generated `UPDATE_SOURCES` is empty.
   Proposal: a function secret `WIVO_BUILD=riga`, and the function uses
   `updateSourcesFor(build)`, as the desktop does. Safe because the address
   is not trusted (signatures and the stored channel and serial floor are).
   Alternative: generate the copy per clinic at deploy (decision 2).
4. **Desktop waits for its database.** The release statement already carries
   `schema`. A desktop update whose `schema` is not in the ledger yet should
   stay staged ("waiting for the database update") instead of installing, so
   the order is always database first. Readable without new SQL: the
   approver's `update_status()`; for others a small `stable` function
   `ledger_has(file)` (new migration, `lock_anon_functions`).
5. **The scheduled check** (pg_cron, daily, `{ action: 'check' }` with the
   Vault's `sb_secret` key, as `send-notifications`): a migration that
   schedules it only when `wivo_instance` has a row.
6. **Deploying `wivo-update` to Riga** (Kevin, once, by CLI, `--no-verify-jwt`),
   and RIGA-SETUP/ROLLOUT steps for it.
7. **Not now:** Edge Functions in a package (functions token, §5c, slice 3):
   a package with `functions/` is refused (`functions_not_yet`); function
   changes stay a manual deploy by Kevin. Automatic installs (after Riga runs,
   decided 2026-11-05).

## 3. How the owner approves

1. Kevin publishes a release whose list names database package 2.0.7
   (migration 126). Riga's daily check, or **Settings → Updates → Check now**,
   records it.
2. The owner (or a member given **Install updates**) sees "Database update
   2.0.7" with the note and the migrations it brings. Nobody else sees it.
3. **Install** asks for a fresh authenticator code (sql/120: under 5 minutes
   old, by the database's clock), then calls Riga's own `wivo-update`, which
   fetches and checks everything itself. The app never carries the package.
4. The banner says what happened, in words; the audit tables keep who, from,
   to, package hash and result. Desktops staged with `schema` 126 install at
   their next start once the ledger has it (2.4).

## 4. When a migration fails, and undoing one

- **Fails while installing:** every migration of the package and its ledger
  rows run in **one transaction** (`wivoUpdate.ts install`), so a failure
  changes nothing: the transaction rolls back, the attempt is recorded as
  `failed` with the migration's name and SQLSTATE only (never the error text,
  which can quote data), and the app keeps working on the old schema. The
  owner sees "did not install: <migration>, contact Wivo". Nothing to clean.
- **Two approvers at once:** an advisory lock; the second plans against what
  the first installed (built).
- **Installed, but wrong:** migrations only add (expand, then contract,
  docs/MIGRATIONS.md), so the previous app keeps working. The fix is a new
  forward migration in a new version; the bad version goes on the list's
  `withdrawn` so no one else installs it. There is no automatic "down"
  migration: a down script written in advance is untested exactly when it
  is needed, and can lose data written since.
- **Data damaged:** Supabase's backups (Riga's Pro plan: daily backups, 7
  days; point-in-time recovery is a paid add-on, decision 4). Restoring is the
  owner's step in Supabase's dashboard, with the incident steps of §5e.4.
- **Before each install:** the read-only checks also run first, and the
  install is refused if they already return rows (a drifted database is not
  updated blindly).

## 5. Security review before switching it on in Riga

The §5f list, narrowed to what this switches on. A separate pass
(`/code-review` at its highest level, Kevin starts it) plus Kevin's run of the
adversarial script on a **fresh project with made-up data** (never the test
copy, never Riga):

1. **Who can call:** `install` only an approver with a code < 5 min; `check`
   only the project's service key or an approver; `adopt` only the owner,
   only with an empty ledger. Errors say nothing about the database.
2. **The adopt step:** cannot be replayed, cannot be run on a database whose
   checks return rows, cannot write a ledger row whose sha256 is not the
   signed package's.
3. **The package:** a tampered byte, a file the manifest doesn't list, a
   package the list doesn't name or withdrew, a downgrade, a replayed old
   package, a test-channel package, a migration that ends the transaction
   (`transactionSafe` bypass attempts: comments, dollar quotes, `DO` blocks),
   a migration that writes the ledger itself, very large inputs, a trickling
   response.
4. **The list:** expired, rolled back, re-used serial, a revocation withheld
   from one address.
5. **Power:** `wivo-update` runs SQL as the database owner (`SUPABASE_DB_URL`).
   Only signed SQL may reach it; review that no request field reaches a query
   unparameterised.
6. **Read-only checks** really run read-only (`set transaction read only`),
   and their rows go only to approvers.
7. **The scheduled check** with the `sb_secret` key in Vault: what it can and
   cannot trigger (a check installs nothing).
8. **The `WIVO_BUILD` secret:** changing it changes only where lists are
   fetched, never what is trusted.
9. **Desktop order:** an app update never installs ahead of a database it
   needs, and never blocks working on the old version.

Findings are fixed and re-tested before the first package goes to Riga.

## 6. Build order (next night)

1. Packages in `release-riga.mjs` (+ tests: the signed manifest bytes are what
   `checkPackage` verifies; a non-transaction-safe migration is refused before
   signing).
2. The adopt step in `wivoUpdate.ts` + a small migration for anything it needs
   (126; `lock_anon_functions()`, leak test if a table is added) + tests on
   PGlite with the real baseline: adopt, then install 126 → only 126 runs.
3. `WIVO_BUILD` in `wivo-update/index.ts` (+ test: unknown build → no source).
4. Desktop waits for `schema` (+ tests).
5. The scheduled check migration.
6. Docs: RELEASE.md §5 replaced, RIGA-ROLLOUT steps (deploy `wivo-update`,
   adopt, first database package on the test project, then Riga).
7. The security review (§5) before anything is deployed to Riga.

## 7. Decisions for Kevin

1. **Adopt instead of a setup secret** for Riga's hand-built database (2.2).
   Recommended: yes; the setup tool comes later for new clinics.
2. **Where `wivo-update` learns Riga's address:** a function secret
   `WIVO_BUILD=riga` (recommended: no per-clinic code) or a per-clinic copy
   generated at deploy.
3. **Functions stay manual** until the functions token (slice 3).
   Recommended: yes; most releases change no function.
4. **Point-in-time recovery** for Riga (paid add-on): Riga's decision and
   cost. Without it the last daily backup is the floor.
5. **Desktop waits for the database** (2.4) vs. installs and runs read-only
   until the database catches up (§5b's wording). Recommended: wait, it is
   simpler and never leaves a desktop read-only.
