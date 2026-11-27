-- ============================================================================
-- 142: notices for the Network client, and the clinic hears the client's messages
-- ============================================================================
--
-- Until now a client heard nothing: not when the clinic wrote, not when the
-- order was accepted, refused, ready or sent, not when its request to connect
-- was answered. The notices live HERE, in the clinic's own database, and reach
-- the client only through network-client with the session this clinic gave
-- (client_notifications); the Network project keeps none of them.
--
--   client_notification   one row per notice to one client: what happened
--                         (kind), on which order and its reference, and the
--                         reason when refused. No message text, no patient.
--
-- What makes one (triggers, so every path that changes these rows counts):
--   the clinic writes on an order            → message
--   the order is accepted / refused          → accepted / rejected (+ reason)
--   the job it became reaches the last stage → ready     (if the client may see progress)
--   the job is sent or handed over           → sent      (likewise)
--   the request to connect is confirmed      → connected
--   the request is declined by the clinic    → declined
--
-- E-mail (send-notifications, the clinic's own Resend, as the staff's
-- notices): only "New message on TF-DE-261127-001 from Dentiks" and a link to
-- the Network, never the message or anything about the patient; only to a
-- client who left e-mails on in its Network profile. The address and that
-- choice arrive with the client's signed Network token (client_set_contact).
--
-- And the other way: a client's message rings the clinic's bell
-- (client_message), on the job once the order became one.

set lock_timeout = '10s';

-- ── The client's address and choice, from its Network token ─────────────────
alter table public.network_client add column if not exists email text;
alter table public.network_client add column if not exists email_notifications boolean not null default true;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'network_client_email_valid') then
    alter table public.network_client add constraint network_client_email_valid
      check (email is null or (length(email) between 3 and 254 and email ~ '^[^@\s]+@[^@\s]+$'));
  end if;
end $$;

-- ── The notices ─────────────────────────────────────────────────────────────
create table if not exists public.client_notification (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.clinics(id) on delete cascade,
  client_id   uuid not null,
  order_id    uuid,
  kind        text not null,
  ref         text,
  reason      text,
  created_at  timestamptz not null default now(),
  read_at     timestamptz,
  emailed_at  timestamptz,
  constraint client_notification_client_fk foreign key (client_id, org_id)
    references public.network_client (id, org_id) on delete cascade,
  constraint client_notification_kind_valid
    check (kind in ('message', 'accepted', 'rejected', 'ready', 'sent', 'connected', 'declined')),
  constraint client_notification_ref_valid check (ref is null or length(ref) <= 40),
  constraint client_notification_reason_valid check (reason is null or length(reason) <= 500)
);
create index if not exists client_notification_client_idx on public.client_notification (client_id, created_at desc);
create index if not exists client_notification_email_idx on public.client_notification (created_at) where emailed_at is null;
alter table public.client_notification enable row level security;
-- The clinic's people may see what their clients were told; nobody writes but the triggers.
drop policy if exists "client_notification_select" on public.client_notification;
create policy "client_notification_select" on public.client_notification for select to authenticated
  using (public.may_handle_orders(org_id));
revoke all on public.client_notification from public, anon, authenticated;
grant select on public.client_notification to authenticated;

/** One notice to one client. */
create or replace function public.notify_client(p_org uuid, p_client uuid, p_order uuid, p_kind text, p_reason text default null)
returns void
language sql
volatile
security definer
set search_path = public
as $$
  insert into public.client_notification (org_id, client_id, order_id, kind, ref, reason)
  values (p_org, p_client, p_order, p_kind,
          (select patient_ref from public.client_order where id = p_order),
          left(p_reason, 500))
$$;

-- ── The clinic's bell for a client's message ────────────────────────────────
alter table public.notification drop constraint if exists notification_kind_valid;
alter table public.notification add constraint notification_kind_valid
  check (kind in ('job_shared', 'stage_handover', 'question', 'files_added', 'stage_reached', 'assigned',
                  'mfa_removed', 'mfa_reset', 'update_installed', 'update_failed', 'update_stale',
                  'stage_progress', 'stage_assigned', 'mail_quota', 'option_assigned',
                  'client_order', 'client_request', 'client_message', 'client_review'));

/**
 * The clinic hears about an order: the owners, and once the order became a
 * job, whoever the job is assigned to. On the job then, so the bell opens it.
 */
