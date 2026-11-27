-- ============================================================================
-- 145: "Received" after "Sent", a delivery problem, and feedback that stays open
-- ============================================================================
--
-- Run AFTER 144. Every order and every job of ours now goes:
--
--   Sent → Received → Fitted / Needs adjustment
--
-- 1. Received. Once the work is sent, whoever ordered it says it arrived:
--    - an order from outside: the Network client (client_received);
--    - our own job: the doctor who ordered it, a doctor of the clinic, or the
--      owner (job_mark_received);
--    - the clinic itself, when the orderer said so on the phone: "Received
--      (confirmed by phone)" with a note (job_mark_received, p_by_phone).
--    jobs.sent_at is when it left (set here, by a trigger, whenever the job's
--    delivery state goes from at the lab to on its way or handed over);
--    jobs.received_at is when it arrived. Handed over straight from the lab
--    (in person) counts as received at once. A job sent before this migration
--    has no sent_at and counts as received: nobody is asked about old work.
--    These columns are written only by the functions here: the app's job save
--    cannot change them (jobs_delivery_guard).
--
-- 2. Problem with delivery, instead of Received: a reason (not arrived,
--    damaged, wrong item, missing parts, other), a text, and the client's
--    photos with its message. It rings the clinic's bell (delivery_problem),
--    is in the order's conversation, and the order shows "Delivery problem"
--    until the clinic marks it resolved (resend, replaced, other, and a note).
--    For damaged work or a wrong item, resolving can add a remake to the job.
--    One open problem per job.
--
-- 3. The reminder: no Received some days after Sent (the clinic's setting,
--    3 by default) → "Did your order arrive?" to the orderer, once
--    (delivery_reminders, every hour by pg_cron where the project has it).
--    The Orders page shows "Not confirmed" from the same numbers.
--
-- 4. Feedback stays open after Received, on both sides, for as long as the
--    work exists: Fitted / Needs adjustment and the ratings (module `ratings`,
--    as in 144) need Received now instead of "done", and a rating can be
--    changed at any time. Every change is kept (job_rating_change), for the
--    owner.
--
-- Received and the delivery problem work without the `ratings` module.

set lock_timeout = '10s';

-- ── The job's delivery times ────────────────────────────────────────────────
alter table public.jobs add column if not exists sent_at timestamptz;
alter table public.jobs add column if not exists received_at timestamptz;
alter table public.jobs add column if not exists received_via text;
alter table public.jobs add column if not exists received_note text;
alter table public.jobs add column if not exists received_reminded_at timestamptz;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'jobs_received_via_valid') then
    alter table public.jobs add constraint jobs_received_via_valid
      check (received_via is null or received_via in ('orderer', 'client', 'phone', 'handed_over'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'jobs_received_note_valid') then
    alter table public.jobs add constraint jobs_received_note_valid check (received_note is null or length(received_note) <= 1000);
  end if;
end $$;

/**
 * Only this migration's functions write the delivery times (they set
 * wivo.delivery for their own transaction). sent_at follows the delivery
 * state: it leaves the lab → now; back at the lab → all cleared. Straight
 * from the lab to handed over → received at once.
 */
create or replace function public.jobs_delivery_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_ours boolean := coalesce(current_setting('wivo.delivery', true), '') = 'on';
  v_was_sent boolean;
  v_is_sent boolean := coalesce(new.delivery_status, 'labor') in ('teel', 'yle_antud');
begin
  if tg_op = 'INSERT' then
    if not v_ours then
      new.sent_at := case when v_is_sent then now() end;
      new.received_at := case when new.delivery_status = 'yle_antud' then now() end;
      new.received_via := case when new.delivery_status = 'yle_antud' then 'handed_over' end;
      new.received_note := null;
      new.received_reminded_at := null;
    end if;
    return new;
  end if;
  if not v_ours then
    new.sent_at := old.sent_at;
    new.received_at := old.received_at;
    new.received_via := old.received_via;
    new.received_note := old.received_note;
    new.received_reminded_at := old.received_reminded_at;
  end if;
  v_was_sent := coalesce(old.delivery_status, 'labor') in ('teel', 'yle_antud');
  if v_is_sent and not v_was_sent then
    new.sent_at := now();
    new.received_at := case when new.delivery_status = 'yle_antud' then now() end;
    new.received_via := case when new.delivery_status = 'yle_antud' then 'handed_over' end;
    new.received_note := null;
    new.received_reminded_at := null;
  elsif not v_is_sent and v_was_sent then
    new.sent_at := null;
    new.received_at := null;
    new.received_via := null;
    new.received_note := null;
    new.received_reminded_at := null;
  end if;
  return new;
end;
$$;
drop trigger if exists jobs_delivery_guard on public.jobs;
create trigger jobs_delivery_guard before insert or update on public.jobs
  for each row execute function public.jobs_delivery_guard();

/** Sent, and the orderer has it: received, or sent before this migration (no sent_at). */
create or replace function public.job_received(p_job uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select j.delivery_status in ('teel', 'yle_antud') and (j.received_at is not null or j.sent_at is null)
                     from public.jobs j where j.id = p_job), false)
