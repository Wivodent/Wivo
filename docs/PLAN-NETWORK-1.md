# Wivo Network 1 + orders: the plan and its decisions

Status: built on `testing` (night of 2026-11-27), **nothing deployed, nothing
migrated**. Gary's wish: outside technicians and clinics send orders straight
into his Wivo. Built on the Network from the start, not as a clinic-local
portal. The wider vision stays in docs/WIVO-NETWORK.md; this is part 1 only.

## What is built

1. **Wivo Network** (its own Supabase project `wivo-network`; files in
   `network/`): accounts, profiles, the opt-in clinic directory, and
   connections account ↔ clinic (`requested` / `confirmed` / `ended`). One Edge
   Function, `network-token`, gives a signed-in account a short-lived signed
   token **for one clinic**.
2. **The clinic's side** (Wivo migration sql/138, Edge Function
   `network-client`): checks the Network token with the Network's public key,
   takes the connection request, and, once the owner has confirmed it, gives a
   narrow **client session in this clinic only**. Behind the licence module
   `portal`, off by default.
3. **Orders** in the "Wivo order" format (docs/WIVO-ORDER-FORMAT.md, v1): the
   client's New order and My orders, messages, files; the clinic's New order
   mark and notification, accept with a template or reject with a reason.
4. **The Network user's side**: the phone app's **Network mode** (`/network`,
   works in a computer's browser too): sign up, profile, find a clinic or open
   an invite link, request a connection, the list of connected clinics, and the
   client screens per clinic.

## Decisions

| # | Decision | Why |
|---|---|---|
| N1 | The Network **never** holds an order, a file, a message or anything about a patient. Only accounts, profiles, the directory and connection metadata. | The lawyer's rule: no personal data crosses between clinics. Orders live in the clinic's own project. |
| N2 | Network token: Ed25519 over `WIVO-NETWORK-1\n<payload>`, payload `{v, iss, aud = the clinic's Network id, sub = account, conn, name, kind, role, company, country, iat, exp}`, **5 minutes**. The private key is a Network secret; the public key goes into each clinic's settings. | Its own domain prefix, so a Network token can never pass for a licence or an update. Short: it is only used to open a session. |
| N3 | The clinic verifies the token in its Edge Function and checks `aud` against its own Network id. | A token for one clinic is worthless in another. |
| N4 | The clinic session is an **opaque random token**, stored only as its SHA-256 in the clinic's database, **8 hours** by default. Every client call checks, in the database: the session is live, the connection is confirmed, the portal is on. | Ending a connection or turning the portal off stops access at once; the Network being down does not stop a session already given, until it expires. |
| N5 | A client has **no database role and no login in the clinic's project.** Every client call goes through `network-client`, which calls `client_*` functions granted to the service role only; each function finds the client from the session and touches only that client's rows. Row security on the new tables is for the clinic's staff; it lets no client in. | No shadow users, nothing for the anon key, no change to the MFA rule (sql/098) or to `lock_anon_functions` (sql/101). The client's boundary is one place, tested. |
| N6 | The Network requires the **second factor** (aal2) before it gives a token. | The session reaches orders and their files (scans are health data). |
| N7 | The clinic decides; the Network mirrors. Confirm and end happen in the clinic's Wivo. The Network's `confirmed` is what the account's app reported after the clinic said so; it is shown, never trusted for access. An account ending a connection in the Network gets no more tokens, and its app tells the clinic (`end`), which ends its sessions. | The clinic is the controller of its data; the Network must not be able to open a door into a clinic. |
| N8 | A confirmed client becomes a row in **Clients** (`customers.kind = person`: a technician or a doctor) or in **Clinics** (`kind = clinic`: a clinic or a lab), by its profile. The owner can pick the other one when confirming. | Orders become jobs for that customer, priced and invoiced as any other. |
| N9 | What the client sees is the owner's choice per client: the status of their orders, messages, files, prices in the catalogue. Default: status, messages and files on, prices off. | Gary's choice per partner. |
| N10 | An order's patient is a **reference only** (the orderer's own, at most 40 characters): no name field, no personal code, no birth date, no medical card. The form says so. | "Patient reference without the health record." |
| N11 | Accepting an order makes an ordinary job (the chosen template, the work type, teeth, options, shade, due date, the reference as the patient text) and registers the order's files as the job's files. Rejecting needs a reason the client sees. | The job is the work; the order is its envelope. |
| N12 | The client's screens are the phone app's Network mode, not a new app. | One web app, one build per clinic already exists; the mode needs only the Network's URL and anon key. |
| N13 | Not in part 1: invoices and stock for clients, the Network's quick-job market, the work history records, Latvian names in the catalogue for clients. | The order flow first; the rest needs the lawyer and Gary's use. |

## Order of things for a clinic

The Network project is made and deployed first (docs/NETWORK-SETUP.md); then a
clinic gets sql/138, `network-client`, its directory entry and the public key;
the licence gets `portal`; the owner turns it on in Settings → Network.

## Before it is used for real

- **The lawyer** (docs/WIVO-NETWORK.md): accounts of outside technicians and
  doctors sit in a central project in the EU. What does the account holder
  agree to? Is the clinic the controller of the orders and Wivo a processor?
- A penetration test of `network-client` and `network-token`
  (SECURITY-REVIEW-2026-11.md, SEC1).
