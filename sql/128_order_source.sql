-- ============================================================================
-- Wivo — migration 128: who ordered a job (our clinic, another clinic, or a
-- dentist / technician)
-- Run AFTER sql/127. Then, as a SEPARATE query:  notify pgrst, 'reload schema';
-- ============================================================================
--
-- The new-job form asks "Ordered by" with three answers
-- (docs/design patient-order.html):
--
--   own     Our clinic: one of our own doctors ordered it   → order_doctor
--   clinic  Another clinic: a customer that is a clinic      → customer_id, customer_ref
--   person  A dentist or technician working on their own     → customer_id, customer_ref
--
-- 1. jobs.order_source  'own' | 'clinic' | 'person', NULL = not said.
-- 2. jobs.order_doctor  our doctor who ordered it (a member of the job's
--    clinic). Not jobs.ordered_by: that is the person who CREATED the job,
--    set by the database and never changed (sql/122, docs/WORKFLOW-STAGES.md
--    §2.6a), and it stays exactly that.
-- 3. customers.kind     'clinic' | 'person', so the form can offer clinics
--    under "Another clinic" and people under "Dentist / technician". Every
--    member reads it, as they read a client's name (sql/118).
--
-- Old jobs and customers: NOTHING is rewritten. Every existing job keeps
-- order_source and order_doctor NULL ("not said") and reads exactly as
-- before: its customer, if it has one, is still its customer. Every existing
-- customer becomes kind 'clinic' (the default), which is what they all are
-- today; a clinic marks the odd dentist as a person in Customers.
--
-- No new table, so no new RLS: both tables keep theirs. order_doctor names a
-- member of the job's own clinic only (guard_job_order_doctor below), like
-- the other people on a job. A partner sees no new information about the
-- patient: these columns name the clinic's own doctor and the ordering
-- customer, never the patient.
--
-- Tests: sql/test/orderSource.test.ts. Schema check regenerated.
-- ============================================================================

set lock_timeout = '10s';

-- ── 1–2. jobs ───────────────────────────────────────────────────────────────

alter table public.jobs
  add column if not exists order_source text,
  add column if not exists order_doctor uuid references public.profiles(id) on delete set null;

alter table public.jobs drop constraint if exists jobs_order_source_valid;
alter table public.jobs add constraint jobs_order_source_valid
  check (order_source is null or order_source in ('own', 'clinic', 'person'));

create index if not exists jobs_order_doctor_idx on public.jobs (order_doctor);

/**
 * The doctor who ordered a job is a member of the job's clinic. Checked on
 * every write that sets one; NULL is always allowed.
 */
create or replace function public.guard_job_order_doctor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.order_doctor is not null and not exists (
    select 1 from public.profiles p where p.id = new.order_doctor and p.clinic_id = new.clinic_id
  ) then
    raise exception 'The ordering doctor must be a member of this clinic' using errcode = '23503';
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_job_order_doctor() from public, anon, authenticated;

drop trigger if exists guard_job_order_doctor on public.jobs;
create trigger guard_job_order_doctor
  before insert or update of order_doctor, clinic_id on public.jobs
  for each row execute function public.guard_job_order_doctor();

-- ── 3. customers ────────────────────────────────────────────────────────────

alter table public.customers
  add column if not exists kind text not null default 'clinic';

alter table public.customers drop constraint if exists customers_kind_valid;
alter table public.customers add constraint customers_kind_valid
  check (kind in ('clinic', 'person'));

-- Read like the name (sql/118): the new-job form lists clinics and people
-- apart, for every member who adds jobs. Whether a client is a clinic or a
-- person says nothing more about them than their name does.
grant select (kind) on public.customers to authenticated;

-- ── 4. What an edit of the new job columns records (sql/114) ────────────────
-- The same function as sql/122, with the two new columns: the source as its
-- value, the doctor as a member. auditEdits.test.ts fails for a jobs column
-- without a rule.

