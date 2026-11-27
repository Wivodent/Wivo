-- ============================================================================
-- 146: deleting a job safely, and one rating per rater, ratee and job
-- ============================================================================
--
-- Run AFTER 145.
--
-- 1. Ratings (module `ratings`, sql/144–145): one row per rater, ratee and
--    job (job_rating_one, a unique index); saving again changes that row (the
--    change is kept in job_rating_change, sql/145) and never adds one, so the
--    averages, counted from the rows, do not move by saving twice. An
--    unchanged save changes nothing at all. Only someone on the work rates it,
--    and only after Received:
--      work              the doctor who ordered the job (or the owner, for our
--                        own job with no doctor on it)
--      input             the job's technician or designer
--      clinic_to_client  the job's technician, designer, or the owner
--      client_to_clinic  the client of the order
--    Fitted / Needs adjustment on an order from outside is the client's.
--
-- 2. Deleting a job (still the bin of sql/089: the job is kept and can be
--    restored):
--    - job_delete_check: what the job is tied to (the order it came from,
--      invoice lines, payments, pay lines, files), for the confirmation;
--    - a job with an invoice line, a payment or a pay line cannot be deleted;
--    - a job from a Network order is deleted only through delete_job, with
--      its code typed and a reason: the order becomes "Cancelled by clinic"
--      (client_order.cancelled_at) and the client is told, with the reason.
--      Restoring the job takes the order back to where it was and tells the
--      client;
--    - purge_job: the owner deletes a job in the bin for good (not one with
--      files: stored files are never deleted for good, sql/089);
--    - deleted_jobs also says which client's order a job came from;
--    - the audit log has delete, restore and purge (who, when, which job).
--    Orders whose job was deleted before this migration are marked cancelled
--    now, without a notice.

set lock_timeout = '10s';

-- ── 1. One rating per rater, ratee and job ──────────────────────────────────
delete from public.job_rating r
 using public.job_rating k
 where r.job_id = k.job_id
   and coalesce(r.rater_profile, r.rater_client) = coalesce(k.rater_profile, k.rater_client)
   and coalesce(r.ratee_profile, r.ratee_client, r.org_id) = coalesce(k.ratee_profile, k.ratee_client, k.org_id)
   and (r.updated_at, r.id) < (k.updated_at, k.id);
drop index if exists public.job_rating_once;
create unique index if not exists job_rating_one on public.job_rating
  (job_id, coalesce(rater_profile, rater_client), coalesce(ratee_profile, ratee_client, org_id));

/** As in 145; an order from outside: the client says how it fitted. */
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
  if public.order_of_job(p_job) is not null then raise exception 'The client says how it fitted' using errcode = '42501'; end if;
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

/**
 * One rating, saved: a new row, or the same row changed (never a second one).
 * An unchanged save touches nothing.
 */
create or replace function public.save_rating(p_org uuid, p_job uuid, p_direction text, p_rater_profile uuid, p_rater_client uuid,
                                              p_ratee_profile uuid, p_ratee_client uuid, p_score int, p_comment text)
returns void
language sql
volatile
security definer
set search_path = public
as $$
  insert into public.job_rating (org_id, job_id, direction, rater_profile, rater_client, ratee_profile, ratee_client, score, comment)
  values (p_org, p_job, p_direction, p_rater_profile, p_rater_client, p_ratee_profile, p_ratee_client, p_score,
          nullif(left(btrim(coalesce(p_comment, '')), 1000), ''))
  on conflict (job_id, coalesce(rater_profile, rater_client), coalesce(ratee_profile, ratee_client, org_id))
  do update set score = excluded.score, comment = excluded.comment, updated_at = now()
   where (public.job_rating.score, public.job_rating.comment) is distinct from (excluded.score, excluded.comment)
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
  v_ratee uuid;
  n int := 0;
