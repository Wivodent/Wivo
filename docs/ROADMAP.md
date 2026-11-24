# Roadmap: the order Riga gets Wivo in

**Decided with Riga, 2026-11-16.** They want the whole thing, but delivered
one part at a time — a new part every week or month, each one usable before
the next exists.

This file is the **order**. docs/BACKLOG.md stays the list of ideas: nothing
here is an idea, and nothing there has a date. docs/VISION.md is where the
product is going after 2.0; this is how Riga gets there.

The switch for every step below is the **licence modules**
(docs/MODULES-AND-RATINGS.md, part 1). A step is "delivered" when its module
is turned on in Riga's licence — which is also how a step can be turned back
off without a release.

---

## What everything here stands on

Two things carry every step and are not steps themselves.

| | What it is | Where |
|---|---|---|
| **Phase 1** | Riga on its own Supabase project, with its own data. No Wivo clinic shares a database with another. | docs/ARCHITECTURE-INSTANCES.md |
| **Licence modules** | A signed licence names the clinic, the allowed API address and the modules it may run. Turning a step on for Riga is a new licence file, not a release. | docs/MODULES-AND-RATINGS.md part 1 |

The licence carries the **allowed API address**, not only the organisation,
because the app checks where it may connect before it connects — and because
Riga may later move to their own server, where the address is not
`*.supabase.co` (see "Own server" below).

---

## Step 1 — work gets done (now)

The first thing Riga does with Wivo on day one. Module `jobs`, with the team
always present (the team is not in a module: `payroll` and `stock` need
people even when `jobs` is off).

- **Workers and the team.** Built.
- **Jobs and stages with SEVERAL technicians.** Not built: a job today takes
  one person as its maker and one as its designer. Riga's work passes through
  a doctor, a designer and a printer, each with their own stage. **Plan 3.**
- **A notification when a job reaches a stage.** The stage's responsible
  person is told (bell, push, e-mail, as their own settings say); with nobody
  on the stage, the owner is. **Plan 3.**
- **Files on the job** — scans, the design, the print file. STL files run to
  hundreds of megabytes, so the upload has to survive a dropped connection.
  **Plan 3.**
- **The phone**: adding a job, moving a stage, "I started", photos and files.
  Partly built; the stage work follows plan 3.
- **Russian as the fall-back language.** Separate small plan after plan 3.
  Russian is the third language: a missing string falls back to English, and
  every translation is marked for a native speaker to read before release.

**Ratings (docs/MODULES-AND-RATINGS.md part 2) come after step 1**, not
during it: who is rated has to come from the technician assigned to the
stage, and that assignment is what plan 3 builds.

## Step 2 — stock

Module `stock`. Stock and a partner clinic's stock, counted per job.

**Largely built, and untested** (docs/STOCK.md). Step 2 is therefore mostly a
test and fix step, not a build step. Nothing here is "done" until it has run
on real jobs in Riga.

## Step 3 — invoices

Module `invoices`.

- Invoices, and **recurring customers**: a customer marked as such gets a
  monthly invoice built automatically.
- The invoice goes to the customer's **saved representative**, either
  straight away or after an admin confirms it on the Invoices page. Which of
  the two is a per-customer setting.
- **Latvia's invoice requirements have to be researched first.** Wivo's
  invoice is an Estonian document today: `invoicesAvailable()` in
  `src/renderer/src/lib/country.ts` returns true only for `EE`, so invoices
  are **switched off for a Latvian clinic**. That gate opens when the Latvian
  requirements are known and built — not before.

## Step 4 — the calendar, and the rest

Module `patients` (the calendar is inside it, one piece). Everything agreed
but not in steps 1–3 lands here.

## Stage statistics for the owner (after Riga is stable)

**When:** once Riga has worked with stages long enough for the numbers to
mean something: a few weeks of jobs through their templates. The owner, or
someone given the permission, sees it; it fits module `stats`. **Roadmap entry
only: no code yet.**

