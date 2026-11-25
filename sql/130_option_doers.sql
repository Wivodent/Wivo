-- ============================================================================
-- Wivo — migration 130: who makes a job's chosen option (Metal bar by B)
-- Run AFTER sql/129. Then, as a SEPARATE query:  notify pgrst, 'reload schema';
-- ============================================================================
--
-- A work type option chosen on a job (sql/129's pay rules, shared/pricing/
-- workOptions.ts) may be made by someone other than the job's technician:
-- the teeth by A, the metal bar by B. The job card, the job page and the phone
-- show a person button beside each chosen option, like the stage bar's.
--
-- Where it lives: on the job's own work item, beside the choice it belongs to,
--   jobs.work_items[].valikuTegijad   { [option id]: profile id }
-- jsonb like the choice itself (work_items[].valikud), so no column is added.
-- Absent = the job's technician makes it, which is every job made before this:
-- NOTHING is rewritten. A pay rule "Only with option" pays the option's doer,
-- or the technician when there is none (lib/earnings.ts).
--
-- What the database does here:
--   1. a doer is a member of the job's clinic (guard_job_option_doers), as
--      the other people on a job are; checked for doers that are new on the
--      row, so a later edit of a job whose doer has since left still saves;
--   2. the person is told in the bell when made a doer, as when put on a
--      stage (sql/123, sql/126): kind 'option_assigned', one notification per
--      person per save naming their options; never by e-mail or push, like
--      'stage_assigned'.
--
-- No new table, so no new RLS. A partner sees no new information about the
-- patient: the notification carries the job code and the option's name only.
--
-- Tests: sql/test/optionDoers.test.ts. Schema and trigger checks regenerated.
-- ============================================================================

set lock_timeout = '10s';

-- ── 1. The notification kind ────────────────────────────────────────────────

alter table public.notification drop constraint if exists notification_kind_valid;
alter table public.notification add constraint notification_kind_valid
  check (kind in ('job_shared', 'stage_handover', 'question', 'files_added', 'stage_reached', 'assigned',
                  'mfa_removed', 'mfa_reset', 'update_installed', 'update_failed', 'update_stale',
                  'stage_progress', 'stage_assigned', 'mail_quota', 'option_assigned'));

-- ── 2. A job's option doers ─────────────────────────────────────────────────

/** Every (work item, option, doer) a work_items array names. A value that is not a uuid reads as NULL. */
create or replace function public.job_option_doers(p_items jsonb)
returns table (item_id text, option_id text, profile_id uuid, raw text)
language sql
immutable
set search_path = public
as $$
  select i ->> 'id', d.key, public.as_uuid(d.value), d.value
    from jsonb_array_elements(case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end) i
    cross join lateral jsonb_each_text(
      case when jsonb_typeof(i -> 'valikuTegijad') = 'object' then i -> 'valikuTegijad' else '{}'::jsonb end) d
$$;
revoke execute on function public.job_option_doers(jsonb) from public, anon, authenticated;

/** A doer new on this row is a member of the job's clinic. */
create or replace function public.guard_job_option_doers()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  d record;
begin
  for d in
    select n.* from public.job_option_doers(new.work_items) n
     where tg_op = 'INSERT'
        or not exists (select 1 from public.job_option_doers(old.work_items) o
                        where o.item_id is not distinct from n.item_id
                          and o.option_id = n.option_id and o.raw is not distinct from n.raw)
  loop
    if d.raw is null then
      continue;  -- a JSON null: no doer, the technician
    end if;
    if d.profile_id is null or not exists (
      select 1 from public.profiles p where p.id = d.profile_id and p.clinic_id = new.clinic_id
    ) then
      raise exception 'The person who makes an option must be a member of this clinic' using errcode = '23503';
    end if;
  end loop;
  return new;
end;
$$;
revoke execute on function public.guard_job_option_doers() from public, anon, authenticated;

