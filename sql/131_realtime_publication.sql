-- ============================================================================
-- Wivo — migration 131: every table the app listens to is in realtime
-- Run this ON ITS OWN, in a separate query.
-- ============================================================================
--
-- WHY
--   The app hears another computer's change through Supabase realtime
--   (postgres_changes): a job's note or price, a visit, a payment. Realtime
--   sends a table's changes only while the table is in the publication
--   `supabase_realtime`. A table missing from it is SILENT: no error, no
--   warning, the change just does not arrive, and the other screen keeps the
--   old value until it is reloaded.
--
--   The migrations added these tables one by one (001, 004, 008, 019, 020,
--   022, 036, 046, 049, 062, 066, 076). A project made by copying another
--   (the test copy, made from production) can come without them: the test
--   copy had none. This puts every one of them in, once, whatever is there
--   already. sql/checks/schema_check.sql now says which are missing (kind
--   `realtime`).
--
-- THE TABLES
--   The fifteen the app subscribes to, desktop and phone (hooks/*,
--   lib/clinicSettings): clinic_settings, customers, invoice_lines, invoices,
--   jobs, notification, patient_teeth, patients, payment_plans, payments,
--   visit_requests, visits, work_hours, worker_payouts, worker_rates; and
--   messages (sql/066, the chat). Not job_stage, job_stage_person, job_files
--   or channels: nothing listens to them, and a table in the publication
--   costs the realtime worker its changes for nobody.
--
-- REPLICA IDENTITY: left as it is (the primary key). Every handler only
--   reloads its list, whatever the event; the one that reads the row
--   (notification, INSERT) gets the whole new row anyway. A DELETE carries
--   the primary key, and with row security on, Supabase sends no more than
--   that even under FULL. FULL would only make every update log the whole
--   old row.
--
-- Idempotent: a table already in the publication is left alone; a table this
-- database does not have is skipped and named. Changes no data.

set lock_timeout = '10s';

do $$
declare
  t text;
  wanted text[] := array[
    'clinic_settings', 'customers', 'invoice_lines', 'invoices', 'jobs', 'messages',
    'notification', 'patient_teeth', 'patients', 'payment_plans', 'payments',
    'visit_requests', 'visits', 'work_hours', 'worker_payouts', 'worker_rates'
  ];
begin
  -- Supabase makes this publication with every project; a database without
  -- it would hear nothing at all.
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
    raise notice 'created publication supabase_realtime';
  end if;

  foreach t in array wanted loop
    if to_regclass('public.' || t) is null then
      raise notice 'skipped public.%: no such table here', t;
    elsif not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
      raise notice 'added public.% to supabase_realtime', t;
    end if;
  end loop;
end $$;

-- ─── Verify (read only) ─────────────────────────────────────────────────────
-- select tablename from pg_publication_tables
--  where pubname = 'supabase_realtime' and schemaname = 'public'
--  order by 1;
--   -> the sixteen tables above (and nothing missing in schema_check.sql's
--      rows of kind `realtime`)