$$;

-- ── Delivery problems ───────────────────────────────────────────────────────
create table if not exists public.delivery_problem (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.clinics(id) on delete cascade,
  job_id           uuid not null references public.jobs(id) on delete cascade,
  order_id         uuid references public.client_order(id) on delete set null,
  reason           text not null,
  note             text not null,
  by_profile       uuid references public.profiles(id) on delete set null,
  by_client        uuid,
  message_id       uuid,
  created_at       timestamptz not null default now(),
  resolved_at      timestamptz,
  resolution       text,
  resolution_note  text,
  resolved_by      uuid references public.profiles(id) on delete set null,
  revision_id      text,
  constraint delivery_problem_reason_valid check (reason in ('not_arrived', 'damaged', 'wrong_item', 'missing_parts', 'other')),
  constraint delivery_problem_note_valid check (length(note) between 1 and 4000),
  constraint delivery_problem_resolution_valid check (resolution is null or resolution in ('resend', 'replaced', 'other')),
  constraint delivery_problem_resolved_whole check ((resolved_at is null) = (resolution is null)),
  constraint delivery_problem_resolution_note_valid check (resolution_note is null or length(resolution_note) <= 1000),
  constraint delivery_problem_by_one check (num_nonnulls(by_profile, by_client) <= 1)
);
create unique index if not exists delivery_problem_one_open on public.delivery_problem (job_id) where resolved_at is null;
create index if not exists delivery_problem_job_idx on public.delivery_problem (job_id, created_at desc);
alter table public.delivery_problem enable row level security;
drop policy if exists "delivery_problem_select" on public.delivery_problem;
create policy "delivery_problem_select" on public.delivery_problem for select to authenticated
  using (org_id = public.my_org_id() and (public.has_perm('jobs.read') or public.has_perm('jobs.write')));
revoke all on public.delivery_problem from public, anon, authenticated;
grant select on public.delivery_problem to authenticated;

-- ── Every change of a rating, kept ──────────────────────────────────────────
create table if not exists public.job_rating_change (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.clinics(id) on delete cascade,
  rating_id    uuid not null references public.job_rating(id) on delete cascade,
  old_score    smallint,
  old_comment  text,
  new_score    smallint,
  new_comment  text,
  changed_at   timestamptz not null default now()
);
create index if not exists job_rating_change_rating_idx on public.job_rating_change (rating_id, changed_at);
alter table public.job_rating_change enable row level security;
drop policy if exists "job_rating_change_select" on public.job_rating_change;
create policy "job_rating_change_select" on public.job_rating_change for select to authenticated
  using (org_id = public.my_org_id() and public.my_role() = 'owner');
revoke all on public.job_rating_change from public, anon, authenticated;
grant select on public.job_rating_change to authenticated;

create or replace function public.job_rating_keep_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (old.score, old.comment) is distinct from (new.score, new.comment) then
    insert into public.job_rating_change (org_id, rating_id, old_score, old_comment, new_score, new_comment)
    values (new.org_id, new.id, old.score, old.comment, new.score, new.comment);
  end if;
  return new;
end;
$$;
drop trigger if exists job_rating_keep_change on public.job_rating;
create trigger job_rating_keep_change after update on public.job_rating
  for each row execute function public.job_rating_keep_change();

-- ── The order's conversation carries the delivery answers ───────────────────
alter table public.client_order_message add column if not exists delivery_state text;
alter table public.client_order_message add column if not exists delivery_reason text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'client_order_message_delivery_valid') then
    alter table public.client_order_message add constraint client_order_message_delivery_valid
      check (delivery_state is null
             or (delivery_state in ('received', 'problem') and from_client)
             or (delivery_state = 'resolved' and not from_client));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'client_order_message_delivery_reason_valid') then
    alter table public.client_order_message add constraint client_order_message_delivery_reason_valid
      check (delivery_reason is null or length(delivery_reason) <= 40);
  end if;
end $$;

