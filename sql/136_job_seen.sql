-- ============================================================================
-- Wivo — migration 136: "new activity" on a job card, per person
-- Run this ON ITS OWN, in a separate query, AFTER 135.
-- ============================================================================
--
-- WHAT
--   A small mark on a job card (board and phone) when someone ELSE added a
--   note, a message, a file or moved a stage since I last opened the job.
--   Opening the job clears it, on all my devices at once (realtime).
--
--   job_seen         when each person last opened each job. Own rows only:
--                    nobody sees when a colleague opened what.
--   mark_job_seen    "I opened this job", with the database's clock.
--   job_activity     the jobs with something new for me, by kind, with who.
--   clinics.activity_seen_from
--                    where "new" starts for everyone: the moment this
--                    migration runs (a new clinic: when it is made). Old jobs
--                    therefore start as seen; nobody gets a wall of marks.
--
-- NO NEW LOG. The activity is read from what is already kept:
--   files     job_file.completed_at / uploaded_by
--   messages  messages.created_at / author_id, via message_jobs
--   stages    job_stage.started_at / started_by and done_at / done_by
--   notes     jobs.markused[].ts and, from here on, .by (add_job_note below
--             now writes who added the note; an older note without it is
--             matched by the author's name)
--   job_activity is SECURITY INVOKER: it sees exactly the jobs, files and
--   messages the person may read (a technician's own jobs, their own
--   channels), so it tells nobody of anything they could not open.
--
-- Idempotent. Changes no existing data (the new column is filled with the
-- time of the run).

set lock_timeout = '10s';

-- ── Where "new" starts ──────────────────────────────────────────────────────
alter table public.clinics
  add column if not exists activity_seen_from timestamptz not null default now();

-- ── job_seen ────────────────────────────────────────────────────────────────
create table if not exists public.job_seen (
  user_id  uuid not null references auth.users(id) on delete cascade,
  job_id   uuid not null references public.jobs(id) on delete cascade,
  org_id   uuid not null references public.clinics(id) on delete cascade,
  seen_at  timestamptz not null default now(),
  primary key (user_id, job_id)
);
create index if not exists job_seen_job_idx on public.job_seen (job_id);

alter table public.job_seen enable row level security;

drop policy if exists "job_seen_select_own" on public.job_seen;
create policy "job_seen_select_own" on public.job_seen
  for select to authenticated
  using (user_id = auth.uid() and org_id = public.my_org_id());
-- No insert, update or delete policy and no write grant: rows are written by
-- mark_job_seen only, with the database's clock (a client's clock that runs
-- ahead would hide activity, one that runs behind would show it twice).

revoke all on public.job_seen from public, anon, authenticated;
grant select on public.job_seen to authenticated;

-- ── I opened this job ───────────────────────────────────────────────────────
create or replace function public.mark_job_seen(p_job uuid)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid := public.my_org_id();
  v_now timestamptz := now();
begin
  if auth.uid() is null or v_org is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  -- Only a job of my own organisation. Marking one I cannot read would tell
  -- me nothing, but there is no reason to keep a row for it either.
  if not exists (select 1 from public.jobs where id = p_job and clinic_id = v_org) then
    return null;
  end if;
  insert into public.job_seen (user_id, job_id, org_id, seen_at)
  values (auth.uid(), p_job, v_org, v_now)
  on conflict (user_id, job_id) do update set seen_at = excluded.seen_at
    where public.job_seen.seen_at < excluded.seen_at;
  return v_now;
end;
$$;
revoke execute on function public.mark_job_seen(uuid) from public, anon;
grant execute on function public.mark_job_seen(uuid) to authenticated;

-- ── What is new for me ──────────────────────────────────────────────────────
/**
 * One row per job I can read that has activity by someone else after I last
 * opened it (or after activity_seen_from, if I never have): how many of each
 * kind, when the latest was, and who (names, at most five).
 */
create or replace function public.job_activity()
returns table (job_id uuid, files int, notes int, messages int, stages int,
               last_at timestamptz, people text[])