begin
  if not public.ratings_on(v_org) then raise exception 'Feedback is not on for this clinic' using errcode = '42501'; end if;
  select * into j from public.jobs where id = p_job and clinic_id = v_org and deleted_at is null;
  if j.id is null then raise exception 'Job not found' using errcode = '42501'; end if;
  if not public.job_received(p_job) then raise exception 'Not received yet' using errcode = '22023'; end if;
  if p_score is null or p_score not between 1 and 5 then raise exception 'A score from 1 to 5' using errcode = '22023'; end if;
  if p_direction = 'work' then
    if not coalesce(auth.uid() = j.order_doctor
            or (j.order_doctor is null and public.order_of_job(p_job) is null and public.my_role() = 'owner'), false) then
      raise exception 'Only the doctor who ordered it' using errcode = '42501';
    end if;
    for v_ratee in select distinct x from unnest(array[j.assigned_to, j.designed_by]) x where x is not null and x <> auth.uid() loop
      perform public.save_rating(v_org, p_job, 'work', auth.uid(), null, v_ratee, null, p_score, p_comment);
      n := n + 1;
    end loop;
  elsif p_direction = 'input' then
    if auth.uid() is distinct from j.assigned_to and auth.uid() is distinct from j.designed_by then
      raise exception 'Only the technician or the designer' using errcode = '42501';
    end if;
    if j.order_doctor is null or j.order_doctor = auth.uid() then raise exception 'No doctor to rate' using errcode = '22023'; end if;
    perform public.save_rating(v_org, p_job, 'input', auth.uid(), null, j.order_doctor, null, p_score, p_comment);
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
declare
  o public.client_order;
  j public.jobs;
  v_org uuid := public.my_org_id();
begin
  if not public.ratings_on(v_org) then raise exception 'Feedback is not on for this clinic' using errcode = '42501'; end if;
  select * into o from public.client_order where id = p_order and org_id = v_org and status = 'accepted';
  if o.id is null then raise exception 'Order not found' using errcode = '42501'; end if;
  select * into j from public.jobs where id = o.job_id and deleted_at is null;
  if j.id is null then raise exception 'Order not found' using errcode = '42501'; end if;
  if not (coalesce(auth.uid() in (j.assigned_to, j.designed_by), false) or coalesce(public.my_role() = 'owner', false)) then
    raise exception 'Only someone on the job' using errcode = '42501';
  end if;
  if not public.job_received(o.job_id) then raise exception 'Not received yet' using errcode = '22023'; end if;
  if p_score is null or p_score not between 1 and 5 then raise exception 'A score from 1 to 5' using errcode = '22023'; end if;
  perform public.save_rating(v_org, o.job_id, 'clinic_to_client', auth.uid(), null, null, o.client_id, p_score, p_comment);
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
  perform public.save_rating(c.org_id, o.job_id, 'client_to_clinic', null, c.id, null, null, p_score, p_comment);
end;
$$;

-- ── 2. Deleting a job ───────────────────────────────────────────────────────
alter table public.client_order add column if not exists cancelled_at timestamptz;
alter table public.client_order add column if not exists cancel_reason text;
alter table public.client_order add column if not exists cancelled_by uuid references public.profiles(id) on delete set null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'client_order_cancel_reason_valid') then
    alter table public.client_order add constraint client_order_cancel_reason_valid check (cancel_reason is null or length(cancel_reason) <= 500);
  end if;
end $$;

alter table public.client_notification drop constraint if exists client_notification_kind_valid;
alter table public.client_notification add constraint client_notification_kind_valid
  check (kind in ('message', 'accepted', 'rejected', 'ready', 'sent', 'connected', 'declined',
                  'received_reminder', 'problem_resolved', 'cancelled', 'reinstated'));

alter table public.audit_log drop constraint if exists audit_log_action_valid;
alter table public.audit_log add constraint audit_log_action_valid
  check (action in ('view', 'download', 'upload', 'share', 'unshare', 'stage_move',
                    'partnership', 'export', 'question', 'delete', 'restore', 'stock_override',
                    'mfa_added', 'mfa_removed', 'mfa_reset', 'account_deleted',
                    'create', 'edit', 'permission', 'file_deleted', 'update',
                    'stage_start', 'stage_edit', 'password_set', 'purge'));