-- ── Notices ─────────────────────────────────────────────────────────────────
alter table public.notification drop constraint if exists notification_kind_valid;
alter table public.notification add constraint notification_kind_valid
  check (kind in ('job_shared', 'stage_handover', 'question', 'files_added', 'stage_reached', 'assigned',
                  'mfa_removed', 'mfa_reset', 'update_installed', 'update_failed', 'update_stale',
                  'stage_progress', 'stage_assigned', 'mail_quota', 'option_assigned',
                  'client_order', 'client_request', 'client_message', 'client_review',
                  'job_adjust', 'client_fit',
                  'delivery_problem', 'problem_resolved', 'received_reminder'));

alter table public.client_notification drop constraint if exists client_notification_kind_valid;
alter table public.client_notification add constraint client_notification_kind_valid
  check (kind in ('message', 'accepted', 'rejected', 'ready', 'sent', 'connected', 'declined',
                  'received_reminder', 'problem_resolved'));

/** As in 144; the delivery answers are told once, by their own functions. */
create or replace function public.client_order_message_notices()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare o public.client_order;
begin
  select * into o from public.client_order where id = new.order_id;
  if o.id is null then return new; end if;
  if new.delivery_state is not null then return new; end if;
  if new.from_client then
    -- A review answer (client_review) or a fit answer (client_fit) is told once, by its own function.
    if new.review_state is null and new.fit_state is null then perform public.notify_order_people(o.id, 'client_message', '{}'::jsonb); end if;
  else
    perform public.notify_client(o.org_id, o.client_id, o.id, 'message');
  end if;
  return new;
end;
$$;

-- ── Helpers ─────────────────────────────────────────────────────────────────

/** The delivery times are written by this migration's functions only: within this transaction. */
create or replace function public.delivery_write_on()
returns void
language sql
volatile
set search_path = public
as $$ select set_config('wivo.delivery', 'on', true); $$;

/** The order from outside a job came from, if any. */
create or replace function public.order_of_job(p_job uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$ select id from public.client_order where job_id = p_job and status = 'accepted' limit 1 $$;

/** The clinic hears about a delivery problem on our own job: its technician, designer and the owners. */
create or replace function public.notify_job_people(p_job uuid, p_kind text, p_detail jsonb)
returns void
language sql
volatile
security definer
set search_path = public
as $$
  insert into public.notification (org_id, user_id, job_id, job_code, kind, detail)
  select j.clinic_id, p.id, j.id, j.job_code, p_kind, p_detail
    from public.jobs j
    join public.profiles p on p.clinic_id = j.clinic_id and (p.id in (j.assigned_to, j.designed_by) or p.role = 'owner')
   where j.id = p_job and p.id is distinct from auth.uid()
$$;

/** The remake reason a delivery problem becomes (the app's stored reasons): damaged → breakage, else other. */
create or replace function public.problem_remake_reason(p_reason text)
returns text
language sql
immutable
set search_path = public
as $$ select case when p_reason = 'damaged' then 'Purunemine' else 'Muu' end $$;

-- ── Our side (signed in) ────────────────────────────────────────────────────

/**
 * Received. The orderer of our own job (the doctor who ordered it, a doctor of
 * the clinic, the owner); or, with p_by_phone, anyone who edits jobs, for our
 * own job or an order from outside, as "confirmed by phone" with a note.
 */
create or replace function public.job_mark_received(p_job uuid, p_by_phone boolean, p_note text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  j public.jobs;
  v_org uuid := public.my_org_id();
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 1000), '');
  v_via text;
begin
  select * into j from public.jobs where id = p_job and clinic_id = v_org and deleted_at is null;
  if j.id is null then raise exception 'Job not found' using errcode = '42501'; end if;
  if coalesce(p_by_phone, false) then
    if not public.has_perm('jobs.write') then raise exception 'Edit jobs is needed' using errcode = '42501'; end if;
    v_via := 'phone';
  else
    if public.order_of_job(p_job) is not null then raise exception 'The client says it arrived' using errcode = '42501'; end if;
    if not public.may_judge_fit(p_job) then raise exception 'Only the doctor or the owner' using errcode = '42501'; end if;
    v_via := 'orderer';
  end if;
  if coalesce(j.delivery_status, 'labor') not in ('teel', 'yle_antud') then raise exception 'The work is not sent yet' using errcode = '22023'; end if;
  if public.job_received(p_job) then return; end if;
  perform public.delivery_write_on();
  update public.jobs set received_at = now(), received_via = v_via, received_note = v_note, updated_at = now() where id = p_job;
end;
$$;