language sql
stable
security invoker
set search_path = public
as $$
  with me as (
    select p.id as uid, p.full_name,
           greatest(c.activity_seen_from, p.created_at) as since
      from public.profiles p
      join public.clinics c on c.id = p.clinic_id
     where p.id = auth.uid()
  ),
  ev as (
    select f.job_id, 'file'::text as kind, f.completed_at as at, f.uploaded_by as by
      from public.job_file f, me
     where f.completed_at > me.since and f.deleted_at is null
       and f.uploaded_by is distinct from me.uid
    union all
    select mj.job_id, 'message', m.created_at, m.author_id
      from public.message_jobs mj
      join public.messages m on m.id = mj.message_id, me
     where m.created_at > me.since and m.deleted_at is null
       and m.author_id is distinct from me.uid
    union all
    select s.job_id, 'stage', s.done_at, s.done_by
      from public.job_stage s, me
     where s.done_at > me.since and s.done_by is distinct from me.uid
    union all
    select s.job_id, 'stage', s.started_at, s.started_by
      from public.job_stage s, me
     where s.started_at > me.since and s.started_by is distinct from me.uid
       and (s.done_at is null or s.done_at <> s.started_at)
    union all
    select j.id, 'note', (n->>'ts')::timestamptz,
           case when n->>'by' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                then (n->>'by')::uuid end
      from public.jobs j
      cross join me
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(j.markused) = 'array' then j.markused else '[]'::jsonb end) n
     where j.updated_at > me.since
       and n->>'ts' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}'
       and (n->>'ts')::timestamptz > me.since
       and coalesce(n->>'by', '') <> me.uid::text
       and (n ? 'by' or coalesce(n->>'autor', '') <> me.full_name)
  )
  select ev.job_id,
         (count(*) filter (where ev.kind = 'file'))::int,
         (count(*) filter (where ev.kind = 'note'))::int,
         (count(*) filter (where ev.kind = 'message'))::int,
         (count(*) filter (where ev.kind = 'stage'))::int,
         max(ev.at),
         (array_agg(distinct pr.full_name) filter (where pr.full_name is not null))[1:5]
    from ev
    cross join me
    join public.jobs j on j.id = ev.job_id and j.deleted_at is null
    left join public.job_seen s on s.user_id = me.uid and s.job_id = ev.job_id
    left join public.profiles pr on pr.id = ev.by
   where ev.at > coalesce(s.seen_at, me.since)
   group by ev.job_id
$$;
revoke execute on function public.job_activity() from public, anon;
grant execute on function public.job_activity() to authenticated;

-- ── Notes say who added them ────────────────────────────────────────────────
-- As sql/134, with `by`: the person's id, so their own note is not "new" to
-- them on another device, whatever name the app showed.
create or replace function public.add_job_note(p_job uuid, p_text text, p_author text)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_note jsonb;
begin
  if p_text is null or length(btrim(p_text)) = 0 then
    raise exception 'A note needs text' using errcode = '22023';
  end if;
  if length(p_text) > 5000 then
    raise exception 'A note is at most 5000 characters' using errcode = '22023';
  end if;
  v_note := jsonb_build_object(
    'id', gen_random_uuid()::text,
    'ts', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'autor', left(coalesce(nullif(btrim(p_author), ''), '?'), 200),
    'by', auth.uid()::text,
    'tekst', btrim(p_text)
  );
  update public.jobs
     set markused = coalesce(markused, '[]'::jsonb) || jsonb_build_array(v_note)
   where id = p_job;
  if not found then
    raise exception 'This job cannot be changed' using errcode = '42501';
  end if;
  return v_note;
end
$$;
revoke execute on function public.add_job_note(uuid, text, text) from public, anon;
grant execute on function public.add_job_note(uuid, text, text) to authenticated;

-- ── Realtime: my other devices hear that I opened the job ───────────────────
-- Realtime sends a row only to whoever may read it: job_seen_select_own, so
-- only to me. Skipped, and named, where there is no publication (as 131).
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'job_seen') then
    alter publication supabase_realtime add table public.job_seen;
  end if;
end $$;

select public.ensure_mfa_policies();
select public.lock_anon_functions();

-- ─── Verify (read only) ─────────────────────────────────────────────────────
-- select count(*) from public.job_seen;                               -> 0
-- select activity_seen_from from public.clinics;                      -> the time of the run
-- select tablename from pg_publication_tables
--  where pubname = 'supabase_realtime' and tablename = 'job_seen';    -> one row
-- Afterwards, in SQL Editor on its own: notify pgrst, 'reload schema';