create or replace function public.audit_field_rules()
returns table (tbl text, col text, rule text)
language sql
immutable
set search_path = public
as $$
  values
    -- jobs: the work, the people, the dates, the links, the money
    ('jobs', 'too', 'value'), ('jobs', 'materjal', 'value'), ('jobs', 'varv', 'value'),
    ('jobs', 'kondivarv', 'value'), ('jobs', 'masina', 'value'), ('jobs', 'hambad', 'teeth'),
    ('jobs', 'kiirtoo', 'value'), ('jobs', 'mudel', 'value'), ('jobs', 'materjali_yhikud', 'value'),
    ('jobs', 'assigned_to', 'member'), ('jobs', 'designed_by', 'member'),
    ('jobs', 'kuupaev', 'value'), ('jobs', 'valmis_aeg', 'value'), ('jobs', 'valmis_kuupaev', 'value'),
    ('jobs', 'delivery_status', 'value'), ('jobs', 'delivered_at', 'value'),
    ('jobs', 'customer_id', 'value'), ('jobs', 'patient_id', 'value'),
    ('jobs', 'hind', 'value'), ('jobs', 'disain_hind', 'value'), ('jobs', 'makstud', 'value'),
    ('jobs', 'makse_kuupaev', 'value'), ('jobs', 'extras', 'value'), ('jobs', 'kulu_yle', 'value'),
    ('jobs', 'rev_hambad', 'teeth'), ('jobs', 'rev_varv', 'value'), ('jobs', 'uus_valmis', 'value'),
    ('jobs', 'status', 'stage'),
    -- jobs: typed by hand, so it could name someone
    ('jobs', 'patsient', 'changed'), ('jobs', 'kirjeldus', 'changed'), ('jobs', 'muudatused', 'changed'),
    ('jobs', 'customer_ref', 'changed'), ('jobs', 'print_id', 'changed'), ('jobs', 'disain_id', 'changed'),
    ('jobs', 'mudel_id', 'changed'), ('jobs', 'extra_costs', 'changed'), ('jobs', 'markused', 'notes'),
    ('jobs', 'work_items', 'items'), ('jobs', 'revisions', 'remakes'),
    -- jobs: the database's own, or with an entry of their own (delete, restore)
    ('jobs', 'id', 'skip'), ('jobs', 'clinic_id', 'skip'), ('jobs', 'job_code', 'skip'),
    ('jobs', 'created_at', 'skip'), ('jobs', 'updated_at', 'skip'),
    ('jobs', 'deleted_at', 'skip'), ('jobs', 'deleted_by', 'skip'),
    -- jobs: the template and the fields its rules read (sql/122). The orderer
    -- never changes (guard_job_orderer), so it has nothing to record.
    ('jobs', 'template_id', 'value'), ('jobs', 'impression_type', 'value'),
    ('jobs', 'implant_count', 'value'), ('jobs', 'production_method', 'value'),
    ('jobs', 'printed_model', 'value'), ('jobs', 'ordered_by', 'skip'),
    -- jobs: who ordered it (sql/128)
    ('jobs', 'order_source', 'value'), ('jobs', 'order_doctor', 'member'),

    -- a work item (jobs.work_items[], and a remake's)
    ('work_item', 'too', 'value'), ('work_item', 'hambad', 'teeth'), ('work_item', 'bridge', 'value'),
    ('work_item', 'materjal', 'value'), ('work_item', 'masina', 'value'), ('work_item', 'implantaadid', 'teeth'),
    ('work_item', 'kruvi', 'value'), ('work_item', 'kruvid', 'value'), ('work_item', 'designed_by', 'member'),
    ('work_item', 'disain_hambad', 'teeth'), ('work_item', 'note', 'changed'), ('work_item', 'id', 'skip'),

    -- a remake (jobs.revisions[])
    ('remake', 'reasons', 'value'), ('remake', 'reason', 'value'), ('remake', 'hambad', 'teeth'),
    ('remake', 'purunenud_hambad', 'teeth'), ('remake', 'varv', 'value'), ('remake', 'kondivarv', 'value'),
    ('remake', 'materjal', 'value'), ('remake', 'deadline', 'value'), ('remake', 'price', 'value'),
    ('remake', 'kiirtoo', 'value'), ('remake', 'mudel', 'value'), ('remake', 'taspidev', 'value'),
    ('remake', 'uusi_tarvikuid', 'value'), ('remake', 'materjali_yhikud', 'value'),
    ('remake', 'assigned_to', 'member'), ('remake', 'designed_by', 'member'),
    ('remake', 'valmis_kuupaev', 'value'), ('remake', 'status', 'stage'), ('remake', 'work_items', 'items'),
    ('remake', 'note', 'changed'), ('remake', 'extra_costs', 'changed'), ('remake', 'print_id', 'changed'),
    ('remake', 'disain_id', 'changed'), ('remake', 'mudel_id', 'changed'),
    ('remake', 'id', 'skip'), ('remake', 'ts', 'skip'),

    -- patients: who they are is never recorded, only that it changed
    ('patients', 'turundusnousolek', 'value'),
    ('patients', 'nimi', 'changed'), ('patients', 'synniaeg', 'changed'), ('patients', 'telefon', 'changed'),
    ('patients', 'email', 'changed'), ('patients', 'arst', 'changed'), ('patients', 'kliinik', 'changed'),
    ('patients', 'ravikaart', 'changed'), ('patients', 'allergiad', 'changed'), ('patients', 'eelistused', 'changed'),
    ('patients', 'lougad', 'changed'), ('patients', 'markmed', 'changed'), ('patients', 'varvi_eelistus', 'changed'),
    ('patients', 'markused', 'notes'), ('patients', 'lougaliiges', 'changed'), ('patients', 'nousoleku_aeg', 'changed'),
    ('patients', 'id', 'skip'), ('patients', 'clinic_id', 'skip'),
    ('patients', 'created_at', 'skip'), ('patients', 'updated_at', 'skip'),

    -- the patient's own tooth chart
    ('patient_teeth', 'staatus', 'value'), ('patient_teeth', 'markus', 'changed'),
    ('patient_teeth', 'patient_id', 'skip'), ('patient_teeth', 'fdi', 'skip'), ('patient_teeth', 'updated_at', 'skip')
$$;
revoke execute on function public.audit_field_rules() from public, anon, authenticated;

select public.lock_anon_functions();
