-- ============================================================================
-- 144: feedback after the work is done — "Fitted" / "Needs adjustment", and ratings
-- ============================================================================
--
-- Module `ratings` (docs/MODULES-AND-RATINGS.md, part 2). On only where the
-- clinic's licence has the module: the owner's Wivo writes
-- clinic_settings.features.ratings from the licence, and every function here
-- asks ratings_on() first.
--
-- 1. Fitted / Needs adjustment, once the work is at its last stage or sent:
--    - our own job: the doctor who ordered it (jobs.order_doctor), a doctor of
--      the clinic, or the owner (job_fit_decide);
--    - an order from outside: the client, once the job is sent (client_fit).
--    "Fitted" marks the job fitted (jobs.fitted_at: the job card's tick).
--    "Needs adjustment" needs a reason (one of the remake reasons) and a
--    text; it adds a revision to the job exactly as a remake is kept
--    (jobs.revisions), clears the tick, and tells the job's technician and
--    designer (job_adjust). A client's answer is also a message on the order
--    (fit_state), so it is in the conversation, with photos if it sends them,
--    and rings the clinic's bell once (client_fit).
--
-- 2. Ratings, 1–5 with an optional comment (job_rating):
--    work             the doctor → the job's technician and designer
--    input            the technician or designer → the doctor (the scan, the information)
--    client_to_clinic the Network client → this clinic, for one order
--    clinic_to_client this clinic → the Network client (the input it sent)
--    Nobody rates themselves. A person sees their own average and the
--    comments, never who gave them or for which job (my_rating_summary);
--    people do not see each other's ratings; the owner sees everything.
--    Ratings stay in this database. `published` is for Network 2 (a clinic
--    choosing what reaches a client's shared profile): nothing reads it yet.

set lock_timeout = '10s';

-- ── On / off ────────────────────────────────────────────────────────────────
/** The clinic's licence has `ratings` (written by the owner's Wivo into clinic_settings.features). */
create or replace function public.ratings_on(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select (features->>'ratings')::boolean from public.clinic_settings where clinic_id = p_org), false)
$$;

-- ── The job's tick ──────────────────────────────────────────────────────────
alter table public.jobs add column if not exists fitted_at timestamptz;

-- ── Fitted / Needs adjustment ───────────────────────────────────────────────
create table if not exists public.job_fit (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.clinics(id) on delete cascade,
  job_id       uuid not null references public.jobs(id) on delete cascade,
  decision     text not null,
  reason       text,
  note         text,
  revision_id  text,
  by_profile   uuid references public.profiles(id) on delete set null,
  by_client    uuid,
  created_at   timestamptz not null default now(),
  constraint job_fit_decision_valid check (decision in ('fitted', 'adjust')),
  constraint job_fit_adjust_has_reason check (decision = 'fitted' or (reason is not null and note is not null)),
  constraint job_fit_reason_valid check (reason is null or length(reason) <= 80),
  constraint job_fit_note_valid check (note is null or length(note) <= 4000),
  constraint job_fit_by_one check (num_nonnulls(by_profile, by_client) <= 1)
);
create index if not exists job_fit_job_idx on public.job_fit (job_id, created_at desc);
alter table public.job_fit enable row level security;
drop policy if exists "job_fit_select" on public.job_fit;
create policy "job_fit_select" on public.job_fit for select to authenticated
  using (org_id = public.my_org_id() and (public.has_perm('jobs.read') or public.has_perm('jobs.write')));
revoke all on public.job_fit from public, anon, authenticated;
grant select on public.job_fit to authenticated;

-- ── Ratings ─────────────────────────────────────────────────────────────────
create table if not exists public.job_rating (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.clinics(id) on delete cascade,
  job_id         uuid references public.jobs(id) on delete cascade,
  direction      text not null,
  rater_profile  uuid references public.profiles(id) on delete cascade,
  rater_client   uuid,
  ratee_profile  uuid references public.profiles(id) on delete cascade,
  ratee_client   uuid,
  score          smallint not null,
  comment        text,
  -- Network 2: what the clinic chooses to show on a client's shared profile. Nothing reads it yet.
  published      boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint job_rating_direction_valid check (direction in ('work', 'input', 'client_to_clinic', 'clinic_to_client')),
  constraint job_rating_score_valid check (score between 1 and 5),
  constraint job_rating_comment_valid check (comment is null or length(comment) <= 1000),
  constraint job_rating_not_self check (rater_profile is null or rater_profile is distinct from ratee_profile)
);
create unique index if not exists job_rating_once on public.job_rating
  (job_id, direction, coalesce(rater_profile, rater_client), coalesce(ratee_profile, ratee_client, org_id));
create index if not exists job_rating_ratee_idx on public.job_rating (ratee_profile) where ratee_profile is not null;
alter table public.job_rating enable row level security;
-- The owner sees everything; a person the ratings they gave (to change them). Nobody else reads the table.
drop policy if exists "job_rating_select" on public.job_rating;
create policy "job_rating_select" on public.job_rating for select to authenticated
  using (org_id = public.my_org_id() and (public.my_role() = 'owner' or rater_profile = auth.uid()));
revoke all on public.job_rating from public, anon, authenticated;
grant select on public.job_rating to authenticated;

-- ── Helpers ─────────────────────────────────────────────────────────────────

/** The work is done: at the clinic's last stage, or on its way / handed over. */
create or replace function public.job_is_done(p_job uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select j.status = (public.stage_order(j.clinic_id))[array_length(public.stage_order(j.clinic_id), 1)]
                          or j.delivery_status in ('teel', 'yle_antud')
                     from public.jobs j where j.id = p_job), false)