/** Money tied to the job: an invoice line, a payment, a pay line. Such a job is never deleted. */
create or replace function public.job_money_ties(p_job uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'invoice_lines', (select count(*) from public.invoice_lines where job_id = p_job),
    'payments', (select count(*) from public.payments where job_id = p_job),
    'pay_lines', (select count(*) from public.worker_payout_lines where job_id = p_job))
$$;

/** The accepted order from outside a job came from, still standing (not cancelled). */
create or replace function public.live_order_of_job(p_job uuid)
returns public.client_order
language sql
stable
security definer
set search_path = public
as $$ select * from public.client_order where job_id = p_job and status = 'accepted' and cancelled_at is null limit 1 $$;

/** May the signed-in person delete (and restore) this job: Delete jobs, and the job is one they could read. */
create or replace function public.may_delete_job(p_job uuid, p_deleted boolean)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_perm_or_admin('jobs.delete') and exists (
    select 1 from public.jobs j
     where j.id = p_job and j.clinic_id = public.my_org_id()
       and (j.deleted_at is not null) = p_deleted
       and (public.has_perm('jobs.read') or public.is_org_admin() or public.job_is_mine(j.assigned_to, j.designed_by, j.work_items)))
$$;

/**
 * A plain DELETE from the app (any build) still keeps the job (sql/089), now
 * refused for a job with money tied to it, and for a job from a Network order
 * unless it comes through delete_job (the code typed, the client told). A
 * purge by the owner (purge_job) and a delete with no user (organisation exit)
 * are real.
 */
create or replace function public.soft_delete_job()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
  m jsonb;
  o public.client_order;
begin
  if coalesce(current_setting('wivo.job_purge', true), '') = 'on' then return old; end if;
  if auth.uid() is null then
    return old;   -- service role / SQL editor: a real delete (organisation exit)
  end if;
  m := public.job_money_ties(old.id);
  if (m->>'invoice_lines')::int > 0 or (m->>'payments')::int > 0 then
    raise exception 'This job is on an invoice or has a payment: it cannot be deleted' using errcode = '22023';
  end if;
  if (m->>'pay_lines')::int > 0 then
    raise exception 'This job is on a pay run: it cannot be deleted' using errcode = '22023';
  end if;
  o := public.live_order_of_job(old.id);
  if o.id is not null and coalesce(current_setting('wivo.job_delete', true), '') <> 'on' then
    raise exception 'This job belongs to an order from outside: delete it with its code' using errcode = '42501';
  end if;
  update public.jobs set deleted_at = now(), deleted_by = auth.uid()
   where id = old.id and deleted_at is null;
  for s in
    update public.job_share set revoked_at = now()
     where job_id = old.id and revoked_at is null
    returning partner_org
  loop
    perform public.audit(old.clinic_id, 'unshare', 'job:' || old.id, jsonb_build_object('partner_org', s.partner_org, 'reason', 'job deleted'));
    perform public.audit(s.partner_org, 'unshare', 'job:' || old.id, jsonb_build_object('owner_org', old.clinic_id, 'reason', 'job deleted'));
  end loop;
  perform public.audit(old.clinic_id, 'delete', 'job:' || old.id,
    jsonb_strip_nulls(jsonb_build_object('job_code', old.job_code,
      'order', (select id from public.client_order where job_id = old.id and status = 'accepted' limit 1))));
  return null;  -- the row stays
end;
$$;

