# Wivo Network: a short plan (vision for 3.0/4.0, nothing built)

**Status: vision and preparation plan only (November 2026).** Nothing here
is built, and nothing is migrated. The lawyer sees it before any of it is
built. The roadmap entry is in docs/ROADMAP.md, "Wivo Network".

## What it is

1. **A personal Wivo account that no clinic owns.** A technician's or a
   designer's own login. It outlives any job at any clinic, and the person
   takes it with them when they leave.
2. **A professional profile:** name, skills, the kinds of work the person
   does, and the clinics they have worked for, if they choose to show them.
3. **A signed, patient-free work history.** When a job finishes, the clinic's
   Wivo sends one record per stage to the person's account, signed by the
   clinic. The person can prove what they did without anyone being able to see
   whose teeth it was.
4. **A market for quick jobs.** A clinic offers one job, for example "design
   these 3 crowns by tomorrow". A Network member takes it, and the clinic
   gives that person temporary access to **that one job only**. The access
   ends when the stage is done or the grant expires.

**Where it runs:**
- A separate central Supabase project, Wivo Network.
- Not the admin console's project. The console is Kevin's business view, and
  the Network holds other people's personal data.
- No patient data in it, ever.
- The clinics' own projects stay where they are.

## Before anything is built: the lawyer

These questions decide whether and how it can be built:
- **People's data in a central project.** A staff member's work history is
  personal data, about the staff member and not a patient. It would leave the
  clinic's own project and sit with Wivo, in another country for Riga.
  - The locked rule is that no personal data crosses borders between clinics.
  - Does a record the person asks for and receives fall under that rule? On
    what basis?
- **Consent, two-sided.** The person turns the history on. Does the clinic
  have to agree too, record by record?
- **Monitoring of workers.** Durations per person are the same question as
  the stage statistics (ROADMAP, "Stage statistics for the owner"). Workers
  have to be told.
- **The quick-job guest.** Is the guest a processor for the clinic? What does
  the guest sign before seeing a job?

## Preparation 1: `profiles.wivo_person_id` (plan, not migrated)

One empty column. It links a clinic's user to a Network account, once the
person links it themselves. Each clinic has its own project, so the column is
local to that clinic.

```sql
-- sql/1xx_wivo_person_id.sql (NOT written yet; the number is the next free one then)
alter table public.profiles add column if not exists wivo_person_id uuid;
create unique index if not exists profiles_wivo_person_id_unique
  on public.profiles (wivo_person_id) where wivo_person_id is not null;
select public.ensure_mfa_policies();
```

**Rules for when it is built:**
- **Only the person sets it, and only by proving the account.** A link token
  the Network signs, checked by a database function. The owner never types an
  id in for someone else, and no client update may change the column.
  - Today `profiles_update_own` lets a user update their own row.
  - So the column needs a trigger or column privileges, so that only the
    linking function can write it.
  - That function ends with `lock_anon_functions()`.
- **Unlinking is always possible, by the person.** It stops new records and
  sends nothing more. What was already sent belongs to the person's account.
- **Nobody else sees it.**
  - A partner organisation never sees it (CLAUDE.md, partner visibility).
  - The phone and desktop show only "linked", never the id.
- **An empty column changes nothing.**
  - Every screen and RPC behaves the same while it is null.
  - The schema check (sql/checks/) is regenerated in the same migration.
  - A test shows that a user cannot set it with a plain update.
- **When it ships:** together with the linking function, not before. An empty
  column without its rules would invite exactly the update the rules forbid.

## Preparation 2: the shape of a work history record

One record per **finished stage** (`job_stage.done_at` set) for each person on
it (`job_stage_person`). It is sent when the job is finished, and only for a
person who is linked and has the history turned on.

```json
{
  "v": 1,
  "record_id": "random uuid, made when the record is sent",
  "person": "<wivo_person_id>",
  "clinic": { "network_id": "<the clinic's Network id>", "name": "Dentiks" },
  "stage": "design",
  "work_kind": "crown",
  "units": 3,
  "started_on": "2026-11-20",
  "done_on": "2026-11-21",
  "duration_days": 1,
  "issued_at": "2026-11-24T10:00:00Z",
  "key_id": "network-dentiks-…"
}
```

The record is signed with Ed25519 over `WIVO-WORK-1\n<payload>`. The prefix
is its own domain, so a work record can never pass for a licence or an update
(shared/license/token.ts, LICENCE_SIGNING_DOMAIN). The key is the clinic's own
Network key, never the service-role key.

**Where each field comes from:**

| Field | From | Why it is safe |
|---|---|---|
| `stage` | `job_stage.stage_key`, mapped to a fixed list (design, milling, …) | A fixed word, not the clinic's own stage name |
| `work_kind` | The job's type, mapped to the fixed list of work kinds (crown, bridge, veneer, …) | Never the clinic's free text |
| `units` | How many units the job has | A count only |
| `started_on`, `done_on` | `started_at`, `done_at`, **dates only** | A time of day plus a clinic narrows down to one patient's visit |
| `duration_days` | Calendar time between them, whole days | Real working time only if the "Pause" decision (ROADMAP) is ever made |

**Never in a record:**
- the job's id or code;
- the patient, or anything that points to one: name, personal code, birth
  date, the medical card, visit notes;
- tooth numbers;
- the stage's `task` text, notes, files or photos;
- prices or invoices;
- partner names;
- ratings;
- `job_stage.id`.

The clinic keeps the map from `record_id` to `job_stage` in its own project,
so it can withdraw a record it sent by mistake. The Network never gets that
map.

**A test then guards it:** a record builder that refuses any field outside
this list, in the same spirit as the export audit's tests.

## Not part of this plan

- The quick-job market's access model. It reuses the partner rules (sql/092:
  a partner sees job information, never who the patient is). It needs its own
  plan once the lawyer has answered.
- Anything that ranks people for a clinic from patient data. Wivo is not a
  medical device, and that does not change here either.
