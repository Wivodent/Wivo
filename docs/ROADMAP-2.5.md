# Roadmap to 2.5, and the ground for 3.0

**Status: plan only (2026-11-26).** No code, no migration. Gap analysis made
from the code on `testing` at `248fb85` (Wivo 2.2.1), not from older documents.

docs/ROADMAP.md keeps the ladder and the long view. This file is the order of
the releases from 2.2.2 to 2.5.0, then from 2.5.0 to 3.0. docs/GAP-ANALYSIS.md
(2026-11-02) is out of date: stock, inventory, stages and Latvian pay were
built after it.

**Lühidalt (Kevin):**

- **2.5 on täielik rakendus ühele kliinikule ja laborile.** Selleni on kolm
  plokki, igaüks väikeste testitud väljalasetena:
  - **A** (2.2.2 → 2.3.0): ükski muudatus ei kao ja andmebaasi uuendused
    käivad allkirjastatult;
  - **B** (2.3.1 → 2.4.0): labori ja raha terve tööpäev, vene keel;
  - **C** (2.4.1 → 2.5.0): failid, ravikaart, kalender, telefon, läti keel,
    abi, lihvimine.
- **Kõik tööprotsessi asjad on 2.5.0-s valmis.**
- **2.6–2.9 ei lisa kliendile midagi nähtavat.** Need ehitavad partnerluse
  alust kahe testkliiniku vahel. 3.0 lülitab selle esimesele päris paarile
  sisse.
- **Sinu käsi on vaja:** juristi küsimused, Läti arve nõuded, Apple konto, Pro
  plaanid, tõlkijad ja võtmed (§4).

---

## 0. The version ladder and the release rule

| Version | What it means |
|---|---|
| **2.5** | The complete, polished app: comfortable on the phone and the desktop, everything one clinic or lab needs for its own work. |
| **3.0** | Partnerships and connections between clinics, working end to end. |
| **3.5** | The partnership finished: chat across clinics, changes after sending, stock across projects, hardening. |
| **4.0** | WivoStore: ordering from partners and suppliers. |
| **4.5** | WivoStore polished. |
| **5.0** | Wivo Network: people, not only clinics (docs/WIVO-NETWORK.md). |

**The rule (also in CLAUDE.md):**

- Work ships in **small steps**: 2.2.2, 2.2.3 … and the patch number may go
  past 9 (2.2.11 is fine).
- **Each step is tested and released.** Nothing waits in a branch for the
  next one.
