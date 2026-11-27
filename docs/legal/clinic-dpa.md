# Data Processing Agreement (Wivo and a clinic)

> **DRAFT – pending legal review.** Not in force. Placeholders in square brackets are filled in before signing. Whether Wivo is a processor at all, and for which activities, is the first open question (QUESTIONS-FOR-LAWYER.md, Q1). This draft assumes it is, for the activities in section 2.

Version 2026-11-draft. Effective from [EFFECTIVE DATE].

**Between**

- **The clinic** (controller): [CLINIC NAME], registry code [CLINIC REG CODE], [CLINIC ADDRESS], represented by [NAME, ROLE].
- **Wivo** (processor): [COMPANY NAME], registry code [REG CODE], [ADDRESS], [CONTACT EMAIL], represented by [NAME, ROLE].

This agreement is part of the Wivo licence agreement between the parties and meets Article 28 of the General Data Protection Regulation (EU) 2016/679 ("GDPR").

## 1. Background: how the clinic's data is held

- The clinic's data (patients, jobs, files, orders from Wivo Network users, invoices, staff) is stored in **the clinic's own Supabase project, in the clinic's own Supabase organisation**, in the EU region chosen at setup. The clinic holds the contract with Supabase and with its e-mail providers (Resend, its mail host).
- The Wivo app runs on the clinic's own computers and phones, signed in as the clinic's own people, and talks to the clinic's project directly.
- Wivo Network (operated by Wivo) holds only Network user accounts, the clinic directory and connection states. Orders, files and messages from Network users go from their browser directly to the clinic's project.

## 2. What Wivo does for the clinic (the processing)

Wivo processes the clinic's personal data only in these activities, and only as far as each needs:

- **Setup and connection**: creating the clinic's project structure, deploying Wivo's server functions into the clinic's project, and connecting the clinic to Wivo Network (`network:connect`), during which Wivo has administrator access to the project.
- **Updates**: signed database and function updates that the clinic installs, which run with full rights in the clinic's database.
- **Support**: looking into a problem in the clinic's database when the clinic asks, with the clinic's access.
- **Wivo Network**: issuing a 5-minute signed pass that tells the clinic who a Network user is (name, kind, role, company, country, e-mails) when that user opens the clinic. The pass is Wivo's own data about its user (Wivo is controller of the Network account); this agreement covers it as far as it becomes the clinic's data.
- **Hosting of the phone web app**: serving the files of the clinic's phone and /network web app from Cloudflare Pages, under Wivo's Cloudflare account.

Details are in Annex 1.

## 3. Wivo's obligations

Wivo shall:

- process the personal data only on the clinic's documented instructions, which are this agreement, the licence agreement and the clinic's written requests, unless EU or member-state law requires otherwise (then Wivo tells the clinic first, unless the law forbids it);
- not read, copy or send the clinic's data in its updates, and use administrator access during setup and support only for the task at hand;
- make sure that the people who may access the data are bound by confidentiality;
- take the technical and organisational measures in Annex 3;
- use other processors (sub-processors) only as in section 5;
- help the clinic answer data subjects' requests, as far as Wivo can, taking into account that the data is in the clinic's own project;
- help the clinic with security, breach notification, data protection impact assessments and prior consultation (GDPR articles 32–36), as far as Wivo's processing is concerned;
- at the end of the services, return or delete any of the clinic's personal data Wivo holds, at the clinic's choice, unless the law requires Wivo to keep it (section 8);
- give the clinic the information needed to show that this agreement is kept, and allow audits (section 7).

## 4. The clinic's obligations

The clinic shall:

- have a lawful basis for all personal data in its project, including health data (GDPR art. 9) in files and orders, and inform its patients and staff;
- decide whom it connects with in Wivo Network and what each Network user may see;
- keep its own Supabase, e-mail and other accounts secure, with the second factor on;
- install Wivo's updates or decide not to, and approve support access case by case.

## 5. Sub-processors

The clinic gives general authorisation for the sub-processors in Annex 2. Wivo tells the clinic at least [NOTICE PERIOD] before adding or replacing one, and the clinic may object on reasonable grounds; if the parties cannot agree, the clinic may end the affected service. Wivo puts the same data protection obligations on each sub-processor by contract and remains responsible for them.

Providers the clinic contracts itself (its Supabase organisation, Resend, its mail host) are not Wivo's sub-processors.

## 6. Personal data breaches

