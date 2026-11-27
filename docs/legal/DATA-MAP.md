# Wivo Network: data map

> **DRAFT – pending legal review.** Facts read from the code on 2026-11-28
> (branch `testing`, Wivo 2.3.0 plus network/sql/005). Every statement in
> network-terms.md, network-privacy.md and clinic-dpa.md must match this file.
> Where a fact comes from Supabase's or another provider's standard behaviour
> and not from this repository, it says so ("not in our code").

## 1. The parts

| Part | Where it runs | Who operates it | Source |
|---|---|---|---|
| **Wivo Network** (Supabase project `wivo-network`) | Supabase, region Central EU (Frankfurt) | Wivo | network/sql/*, network/functions/*, docs/NETWORK-SETUP.md A1 |
| **The Network web app** (`/network`) | Cloudflare Pages: app.wivodent.com (Network only) and each clinic's phone address (for example wivo.dentiks.lv/network) | Wivo (Cloudflare account) | src/renderer/src/mobile/network/NetworkApp.tsx, networkMain.tsx, vite.mobile.config.ts |
| **A clinic's own database** (one Supabase project per clinic) | Supabase, the region chosen at setup (Dentiks: North EU, Stockholm `eu-north-1`) | The clinic: the project is in the clinic's own Supabase organisation | docs/CLINIC-SETUP.md §1, docs/ARCHITECTURE-INSTANCES.md 5d |
| **The clinic's Edge Functions** `network-client`, `network-directory`, `file-link`, `send-notifications`, `send-invoice(s)` | Inside the clinic's Supabase project | Deployed by Wivo (`npm run network:connect`, Wivo's updates), run in the clinic's project | supabase/functions/* |
| **The clinic's e-mail** | Notices: the clinic's own Resend account (Dentiks: domain region EU, Ireland `eu-west-1`). Invoices: the clinic's own mailbox over SMTP | The clinic | supabase/functions/_shared/notifySender.ts, mail.ts, docs/CLINIC-SETUP.md §6 |

**Orders, files, messages, prices, ratings and notices never pass through or
rest in the Network.** The browser talks to the Network for the account and
the directory, then directly to the chosen clinic's `network-client` with a
session that clinic gave (src/renderer/src/lib/network.ts, header comment).

## 2. What the Network stores (project `wivo-network`)

Three tables of its own (network/test/network.test.ts checks there are only
these three and that no column is about a patient, order, price, file,
message or note).

### `account`: one row per user, readable and writable only by that user

| Field | What | Required | Source |
|---|---|---|---|
| `id` | the sign-in user's id | yes | 001 |
| `kind` | `person` or `company` | yes | 001 |
| `role` | `technician`, `doctor`, `clinic` or `lab` | yes | 001 |
| `display_name` | name, 1–120 characters | yes | 001 |
| `company_name` | up to 160; required for a company | for a company | 001 |
| `country` | two letters | no | 001 |
| `city` | up to 120 | no | 001 |
| `about` | up to 1000; **no screen writes it today** | no | 001 |
| `email_notifications` | whether clinics may e-mail notices about orders; on by default | yes | 003 |
| `billing_email` | where invoices should go, if not the sign-in address | no | 004 |
| `preferred_language` | `en`, `lv`, `ru` or `et`: the language of Wivo Network and of the clinics' e-mails to the user | no | 006 (new) |
| `accepted_terms_version`, `accepted_terms_at` | the Terms version accepted and the server time it was accepted; written only by `accept_terms()` | no | 005 (new) |
| `created_at`, `updated_at` | times | yes | 001 |

### `clinic`: the directory, written by Wivo

`name`, `country`, `city`, `api_url` (the clinic's Supabase address),
`listed` (shown in the directory or not; the clinic's owner switches it),
`invite_code`, `clinic_public_key` (002), `last_request_ms` (002),
`created_at`. Accounts read only `id, name, country, city, api_url, listed`,
and only for listed clinics or clinics they are connected to (001 policy
`clinic_listed_select`). The invite code and the key are never readable by an
account.

### `connection`: account ↔ clinic

`account_id`, `clinic_id`, `state` (`requested`, `confirmed`, `ended`),
`requested_at`, `confirmed_at`, `ended_at`, `ended_by` (`account` or
`clinic`). An account reads only its own; it changes them only through
`request_connection`, `report_connection_state`, `end_connection` (001).
`confirmed` is what the account's app reported after the clinic confirmed; it
is shown, never used for access (docs/PLAN-NETWORK-1.md N7).

### Supabase Auth (not in our code: Supabase's standard behaviour)

The Network uses Supabase Auth with e-mail and password, e-mail confirmation
on, a password of at least 12 characters with leaked-password protection, and
TOTP as the required second factor (docs/NETWORK-SETUP.md A2). Supabase Auth
keeps: the e-mail address, a password hash, the TOTP factor's secret,
sign-in and confirmation times, sessions and refresh tokens (with the
browser's user agent and IP address), and an audit log of sign-ins with IP
addresses. At sign-up the app also writes `terms_version`,
`terms_accepted_at` (005 flow, below) and the chosen `lang` into the user's
metadata.

Auth e-mails (confirm the address) are sent by whatever the Network project's
Auth settings use. docs/NETWORK-SETUP.md sets no custom SMTP, so today that is
**Supabase's built-in mailer** (not in our code). There is no "forgot
password" screen in /network.

### What the Network never holds

No order, file, message, price, rating, notice, patient reference or anything
that points to a patient (001 header, the test above).

## 3. What a clinic's database receives about a Network user

### At connect (`network-client` action `connect`, sql/138 `network_connect`)

The user's app asks the Network for a token for **one** clinic
(`network-token`). It lives **5 minutes** (`NETWORK_TOKEN_SECONDS = 300`), is
signed with the Network's Ed25519 key, and carries: account id, connection
id, `name`, `kind`, `role`, `company`, `country`, the **sign-in e-mail** and
the e-mail choice (003), the **billing e-mail** if given (004), and the
chosen **language** (006). Not the city, not `about`. Only for a connection that is not ended, and only with
the second factor (`token_claims`, `token_contact`, `token_billing`).

The clinic checks the signature and keeps, in `network_client`: account id,
connection id, state, kind, role, display name, company, country, `email`,
`email_notifications` (142), `billing_email` (152), `language` (154), `can_see` (what the
clinic lets the user see: status, messages, files, prices), request /
confirm / end times and who ended it. Its staff with job rights see it
(`may_handle_orders`).

When the owner confirms the request, a **customer record** is made in the
clinic's client list (name = company or name, contact = the person for a
company, note "Wivo Network"); its invoice e-mail is filled from the billing
e-mail, else the sign-in e-mail (138 `network_confirm_client`, 152).

### Orders and what comes with them (sql/138–153)

| Table | What | Source |
|---|---|---|
| `client_order` | the order as sent (Wivo order format: work type, teeth, implants, abutment, options, shade, due date, notes up to 2000, **patient reference up to 40 characters**), status, reject/cancel reason, prices and price decisions, the job it became | 138, 141, 146, 153; docs/WIVO-ORDER-FORMAT.md |
| `client_order_message` | messages both ways (up to 4000), review requests and answers, fit and delivery answers | 138, 143–145 |
| `client_order_file` | files: name, size, SHA-256, type, storage path, the message it came with | 138, 143 |
| storage bucket `job-files` | the file contents, in the clinic's own Supabase Storage | 138 |
| `client_notification` | what the user was told (kind, order reference, a reason), read and e-mailed times; never a message's text | 142 |
| `job_fit`, `job_rating`, `job_rating_change`, `delivery_problem` | Fitted / Needs adjustment with reason and note; 1–5 ratings with a comment; delivery problems | 144–146 |
| `order_reference`, `reference_party`, `reference_counter` | the order references the clinic gives out (letters from the orderer's name, for example TF) | 140 |
| `network_client_session` | the user's session at this clinic: **only the SHA-256 of the token**, created, expires, revoked | 138 |

**The patient field is a reference only.** The format has no field for a
name, personal code, birth date, contacts or a medical card; an order with
any other field is refused; the form says so (docs/WIVO-ORDER-FORMAT.md,
PLAN-NETWORK-1 N10). **But free text and files can still identify a patient:**
`notes`, messages, file names, and file contents.

**Files are cleaned in the browser before upload** (lib/fileClean.ts, used by
lib/network.ts): photos lose all metadata (EXIF incl. GPS, camera, dates,
owner; XMP; IPTC); 3D scans lose names in STL/PLY/OBJ headers. **DICOM files
(X-ray, CT) are uploaded unchanged**, so a patient name in a DICOM header
reaches the clinic. A name printed in a PDF or visible in an image is not
removed.

## 4. Sessions and links

| What | Lifetime | Source |
|---|---|---|
| Network token for one clinic | 5 minutes, ±60 s clock skew | shared/network/token.ts |
| The clinic's session for a Network user | `session_hours`, default **8**, the clinic may set 1–24; ends at once when either side ends the connection; kept in the browser tab only (`sessionStorage`), so closing the tab forgets it | sql/138, lib/network.ts |
| Expired clinic sessions | deleted at the user's next connect, once more than 1 day old | 138 `network_connect` |
| The Network sign-in | Supabase session kept in the browser's `localStorage` (`wivo-network-auth`) and refreshed automatically until sign-out; access token and refresh-token lifetimes are Supabase project settings (not in our code) | lib/network.ts |
| Download link for a Network user | **signed by the server, 60 seconds** | _shared/networkClient.ts `DOWNLOAD_SECONDS` |
| Upload link for a Network user | a signed upload URL from Supabase Storage for one path, given only after the clinic's database made the slot; its validity is Supabase's default (not in our code; Supabase documents 2 hours) | networkClient.ts `signUpload` |
| Staff download / preview links | signed by the server: 60 s downloads, 300 s previews, after the second factor and the person's rights; audited | supabase/functions/file-link |
| Limits | 30 files per order, 2 GB per file at most (the clinic's own bucket limit applies), 60 orders per hour per user, request body 64 KB | 138, networkClient.ts, network-client/index.ts |

Everything in the Network and every clinic call requires the **second factor
(aal2)**: a restrictive policy on every Network table and a check in every
function (001, PLAN-NETWORK-1 N6). The anon key runs nothing in the Network.

## 5. E-mail

| E-mail | Sent by | Content | Source |
|---|---|---|---|
| Confirm the address (sign-up) | the Network project's Supabase Auth (built-in mailer, see 2) | the link | not in our code |
| Notices to a Network user ("New message on TF-… from Dentiks", accepted, ready, on its way…) | the **clinic's** Resend account, from the clinic's `send-notifications` | subject and a link to /network only, in the user's language (English when not known); never the message, the reason or anything about the patient; only if the user keeps e-mails on | sql/142, sql/154, notifySender.ts, shared/network/clientMail.ts |
| Invoices to a Network user as a client | the **clinic's** own mailbox over SMTP (port 465, send only) | the invoice and its PDF | sql/148–152, mail.ts, sendInvoice.ts |

Wivo sends no e-mail of its own to Network users from this code.

## 6. Hosting and other recipients

- **Supabase** (Network project, Frankfurt): database, Auth, Edge Functions
  `network-token`, `network-clinic`. Supabase is a US company hosting in the
  EU (docs/ARCHITECTURE-INSTANCES.md Q8).
- **Cloudflare Pages**: serves the web app's files (HTML, scripts) for
  app.wivodent.com and the clinics' phone addresses. The app's data calls go
  from the browser to Supabase directly, not through Cloudflare. Cloudflare
  sees page requests (IP address, user agent). Whether Cloudflare Web
  Analytics is on is a dashboard setting, not in this repo.
- **Resend** (the clinic's account): notice e-mails, see 5.
- **The clinic's mail host** (SMTP): invoice e-mails.
- No analytics, advertising or tracking code in the /network app; no
  third-party fonts. **Sentry** (error reports) exists only in the desktop
  app, and only when a build sets a DSN; the /network app does not load it
  (src/renderer/src/main.tsx is the only caller). The /network app keeps the
  last 20 errors in memory in the tab, scrubbed of e-mails, phone numbers and
  personal codes (lib/errorLog.ts); it sends them nowhere.
- Security headers: no framing, HSTS, `Referrer-Policy: no-referrer`
  (src/renderer/mobile-static/_headers).

## 7. Logs

- **Network database:** no audit table of its own.
- **Network Edge Functions** (`network-token`, `network-clinic`): log nothing
  of the request in our code.
- **Clinic `network-client`:** no logging in our code. The clinic's audit log
  records the owner ending a connection (138 `network_end_client`), job
  deletes and restores, invoice deletes / cancels / credits, file downloads.
  Audit entries are kept at least 3 years (lawyer's answer L3, docs/AUDIT.md).
- **Supabase platform logs** (API gateway, Auth, Edge Function logs: IP
  address, path, time) exist for both projects; retention depends on the
  Supabase plan (not in our code).

## 8. Deleting and ending

| Who | What happens | Source |
|---|---|---|
| The user ends a connection (clinic's "⋯" menu) | Network: `connection.state = ended`, no more tokens. Clinic: `client_end` ends the user's sessions; **orders, files, messages and jobs stay with the clinic** | 001, 138 |
| The clinic's owner ends a connection | The user's sessions there end at once; orders and jobs stay; audited | 138 `network_end_client` |
| The clinic stops taking orders | Every Network session at that clinic ends | 138 `network_save_settings` |
| Deleting a Network account | **No screen for it.** Deleting the user in Supabase Auth (by Wivo) removes `account` and `connection` rows (`on delete cascade`). The clinics' copies (client record, orders, files, ratings) are not touched: they are the clinic's records | 001 |
| Deleting orders, files, messages at a clinic | No automatic deletion. A job from a Network order can be deleted only with a reason (it goes to the bin and can be restored; the order shows "Cancelled by clinic"); the owner may purge a job without files; stored files are never purged | 146, sql/089 |
| Changing profile data | The user edits it any time; each clinic gets the new name, company, country and e-mails at the user's next connect | 138 `network_connect` (on conflict update) |

## 9. Ratings (licence module `ratings`; off without it)

- After the work is received, the Network user can say **Fitted** or **Needs
  adjustment** (reason and note) and rate the clinic **1–5** with an optional
  comment (up to 1000). The clinic can rate the user's input 1–5.
- **Stored only in that clinic's database.** The Network holds no rating.
- One rating per rater, ratee and job; saving again changes it.
- The user sees only the rating it gave. The clinic's **owner** sees all
  ratings and each client's average and adjustments; a staff member sees
  their own average and comments, never who gave them or for which job.
- `job_rating.published` is prepared for a future shared profile; **nothing
  reads it**: no rating is shown to anyone outside the clinic.

Source: sql/144–146, docs/MODULES-AND-RATINGS.md 2.9.

## 10. Terms acceptance (network/sql/005, this change)

- Sign-up: a required checkbox; the app writes `terms_version` and
  `terms_accepted_at` (browser time) into the sign-in user's metadata.
- When the profile is first saved, the app calls `accept_terms(version)`:
  `account.accepted_terms_version` and `accepted_terms_at` (server time).
- Signing in with an account whose accepted version is not the current one
  (`TERMS_VERSION` in src/renderer/src/lib/legal.ts) shows the acceptance
  once more before anything else.
- The columns are written only by `accept_terms()`: a user cannot set them
  directly (a trigger keeps them).
- Only the latest acceptance is kept on the account; earlier versions are not
  kept as a history.