drop trigger if exists guard_job_option_doers on public.jobs;
create trigger guard_job_option_doers
  before insert or update of work_items, clinic_id on public.jobs
  for each row execute function public.guard_job_option_doers();

/**
 * Tell each person newly made the doer of an option on this job, once per
 * save, naming their options (the library's names, else the ids). The bell
 * only; nobody is told what they did themselves (notify_member).
 */
create or replace function public.notify_job_option_doers()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lib jsonb;
  r record;
begin
  select coalesce(cs.pricing -> 'tooValikud', '[]'::jsonb) into v_lib
    from public.clinic_settings cs where cs.clinic_id = new.clinic_id;
  if jsonb_typeof(v_lib) is distinct from 'array' then
    v_lib := '[]'::jsonb;
  end if;

  for r in
    select n.profile_id,
           array_agg(distinct coalesce(
             (select o ->> 'nimi' from jsonb_array_elements(v_lib) o where o ->> 'id' = n.option_id limit 1),
             n.option_id)) as names
      from public.job_option_doers(new.work_items) n
     where n.profile_id is not null
       and (tg_op = 'INSERT'
            or not exists (select 1 from public.job_option_doers(old.work_items) o
                            where o.item_id is not distinct from n.item_id
                              and o.option_id = n.option_id and o.profile_id = n.profile_id))
     group by n.profile_id
  loop
    perform public.notify_member(new.clinic_id, r.profile_id, new.id, 'option_assigned',
      jsonb_build_object('options', to_jsonb(r.names), 'new', tg_op = 'INSERT'));
  end loop;
  return new;
end;
$$;
revoke execute on function public.notify_job_option_doers() from public, anon, authenticated;

drop trigger if exists notify_job_option_doers on public.jobs;
create trigger notify_job_option_doers
  after insert or update of work_items on public.jobs
  for each row execute function public.notify_job_option_doers();

-- ── 3. The bell only: never by e-mail or push ──────────────────────────────

/** sql/125, without 'option_assigned' either: the bell only, as 'stage_assigned'. */
create or replace function public.pending_notification_emails(p_limit int default 200)
returns table (id uuid, email text, job_id uuid, job_code text, kind text, language text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select n.id, u.email, n.job_id, n.job_code, n.kind,
         coalesce(p.language, c.default_language, 'en'), n.created_at
    from public.notification n
    join public.profiles p on p.id = n.user_id
    join auth.users u on u.id = n.user_id
    join public.clinics c on c.id = n.org_id
   where n.emailed_at is null and n.read_at is null
     and n.kind not in ('stage_assigned', 'mail_quota', 'option_assigned')
     and case when n.kind = 'stage_progress' then p.notify_every_stage else p.notify_email end
     and u.email is not null and not public.is_standin_email(u.email)
     and n.created_at > now() - interval '1 day'
   order by n.created_at
   limit p_limit
$$;
revoke execute on function public.pending_notification_emails(int) from public, anon, authenticated;

/** sql/123, without 'option_assigned' either. */
create or replace function public.pending_pushes(p_limit int default 500)
returns table (notification_id uuid, subscription_id uuid, endpoint text, p256dh text, auth text,
               kind text, language text, unread int)
language sql
stable
security definer
set search_path = public
as $$
  select n.id, s.id, s.endpoint, s.p256dh, s.auth,
         n.kind,
         coalesce(p.language, c.default_language, 'en'),
         (select count(*)::int from public.notification u where u.user_id = n.user_id and u.read_at is null)
    from public.notification n
    join public.push_subscription s on s.user_id = n.user_id
    join public.profiles p on p.id = n.user_id and p.notify_push
    left join public.clinics c on c.id = n.org_id
   where n.pushed_at is null and n.read_at is null and n.created_at > now() - interval '1 hour'
     and n.kind not in ('stage_progress', 'stage_assigned', 'option_assigned')
   order by n.created_at, n.id
   limit p_limit
$$;
revoke execute on function public.pending_pushes(int) from public, anon, authenticated;

select public.ensure_mfa_policies();
select public.lock_anon_functions();