/** What the job is tied to, for the confirmation before deleting it. */
create or replace function public.job_delete_check(p_job uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  j public.jobs;
  o public.client_order;
  m jsonb;
  v_client text;
begin
  if not public.may_delete_job(p_job, false) then raise exception 'Job not found' using errcode = '42501'; end if;
  select * into j from public.jobs where id = p_job;
  o := public.live_order_of_job(p_job);
  if o.id is not null then
    select coalesce(nullif(btrim(company_name), ''), display_name) into v_client from public.network_client where id = o.client_id;
  end if;
  m := public.job_money_ties(p_job);
  return m || jsonb_build_object(
    'job_code', j.job_code,
    'order', case when o.id is null then null else jsonb_build_object('id', o.id, 'ref', o.patient_ref, 'client', v_client) end,
    'files', (select count(*) from public.job_file where job_id = p_job and deleted_at is null),
    'blocked', case when (m->>'invoice_lines')::int > 0 or (m->>'payments')::int > 0 then 'money'
                    when (m->>'pay_lines')::int > 0 then 'pay' end);
end;
$$;

/**
 * Delete a job (into the bin). From a Network order: its code typed and a
 * reason; the order is cancelled and the client told why.
 */
create or replace function public.delete_job(p_job uuid, p_reason text, p_confirm text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  j public.jobs;
  o public.client_order;
  v_reason text := nullif(left(btrim(coalesce(p_reason, '')), 500), '');
begin
  if not public.may_delete_job(p_job, false) then raise exception 'Job not found' using errcode = '42501'; end if;
  select * into j from public.jobs where id = p_job;
  o := public.live_order_of_job(p_job);
  if o.id is not null then
    if lower(btrim(coalesce(p_confirm, ''))) is distinct from lower(btrim(coalesce(j.job_code, ''))) or coalesce(j.job_code, '') = '' then
      raise exception 'Type the job code to confirm' using errcode = '22023';
    end if;
    if v_reason is null then raise exception 'A reason for the client is needed' using errcode = '22023'; end if;
  end if;
  perform set_config('wivo.job_delete', 'on', true);
  delete from public.jobs where id = p_job;   -- soft_delete_job keeps it, or refuses (money)
  perform set_config('wivo.job_delete', '', true);
  if o.id is not null then
    update public.client_order set cancelled_at = now(), cancel_reason = v_reason, cancelled_by = auth.uid() where id = o.id;
    perform public.notify_client(o.org_id, o.client_id, o.id, 'cancelled', v_reason);
  end if;
end;
$$;

/** As in 102; a cancelled order goes back to where it was, and the client is told. */
create or replace function public.restore_job(p_job uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.my_org_id();
  o record;
begin
  if not public.may_delete_job(p_job, true) then raise exception 'Job not found' using errcode = '42501'; end if;
  update public.jobs set deleted_at = null, deleted_by = null where id = p_job;
  for o in
    update public.client_order set cancelled_at = null, cancel_reason = null, cancelled_by = null
     where job_id = p_job and cancelled_at is not null
    returning id, org_id, client_id
  loop
    perform public.notify_client(o.org_id, o.client_id, o.id, 'reinstated');
  end loop;
  perform public.audit(v_org, 'restore', 'job:' || p_job,
    jsonb_strip_nulls(jsonb_build_object('job_code', (select job_code from public.jobs where id = p_job))));
end;
$$;

/** The owner deletes a job in the bin for good: its code typed; not one with files or money tied to it. */
create or replace function public.purge_job(p_job uuid, p_confirm text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  j public.jobs;
  m jsonb;
begin
  if public.my_role() is distinct from 'owner' then raise exception 'Only the owner' using errcode = '42501'; end if;
  select * into j from public.jobs where id = p_job and clinic_id = public.my_org_id() and deleted_at is not null;
  if j.id is null then raise exception 'Job not found' using errcode = '42501'; end if;
  if lower(btrim(coalesce(p_confirm, ''))) is distinct from lower(btrim(coalesce(j.job_code, ''))) or coalesce(j.job_code, '') = '' then
    raise exception 'Type the job code to confirm' using errcode = '22023';
  end if;
  m := public.job_money_ties(p_job);
  if (m->>'invoice_lines')::int > 0 or (m->>'payments')::int > 0 or (m->>'pay_lines')::int > 0 then
    raise exception 'This job has money tied to it: it stays' using errcode = '22023';
  end if;
  if exists (select 1 from public.job_file where job_id = p_job) then
    raise exception 'This job has files: it stays in the bin' using errcode = '22023';
  end if;
  perform public.audit(j.clinic_id, 'purge', 'job:' || p_job, jsonb_build_object('job_code', j.job_code));
  perform set_config('wivo.job_purge', 'on', true);
  delete from public.jobs where id = p_job;
  perform set_config('wivo.job_purge', '', true);
end;
$$;

/** As in 102, with the client whose order the job came from, and whether it has files (it then stays). */
drop function if exists public.deleted_jobs();
create or replace function public.deleted_jobs()
returns table (id uuid, job_code text, patient text, work_type text, deleted_at timestamptz, deleted_by_name text,
               order_client text, has_files boolean)
language sql
stable
security definer
set search_path = public
as $$
  select j.id, j.job_code, j.patsient, j.too, j.deleted_at, p.full_name,
         (select coalesce(nullif(btrim(c.company_name), ''), c.display_name)
            from public.client_order o join public.network_client c on c.id = o.client_id
           where o.job_id = j.id and o.status = 'accepted' limit 1),
         exists (select 1 from public.job_file f where f.job_id = j.id)
    from public.jobs j left join public.profiles p on p.id = j.deleted_by
   where j.clinic_id = public.my_org_id() and j.deleted_at is not null and public.has_perm_or_admin('jobs.delete')
     and (public.has_perm('jobs.read') or public.is_org_admin() or public.job_is_mine(j.assigned_to, j.designed_by, j.work_items))
   order by j.deleted_at desc
$$;

-- ── The client's side: "Cancelled by clinic" ────────────────────────────────

/** As in 145, with Cancelled by clinic. */
create or replace function public.client_order_status(o public.client_order, p_show boolean)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when o.status = 'rejected' then 'rejected'
    when o.cancelled_at is not null then 'cancelled'
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

/** As in 138, with the reason a cancelled order was cancelled. */
create or replace function public.client_orders(p_session text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c public.network_client := public.network_session_client(p_session);
  v_show boolean := coalesce((c.can_see->>'status')::boolean, true);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', o.id, 'created_at', o.created_at, 'work_type', o.work_type, 'patient_ref', o.patient_ref,
      'due', o.due, 'status', public.client_order_status(o, v_show), 'reject_reason', o.reject_reason,
      'cancel_reason', o.cancel_reason,
      'messages', (select count(*) from public.client_order_message m where m.order_id = o.id)
    ) order by o.created_at desc)
      from public.client_order o where o.client_id = c.id and o.org_id = c.org_id), '[]'::jsonb);
end;
$$;

/** As in 145, with the reason a cancelled order was cancelled. */
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
    'cancel_reason', o.cancel_reason,
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

-- An order whose job was deleted before this migration: cancelled now (no notice: it happened before).
update public.client_order o
   set cancelled_at = j.deleted_at
  from public.jobs j
 where o.job_id = j.id and j.deleted_at is not null and o.status = 'accepted' and o.cancelled_at is null;

-- ── Who may run what ────────────────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'public.save_rating(uuid, uuid, text, uuid, uuid, uuid, uuid, int, text)', 'public.job_money_ties(uuid)',
    'public.live_order_of_job(uuid)', 'public.may_delete_job(uuid, boolean)', 'public.soft_delete_job()'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'public.job_delete_check(uuid)', 'public.delete_job(uuid, text, text)', 'public.restore_job(uuid)',
    'public.purge_job(uuid, text)', 'public.deleted_jobs()'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

select public.ensure_mfa_policies();
select public.lock_anon_functions();

-- ─── Verify (read only) ─────────────────────────────────────────────────────
-- select indexname from pg_indexes where tablename = 'job_rating' and indexname in ('job_rating_one', 'job_rating_once');  -> job_rating_one only
-- select count(*) from public.client_order o join public.jobs j on j.id = o.job_id where j.deleted_at is not null and o.cancelled_at is null;  -> 0
-- Afterwards, in SQL Editor on its own: notify pgrst, 'reload schema';
