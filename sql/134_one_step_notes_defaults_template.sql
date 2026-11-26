-- ============================================================================
-- Wivo — migration 134: notes and stage defaults in one step; a job keeps
-- its template
-- Run after 133.
-- ============================================================================
--
-- 1. A JOB'S NOTES (add_job_note, remove_job_note)
--   The app read the job's whole list of notes, added or removed one, and
--   wrote the list back. Two people at once could lose one (2.2.3 merged the
--   two lists in the app; this does it where it cannot race): the database
--   appends or removes the one note in a single UPDATE, under the row's lock.
--   SECURITY INVOKER: the jobs table's own rules decide who may (as the
--   update did), and its triggers run as before (the partner-text check,
--   the audit, updated_at).
--
-- 2. A STAGE'S DEFAULT PEOPLE (save_stage_default)
--   Delete-then-insert as two requests: a break between them emptied the
--   stage's people. One call, one transaction. SECURITY INVOKER: the table's
--   rules ("Manage stages", people of one's own clinic) decide.
--
-- 3. A JOB KEEPS ITS TEMPLATE (J5, BACKLOG security check 3)
--   jobs.template_id could be changed after creation by anyone who may edit
--   the job. It does not move the job's stages, but a stage added later takes
--   its pay kind from the template (sql/124). Refused now, like the orderer
--   (guard_job_orderer, sql/122). The app never changes it.

set lock_timeout = '10s';

-- ── 1. Notes ────────────────────────────────────────────────────────────────

/**
 * Append one note to a job; the note as stored. Its id and time are the
 * database's; the author is the name the app shows for this person (as before).
 */
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

/** Remove one note from a job, by its id. A note already gone is no error. */
create or replace function public.remove_job_note(p_job uuid, p_note text)
returns void
language plpgsql
volatile
security invoker
set search_path = public
as $$
begin
  update public.jobs
     set markused = coalesce((select jsonb_agg(n order by o)
                                from jsonb_array_elements(coalesce(markused, '[]'::jsonb)) with ordinality as x(n, o)
                               where n->>'id' is distinct from p_note), '[]'::jsonb)
   where id = p_job;
  if not found then
    raise exception 'This job cannot be changed' using errcode = '42501';
  end if;
end
$$;

revoke execute on function public.add_job_note(uuid, text, text) from public, anon;
revoke execute on function public.remove_job_note(uuid, text) from public, anon;
grant execute on function public.add_job_note(uuid, text, text) to authenticated;
grant execute on function public.remove_job_note(uuid, text) to authenticated;

-- ── 2. A stage's default people ─────────────────────────────────────────────

create or replace function public.save_stage_default(p_stage_key text, p_people uuid[])
returns void
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_org uuid := public.my_org_id();
begin
  if v_org is null then
    raise exception 'No clinic' using errcode = '42501';
  end if;
  if p_stage_key is null or length(btrim(p_stage_key)) = 0 then
    raise exception 'Which stage?' using errcode = '22023';
  end if;
  -- Said, not silent: without the permission row security would let the
  -- delete match nothing and an empty insert pass, and the screen would
  -- think it saved.
  if not public.has_perm('pipeline.write') then
    raise exception 'Manage stages is needed for this' using errcode = '42501';
  end if;
  delete from public.clinic_stage_default where org_id = v_org and stage_key = p_stage_key;
  insert into public.clinic_stage_default (org_id, stage_key, profile_id)
  select distinct v_org, p_stage_key, p from unnest(coalesce(p_people, '{}'::uuid[])) p;
end
$$;

revoke execute on function public.save_stage_default(text, uuid[]) from public, anon;
grant execute on function public.save_stage_default(text, uuid[]) to authenticated;

-- ── 3. A job keeps its template ─────────────────────────────────────────────

create or replace function public.guard_job_template()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- The SQL editor or a service function (no signed-in user) is left alone.
  if auth.uid() is not null and new.template_id is distinct from old.template_id then
    raise exception 'A job''s template cannot be changed after it is made' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_job_template() from public, anon, authenticated;

drop trigger if exists guard_job_template on public.jobs;
create trigger guard_job_template
  before update of template_id on public.jobs
  for each row execute function public.guard_job_template();

select public.lock_anon_functions();