/** Problem with delivery on our own job, by its orderer, instead of Received. Returns the problem. */
create or replace function public.job_report_problem(p_job uuid, p_reason text, p_note text)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  j public.jobs;
  v_org uuid := public.my_org_id();
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_id uuid;
begin
  select * into j from public.jobs where id = p_job and clinic_id = v_org and deleted_at is null;
  if j.id is null then raise exception 'Job not found' using errcode = '42501'; end if;
  if public.order_of_job(p_job) is not null then raise exception 'The client reports it' using errcode = '42501'; end if;
  if not public.may_judge_fit(p_job) then raise exception 'Only the doctor or the owner' using errcode = '42501'; end if;
  if coalesce(j.delivery_status, 'labor') not in ('teel', 'yle_antud') then raise exception 'The work is not sent yet' using errcode = '22023'; end if;
  if public.job_received(p_job) then raise exception 'Already received' using errcode = '22023'; end if;
  if p_reason is null or p_reason not in ('not_arrived', 'damaged', 'wrong_item', 'missing_parts', 'other') then
    raise exception 'A reason is needed' using errcode = '22023';
  end if;
  if v_note is null or length(v_note) > 4000 then raise exception 'What happened is needed' using errcode = '22023'; end if;
  if exists (select 1 from public.delivery_problem where job_id = p_job and resolved_at is null) then
    raise exception 'A problem is already open' using errcode = '22023';
  end if;
  insert into public.delivery_problem (org_id, job_id, reason, note, by_profile)
  values (v_org, p_job, p_reason, v_note, auth.uid()) returning id into v_id;
  perform public.notify_job_people(p_job, 'delivery_problem', jsonb_build_object('reason', p_reason, 'problem', v_id));
  return v_id;
end;
$$;

/**
 * The clinic resolves a delivery problem: resend, replaced or other (a note
 * for other). For damaged work or a wrong item it may add a remake. The
 * client is told in the conversation and with a notice; on our own job, the
 * one who reported it. Returns the remake's id or null.
 */
create or replace function public.job_resolve_problem(p_problem uuid, p_resolution text, p_note text, p_remake boolean)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  p public.delivery_problem;
  o public.client_order;
  v_org uuid := public.my_org_id();
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 1000), '');
  v_rev text;
begin
  if not public.has_perm('jobs.write') then raise exception 'Edit jobs is needed' using errcode = '42501'; end if;
  select * into p from public.delivery_problem where id = p_problem and org_id = v_org and resolved_at is null;
  if p.id is null then raise exception 'Problem not found' using errcode = '42501'; end if;
  if p_resolution is null or p_resolution not in ('resend', 'replaced', 'other') then raise exception 'How it was resolved' using errcode = '22023'; end if;
  if p_resolution = 'other' and v_note is null then raise exception 'A note is needed' using errcode = '22023'; end if;
  if coalesce(p_remake, false) then
    if p.reason not in ('damaged', 'wrong_item') then raise exception 'A remake only for damaged work or a wrong item' using errcode = '22023'; end if;
    v_rev := public.add_adjust_revision(p.job_id, public.problem_remake_reason(p.reason), left(coalesce(v_note, p.note), 4000));
  end if;
  update public.delivery_problem
     set resolved_at = now(), resolution = p_resolution, resolution_note = v_note, resolved_by = auth.uid(), revision_id = v_rev
   where id = p.id;
  if p.order_id is not null then
    select * into o from public.client_order where id = p.order_id;
    if o.id is not null then
      insert into public.client_order_message (org_id, order_id, from_client, author_id, body, delivery_state, delivery_reason)
      values (v_org, o.id, false, auth.uid(), coalesce(v_note, '✓'), 'resolved', p_resolution);
      perform public.notify_client(o.org_id, o.client_id, o.id, 'problem_resolved');
    end if;
  elsif p.by_profile is not null and p.by_profile is distinct from auth.uid() then
    insert into public.notification (org_id, user_id, job_id, job_code, kind, detail)
    select j.clinic_id, p.by_profile, j.id, j.job_code, 'problem_resolved', jsonb_build_object('resolution', p_resolution)
      from public.jobs j where j.id = p.job_id;
  end if;
  return v_rev;
end;
$$;

-- ── The reminder ────────────────────────────────────────────────────────────