$$;

/** May the signed-in person say how our job fitted: the doctor who ordered it, a doctor of the clinic, or the owner. */
create or replace function public.may_judge_fit(p_job uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.jobs j join public.profiles p on p.id = auth.uid()
     where j.id = p_job and j.clinic_id = public.my_org_id() and p.clinic_id = j.clinic_id
       and (j.order_doctor = auth.uid() or p.role = 'owner' or p.org_role = 'doctor'))
$$;

/**
 * A remake on the job, kept as every remake is (jobs.revisions): its reason
 * (one of the remake reasons the app knows), the text, the first stage.
 * The tick goes. Returns the revision's id.
 */
create or replace function public.add_adjust_revision(p_job uuid, p_reason text, p_note text)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_id text := gen_random_uuid()::text;
  v_org uuid;
begin
  select clinic_id into v_org from public.jobs where id = p_job;
  update public.jobs
     set revisions = coalesce(revisions, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
           'id', v_id,
           'ts', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
           'note', p_note,
           'reasons', jsonb_build_array(p_reason),
           'status', (public.stage_order(v_org))[1])),
         fitted_at = null,
         updated_at = now()
   where id = p_job;
  return v_id;
end;
$$;

/** The job's technician and designer hear that it needs adjustment. */
create or replace function public.notify_job_makers(p_job uuid, p_kind text, p_detail jsonb)
returns void
language sql
volatile
security definer
set search_path = public
as $$
  insert into public.notification (org_id, user_id, job_id, job_code, kind, detail)
  select j.clinic_id, p.id, j.id, j.job_code, p_kind, p_detail
    from public.jobs j
    join public.profiles p on p.clinic_id = j.clinic_id and p.id in (j.assigned_to, j.designed_by)
   where j.id = p_job and p.id is distinct from auth.uid()
$$;

-- ── Our own jobs (signed in) ────────────────────────────────────────────────

/** Fitted, or Needs adjustment with a reason and a text (a revision is made). Returns the revision id or null. */
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
  if not public.job_is_done(p_job) then raise exception 'The work is not done yet' using errcode = '22023'; end if;
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

/**
 * Rate a job, 1–5 with an optional comment: 'work' (the doctor → the
 * technician and the designer, one row each) or 'input' (the technician or
 * designer → the doctor). Done work only; nobody rates themselves.
 */
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
  if not public.job_is_done(p_job) then raise exception 'The work is not done yet' using errcode = '22023'; end if;
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

/** The signed-in person's own ratings: the average, how many, and the comments by month. Never who, never which job. */
create or replace function public.my_rating_summary()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'count', count(*),
    'average', round(avg(r.score)::numeric, 2),
    'comments', coalesce(jsonb_agg(jsonb_build_object('score', r.score, 'comment', r.comment, 'month', to_char(r.created_at, 'YYYY-MM'))
                                   order by r.created_at desc) filter (where r.comment is not null), '[]'::jsonb))
    from public.job_rating r
   where r.ratee_profile = auth.uid() and r.org_id = public.my_org_id() and public.ratings_on(r.org_id)
$$;

/** The clinic rates a Network client's input on one accepted order. */
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
  if p_score is null or p_score not between 1 and 5 then raise exception 'A score from 1 to 5' using errcode = '22023'; end if;
  insert into public.job_rating (org_id, job_id, direction, rater_profile, ratee_client, score, comment)
  values (v_org, o.job_id, 'clinic_to_client', auth.uid(), o.client_id, p_score, nullif(left(btrim(coalesce(p_comment, '')), 1000), ''))
  on conflict (job_id, direction, coalesce(rater_profile, rater_client), coalesce(ratee_profile, ratee_client, org_id))
  do update set score = excluded.score, comment = excluded.comment, updated_at = now();
end;
$$;

/** For the owner: each Network client's average (the clinic's ratings of its input) and how many adjustments it asked for. */
create or replace function public.client_feedback_summary()
returns table (client_id uuid, average numeric, ratings int, adjustments int)
language sql
stable
security definer
set search_path = public
as $$
  select c.id,
         (select round(avg(r.score)::numeric, 2) from public.job_rating r where r.ratee_client = c.id and r.direction = 'clinic_to_client'),
         (select count(*)::int from public.job_rating r where r.ratee_client = c.id and r.direction = 'clinic_to_client'),
         (select count(*)::int from public.job_fit f where f.by_client = c.id and f.decision = 'adjust')
    from public.network_client c
   where c.org_id = public.my_org_id() and public.my_role() = 'owner' and public.ratings_on(c.org_id)