create or replace function public.notify_order_people(p_order uuid, p_kind text, p_detail jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare o public.client_order;
begin
  select * into o from public.client_order where id = p_order;
  if o.id is null then return; end if;
  insert into public.notification (org_id, user_id, job_id, job_code, kind, detail)
  select o.org_id, p.id, o.job_id, (select job_code from public.jobs where id = o.job_id), p_kind,
         p_detail || jsonb_build_object('order', o.id, 'ref', o.patient_ref)
    from public.profiles p
   where p.clinic_id = o.org_id
     and (p.role = 'owner' or (o.job_id is not null and p.id = (select assigned_to from public.jobs where id = o.job_id)));
end;
$$;

-- ── What makes a notice ─────────────────────────────────────────────────────
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
    perform public.notify_order_people(o.id, 'client_message', '{}'::jsonb);
  else
    perform public.notify_client(o.org_id, o.client_id, o.id, 'message');
  end if;
  return new;
end;
$$;
drop trigger if exists client_order_message_notices on public.client_order_message;
create trigger client_order_message_notices after insert on public.client_order_message
  for each row execute function public.client_order_message_notices();

create or replace function public.client_order_decision_notices()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'received' and new.status = 'accepted' then
    perform public.notify_client(new.org_id, new.client_id, new.id, 'accepted');
  elsif old.status = 'received' and new.status = 'rejected' then
    perform public.notify_client(new.org_id, new.client_id, new.id, 'rejected', new.reject_reason);
  end if;
  return new;
end;
$$;
drop trigger if exists client_order_decision_notices on public.client_order;
create trigger client_order_decision_notices after update of status on public.client_order
  for each row execute function public.client_order_decision_notices();

/** The job an order became: ready (the last stage) and sent (on its way or handed over), told once each. */
create or replace function public.client_job_notices()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.client_order;
  v_show boolean;
  v_last text;
begin
  select * into o from public.client_order where job_id = new.id and org_id = new.clinic_id limit 1;
  if o.id is null then return new; end if;
  select coalesce((can_see->>'status')::boolean, true) into v_show from public.network_client where id = o.client_id;
  if not coalesce(v_show, true) then return new; end if;
  if new.delivery_status in ('teel', 'yle_antud') and coalesce(old.delivery_status, '') not in ('teel', 'yle_antud') then
    perform public.notify_client(o.org_id, o.client_id, o.id, 'sent');
    return new;
  end if;
  v_last := (public.stage_order(new.clinic_id))[array_length(public.stage_order(new.clinic_id), 1)];
  if new.status = v_last and old.status is distinct from v_last
     and coalesce(new.delivery_status, '') not in ('teel', 'yle_antud') then
    perform public.notify_client(o.org_id, o.client_id, o.id, 'ready');
  end if;
  return new;
end;
$$;
drop trigger if exists client_job_notices on public.jobs;
create trigger client_job_notices after update of status, delivery_status on public.jobs
  for each row execute function public.client_job_notices();

create or replace function public.network_client_state_notices()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.state = 'requested' and new.state = 'confirmed' then
    perform public.notify_client(new.org_id, new.id, null, 'connected');
  elsif old.state = 'requested' and new.state = 'ended' and new.ended_by = 'clinic' then
    perform public.notify_client(new.org_id, new.id, null, 'declined');
  end if;
  return new;
end;
$$;
drop trigger if exists network_client_state_notices on public.network_client;
create trigger network_client_state_notices after update of state on public.network_client
  for each row execute function public.network_client_state_notices();

-- ── The client's side: the service role only (network-client) ───────────────

/** The address and the e-mail choice from the client's signed Network token (checked by network-client first). */
create or replace function public.client_set_contact(p_network_clinic uuid, p_account uuid, p_email text, p_mail boolean)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_org uuid;
begin
  select org_id into v_org from public.network_settings where network_clinic_id = p_network_clinic;
  if v_org is null then return; end if;
  update public.network_client
     set email = case when p_email ~ '^[^@\s]+@[^@\s]+$' and length(p_email) between 3 and 254 then p_email end,
         email_notifications = coalesce(p_mail, true)
   where org_id = v_org and account_id = p_account;
end;
$$;

/** The client's notices here, newest first. */
create or replace function public.client_notifications(p_session text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare c public.network_client := public.network_session_client(p_session);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', n.id, 'kind', n.kind, 'order_id', n.order_id, 'ref', n.ref,
                                        'reason', n.reason, 'created_at', n.created_at, 'read_at', n.read_at)
                     order by n.created_at desc)
      from (select * from public.client_notification
             where client_id = c.id and org_id = c.org_id
             order by created_at desc limit 50) n), '[]'::jsonb);
end;
$$;

/** Marks the client's own notices read: these, or (null) all. */
create or replace function public.client_notifications_read(p_session text, p_ids uuid[])
returns int
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  c public.network_client := public.network_session_client(p_session);
  v_n int;
begin
  update public.client_notification set read_at = now()
   where client_id = c.id and org_id = c.org_id and read_at is null
     and (p_ids is null or id = any(p_ids));
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- ── E-mail (send-notifications, service role) ───────────────────────────────

/** Notices to e-mail: to a client with an address and e-mails on, not read yet, at most a day old. */
create or replace function public.pending_client_emails(p_limit int default 200)
returns table (id uuid, email text, kind text, ref text, clinic text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select n.id, c.email, n.kind, n.ref, k.name, n.created_at
    from public.client_notification n
    join public.network_client c on c.id = n.client_id and c.org_id = n.org_id
    join public.clinics k on k.id = n.org_id
   where n.emailed_at is null and n.read_at is null
     and c.email is not null and c.email_notifications
     and n.created_at > now() - interval '1 day'
   order by n.created_at
   limit p_limit
$$;

create or replace function public.mark_client_notifications_emailed(p_ids uuid[])
returns void
language sql
volatile
security definer
set search_path = public
as $$
  update public.client_notification set emailed_at = now() where id = any(p_ids) and emailed_at is null
$$;

-- ── Who may run what ────────────────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'public.notify_client(uuid, uuid, uuid, text, text)', 'public.notify_order_people(uuid, text, jsonb)',
    'public.client_order_message_notices()', 'public.client_order_decision_notices()',
    'public.client_job_notices()', 'public.network_client_state_notices()'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'public.client_set_contact(uuid, uuid, text, boolean)', 'public.client_notifications(text)',
    'public.client_notifications_read(text, uuid[])', 'public.pending_client_emails(int)',
    'public.mark_client_notifications_emailed(uuid[])'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

select public.ensure_mfa_policies();
select public.lock_anon_functions();

-- ─── Verify (read only) ─────────────────────────────────────────────────────
-- select rowsecurity from pg_tables where tablename = 'client_notification';                        -> true
-- select has_function_privilege('authenticated', 'public.client_notifications(text)', 'execute');   -> false
-- Afterwards, in SQL Editor on its own: notify pgrst, 'reload schema';
