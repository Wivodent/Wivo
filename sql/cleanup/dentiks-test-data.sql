-- ============================================================================
-- Dentiks: remove the test data before real work starts
-- NOT a migration. Kevin runs it by hand, in Dentiks's own Supabase project
-- (SQL Editor), in a session started for this purpose. Nothing runs it
-- automatically, and it is never run on another project.
-- ============================================================================
--
-- Organisation: Dentiks, org_id 0641ae3d-5bdb-4e67-b147-6cc45ba59bb4
-- (clinics/dentiks.json). Every statement is limited to that org_id.
--
-- DELETED: every job and what hangs on it (stages and their people, partner
-- shares, files, job chat threads, notifications, payouts that contain a line
-- for one of those jobs),
-- invoices with their lines and payments, payment plans, visits, booking
-- requests, patients (with their tooth chart), customers.
--
-- KEPT: the organisation, users, workers, roles and permissions, invites,
-- workflow templates and stages, usual people per stage, pay rules and monthly
-- salaries (worker_rates), worked hours, payouts with no job line, prices and
-- work types, machines, materials, stock (its movements stay; the job they
-- were for is cleared, which stock allows), all settings, the licence, the job
-- code and invoice number counters, and the WHOLE audit log.
--
-- The audit log cannot be cleaned, on purpose: it is append-only even from
-- the SQL Editor (sql/114, sql/115); only deleting the organisation removes
-- its rows. Rows about the test jobs stay, naming a job code and an id, never
-- a patient's name (sql/106). Part 1 counts them so the number is known.
--
-- No TRUNCATE anywhere: TRUNCATE ignores org_id.
--
-- Not done here: the uploaded files themselves (Storage bucket `job-files`).
-- Part 1 counts them; delete them in Dashboard > Storage > job-files after
-- part 2 (Supabase does not allow deleting Storage objects from SQL).
--
-- HOW:
--   1. Run PART 1 alone. Read the counts. They are what part 2 will delete.
--   2. Run PART 2 alone. It stops, changing nothing, if the org is not Dentiks.
--   3. Run PART 1 again: every count but the Storage one is 0.
-- ============================================================================


-- ── PART 1: counts only (read-only) ─────────────────────────────────────────

with org as (select '0641ae3d-5bdb-4e67-b147-6cc45ba59bb4'::uuid as id),
     j as (select id from public.jobs where clinic_id = (select id from org)),
     p as (select id from public.patients where clinic_id = (select id from org)),
     f as (select id, storage_path from public.job_file where job_id in (select id from j))
select 'clinic (must say Dentiks)' as what, (select name from public.clinics where id = (select id from org)) as rows
union all select 'jobs',                       count(*)::text from j
union all select 'job_stage',                  count(*)::text from public.job_stage where job_id in (select id from j)
union all select 'job_stage_person',           count(*)::text from public.job_stage_person jsp
                                                 where jsp.job_stage_id in (select s.id from public.job_stage s where s.job_id in (select id from j))
union all select 'job_share',                  count(*)::text from public.job_share where job_id in (select id from j)
union all select 'job_file',                   count(*)::text from f
union all select 'storage objects (job-files)', count(*)::text from storage.objects o
                                                 where o.bucket_id = 'job-files' and o.name in (select storage_path from f)
union all select 'channels (job threads)',     count(*)::text from public.channels where job_id in (select id from j)
union all select 'messages in job threads',    count(*)::text from public.messages
                                                 where channel_id in (select c.id from public.channels c where c.job_id in (select id from j))
union all select 'message_jobs',               count(*)::text from public.message_jobs where job_id in (select id from j)
union all select 'notification (jobs)',        count(*)::text from public.notification where org_id = (select id from org) and job_id in (select id from j)
union all select 'audit_log about them (KEPT, cannot be deleted)', count(*)::text from public.audit_log
                                                 where org_id = (select id from org)
                                                   and (object in (select 'job:' || id from j)
                                                     or object in (select 'file:' || id from f)
                                                     or object in (select 'patient:' || id from p))
union all select 'worker_payouts with a job line', count(*)::text from public.worker_payouts wp
                                                 where exists (select 1 from public.worker_payout_lines l
                                                               where l.payout_id = wp.id and l.job_id in (select id from j))