$$;

-- ── The client's side (service role, network-client) ────────────────────────
alter table public.client_order_message add column if not exists fit_state text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'client_order_message_fit_valid') then
    alter table public.client_order_message add constraint client_order_message_fit_valid
      check (fit_state is null or (fit_state in ('fitted', 'adjust') and from_client));
  end if;
end $$;

/**
 * The client says how the sent work fitted. Fitted ticks the job; Needs
 * adjustment (a reason and a text) adds a revision. Either way a message on
 * the order (its photos go with it) and one bell for the clinic. Returns the
 * message, for the photos.
 */
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
  select * into o from public.client_order where id = p_order and client_id = c.id and org_id = c.org_id and status = 'accepted';
  if o.id is null or o.job_id is null then raise exception 'Order not found' using errcode = '42501'; end if;
  if not exists (select 1 from public.jobs where id = o.job_id and delivery_status in ('teel', 'yle_antud')) then
    raise exception 'The work is not sent yet' using errcode = '22023';
  end if;
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

/** The client rates this clinic for one of its accepted orders, 1–5 with an optional comment. */
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
  select * into o from public.client_order where id = p_order and client_id = c.id and org_id = c.org_id and status = 'accepted';
  if o.id is null then raise exception 'Order not found' using errcode = '42501'; end if;
  if p_score is null or p_score not between 1 and 5 then raise exception 'A score from 1 to 5' using errcode = '22023'; end if;
  insert into public.job_rating (org_id, job_id, direction, rater_client, score, comment)
  values (c.org_id, o.job_id, 'client_to_clinic', c.id, p_score, nullif(left(btrim(coalesce(p_comment, '')), 1000), ''))
  on conflict (job_id, direction, coalesce(rater_profile, rater_client), coalesce(ratee_profile, ratee_client, org_id))
  do update set score = excluded.score, comment = excluded.comment, updated_at = now();
end;
$$;

/** What the client already said on this order: on or not, the latest fit answer, its rating of the clinic. */
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
    'fit', (select jsonb_build_object('decision', f.decision, 'reason', f.reason, 'created_at', f.created_at)
              from public.job_fit f where f.job_id = o.job_id and f.by_client = c.id order by f.created_at desc limit 1),
    'rating', (select jsonb_build_object('score', r.score, 'comment', r.comment)
                 from public.job_rating r where r.job_id = o.job_id and r.direction = 'client_to_clinic' and r.rater_client = c.id limit 1));
end;
$$;

-- ── The clinic's bell ───────────────────────────────────────────────────────
alter table public.notification drop constraint if exists notification_kind_valid;
alter table public.notification add constraint notification_kind_valid
  check (kind in ('job_shared', 'stage_handover', 'question', 'files_added', 'stage_reached', 'assigned',
                  'mfa_removed', 'mfa_reset', 'update_installed', 'update_failed', 'update_stale',
                  'stage_progress', 'stage_assigned', 'mail_quota', 'option_assigned',
                  'client_order', 'client_request', 'client_message', 'client_review',
                  'job_adjust', 'client_fit'));

/** As in 143; a client's fit answer is told once too, as client_fit. */
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
  if new.from_client then
    -- A review answer rings as client_review (client_review() does it), not as a second notice.
    -- A review answer (client_review) or a fit answer (client_fit) is told once, by its own function.
    if new.review_state is null and new.fit_state is null then perform public.notify_order_people(o.id, 'client_message', '{}'::jsonb); end if;
  else
    perform public.notify_client(o.org_id, o.client_id, o.id, 'message');
  end if;
  return new;
end;
$$;

-- ── What an edit of the new job column records (sql/114) ────────────────────
-- The same function as sql/128, with jobs.fitted_at. auditEdits.test.ts fails for a jobs column without a rule.
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
    'public.ratings_on(uuid)', 'public.job_is_done(uuid)', 'public.may_judge_fit(uuid)',
    'public.add_adjust_revision(uuid, text, text)', 'public.notify_job_makers(uuid, text, jsonb)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'public.client_fit(text, uuid, text, text, text)', 'public.client_rate_clinic(text, uuid, int, text)', 'public.client_feedback(text, uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array[
    'public.job_fit_decide(uuid, text, text, text)', 'public.rate_job(uuid, text, int, text)', 'public.my_rating_summary()',
    'public.rate_client(uuid, int, text)', 'public.client_feedback_summary()'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

select public.ensure_mfa_policies();
select public.lock_anon_functions();

-- ─── Verify (read only) ─────────────────────────────────────────────────────
-- select tablename, rowsecurity from pg_tables where tablename in ('job_fit', 'job_rating');   -> two rows, true
-- select has_function_privilege('authenticated', 'public.client_fit(text, uuid, text, text, text)', 'execute');  -> false
-- Afterwards, in SQL Editor on its own: notify pgrst, 'reload schema';
