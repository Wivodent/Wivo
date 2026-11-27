-- ============================================================================
-- Wivo — migration 139: the board knows which stages each job has switched off
-- Run this ON ITS OWN, in a separate query, AFTER 138.
-- ============================================================================
--
-- WHAT
--   The board's ← / → arrows on a job card step over the stages switched off
--   (skipped) on that job, and a dragged card cannot be dropped on them. The
--   board reads them for all its cards at once, and hears a change at once.
--
--   job_skipped_stages(p_jobs)
--                    the switched-off stages of these jobs, one call for the
--                    whole board (a list of ids in the URL would outgrow it).
--                    SECURITY INVOKER: job_stage's own row security
--                    (job_stage_select) decides, so a job one may not read
--                    gives nothing, another clinic's above all. Only reads:
--                    stable.
--   job_stage in supabase_realtime
--                    a stage switched off or on, on another computer, shows
--                    on the board at once. Realtime sends a change only to
--                    someone job_stage_select lets read the row: within one's
--                    own clinic, never a partner. The app reads nothing from
--                    the event, it reloads (sql/131: replica identity stays
--                    the primary key).
--
-- An app without this migration's function reads job_stage directly, in
-- parts; without the publication it hears the change at the next reload.
--
-- Idempotent. Changes no data.

set lock_timeout = '10s';

create or replace function public.job_skipped_stages(p_jobs uuid[])
returns table (job_id uuid, stage_key text)
language sql
stable
security invoker
set search_path = public
as $$
  select s.job_id, s.stage_key
    from public.job_stage s
   where s.job_id = any(coalesce(p_jobs, '{}'::uuid[]))
     and s.skipped_at is not null
   order by s.job_id, s.position
$$;
revoke execute on function public.job_skipped_stages(uuid[]) from public, anon;
grant execute on function public.job_skipped_stages(uuid[]) to authenticated;

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'job_stage') then
    alter publication supabase_realtime add table public.job_stage;
  end if;
end $$;

select public.ensure_mfa_policies();
select public.lock_anon_functions();

-- ─── Verify (read only) ─────────────────────────────────────────────────────
-- select count(*) from public.job_skipped_stages('{}');               -> 0
-- select tablename from pg_publication_tables
--  where pubname = 'supabase_realtime' and tablename = 'job_stage';   -> one row
-- Afterwards, in SQL Editor on its own: notify pgrst, 'reload schema';