/** The clinic's days before "Did your order arrive?": features.received_reminder_days, 1–60, 3 by default. */
create or replace function public.received_reminder_days(p_org uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select greatest(1, least(60, coalesce(
    (select case when features->>'received_reminder_days' ~ '^\d{1,3}$' then (features->>'received_reminder_days')::int end
       from public.clinic_settings where clinic_id = p_org), 3)))
$$;

/**
 * Sent some days ago, not received, no open problem, not reminded yet: the
 * Network client gets "Did your order arrive?"; on our own job, the doctor
 * who ordered it. Once per sending. Returns how many were reminded.
 */
create or replace function public.delivery_reminders()
returns int
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  j record;
  o public.client_order;
  n int := 0;
begin
  perform public.delivery_write_on();
  for j in
    select jj.id, jj.clinic_id, jj.job_code, jj.order_doctor
      from public.jobs jj
     where jj.sent_at is not null and jj.received_at is null and jj.received_reminded_at is null
       and jj.deleted_at is null and coalesce(jj.delivery_status, 'labor') in ('teel', 'yle_antud')
       and jj.sent_at < now() - make_interval(days => public.received_reminder_days(jj.clinic_id))
       and not exists (select 1 from public.delivery_problem p where p.job_id = jj.id and p.resolved_at is null)
     for update of jj skip locked
  loop
    select * into o from public.client_order where job_id = j.id and status = 'accepted' limit 1;
    if o.id is not null then
      perform public.notify_client(o.org_id, o.client_id, o.id, 'received_reminder');
    elsif j.order_doctor is not null then
      insert into public.notification (org_id, user_id, job_id, job_code, kind, detail)
      values (j.clinic_id, j.order_doctor, j.id, j.job_code, 'received_reminder', '{}'::jsonb);
    end if;
    update public.jobs set received_reminded_at = now() where id = j.id;
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- ── Feedback after Received (as 144, with Received instead of "done") ───────

create or replace function public.job_fit_decide(p_job uuid, p_decision text, p_reason text, p_note text)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid := public.my_org_id();
  v_rev text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not public.ratings_on(v_org) then raise exception 'Feedback is not on for this clinic' using errcode = '42501'; end if;
  if not public.may_judge_fit(p_job) then raise exception 'Only the doctor or the owner' using errcode = '42501'; end if;
  if not public.job_received(p_job) then raise exception 'Not received yet' using errcode = '22023'; end if;
  if p_decision not in ('fitted', 'adjust') then raise exception 'Fitted or needs adjustment' using errcode = '22023'; end if;
  if p_decision = 'adjust' and (v_reason is null or v_note is null) then
    raise exception 'A reason and what to change are needed' using errcode = '22023';
  end if;
  if p_decision = 'fitted' then
    update public.jobs set fitted_at = now(), updated_at = now() where id = p_job;
  else
    v_rev := public.add_adjust_revision(p_job, v_reason, v_note);
    perform public.notify_job_makers(p_job, 'job_adjust', jsonb_build_object('reason', v_reason));
  end if;
  insert into public.job_fit (org_id, job_id, decision, reason, note, revision_id, by_profile)
  values (v_org, p_job, p_decision, v_reason, v_note, v_rev, auth.uid());
  return v_rev;
end;
$$;

create or replace function public.rate_job(p_job uuid, p_direction text, p_score int, p_comment text)
returns int
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  j public.jobs;
  v_org uuid := public.my_org_id();
  v_comment text := nullif(left(btrim(coalesce(p_comment, '')), 1000), '');
  v_ratee uuid;
  n int := 0;
begin
  if not public.ratings_on(v_org) then raise exception 'Feedback is not on for this clinic' using errcode = '42501'; end if;
  select * into j from public.jobs where id = p_job and clinic_id = v_org;
  if j.id is null then raise exception 'Job not found' using errcode = '42501'; end if;
  if not public.job_received(p_job) then raise exception 'Not received yet' using errcode = '22023'; end if;
  if p_score is null or p_score not between 1 and 5 then raise exception 'A score from 1 to 5' using errcode = '22023'; end if;
  if p_direction = 'work' then
    if not public.may_judge_fit(p_job) then raise exception 'Only the doctor' using errcode = '42501'; end if;
    for v_ratee in select distinct x from unnest(array[j.assigned_to, j.designed_by]) x where x is not null and x <> auth.uid() loop
      insert into public.job_rating (org_id, job_id, direction, rater_profile, ratee_profile, score, comment)
      values (v_org, p_job, 'work', auth.uid(), v_ratee, p_score, v_comment)
      on conflict (job_id, direction, coalesce(rater_profile, rater_client), coalesce(ratee_profile, ratee_client, org_id))
      do update set score = excluded.score, comment = excluded.comment, updated_at = now();
      n := n + 1;
    end loop;
  elsif p_direction = 'input' then
    if auth.uid() is distinct from j.assigned_to and auth.uid() is distinct from j.designed_by then
      raise exception 'Only the technician or the designer' using errcode = '42501';
    end if;
    if j.order_doctor is null or j.order_doctor = auth.uid() then raise exception 'No doctor to rate' using errcode = '22023'; end if;
    insert into public.job_rating (org_id, job_id, direction, rater_profile, ratee_profile, score, comment)
    values (v_org, p_job, 'input', auth.uid(), j.order_doctor, p_score, v_comment)
    on conflict (job_id, direction, coalesce(rater_profile, rater_client), coalesce(ratee_profile, ratee_client, org_id))
    do update set score = excluded.score, comment = excluded.comment, updated_at = now();
    n := 1;
  else
    raise exception 'Work or input' using errcode = '22023';
  end if;
  return n;
end;
$$;

create or replace function public.rate_client(p_order uuid, p_score int, p_comment text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare o public.client_order; v_org uuid := public.my_org_id();
begin
  if not public.ratings_on(v_org) then raise exception 'Feedback is not on for this clinic' using errcode = '42501'; end if;
  if not public.has_perm('jobs.write') then raise exception 'Edit jobs is needed' using errcode = '42501'; end if;
  select * into o from public.client_order where id = p_order and org_id = v_org and status = 'accepted';
  if o.id is null then raise exception 'Order not found' using errcode = '42501'; end if;
  if not public.job_received(o.job_id) then raise exception 'Not received yet' using errcode = '22023'; end if;
  if p_score is null or p_score not between 1 and 5 then raise exception 'A score from 1 to 5' using errcode = '22023'; end if;
  insert into public.job_rating (org_id, job_id, direction, rater_profile, ratee_client, score, comment)
  values (v_org, o.job_id, 'clinic_to_client', auth.uid(), o.client_id, p_score, nullif(left(btrim(coalesce(p_comment, '')), 1000), ''))
  on conflict (job_id, direction, coalesce(rater_profile, rater_client), coalesce(ratee_profile, ratee_client, org_id))
  do update set score = excluded.score, comment = excluded.comment, updated_at = now();
end;
$$;

-- ── The client's side (service role, network-client) ────────────────────────

/** An order's status as the client sees it (as 138), with Received and Problem after Sent. */
create or replace function public.client_order_status(o public.client_order, p_show boolean)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when o.status = 'rejected' then 'rejected'
    when o.status = 'received' then 'received'
    when not p_show then 'in_progress'
    when j.id is null then 'in_progress'
    when j.delivery_status in ('teel', 'yle_antud') then
      case when exists (select 1 from public.delivery_problem p where p.job_id = j.id and p.resolved_at is null) then 'problem'
           when j.received_at is not null or j.sent_at is null then 'arrived'
           else 'sent' end
    when j.status = (public.stage_order(o.org_id))[array_length(public.stage_order(o.org_id), 1)] then 'ready'
    else 'in_progress' end
    from (select 1) one
    left join public.jobs j on j.id = o.job_id and j.deleted_at is null
$$;

/** The client's own accepted order whose work is sent. */
create or replace function public.client_sent_order(c public.network_client, p_order uuid)
returns public.client_order
language plpgsql
stable
security definer
set search_path = public
as $$
declare o public.client_order;
begin
  select * into o from public.client_order where id = p_order and client_id = c.id and org_id = c.org_id and status = 'accepted';
  if o.id is null or o.job_id is null then raise exception 'Order not found' using errcode = '42501'; end if;
  if not exists (select 1 from public.jobs where id = o.job_id and deleted_at is null and delivery_status in ('teel', 'yle_antud')) then
    raise exception 'The work is not sent yet' using errcode = '22023';
  end if;
  return o;
end;
$$;

/** The client says the order arrived: received now, and a line in the conversation. */
create or replace function public.client_received(p_session text, p_order uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  c public.network_client := public.network_session_client(p_session);
  o public.client_order := public.client_sent_order(c, p_order);
begin
  if public.job_received(o.job_id) then return; end if;
  perform public.delivery_write_on();
  update public.jobs set received_at = now(), received_via = 'client', updated_at = now() where id = o.job_id;
  insert into public.client_order_message (org_id, order_id, from_client, body, delivery_state)
  values (c.org_id, o.id, true, '✓', 'received');
end;
$$;

/**
 * The client reports a problem with the delivery, instead of Received: a
 * reason and a text, as a message on the order (its photos go with it), and
 * one bell for the clinic. Returns the message, for the photos.
 */
create or replace function public.client_report_problem(p_session text, p_order uuid, p_reason text, p_note text)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  c public.network_client := public.network_session_client(p_session);
  o public.client_order := public.client_sent_order(c, p_order);
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_msg uuid;
  v_id uuid;
begin
  if public.job_received(o.job_id) then raise exception 'Already received' using errcode = '22023'; end if;
  if p_reason is null or p_reason not in ('not_arrived', 'damaged', 'wrong_item', 'missing_parts', 'other') then
    raise exception 'A reason is needed' using errcode = '22023';
  end if;
  if v_note is null or length(v_note) > 4000 then raise exception 'What happened is needed' using errcode = '22023'; end if;
  if exists (select 1 from public.delivery_problem where job_id = o.job_id and resolved_at is null) then
    raise exception 'A problem is already open' using errcode = '22023';
  end if;
  insert into public.client_order_message (org_id, order_id, from_client, body, delivery_state, delivery_reason)
  values (c.org_id, o.id, true, v_note, 'problem', p_reason) returning id into v_msg;
  insert into public.delivery_problem (org_id, job_id, order_id, reason, note, by_client, message_id)
  values (c.org_id, o.job_id, o.id, p_reason, v_note, c.id, v_msg) returning id into v_id;
  perform public.notify_order_people(o.id, 'delivery_problem', jsonb_build_object('reason', p_reason, 'problem', v_id));
  return v_msg;
end;
$$;

/** As in 144: the latest fit answer and the rating need Received now. */
create or replace function public.client_fit(p_session text, p_order uuid, p_decision text, p_reason text, p_note text)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  c public.network_client := public.network_session_client(p_session);
  o public.client_order;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_rev text;
  v_msg uuid;
begin
  if not public.ratings_on(c.org_id) then raise exception 'Feedback is not on for this clinic' using errcode = '42501'; end if;
  o := public.client_sent_order(c, p_order);
  if not public.job_received(o.job_id) then raise exception 'Not received yet' using errcode = '22023'; end if;
  if p_decision not in ('fitted', 'adjust') then raise exception 'Fitted or needs adjustment' using errcode = '22023'; end if;
  if p_decision = 'adjust' and (v_reason is null or v_note is null) then
    raise exception 'A reason and what to change are needed' using errcode = '22023';
  end if;
  if length(coalesce(v_note, '')) > 4000 or length(coalesce(v_reason, '')) > 80 then raise exception 'Too long' using errcode = '22023'; end if;
  if p_decision = 'fitted' then
    update public.jobs set fitted_at = now(), updated_at = now() where id = o.job_id;
  else
    v_rev := public.add_adjust_revision(o.job_id, v_reason, v_note);
    perform public.notify_job_makers(o.job_id, 'job_adjust', jsonb_build_object('reason', v_reason));
  end if;
  insert into public.job_fit (org_id, job_id, decision, reason, note, revision_id, by_client)
  values (c.org_id, o.job_id, p_decision, v_reason, v_note, v_rev, c.id);
  insert into public.client_order_message (org_id, order_id, from_client, body, fit_state)
  values (c.org_id, o.id, true, coalesce(case when v_reason is not null then v_reason || ': ' || v_note else v_note end, '✓'), p_decision)
  returning id into v_msg;
  perform public.notify_order_people(o.id, 'client_fit', jsonb_build_object('decision', p_decision));
  return v_msg;
end;
$$;

create or replace function public.client_rate_clinic(p_session text, p_order uuid, p_score int, p_comment text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  c public.network_client := public.network_session_client(p_session);
  o public.client_order;
begin
  if not public.ratings_on(c.org_id) then raise exception 'Feedback is not on for this clinic' using errcode = '42501'; end if;
  o := public.client_sent_order(c, p_order);
  if not public.job_received(o.job_id) then raise exception 'Not received yet' using errcode = '22023'; end if;
  if p_score is null or p_score not between 1 and 5 then raise exception 'A score from 1 to 5' using errcode = '22023'; end if;
  insert into public.job_rating (org_id, job_id, direction, rater_client, score, comment)
  values (c.org_id, o.job_id, 'client_to_clinic', c.id, p_score, nullif(left(btrim(coalesce(p_comment, '')), 1000), ''))
  on conflict (job_id, direction, coalesce(rater_profile, rater_client), coalesce(ratee_profile, ratee_client, org_id))
  do update set score = excluded.score, comment = excluded.comment, updated_at = now();
end;
$$;

/** What the client already said on this order (as 144), with when it arrived and the delivery problem. */
create or replace function public.client_feedback(p_session text, p_order uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c public.network_client := public.network_session_client(p_session);
  o public.client_order;
begin
  select * into o from public.client_order where id = p_order and client_id = c.id and org_id = c.org_id;
  if o.id is null then raise exception 'Order not found' using errcode = '42501'; end if;
  return jsonb_build_object(
    'enabled', public.ratings_on(c.org_id),
    'received', public.job_received(o.job_id),
    'received_at', (select received_at from public.jobs where id = o.job_id),
    'problem', (select jsonb_build_object('reason', p.reason, 'created_at', p.created_at, 'resolved_at', p.resolved_at, 'resolution', p.resolution)
                  from public.delivery_problem p where p.job_id = o.job_id order by p.created_at desc limit 1),
    'fit', (select jsonb_build_object('decision', f.decision, 'reason', f.reason, 'created_at', f.created_at)
              from public.job_fit f where f.job_id = o.job_id and f.by_client = c.id order by f.created_at desc limit 1),
    'rating', (select jsonb_build_object('score', r.score, 'comment', r.comment, 'created_at', r.created_at, 'updated_at', r.updated_at)
                 from public.job_rating r where r.job_id = o.job_id and r.direction = 'client_to_clinic' and r.rater_client = c.id limit 1));
end;
$$;

/** As in 143, with the fit and delivery answers on each message. */
create or replace function public.client_order_detail(p_session text, p_order uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c public.network_client := public.network_session_client(p_session);
  o public.client_order;
begin
  select * into o from public.client_order where id = p_order and client_id = c.id and org_id = c.org_id;
  if o.id is null then raise exception 'Order not found' using errcode = '42501'; end if;
  return jsonb_build_object(
    'id', o.id, 'created_at', o.created_at, 'payload', o.payload,
    'status', public.client_order_status(o, coalesce((c.can_see->>'status')::boolean, true)),
    'reject_reason', o.reject_reason,
    'messages', case when coalesce((c.can_see->>'messages')::boolean, true) then coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'from_client', m.from_client, 'body', m.body, 'created_at', m.created_at,
                                          'needs_review', m.needs_review, 'review_of', m.review_of, 'review_state', m.review_state,
                                          'fit_state', m.fit_state, 'delivery_state', m.delivery_state, 'delivery_reason', m.delivery_reason)
                       order by m.created_at)
        from public.client_order_message m where m.order_id = o.id), '[]'::jsonb) end,
    'files', case when coalesce((c.can_see->>'files')::boolean, true) then coalesce((
      select jsonb_agg(jsonb_build_object('id', f.id, 'file_name', f.file_name, 'size', f.size, 'created_at', f.created_at,
                                          'message_id', f.message_id, 'from_client', f.from_client, 'mime_type', f.mime_type) order by f.created_at)
        from public.client_order_file f where f.order_id = o.id and f.completed_at is not null), '[]'::jsonb) end);
end;
$$;

-- ── What an edit of the new job columns records (sql/114) ───────────────────
-- The same function as sql/144, with the delivery times. auditEdits.test.ts fails for a jobs column without a rule.
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
    -- jobs: fitted, as the doctor or the client said it (sql/144)
    ('jobs', 'fitted_at', 'value'),
    -- jobs: when it left and arrived (sql/145); the note is typed by hand
    ('jobs', 'sent_at', 'skip'), ('jobs', 'received_reminded_at', 'skip'),
    ('jobs', 'received_at', 'value'), ('jobs', 'received_via', 'value'), ('jobs', 'received_note', 'changed'),

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

-- ── Who may run what ────────────────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'public.jobs_delivery_guard()', 'public.job_received(uuid)', 'public.job_rating_keep_change()',
    'public.delivery_write_on()', 'public.order_of_job(uuid)', 'public.notify_job_people(uuid, text, jsonb)',
    'public.problem_remake_reason(text)', 'public.received_reminder_days(uuid)', 'public.delivery_reminders()',
    'public.client_sent_order(public.network_client, uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'public.client_received(text, uuid)', 'public.client_report_problem(text, uuid, text, text)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array[
    'public.job_mark_received(uuid, boolean, text)', 'public.job_report_problem(uuid, text, text)',
    'public.job_resolve_problem(uuid, text, text, boolean)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ── Every hour: the reminders (pg_cron, where the project has it) ───────────
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    execute $c$select cron.unschedule('wivo-delivery-reminders') where exists (select 1 from cron.job where jobname = 'wivo-delivery-reminders')$c$;
    execute $c$select cron.schedule('wivo-delivery-reminders', '23 * * * *', 'select public.delivery_reminders();')$c$;
  end if;
end $$;

-- ── Realtime: a delivery problem shows at once on the Orders page and the job ─
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'delivery_problem') then
    alter publication supabase_realtime add table public.delivery_problem;
  end if;
end $$;

select public.ensure_mfa_policies();
select public.lock_anon_functions();

-- ─── Verify (read only) ─────────────────────────────────────────────────────
-- select tablename, rowsecurity from pg_tables where tablename in ('delivery_problem', 'job_rating_change');   -> two rows, true
-- select jobname, schedule from cron.job where jobname = 'wivo-delivery-reminders';   -> one row, 23 * * * *
-- select has_function_privilege('authenticated', 'public.client_received(text, uuid)', 'execute');   -> false
-- Afterwards, in SQL Editor on its own: notify pgrst, 'reload schema';
