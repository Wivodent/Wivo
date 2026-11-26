-- ============================================================================
-- Wivo — migration 132: a job's files and stage people in realtime
-- Run this ON ITS OWN, in a separate query, AFTER 131.
-- ============================================================================
--
-- WHY
--   From 2.2.4 the app listens to two more tables: job_file (a file added,
--   replaced or removed on a job) and job_stage_person (who is on a stage).
--   Without this they show on another computer only when the job is opened
--   again. A table missing from `supabase_realtime` is silent, and 2.2.4
--   listens to these on channels of their own, so a database without this
--   migration only misses these two, nothing else.
--
-- WHO HEARS WHAT
--   Realtime sends a change only to someone whose row security lets them
--   read the row: both tables are readable within one's own organisation
--   only (job_file_select, job_stage_person_select), never by a partner. The
--   app reads nothing from the event: it reloads the job's files (through
--   the job_files function) and its stages. Replica identity stays the
--   primary key (sql/131: nothing reads the old row).
--
-- Idempotent, the same as 131: a table already in the publication is left
-- alone, a missing table is skipped and named. Changes no data.

set lock_timeout = '10s';

do $$
declare
  t text;
  wanted text[] := array['job_file', 'job_stage_person'];
begin
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
--  where pubname = 'supabase_realtime' and tablename in ('job_file', 'job_stage_person');
--   -> two rows