union all select 'worker_payout_lines in those payouts', count(*)::text from public.worker_payout_lines l
                                                 where l.payout_id in (select wp.id from public.worker_payouts wp
                                                   where exists (select 1 from public.worker_payout_lines x
                                                                 where x.payout_id = wp.id and x.job_id in (select id from j)))
union all select 'invoices',                   count(*)::text from public.invoices where clinic_id = (select id from org)
union all select 'invoice_lines',              count(*)::text from public.invoice_lines
                                                 where invoice_id in (select i.id from public.invoices i where i.clinic_id = (select id from org))
union all select 'payments',                   count(*)::text from public.payments where clinic_id = (select id from org)
union all select 'payment_plans',              count(*)::text from public.payment_plans where clinic_id = (select id from org)
union all select 'visit_requests',             count(*)::text from public.visit_requests where clinic_id = (select id from org)
union all select 'visits',                     count(*)::text from public.visits where clinic_id = (select id from org)
union all select 'patient_teeth',              count(*)::text from public.patient_teeth where patient_id in (select id from p)
union all select 'patients',                   count(*)::text from p
union all select 'customers',                  count(*)::text from public.customers where clinic_id = (select id from org);


-- ── PART 2: delete (one transaction) ────────────────────────────────────────
-- In the SQL Editor auth.uid() is empty, so a job delete is a real delete
-- (sql/089), not the app's soft delete. Run this part on its own.

begin;

create temp table cleanup_org on commit drop as
  select '0641ae3d-5bdb-4e67-b147-6cc45ba59bb4'::uuid as id;

-- The guard: nothing happens unless this org exists and is Dentiks.
do $$
begin
  if not exists (select 1 from public.clinics c
                  where c.id = (select id from cleanup_org) and c.name ilike '%dentiks%') then
    raise exception 'This is not the Dentiks organisation in this project: nothing deleted';
  end if;
end $$;

create temp table cleanup_jobs on commit drop as
  select id from public.jobs where clinic_id = (select id from cleanup_org);
create temp table cleanup_patients on commit drop as
  select id from public.patients where clinic_id = (select id from cleanup_org);
create temp table cleanup_payouts on commit drop as
  select wp.id from public.worker_payouts wp
   where exists (select 1 from public.worker_payout_lines l
                  where l.payout_id = wp.id and l.job_id in (select id from cleanup_jobs));

-- 1. Everything hanging on the jobs (most would cascade; said out loud).
delete from public.notification
 where org_id = (select id from cleanup_org) and job_id in (select id from cleanup_jobs);
delete from public.message_jobs where job_id in (select id from cleanup_jobs);
delete from public.channels where job_id in (select id from cleanup_jobs);      -- its messages and members cascade
delete from public.job_stage_person
 where job_stage_id in (select s.id from public.job_stage s where s.job_id in (select id from cleanup_jobs));
delete from public.job_stage where job_id in (select id from cleanup_jobs);
delete from public.job_share where job_id in (select id from cleanup_jobs);
delete from public.job_file where job_id in (select id from cleanup_jobs);

-- 2. Pay made from those jobs: the whole payout, its lines cascade.
delete from public.worker_payouts where id in (select id from cleanup_payouts);

-- 3. Money documents.
delete from public.payments where clinic_id = (select id from cleanup_org);
delete from public.invoice_lines
 where invoice_id in (select i.id from public.invoices i where i.clinic_id = (select id from cleanup_org));
delete from public.invoices where clinic_id = (select id from cleanup_org);
delete from public.payment_plans where clinic_id = (select id from cleanup_org);

-- 4. The jobs themselves.
delete from public.jobs where id in (select id from cleanup_jobs);

-- 5. Visits, booking requests, patients, customers.
delete from public.visit_requests where clinic_id = (select id from cleanup_org);
delete from public.visits where clinic_id = (select id from cleanup_org);
delete from public.patient_teeth where patient_id in (select id from cleanup_patients);
delete from public.patients where id in (select id from cleanup_patients);
delete from public.customers where clinic_id = (select id from cleanup_org);

commit;
