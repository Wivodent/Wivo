# Wivo admin console: the plan

**Status: a plan only (November 2026). Nothing is built until Kevin says OK.**
The entry in docs/ROADMAP.md ("Wivo admin console") points here.

**Lühidalt (Kevin):**
- **Mis see on:** sinu enda tööleht kõigi kliinike kohta: kliinikud ja
  kontaktid, väljaantud litsentsid ja moodulid, arved, avaldatud versioonid ja
  märkmed.
- **Kus see elab:** eraldi Supabase'i projekt sinu kontol ja eraldi
  Cloudflare Pages'i leht. Patsiendiandmeid seal pole, ega tule.
- **Sisselogimine:** ainult sina, YubiKeyga ja teise faktoriga.
- **Allkirjastamine jääb sinu masinasse.** Konsool ei allkirjasta midagi:
  litsentsi allkirjastab YubiKey C `make-license.mjs`-iga ja release'i
  release-tööriist. Konsool teab kliinikutest, aga ei saa neis midagi teha:
  tal pole ühegi kliiniku võtit.
- **Esimene versioon (MVP)** ei kogu kliinikutest mitte midagi.
- **Teine etapp** (ainult plaan): kliiniku nõusolekul saadab kliinik versiooni
  ja uuenduse tulemuse. Ainult tehnilised koondandmed.
- **Kui konto lekib (§6):** ründaja näeb kliinike kontakte, litsentse, arveid
  ja märkmeid. Patsiente, töid ega kliinike andmebaase ta ei näe. Litsentsi ega
  uuendust teha ta ei saa.
- **Mida sinult vaja:** otsused on §8-s.

---

## 1. Principles

1. **No patient data, ever, and no clinic work data.** The console holds facts
   about Wivo's customers (clinics as companies, their contacts, licences,
   invoices, releases), never anything from inside a clinic's Wivo.
2. **The console knows about clinics; it cannot act on them.** It holds no
   clinic's service-role or secret key, no Supabase access token, no
   Cloudflare or GitHub token, and no signing key. A leak of the console can
   change nothing in a clinic (§6).
3. **Signing stays on the YubiKeys, on Kevin's machine.** The console prepares
   the exact command and records the result. It never signs.
4. **One user: Kevin.** Sign-ups are off, every row is readable and writable
   only by Kevin's user id, and only at the second factor (AAL2).
5. **Separate from everything else.** Its own Supabase project on Kevin's own
   account (not a clinic's, not production, not the test copy) and its own
   Cloudflare Pages project. Its schema and its rules are its own: it shares no
   database with Wivo.
6. **The same discipline as Wivo:** RLS on every table, nothing for the anon
   key, a test that fails for a table without it, an audit log nobody can
   rewrite, and secrets only in Edge Functions.

## 2. Where it lives

| Part | What | Notes |
|---|---|---|
| Database | Supabase project `wivo-admin`, Kevin's own organisation, EU region (Stockholm, as the clinics) | Free plan pauses a project after a week without use; Pro does not, and keeps daily backups (decision 3) |
| Web page | Cloudflare Pages project `wivo-admin`, e.g. `https://admin.wivodent.com` | Production branch only, previews off, as `wivo` |
| In front of the page | Cloudflare Access: only Kevin's identity gets the page at all | A second lock in front of the sign-in, free for one person |
| Code | A private repository `SniperInSuit/wivo-admin` (recommended), or `admin/` in this repo (decision 1) | |

**Why a repository of its own (recommended):**
- the clinics' app and the console never ship together;
- a change to the console never needs a push to `main`, which publishes
  Wivo's phone app;
- the repository can be private: it is nobody else's business.

The one thing it needs from this repository is the module list
(`shared/license/token.ts` `MODULE_KEYS`). It does not copy it:
`make-license.mjs` sends the list along with each licence it records (§4.2),
so the console always has the list that signed it.

## 3. Sign-in

Two locks, both Kevin's YubiKey:

1. **Cloudflare Access** in front of the page. Its identity provider is
   GitHub, where Kevin's sign-in already needs his hardware key. Anyone else
   gets Cloudflare's login page and never the console's code.
2. **Supabase Auth in the console**, the only lock that guards the data. The
   database is reachable without the page, since its address and anon key are
   in the bundle. The sign-in is email and password plus a second factor;
   sign-ups are off and there is one user.
   - The second factor is the YubiKey as a **passkey (WebAuthn)**, where
     Supabase offers WebAuthn as an MFA factor. Check its state when building:
     it was not generally available everywhere at the time of writing.
   - Until it is, TOTP is the second factor, and the passkey lock is Cloudflare
     Access (1).
   - Every RLS policy asks for `aal2` and Kevin's user id. Without the second
     factor there is nothing to read.

A session is short (an hour), and the page asks again for the second factor
before anything that changes money or a licence record.

## 4. The first version (MVP): nothing collected from clinics

Everything below is typed in by Kevin, or recorded from his own tools on his
own machine.

### 4.1 Clinics

| Field | Example | Notes |
|---|---|---|
| name, id | Dentiks, `dentiks` | `id` = `clinics/<id>.json` here |
| country | Latvia | |
| contacts | owner, IT: name, e-mail, phone, role | Business contacts: personal data, but not patients' (§7) |
| Supabase ref | `fwsrnsdrlrlmjfkkkhvp` | the ref only, never a key |
| releases repo | `SniperInSuit/wivo-dentiks-releases` | |
| phone address | `https://wivo.dentiks.lv` | |
| status | trial, active, paused, leaving, left | |

Import: the console can read `clinics/<id>.json` (pasted or uploaded), so the
public settings are typed once. The JSON in this repository stays the source
for builds.

### 4.2 Licences

Every licence issued, with its modules, seats, plan, issue date and expiry, and
a warning **30, 14 and 7 days before it expires**. The app's 14 days of grace
after expiry are shown separately.

**How a licence gets into the console:**
- `make-license.mjs sign` and `renew` print the token as today. The token is
  signed and carries only public facts (name, plan, seats, dates, org id, API
  address, modules), no key.
- Kevin pastes it into the console (**Record licence**). The console checks the
  signature against the licence keys' public keys (C and D, as
  `src/main/license.ts`) and stores the decoded payload and the token. A token
  that does not verify is refused.