**What it shows, per stage and per period:**
- **How long a stage takes:** from "I started" (`job_stage.started_at`) to done
  (`done_at`). Median and spread, not only the average, because one forgotten
  job skews an average.
- **How long a job waits:** from the moment it reaches a stage (the previous
  stage's `done_at`, or the job's creation for the first stage) to "I started".
- **Bottlenecks:** the stages where jobs wait longest, and where the most jobs
  stand right now.
- **A person's throughput:** how many stages a person finished in a period,
  and how long they took.

**From what:**
- `job_stage` `started_at` and `done_at`, which sql/122–123 already record.
- The move history in the audit log, where a stage is entered more than once:
  going back clears a stage's own times (sql/123), so `job_stage` alone loses
  the first pass.

No new data is collected for the first version.

**What the numbers do not say:**
- **"I started" is optional.** Where nobody presses it, a stage has only
  `done_at`. Then the time between stages is waiting and working together.
  The page says how many stages had a start time.
- **The time includes nights, weekends and other jobs.** It is calendar time,
  not working time. It shows where jobs stand still, not how hard anyone works.

**Decide before building:**
- **The per-person figures.** They measure employees, so the staff are told
  what is measured and why (the employer's duty to inform, GDPR). The
  options: the owner sees them, or each person sees only their own, or both.
- **Later: a "Pause" button for real working time.** A person presses "Pause"
  and "Continue" on their stage, and the stage then has real working time, not
  calendar time.
  - The cost: one more thing to press, and data about each person's working
    day, so the same duty to inform.
  - Decide it once the first statistics show whether calendar time is enough.

## 3.0 — the partnership system, working end to end

The partner bridge (phase 2) is **on hold, not cancelled** — the Tallinn
clinic partnership ended. 3.0 is where it comes back and is finished:
partner jobs, partner stock, and the lawyer's locked rule that no personal
data crosses between clinics (sql/092, CLAUDE.md).

## 4.0 — WivoStore

A tab where a clinic orders from partners and other clinics what they offer,
and can send an enquiry — "do you have X?" — to those who have not listed it.
This is VISION.md's supplier marketplace seen from the clinic side, and it
needs 3.0's partnership system underneath it.

## Wivo Network (vision for 3.0/4.0)

Wivo for people, not only for clinics. The plan, the preparation and the
questions for the lawyer are in **docs/WIVO-NETWORK.md**.

- **A personal Wivo account that no clinic owns.** It goes with the person
  from clinic to clinic.
- **A professional profile:** skills, kinds of work, the clinics worked for.
- **A signed work history with no patient in it.** The clinic's Wivo sends a
  record when a job finishes: stage, kind of work, units, dates. It never
  carries a job code, a patient, a tooth or free text.
- **A market for quick jobs.** A clinic gives a Network member temporary
  access to one job only.
- **Where it runs:** a separate central project, not the admin console's,
  with no patient data.
- **The lawyer first.** Nothing is built before the lawyer has answered.
  Staff data in a central project touches the locked rule on personal data
  between clinics.
- **Preparation now, as plan only:**
  - an empty `profiles.wivo_person_id`, set only by the person through a
    signed link;
  - the shape of a work record, built from `job_stage`.

  Neither is migrated yet.

---

## Own server (Riga)

Riga want one physical server with everything on it: Wivo, their website,
booking, and payments later.

**We start in the cloud, on their own account, and move to their server
later.** That order is deliberate: the move is a hosting change, and doing it
while the product is still changing weekly would mean debugging both at once.

Their current server is 17 years old (4 GB RAM, a hard disk, six VMs) and is
being replaced. The new one is Windows Server with Hyper-V, and Wivo gets a
Linux VM of its own.

**docs/OWN-SERVER.md** holds Riga's IT input and what the plan has to settle:
self-hosted Supabase, how updates reach it without the Management API, backups
with an encrypted copy off site, HTTPS that phones accept on port 443 (and
VPN-only as the alternative), the VM's exact specification, and the move out of
the cloud with a way back. **Plan only, and after the demo.**

---

## Wivo admin console (after Riga is stable)

**When:** after Riga is stable. Clinics see no change from it, so it waits until
nothing in Riga needs Kevin's attention every week. **Roadmap entry only: no
code yet.**

**The plan:** docs/ADMIN-CONSOLE.md (waiting for Kevin's OK). Its first version
collects nothing from clinics.

**What it is:** Kevin's own view of every clinic Wivo runs in, in one place.
It is a separate Supabase project on Kevin's own account, holding no patient
data. It is not a clinic's project and not production.

**What it shows:**
- **Clinics:** each clinic, with its licences: which licences were issued,
  their modules and when they expire.
- **Billing:** invoices to clinics and whether they have been paid.
- **Versions:** each clinic's Wivo version, and whether its last update
  succeeded (desktop and database).
- **Error reports.**

**Sign-in:** a YubiKey only. There is no password-only way in.

**What clinics send it, and what never:**
- A clinic sends **only technical summaries:** its version, and the result of
  an update (succeeded or failed, with the error code).
- **Never patient data or job data.** That means no names, personal codes,
  contacts, visit notes, prices, file names or free text. This follows from
  the lawyer's locked rule that no personal data crosses between clinics, and
  the console is one more place outside the clinic.
- **Error reports are the risky part.** An error message can carry data from
  the screen it came from. Only the version, the place in the code and the
  error code are sent, never the message text or the values involved.
- The clinic sends; the console never reaches into a clinic's project. What a
  clinic sends is listed in the clinic's own settings, so its owner can see it.

**What stays as it is:**
- Licences are still signed with the YubiKey (`scripts/make-license.mjs`).
  The console records which licences were issued; it does not sign them.
- Releases stay signed and published by the release tool (docs/RELEASE.md).
  The console only shows what each clinic reports.

**Before it is built, settle:**
- how a clinic proves that a report is its own (a per-clinic key, never the
  service-role key);
- the exact fields of a report, with a test that refuses anything else;
- whether a clinic can switch reporting off, and what Kevin then sees;
- the console project's own backups and its region (EU).

---

## After 2.1.0 (Kevin, 2026-11-25)

Queued by Kevin with the 2.1.0 night run (docs/NIGHT-REPORT-2026-11-25.md).
In this order unless Riga says otherwise.

- **"Request a feature" into the admin console.** Today the Settings tile
  opens an e-mail to Wivo (`VITE_WIVO_CONTACT_EMAIL`, config/contact.ts). Later
  it writes to the admin console (above): **only the clinic, the user and the
  text** — no patient data, no job data, no attachments. The text is free, so
  the form says so and the console never shows it to anyone but Kevin.
- **A full setup wizard on first sign-in.** Today: the simple "Set up your
  clinic" list on Settings (done or not from existing data, hideable). The
  wizard walks a new owner through each step in order, with sensible
  defaults, and ends with the phone app on the staff's phones.
- **Latvian payroll, the rest of it.** 2.1.0 has the estimate (social tax,
  income tax, booklet, dependents, pensioner, minimum-wage base;
  shared/payroll/countryTax.ts). Missing: the 33% income tax band above
  8 775 € a month, the accountant's export with the Latvian fields, and the
  rates for 2027 when they are published.
- **Mac installer, signed with an Apple Developer ID**, and notarised, so a
  Mac at the clinic installs and updates Wivo without warnings.
- **Work type options** (All-on-4 with a metal bar or a titanium mesh): the
  plan is docs/WORKTYPE-OPTIONS-PLAN.md.

---

## What is NOT in any step

- **Anything that recommends or ranks treatment from patient data.** Wivo is
  not a medical device (CLAUDE.md), and no step above changes that.
- **A patient-facing app** (docs/PATIENT-PORTAL.md).
- **Payments through Wivo.** If they ever happen, through a regulated payment
  provider, never Wivo holding money (VISION.md, locked).