Wivo tells the clinic without undue delay, and at the latest within [HOURS] hours, after becoming aware of a personal data breach affecting the clinic's data in Wivo's processing, with what Wivo knows: what happened, which data and people may be affected, likely consequences, and what has been and will be done. Wivo keeps a record of breaches.

## 7. Audits

Wivo makes available all information needed to show that this agreement is kept. The clinic, or an auditor bound by confidentiality, may audit Wivo's processing once a year, or after a breach, with [NOTICE PERIOD] notice. Each party bears its own costs unless the audit finds a material breach by Wivo.

## 8. Duration and end

This agreement lasts as long as Wivo processes the clinic's personal data under the licence agreement. When it ends, Wivo deletes the clinic's personal data it holds (setup records, support copies, if any) within [DAYS] days, or returns it if the clinic asks, and confirms this in writing. The clinic's own project is the clinic's and stays with the clinic.

## 9. Liability and law

Liability follows the licence agreement and GDPR article 82. This agreement is governed by the law of the Republic of Estonia.

## Annex 1: The processing

**Subject matter and duration:** the services in section 2, for the term of the licence agreement.

**Nature and purpose:** setup, connection to Wivo Network, signed updates, support on request, telling the clinic who a Network user is, and serving the web app's files.

**Categories of data subjects:**

- the clinic's patients;
- the clinic's staff;
- the clinic's clients and partners, including Wivo Network users who send orders.

**Categories of personal data:**

- patients: what the clinic keeps in Wivo (for jobs: job code, the client's patient reference, teeth, work, shade, dates; files such as scans, photos and X-rays);
- staff: names, e-mail addresses, roles, activity in the audit log;
- Network users: name, kind, role, company, country, sign-in e-mail, e-mail choice, billing e-mail; their orders, messages, files, notices, ratings and session records (only a hash of the session token).

**Special categories:** health data in patient files and job details (GDPR art. 9).

**Where:** the clinic's Supabase region (EU); Wivo Network in Frankfurt (EU).

## Annex 2: Sub-processors

| Sub-processor | What for | Where | Transfer safeguard |
|---|---|---|---|
| Supabase, Inc. | Wivo Network database, sign-in and server functions; the pass that tells the clinic who a Network user is | EU, Frankfurt (Germany) | [SAFEGUARD]: US company |
| Cloudflare, Inc. | Serving the files of the clinic's phone and /network web app (Cloudflare Pages); sees page requests and IP addresses, not the clinic's data | Global network | [SAFEGUARD]: US company |
| [OTHER, e.g. GitHub, Inc.] | Hosting Wivo's signed update packages and desktop releases; no clinic data | [WHERE] | [SAFEGUARD] |

Not sub-processors of Wivo (the clinic's own contracts): the clinic's Supabase organisation and project; Resend (notice e-mails); the clinic's mail host (invoice e-mails).

## Annex 3: Technical and organisational measures

**Separation**

- One Supabase project per clinic; no clinic's data is in another clinic's database or in Wivo Network.
- Wivo Network stores no order, file, message, price, rating or patient data; a test checks that its database has only the account, directory and connection tables.

**Access**

- Everything in Wivo Network and in the clinic's project requires sign-in with a second factor (TOTP); database policies refuse any request without it.
- Row-level security on every table; a Network user has no login or database role in the clinic's project and reaches only their own orders through one function, `network-client`.
- The app uses only the public key; the service key exists only in server functions.
- Network passes last 5 minutes and work for one clinic; clinic sessions for Network users last 8 hours by default (the clinic may set 1–24) and are stored only as a SHA-256 hash.
- Files are reached only through links the server signs after checking rights: 60 seconds for downloads, 300 seconds for previews.

**Data minimisation**

- An order's patient field is a reference only; the order format has no field for a name, personal code, birth date, contacts or a medical card, and refuses unknown fields.
- Photos lose all metadata and 3D scans lose embedded names before upload. DICOM files are not changed.
- E-mail notices to Network users carry a subject and a link only, never the message or patient details.
- Error reports remove e-mails, phone numbers and personal codes before they leave the device; the /network web app sends no error reports.

**Integrity and accountability**

- Wivo's updates are signed with keys held on hardware security keys, and the clinic approves them.
- An audit log of exports, file downloads, deletes, invoice cancellations and ended connections, kept at least 3 years.
- Every database change is tested on a separate test project before release.

**Transport**

- All connections use TLS. The web app sends HSTS, forbids framing and sends no referrer.