- Optional, later: `make-license.mjs --record` also writes the same record to a
  file to upload. The tool never gets a password or a key to the console:
  nothing on the signing machine can write to it.

### 4.3 Modules

- **Per clinic:** which modules its current licence switches on, and which
  not, from the newest valid licence.
- **Make a new licence with these modules:** Kevin ticks the modules (the
  console refuses a set the module rules refuse, e.g. `ratings` without `jobs`).
  The console shows the exact command:

  ```
  node scripts/make-license.mjs renew <current token> --modules jobs,payroll,stock
  ```

  Kevin copies it, runs it on his machine with YubiKey C (PIN, touch), and
  records the new token (4.2).
- The console never signs, and holds no private key.

### 4.4 Invoices

| Field | |
|---|---|
| clinic, number, period | |
| amount, VAT, currency | |
| issued, due | |
| paid (date) or unpaid | overdue shows in red |
| link to the PDF | where the bookkeeping keeps it |

The legal invoice is made where Kevin's bookkeeping makes it (decision 4). The
console tracks it: what is owed, by whom, and since when.

### 4.5 Releases

For each clinic, the release history:
- which version is published, and when;
- the list's serial and **when the signed list expires**, with a warning 7 days
  before (docs/RELEASE.md §6: the 30-day list).

The console reads it from where the release tool publishes it: the clinic's
public `updates.json` (`<releasesRepo>/releases/download/stable/updates.json`).
- It checks the signatures with the same code the desktop runs
  (`shared/release`), so what it shows is what a clinic's desktop sees.
- A small Edge Function fetches the list (GitHub's download address sends no
  CORS headers to a browser) and returns the checked facts.
- The data is public, so the function needs no secret.

Each release stays in a table, so the history remains after `stable` moves on.
`releases/<id>/<v>/release.json` on Kevin's machine can be uploaded as well;
it adds the commit and the migrations.

### 4.6 Notes

Free text per clinic, with date and author. **Rule shown on the page:** no
patient data, no passwords, no keys. A note is about the company and the
relationship.

### 4.7 Underneath

- `audit_log`: every change (who, what, before and after), written by a
  trigger. Nobody can update or delete it, Kevin included.
- Tables: `clinic`, `contact`, `licence`, `invoice`, `release`, `note`,
  `audit_log`, each with RLS for Kevin's user id at `aal2`. A test fails for a
  table without that, as `sql/test/requireMfa.test.ts` does in Wivo.
- Nothing is granted to `anon`, and no function runs before sign-in.
- English UI, as Wivo's source language; Estonian when it is worth it.

## 5. Second phase (plan only, not built): clinics report

**What:** a clinic's own project reports technical summaries, so the console
shows each clinic's real state, not only what was published to it.

**Only with the clinic's consent:**
- the owner switches it on in Wivo's Settings, and can switch it off;
- the same screen shows exactly what is sent, field by field, and the last
  report.

**What is sent, and nothing else:**

| Field | Example |
|---|---|
| clinic id | `dentiks` |
| desktop versions in use, as counts | `2.0.6: 9, 2.0.5: 1` |
| the database's newest migration | `126_….sql` |
| the last app update and database update: result and error code | `ok`, or `failed: expired` |
| the signed list's freshness as the clinic sees it | `expires 2026-12-24` |
| error codes and where they happened, as counts | `updater.not_this_release: 2` |

**Never:**
- no patient data, job data, prices or names;
- no user names, e-mails or user ids;
- no free text and no error messages: a message can carry data from the screen;
- no counts of jobs, patients or money: they are the clinic's business, not
  Wivo's.