- **2.3.0, 2.4.0, 2.5.0 (and later minors) only mark that a larger block is
  done.** A minor number never carries a half-finished block. The last step
  of a block is its .0 release: it adds only the closing work (the block's
  checks, What's new for the block, the minimum version where needed).
- **One clear theme per step.** A step that needs a migration says so in its
  report; the migration goes to the test copy first (CLAUDE.md).

Sizes in this file: **S** = up to a day of building, **M** = 2–4 days, **L** =
a week or more. Kevin's testing comes on top, and it is usually the limit.
"Migration" means a new `sql/` file (the next free number is **131**).

---

## 1. Gap analysis, area by area

**State:**
- **done**: built and in use;
- **partial**: built but not complete, not tested in real use, or switched off;
- **missing**: nothing in the code.

Each row that is not done carries its size, whether it needs a migration,
what it depends on, and its main risk. The ID (J1, F2 …) is used in §2.

### 1.1 Jobs

**Done:**
- the new-job wizard: teeth, work items, options, "Ordered by";
- the job page and the board, table and search;
- stages from templates, per job, with stage people (sql/122–126), the stage
  gate (sql/123), and notifications per stage;
- revisions with reasons, notes, soft delete and restore, job codes owned by
  the database;
- reprice, option doers (sql/130), and the phone's job view.

| ID | Gap | State | Size | Migr. | Depends on | Risk |
|---|---|---|---|---|---|---|
| J1 | **Editing at the same time overwrites.** The job form and the revision save send the whole job as it was when opened: stage, people, work items, revisions and price. Notes, option doers and pay rules write whole arrays or rows. Templates save in four separate requests. Details: docs/STATUS-2026-11-26.md §2. | partial | M + M | yes, for atomic saves | – | **High, today:** silent data loss, a stage moved back, pay going to the wrong person |
| J2 | "Ordered by" shown and editable on the job page and in the table. The "orderer" stage person is the chosen doctor, not the job's creator. | partial | M | yes (orderer resolution) | – | low |
| J3 | Work type options, the next version: extra stages by option (`only_if`), a required group, options on the job page and card (read-only on the phone), options as their own invoice lines | partial | L | yes | J2 | medium: stage rules and invoices change together |
| J4 | Job sheet to print, with a QR code that opens the job on the phone | missing | M | no | – | low |
| J5 | `jobs.template_id` can be changed after creation (BACKLOG, security check 3) | partial | S | yes | – | low |
| J6 | Remakes still move by a direct `revisions` update, outside the stage rule (BACKLOG, security check 4) | partial | M | yes | J1 | medium |
| J7 | Scanner integration (the scanner's cloud) | missing | – | – | – | Not in 2.5. Manual upload and the folder watcher stay. |

### 1.2 Files

**Done:**
- `job_file` in a private bucket with a 500 MB limit (sql/072);
- resumable upload (TUS, 6 MB chunks), SHA-256, versions, soft delete;
- previews: STL to PNG, photo thumbnails;
- a viewer for images and PDFs (desktop and phone);
- the phone camera (no gallery, no GPS);
- photo and STL cleaning (DICOM is stored as uploaded since `4560a98`);
- the folder watcher into "Scanner files";
- attachments in a job's thread (sql/080);
- `file-link` (60-second signed link, audited), and the patient export ZIP.

| ID | Gap | State | Size | Migr. | Depends on | Risk |
|---|---|---|---|---|---|---|
| F1 | **The upload limit, in words.** The bucket allows 500 MB, but the project's own Storage limit (Supabase dashboard) decides first. A file over the limit should be refused before the upload starts, saying the limit. | partial | S | no | Kevin/clinic: the dashboard limit | medium: a 300 MB scan failing late, with no clear reason |
| F2 | **Storage use and quota per clinic:** used space, a warning near the limit, and the "extra storage" licence module | missing | M | yes (a `stable` function summing the clinic's objects) | licence modules | low |
| F3 | **3D viewer** for STL, PLY and OBJ: rotate and zoom, display only, on desktop and phone | missing | L | no | – | medium: memory on phones with big scans, so a size cap on the phone |
| F4 | **Files by tooth and by stage** (`job_file.teeth`, the stage the file belongs to); photo series before and after | missing | M | yes | – | low |
| F5 | **Files in chat beyond the job thread:** a team chat (group and direct) with attachments. The tables exist (sql/065–069); the screen does not. | partial | L | probably (direct channels) | F1 | medium: a new place where patient data can be written |
| F6 | **Every file read through `file-link`.** `JobFiles.tsx` previews and `PatientExport.tsx` still sign links themselves, so the grant read policy `job_files_select` (sql/072) can't be dropped. Also: `file-link` and `public-booking` read only the legacy service key. | partial | M | yes (drop the policy, after a minimum version) | – | medium: old builds lose previews unless the minimum version is raised first |
| F7 | All of a job's files as one ZIP (audited, `auditedZipExport` exists) | missing | S | no | F6 | low |
| F8 | 2D X-ray viewer (display only) | missing | M | no | F3 | low; never a diagnostic tool (MDR) |

### 1.3 Stock

**Done (built, not tested in real use):**
- stock items, movements, lots and expiry, and consignment (sql/093);
- the partner stock tab and minimum-quantity alerts;
- inventory counts with a schedule, reasons and history (sql/094).

| ID | Gap | State | Size | Migr. | Depends on | Risk |
|---|---|---|---|---|---|---|
| S1 | Stock used for real in Riga, and fixed from what that shows (ROADMAP step 2) | partial | M | maybe | Riga's trial weeks | medium: stock numbers trusted before they are right |
| S2 | The catalogue: equipment, materials, shades, and the clinic's VITA table (docs/STOCK.md slice 1) | missing | L | yes | S1 | medium: touches the new-job wizard's material and shade fields |
| S3 | Goods receipt from the supplier's invoice, a job showing what it used, a lot showing which jobs it went into (docs/STOCK.md slices 2–6, without partner stock) | missing | L | yes | S2 | medium |
| S4 | Stock across two clinics' projects | missing | – | – | 3.0 bridge | **3.5, not 2.5** |

### 1.4 Invoices

**Done:**
- invoices, lines, payments and payment plans, and the print view;
- `send-invoices` (hourly e-mail): not deployed to production (BACKLOG);
- **Estonian only:** `invoicesAvailable()` returns true only for `EE`, so a
  Latvian clinic has no invoices.

| ID | Gap | State | Size | Migr. | Depends on | Risk |
|---|---|---|---|---|---|---|
| I1 | **Invoices for Latvia:** PVN, the required fields, numbering, and the invoice in Latvian | missing | L | probably | **Kevin: Latvian requirements from an accountant** | high: a legal document; wrong is worse than none |
| I2 | Recurring customers: a monthly invoice built automatically, sent to the saved representative straight away or after an admin confirms (ROADMAP step 3) | missing | L | yes | I1 for Latvia | medium: an automatic send is hard to take back |
| I3 | On each invoice, when it was e-mailed or why sending failed; a filter for failed ones (BACKLOG) | missing | S | no | – | low |
| I4 | Accounting export: a locked period and VAT by rate. Also the two number debts in statistics (`periodMetrics` adds revision prices to revenue; `kulu_yle` is not in the cost lines: NEXT.md, not re-verified) | missing / partial | M | yes (locked period) | I1 | medium: the numbers go to the accountant |

### 1.5 Payroll

**Done:**
- pay rules by kind, scope, work type and option (sql/129), additive rules,
  and stage pay kinds (sql/124);
- hours, payouts in one step, and the pay export (sql/121);
- Estonian taxes, and the Latvian estimate: social tax, income tax, booklet,
  dependents, pensioner, minimum-wage base.

| ID | Gap | State | Size | Migr. | Depends on | Risk |
|---|---|---|---|---|---|---|
| P1 | Latvia, the rest: the 33 % band above 8 775 € a month, the accountant's export with the Latvian fields, and the 2027 rates when published | partial | M | no | Kevin: the 2027 rates, an accountant's check | medium: tax figures, labelled as an estimate |
| P2 | Agreements with external technicians, signed with a fresh code (docs/AGREEMENTS.md) | missing | L | yes | J1 | medium. **Decision:** the plan put it after the partnership; the 2.5 rule (all work in 2.5) moves it before. |
| P3 | Ratings between doctor and technician (docs/MODULES-AND-RATINGS.md part 2) | missing | M | yes | stage people (done) | medium: it measures staff, so the duty to inform applies. **Decision:** in 2.5 or later. |

### 1.6 Calendar and visits

**Done:**
- visits, the week grid and timeline, and visit types;
- the booking requests inbox, booking hours, and public services with the
  price calculator;
- the public booking page with a Montonio fee, in sandbox mode until the
  account is verified.

| ID | Gap | State | Size | Migr. | Depends on | Risk |
|---|---|---|---|---|---|---|
| C1 | Reminders to patients before a visit (e-mail; SMS if Riga wants it) | missing | M | yes (a log of what was sent, and the patient's channel) | e-mail on in Riga; **Kevin: an SMS provider and its data processing agreement** | medium: personal data to a processor; time and clinic only, never the procedure |
| C2 | The calendar on the phone: my day, the clinic's day | missing | M | no | – | low |
| C3 | A visit and its lab job together: the visit shows whether the work is ready, and the job knows the visit's date | missing | M | yes | J2 | low |
| C4 | Live booking fees (Montonio verified) and the refund rule | partial | S | no | **Kevin: Montonio verification, the lawyer on refunds** | medium: money |

### 1.7 The treatment card by tooth

**Done:**
- patients, a free-text treatment card (`patients.ravikaart`), and a tooth
  chart with one status per tooth (sql/003);
- the 3D odontogram, TMJ, visits, notes, and the patient export.

| ID | Gap | State | Size | Migr. | Depends on | Risk |
|---|---|---|---|---|---|---|
| T1 | **The visit note by tooth:** FDI tooth, surface, procedure and text, plus a general text. Signed with a fresh code, then locked; changes only as an amendment with a reason. | missing | L | yes (new tables, RLS, leak test, second factor) | **Riga: does Wivo replace Dentas or work beside it; their fields. Kevin: Latvian medical record rules (retention, who may write).** | high: a medical record. Wivo never suggests a treatment (CLAUDE.md, MDR). |
| T2 | A tooth's history: entries, jobs, files and X-rays on one timeline; search and filters | missing | M | no | T1, F4 | low |
| T3 | A chart in two layers (crown, root), and components: implant system, size, lot, linked to the stock lot | missing | L | yes | T1, S3 | medium |
| T4 | The treatment plan builder: packages priced from the clinic's price list, side by side, as a PDF, the patient's choice (VISION step 1, without payment) | missing | L | yes | T1; **decision: in 2.5 or after it** | medium: wording ("builder", never "generator") |

### 1.8 Statistics

**Done:**
- the dashboard panels and the finance view, with revision loss;
- "My view";
- the payroll cost with Latvia's employer tax;
- the `stats.read` permission and the `stats` module.

| ID | Gap | State | Size | Migr. | Depends on | Risk |
|---|---|---|---|---|---|---|
| ST1 | Stage statistics: time per stage, waiting, bottlenecks, a person's throughput (ROADMAP entry) | missing | M | no | weeks of Riga's stage data. **Decision: who sees the per-person figures.** | medium: it measures staff, so the duty to inform applies |
| ST2 | The two number debts (with I4) | partial | S | no | – | medium |
| ST3 | A short owner's view on the phone | missing | S | no | ST2 | low |

### 1.9 Phone

**Done:**
- a PWA from the same code, with the same sign-in and second factor;
- home (my jobs, search), the job page (files, thread, stage bar, option
  doers, camera), new job, settings;
- push notifications, the version guard, a shorter session.

| ID | Gap | State | Size | Migr. | Depends on | Risk |
|---|---|---|---|---|---|---|
| PH1 | The calendar (C2) | missing | M | no | – | low |
| PH2 | Take from stock on a job by scanning a box's code | missing | M | no | S3 | medium: barcode scanning in the browser differs on iPhone |
| PH3 | Find a patient and see their visits (read only, by permission) | missing | M | no | – | medium: patient data on a phone; the same permissions as on the desktop |
| PH4 | Offline: a clear message, uploads that resume after the connection comes back | partial | M | no | – | low |
| PH5 | A full Content-Security-Policy for the phone app (RUN-2 §6) | missing | S | no | – | low |

### 1.10 Languages

**Done:**
- English is the source and Estonian is complete (4 010 keys);
- the language is set per user, with the clinic's default;
- push texts in the recipient's language.

| ID | Gap | State | Size | Migr. | Depends on | Risk |
|---|---|---|---|---|---|---|
| L1 | **Russian complete:** about 280 of 4 010 keys today, the rest falls back to English | partial | L (mostly translating) | no | **Kevin: a native speaker to check it** | low |
| L2 | **Latvian as an interface language** (`lv`): the language list, the clinic default, the full translation | missing | L | **yes** (`clinics_default_language_valid` and the profile language check allow en, et, ru only, sql/070) | Kevin: a native speaker | low |
| L3 | Latvian in everything that leaves the clinic: invoices, e-mails, push and notification e-mails, the booking page | missing | M | no | L2, I1 | medium: legal texts |
| L4 | Dates, numbers and currency formatted per country | partial | S | no | – | low |

### 1.11 Setup

**Done:**
- the first owner's clinic wizard and the "Set up your clinic" list;
- the work type catalogue, the demo clinic, invites and logins;
- licence modules;
- the per-clinic release config (`clinics/<id>.json`);
- the baseline by `fresh-schema.mjs` and psql (CLINIC-SETUP.md, Kevin).

| ID | Gap | State | Size | Migr. | Depends on | Risk |
|---|---|---|---|---|---|---|
| SE1 | A full setup wizard on first sign-in, in order, ending with the phone app on the staff's phones (ROADMAP after 2.1.0) | partial | M | no | H1 shares its text | low |
| SE2 | Importing a clinic's existing patients and customers (CSV) | partial (`ImportCSVButton`, `import-csv.mjs`) | M | no | the Dentas answer (T1) | medium: personal data, so the import is audited |
| SE3 | A new clinic sets up its own project without Wivo (ARCHITECTURE-INSTANCES §6e) | missing | L | no | U1, U3 | **2.6, not 2.5** (§5) |

### 1.12 Help

**Done:** "What's new", "Report a bug", and "Request a feature" / "Contact
Wivo" (an e-mail link, hidden until `VITE_WIVO_CONTACT_EMAIL` is set).

| ID | Gap | State | Size | Migr. | Depends on | Risk |
|---|---|---|---|---|---|---|
| H1 | The guided tour and the written guide per role, with a "?" on each page (docs/TOUR.md) | missing | L | no | **Kevin: OK of docs/guide/admin.md with the secretary**; L1 and L2 for ru and lv | low |
| H2 | The contact address set for Dentiks (`clinics/dentiks.env`) | missing | S | no | Kevin | low |

### 1.13 Backup and restore

**Done:**
- Supabase's daily database backups on Riga's Pro plan (7 days);
- `scripts/export-clinic.mjs`: database, every table as CSV and every Storage
  object, encrypted. It is Kevin's handover tool and read only.
- soft delete with restore, the audit log, and the per-patient export.

**Not covered today:** Supabase's database backups do not hold the files in
Storage. Riga's scans and photos have no second copy anywhere, and no restore
has ever been tried end to end.

| ID | Gap | State | Size | Migr. | Depends on | Risk |
|---|---|---|---|---|---|---|
| B1 | **The clinic's own off-site backup:** database and files, encrypted, to storage the clinic owns, run by the clinic (built from `export-clinic.mjs`). Wivo never holds the copy. | missing | M | no | the clinic's IT; Kevin: PITR decision | **High while missing:** files have no backup |
| B2 | **A restore drill:** a backup restored onto a fresh project, counts and hashes compared, written up as a runbook; first on demo data, then by the clinic every quarter | missing | M | no | B1 | medium |
| B3 | The owner sees when the last backup was made | missing | S | maybe | B1 | low |

### 1.14 Updates

**Done:**
- signed desktop releases per clinic, the licence through updates, and the
  minimum version;
- every piece of `wivo-update` that DB-UPDATES-PLAN §1 lists: the ledger, the
  check and install, and the Settings screen.

**Not working yet:** none of it is switched on, and Riga's migrations are still
run by hand (docs/STATUS-2026-11-26.md §1).

| ID | Gap | State | Size | Migr. | Depends on | Risk |
|---|---|---|---|---|---|---|
| U1 | **`wivo-update` for Dentiks:** packages from the release tool, adopting Riga's existing database, `WIVO_BUILD`, deploying the function, and the security review of DB-UPDATES-PLAN §5 | partial | L | yes (the adopt helpers) | the security review | **High:** it runs SQL as the database owner. Only signed SQL may reach it. |
| U2 | A desktop waits for its database, and the daily check | missing | M | yes | U1 | low |
| U3 | **One build for every clinic:** the licence names the project (RIGA-GO-LIVE part B), and the `riga` branch retires | missing | L | no | – | medium: a wrong licence connects nowhere. **2.6** (§5) |
| U4 | Automatic installs, off by default (ARCHITECTURE-INSTANCES §5b) | missing | M | yes | U1 in use for months | medium. **2.6** |
| U5 | Edge Functions in signed packages (the functions token, §5c slice 3) | missing | L | no | U1 | high. **2.6**: the bridge's functions have to reach every clinic. |

### 1.15 Security

**Done:**
- every `public` table has RLS (56 of 56);
- every security definer function has a `search_path` (199 of 199);
- nothing works without the second factor (sql/098), and the anon key runs
  only `require_mfa_for_api` (sql/101);
- the leak tests, the audit log (append only), and an audit entry for every
  export (sql/106);
- the service key only in Edge Functions (docs/STATUS-2026-11-26.md §3).

| ID | Gap | State | Size | Migr. | Depends on | Risk |
|---|---|---|---|---|---|---|
| SEC1 | The full security review (due 2026-12-07) and its fixes, including BACKLOG's security checks 2.1–2.4 | partial | M (fixes, unknown until the review) | likely | Kevin starts the review | – |
| SEC2 | **Money off the job row** (`job_money`, docs/PERMISSIONS.md): stage people can read prices and the patient's name through the API | missing | L | yes, with a data move | SEC1 | **high:** the biggest data move since the restore. Totals are compared before and after. |
| SEC3 | The 100 definer functions callable when signed in, each checked for clinic, permission and partner visibility | partial | M (review) | maybe | SEC1 | – |
| SEC4 | Defence in depth: remove the table grants that anon does not need (51 tables; RLS already stops it) | missing | S | yes | SEC1 | low |

### 1.16 Mac

**Done:** `package.json` has a `dmg` target. Everything else is built for
Windows only: CI builds only Windows, there is no signing or notarisation, and
the release tool signs a Windows installer.

| ID | Gap | State | Size | Migr. | Depends on | Risk |
|---|---|---|---|---|---|---|
| M1 | A Mac build signed with an Apple Developer ID and notarised. It updates itself (a zip target for the updater) and goes through the same Wivo-signed release statement as Windows. | partial | M | no | **Kevin: the Apple Developer account, the certificate, notarisation credentials** | medium: the release tool and the signed list gain a second file per version |

---

## 2. The releases to 2.5.0

The order: **what loses or leaks data first**, then what Riga works with every
day, then what completes the clinic's side, the files and the polish. Every
step is tested on the test copy and released before the next one starts.

### Block A: nothing lost, nothing leaked (2.2.2 → 2.3.0)

| Version | Theme | Items | Size | Migr. |
|---|---|---|---|---|
| **2.2.2** | A job is never overwritten by an older copy | J1, the job form and the revision save. They send only the fields that changed, and only if the job is still as it was when the form was opened. Otherwise: "Someone else changed this job. Reload to see it." | M | no |
| **2.2.3** | Settings, prices and pay rules are not overwritten either | J1: the clinic settings sync (compare by `updated_at` instead of ignoring every event for 2 seconds; re-read after sleep or a lost connection; retry a failed save and say so), pay rules sending only what changed, option doers | M | no |
| **2.2.4** | Saves that are one step | J1 atomic: notes added and removed by RPC, a template and its stages saved in one transaction, stage defaults the same; J5 | M | yes |
| **2.2.5** | The security review's fixes | SEC1, SEC3, SEC4, PH5 | M | likely |
| **2.2.6** | Files only through `file-link` | F6. Raise the minimum version first, then drop the grant read policy. | M | yes |
| **2.2.7** | Money off the job row | SEC2 | L | yes, data move |
| **2.2.8** | Database updates through `wivo-update`, on the test project | U1, part 1: packages, adopt, `WIVO_BUILD`; the DB-UPDATES-PLAN §5 review on a fresh project with made-up data | L | yes |
| **2.2.9** | Database updates through `wivo-update`, in Riga | U1, part 2, and U2: deploy, adopt, the first package installed by Riga's owner, desktops waiting for their database, the daily check | M | yes |
| **2.2.10** | The Mac | M1 | M | no |
| **2.3.0** | Block A closed | The minimum version at the block's floor; What's new for the block; the RELEASE.md §5 hand steps removed | S | no |

**Alongside block A, with no app release:**
- B1 and B2 (backups and the restore drill). Kevin on demo data first, then
  the clinic's IT on theirs.
- H2 (the contact address).

### Block B: the lab's working day and its money (2.3.1 → 2.4.0)

| Version | Theme | Items | Size | Migr. |
|---|---|---|---|---|
| **2.3.1** | Russian, complete | L1, L4 | L | no |
| **2.3.2** | The job page, complete | J2, J4 | M | yes |
| **2.3.3** | Work type options, the full version | J3 | L | yes |
| **2.3.4** | Remakes through the stage rule | J6 | M | yes |
| **2.3.5** | Latvian payroll, complete | P1 | M | no |
| **2.3.6** | Stock as Riga uses it | S1 | M | maybe |
| **2.3.7** | The catalogue: equipment, materials, shades | S2 | L | yes |
| **2.3.8** | Goods in, goods used | S3 | L | yes |
| **2.3.9** | Invoices for Latvia | I1, with its part of L3 (only after the requirements are known) | L | probably |
| **2.3.10** | Monthly invoices for recurring customers | I2, I3 | L | yes |
| **2.3.11** | The accountant's export and right numbers | I4, ST2 | M | yes |
| **2.3.12** | Agreements with external technicians (if Kevin moves it into 2.5) | P2 | L | yes |
| **2.4.0** | Block B closed | Block checks, What's new, the minimum version | S | no |

### Block C: the clinic's side, files, and finish (2.4.1 → 2.5.0)

The files come first in this block, as decided. Everything about the work
process is done by 2.5.0.

| Version | Theme | Items | Size | Migr. |
|---|---|---|---|---|
| **2.4.1** | File limits you can see | F1, F2 | M | yes |
| **2.4.2** | Files by tooth and stage; a job's files in one ZIP | F4, F7 | M | yes |
| **2.4.3** | Seeing scans and X-rays in Wivo | F3, F8 | L | no |
| **2.4.4** | The team chat, with files | F5 | L | probably |
| **2.4.5** | The visit note by tooth | T1 | L | yes |
| **2.4.6** | A tooth's history and its components | T2, T3 | L | yes |
| **2.4.7** | The treatment plan builder (if Kevin keeps it in 2.5) | T4 | L | yes |
| **2.4.8** | Visits and lab jobs together; reminders | C3, C1 (and C4 if Montonio and the lawyer are done) | M + M | yes |
| **2.4.9** | The phone, complete | C2/PH1, PH2, PH3, PH4, ST3 | L | no |
| **2.4.10** | Stage statistics (and ratings, if decided) | ST1 (P3) | M | no (P3: yes) |
| **2.4.11** | Latvian | L2, the rest of L3 | L | yes |
| **2.4.12** | Help and setup | H1, SE1, SE2 | L | no |
| **2.5.0** | The complete app | A polish pass over every screen on desktop and phone: empty states, errors in plain words, layouts on small screens, speed with a year of data. What's new for 2.5 and the minimum version. | M | no |

### Not in 2.5

- Scanner cloud integration (J7).
- Anything between two clinics' projects: 3.0 and later.
- Booking fees taken for real, if Montonio or the lawyer are not done by then
  (C4).
- Payments through Wivo, and a patient app (docs/ROADMAP.md, "What is NOT in
  any step").
- Anything that suggests or ranks treatment (CLAUDE.md).

---

## 3. Dependencies in one view

- **J1 → everything:** each later screen copies how the job saves. Fix the
  pattern first.
- **SEC1 → SEC2, U1:** the review sees the money gap and the update path
  before they change.
- **U1 → U2, U4, U5, SE3:** packages first, then waiting, automatic installs,
  functions and setup.
- **I1 (Latvian requirements) → I2, I4, L3 invoices.**
- **The Dentas answer → T1 → T2, T3, T4, SE2.**
- **S1 → S2 → S3 → PH2, T3.**
- **F4 → T2.** Files by tooth make the tooth's history.
- **L1, L2 → H1** in Russian and Latvian.

---

## 4. Only Kevin

Things no session can do, and the step each one holds up.

| What | Holds up |
|---|---|
| **Supabase plans:** Riga's Pro plan is Riga's decision and cost. Point-in-time recovery is a paid add-on (DB-UPDATES-PLAN decision 4). The two test projects for 2.6+ need Pro too: free projects pause and have a 50 MB file limit, too small for real scans. | B1, §5 |
| **The project's Storage upload limit** raised in Riga's Supabase dashboard, with Riga's owner | F1 |
| **The Apple Developer account** (yearly fee), the Developer ID certificate, and notarisation credentials stored as CI secrets | M1 |
| A Windows code-signing certificate, if "unknown publisher" should go | optional |
| **The lawyer:** the booking-fee refund; Latvian medical record rules for T1, if it replaces Dentas; the duty to inform for stage statistics and ratings; the partnership questions Q3–Q6 (ARCHITECTURE-INSTANCES) before the first real shared job; anything for Wivo Network | C4, T1, ST1, P3, 3.0, 5.0 |
| **A Latvian accountant:** the invoice requirements (PVN, fields, numbering) and a check of the payroll figures | I1, P1 |
| **Riga's answers:** Dentas replaced or kept; their treatment card fields; whether they want SMS reminders | T1, C1 |
| **Providers' contracts:** Montonio verification; an SMS provider with a data processing agreement; Resend on Riga's domain | C4, C1 |
| **Native speakers** for Russian and Latvian | L1, L2 |
| OK of docs/guide/admin.md with the secretary | H1 |
| **Starting the security review** (due 2026-12-07), and booking the independent consultant for 2.9 | SEC1, §5 |
| **YubiKey work:** every release signature, licences, the update key for database packages | every release, U1 |
| Applying migrations on the test copy; every push; deleting production after the handover and the lawyer's OK (RIGA-GO-LIVE parts C and D) | every migration |
| Dashboard settings no one else can see: Cloudflare branches, GitHub secrets, `VITE_WIVO_CONTACT_EMAIL` | H2, U3 |

---

## 5. From 2.5 to 3.0: the ground for partnerships

**Rule for these versions:** 2.6, 2.7, 2.8 and 2.9 add **no work-process
feature a customer sees.**
- What they build runs between **two test clinics**, behind the licence
  module `partners`, which stays off in every customer's licence.
- Fixes to 2.5 go out as 2.5.x, 2.6.x and so on, as usual.
- 3.0.0 is the release that switches it on for the first real pair.

The design is in docs/ARCHITECTURE-INSTANCES.md §1–§4 and §7–§8: a direct
link between two projects, signed messages, an outbox and an inbox, nothing
going through Wivo. The size estimates below come from its §9 (phase 2).

### 2.6: every clinic the same way, and the test pair

| Step | What | Size | Migr. |
|---|---|---|---|
| U3 | One build for all clinics: the licence names the project (RIGA-GO-LIVE part B); the `riga` branch retires | L | no |
| U5 | Edge Functions in signed packages (the functions token): the bridge's functions must reach every clinic without Kevin deploying them by hand | L | no |
| U4 | Automatic installs, off by default, with the 3-day hold and `manual_only` | M | yes |
| SE3 | A clinic's setup without Wivo: the setup tool, the checklist page, the guide | L | no |
| **The test pair** | Two Supabase projects made with SE3: **Test Lab** and **Test Clinic**, demo data only, never real data. Scripts reset them to a known state. Each partnership test of 2.7–2.9 runs on them, and a PGlite pair runs the same tests in CI. | M | no |
| Admin console (optional here) | Versions and update results reported by each clinic, so "your partner needs to update" can be supported (ROADMAP, admin console). It sees no clinic data. | L | separate project |

### 2.7: trust between two projects

| What | Notes |
|---|---|
| **Keys** | One Ed25519 key pair per partnership and side. The private key is in that project's Vault, read only by the bridge functions. The other side's public key is in `bridge_peer`. (§1c) |
| **Signatures** | Every request signed over method, path, time, a nonce and the body hash. A 5-minute window and a nonce cache. Every message signed over its canonical JSON (RFC 8785). (§1c, §1d) |
| **Pairing** | `bridge-pair`: only an owner with the second factor; a pairing token, a one-time code sent another way, six safety words read aloud. Wivo's approval step goes away. (§1b) |
| **Accounts between clinics** | No account crosses projects. A partner's people work in their own Wivo, and an action arriving from a partner names the partner clinic and a role, not a person. A person working for both clinics has an account in each. Linking accounts is Wivo Network (5.0), after the lawyer. |
| **Permissions** | Who may pair, who may share, which stages a partner may move: settings per partnership, each side changing only its own. New permissions go through `shared/permissions.ts` like the others. |
| **Versions** | `hello` after pairing and after every update; each side writes the message version the other announced (§1e). |
| **Audit, rate limits, the public endpoint** | Both sides log every step (§4), with limits per peer (§1h). The endpoint stays as narrow as §1i describes. |

Migration: yes (`bridge_peer`, and the nonce and audit tables), with RLS,
leak tests and the second factor, like every table. Size: L (§9 slice 1, 4–5
days, plus Kevin's two sessions).

### 2.8: the sharing layer

| What | Notes |
|---|---|
| **Outbox and inbox** | A sender run by pg_cron, retries for days, ordering per job (`stream`, `seq`), idempotent by message id (§1f, §1g) |
| **What crosses** | A list of fields allowed per message type, with a test that refuses anything else. Never a name, personal code, contact details, birth date, medical card, visit note or price (CLAUDE.md, sql/092). |
| **Privacy items from the old work** | No CT or X-ray on a shared job until a cleaned copy exists (BACKLOG, after Riga's start, item 1); an age band instead of an exact age; how the other clinic's staff appear; 3MF and OBJ names cleaned. |
| **Sharing** | `share.created` and `share.ended`, stage requests and answers, the mirror behind the partner screens (§2a, §2d) |
| **Files** | Copied by the receiver from the sender's Storage and checked by hash; kept on both sides (§2b) |
| **The cross-project leak test** | Run on the test pair and the PGlite pair |

Migration: yes (outbox, inbox, `shared_job_mirror`). Size: L (§9 slices 2–3,
6–7 days).

### 2.9: proven, then reviewed

| What | Notes |
|---|---|
| **Delivery tests** | Duplicates, order, one side down for days (§1f) |
| **Version skew** | Two projects on different versions; recorded messages of every supported version replayed in CI (§1e, §8) |
| **Operations** | Key rotation in the app; a count of stuck messages for the owner |
| **The old in-database partnership** | Retired by the plan of §7. Its tables stay until no data needs them. |
| **The independent review** | One consultant over the update path and the bridge (§5f), then the fixes |
| **The lawyer's answers** | Q3–Q6 in before the first real shared job |
| **A full rehearsal** | Scan, technician work, print files, done, on the test pair (§9 slice 4) |

Size: M–L, mostly tests, plus the review's own dates.

### 3.0.0

The `partners` module is switched on in the first real pair's licences, and
the two owners pair on a call. 3.0's What's new is the first time a customer
sees any of §5.

---

## 6. Decisions for Kevin

1. **Agreements with external technicians (P2):** before 2.5 (block B), as
   the "all work in 2.5" rule implies, or after 3.0 as the earlier plan said?
2. **The treatment plan builder (T4):** in 2.5, or the first thing after it?
   It belongs to the vision's closed loop, whose other steps need 3.0 and
   4.0.
3. **Ratings (P3) and per-person stage statistics (ST1):** in 2.5, and who
   sees what.
4. **The treatment card (T1):** only after Riga answers about Dentas. If
   Dentas stays, T1 shrinks to what Dentas lacks.
5. **SMS reminders:** a provider, or e-mail only.
6. **The admin console:** in 2.6 alongside the test pair, or later.