**How:**
- The clinic's project sends; the console never fetches from a clinic.
- A scheduled job (pg_cron, daily) builds the report from the update ledger
  and records that already exist (sql/119), and posts it to one Edge Function
  of the console.
- Each clinic has its own report key, in its Vault. The key is write-only: it
  can post a report for its own clinic and read nothing.
- The function accepts exactly the fields above and refuses anything else. A
  test proves that a report with one more field is refused.
- The clinic keeps its last reports, so the owner can see what left.

**Before it is built:**
- the lawyer reads the field list;
- it is part of the full security review;
- the agreement with the clinic names it.

## 6. Security: if the console leaks

**If someone signs in as Kevin** (stolen session, or both locks broken), they
**see**:
- the clinics, and their owners' and IT people's names, e-mails and phones;
- every licence: org id, API address, modules, seats, expiry, and the token;
- invoices: amounts, and who has paid;
- Kevin's notes about each clinic;
- release history, which is public anyway;
- in phase 2, the clinics' technical reports.

They **do not see, and cannot reach:**
- **any patient, job, price or file of any clinic.** None of it is in the
  console, and the console holds no key to a clinic's project;
- any clinic's database, Edge Functions or Storage;
- the signing keys, which never leave YubiKeys A–D.

They **cannot do:**
- make or extend a licence, or switch a module on: that needs YubiKey C or D;
- publish or sign an update: that needs YubiKey C or D, and GitHub;
- change anything in a clinic.

The harm they can do:
- **phishing:** pretend to be Wivo to a clinic's owner or IT, using real names
  and real invoice numbers. This is the main risk;
- **mislead Kevin:** mark an invoice paid, change a contact's e-mail or
  delete a note. The audit log, which they cannot rewrite, shows what changed,
  and backups restore it;
- **use a licence token:** it works only for its own clinic's address and
  organisation, and only with that clinic's user accounts. On its own it opens
  nothing.

**If the console project's own keys leak** (the service-role key, which lives
only in its Edge Functions): the same data, and they could also rewrite it.
Rotate the key, restore from backup, and read the audit log against the
backup.

**If the Supabase or Cloudflare account leaks:** the same. Both accounts have
the hardware second factor.

**In phase 2, if a clinic's report key leaks:** someone can send false
technical reports for that one clinic. That misleads Kevin, and reads
nothing. Rotate that clinic's key.

**What keeps it small:**
- no clinic secret is ever stored, so the worst case stays a list of
  companies, contacts and money;
- write-protected audit log, daily backups, a short session, and the second
  factor again before changes to money or licences;
- notes carry no patient data, passwords or keys, and the page says so.

**If it happens:**
- warn the clinics' owners that mail "from Wivo" may be false, and tell them
  Wivo's real contact channel;
- this is a personal-data breach of business contacts: GDPR's 72 hours to the
  supervisory authority if it is likely to be a risk (decision 5).

## 7. Personal data in the console

There are no patients. There are clinic contacts: names, work e-mails, phones,
roles.
- **Legal basis:** the contract with the clinic.
- **Minimum:** only who Kevin needs to reach.
- **EU only:** the database and its backups stay in the EU region.
- **When a clinic leaves:** its contacts are deleted after the contract's
  retention. Invoices are kept as long as bookkeeping law requires.

## 8. Decisions for Kevin

1. **Code: a private repository `wivo-admin` (recommended) or `admin/` in this
   repo.** A repository of its own keeps the console out of `main`'s releases
   and the phone app.
2. **The address:** `admin.wivodent.com` (recommended) or a `*.pages.dev`
   address, behind Cloudflare Access either way.
3. **Supabase plan: Pro (recommended).** It never pauses and keeps daily
   backups, at about 25 USD a month. Free pauses after a week unused, and has
   no backups to restore from.
4. **Invoices:** the console only tracks them (recommended), or it also makes
   the PDF. Making them is bookkeeping: numbering, VAT and e-invoice rules.
5. **The second factor:** a passkey (YubiKey) if Supabase's WebAuthn MFA is
   available when we build, else TOTP plus Cloudflare Access with GitHub's
   hardware key.
6. **Phase 2:** with the lawyer first; nothing is built until the field list
   is agreed.

## 9. Build order (after OK)

1. The project, its schema with RLS and `aal2` on every table, the audit log
   trigger, and the tests: RLS on every table, nothing for `anon`, the audit log
   cannot be rewritten.
2. Sign-in with one user, sign-ups off, Cloudflare Access in front.
3. Clinics and contacts, with the import of `clinics/<id>.json`.
4. Licences: record a token (signature checked), expiry warnings, modules, and
   the "new licence with these modules" command.
5. Invoices.
6. Releases: the Edge Function that reads and checks each clinic's public
   `updates.json`, history, and list-expiry warnings.
7. Notes.
8. A security review before real contacts and invoices go in.

The MVP collects nothing from clinics, so it does not have to wait for Riga to
be stable, as the roadmap entry assumed. Phase 2 does.
