-- ============================================================================
-- Wivo — migration 138: orders from outside, through the Wivo Network
-- Run this ON ITS OWN, in a separate query, AFTER 137.
-- ============================================================================
--
-- WHAT (docs/PLAN-NETWORK-1.md)
--   Outside technicians, doctors, clinics and labs with a Wivo Network account
--   ask to connect to this clinic; the owner confirms them (they then appear
--   under Clients or Clinics); they send orders in the "Wivo order" format
--   (docs/WIVO-ORDER-FORMAT.md) with files and messages; the clinic accepts
--   an order with a template (it becomes an ordinary job) or rejects it with a
--   reason. Behind the licence module `portal`, and OFF until the owner turns
--   it on in Settings → Network.
--
--   network_settings        on/off, the Network's public key, this clinic's
--                           id in the Network, how long a session lives
--   network_client          an outside account: requested / confirmed / ended,
--                           which list it is on, what it may see
--   network_client_session  a client's session: only the SHA-256 of its token
--   client_order            an order, as sent; its decision and its job
--   client_order_message    messages about an order, both ways
--   client_order_file       files sent with an order
--
-- THE CLIENT'S BOUNDARY (N5)
--   A client has no login and no database role here. Every client call comes
--   through the Edge Function `network-client`, which runs the client_*
--   functions below with the service key; those are granted to the service
--   role ONLY. Each one finds the client from the session (live, not ended,
--   portal on) and touches only that client's rows. Row security on the new
--   tables is for the clinic's own people; it lets no client in.
--
-- A client sees: its own orders, their status (if allowed), the messages and
-- files of its own orders (if allowed), the catalogue (prices if allowed).
-- Never another client's anything, never a patient record, never a job.
--
-- Idempotent.

set lock_timeout = '10s';

-- ── network_settings ────────────────────────────────────────────────────────
create table if not exists public.network_settings (
  org_id             uuid primary key references public.clinics(id) on delete cascade,
  enabled            boolean not null default false,
  network_public_key text,
  network_clinic_id  uuid unique,
  session_hours      int not null default 8,
  updated_at         timestamptz not null default now(),
  updated_by         uuid,
  constraint network_settings_key_valid check (network_public_key is null or network_public_key ~ '^[A-Za-z0-9_-]{43}$'),
  constraint network_settings_hours_valid check (session_hours between 1 and 24),
  constraint network_settings_on_needs_key check (not enabled or (network_public_key is not null and network_clinic_id is not null))
);
alter table public.network_settings enable row level security;
drop policy if exists "network_settings_select" on public.network_settings;
create policy "network_settings_select" on public.network_settings
  for select to authenticated using (org_id = public.my_org_id() and public.my_role() = 'owner');
revoke all on public.network_settings from public, anon, authenticated;
grant select on public.network_settings to authenticated;

-- ── network_client ──────────────────────────────────────────────────────────
create table if not exists public.network_client (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.clinics(id) on delete cascade,
  account_id    uuid not null,
  connection_id uuid,
  state         text not null default 'requested',
  kind          text not null,
  role          text not null,
  display_name  text not null,
  company_name  text,
  country       text,
  customer_id   uuid references public.customers(id) on delete set null,
  can_see       jsonb not null default '{"status": true, "messages": true, "files": true, "prices": false}'::jsonb,
  requested_at  timestamptz not null default now(),
  confirmed_at  timestamptz,
  confirmed_by  uuid,
  ended_at      timestamptz,
  ended_by      text,
  updated_at    timestamptz not null default now(),
  constraint network_client_unique unique (org_id, account_id),
  constraint network_client_id_org unique (id, org_id),
  constraint network_client_state_valid check (state in ('requested', 'confirmed', 'ended')),
  constraint network_client_kind_valid check (kind in ('person', 'company')),
  constraint network_client_role_valid check (role in ('technician', 'doctor', 'clinic', 'lab')),
  constraint network_client_name_valid check (length(btrim(display_name)) between 1 and 120),
  constraint network_client_company_valid check (company_name is null or length(company_name) <= 160),
  constraint network_client_country_valid check (country is null or country ~ '^[A-Z]{2}$'),
  constraint network_client_ended_by_valid check (ended_by is null or ended_by in ('clinic', 'client')),
  constraint network_client_can_see_object check (jsonb_typeof(can_see) = 'object')
);
create index if not exists network_client_org_state_idx on public.network_client (org_id, state);
alter table public.network_client enable row level security;

/** The clinic's people who handle orders: the owner, and whoever reads or edits jobs. */
create or replace function public.may_handle_orders(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_org is not null and p_org = public.my_org_id()
     and (public.has_perm('jobs.read') or public.has_perm('jobs.write'))
$$;

drop policy if exists "network_client_select" on public.network_client;
create policy "network_client_select" on public.network_client
  for select to authenticated using (public.may_handle_orders(org_id));
revoke all on public.network_client from public, anon, authenticated;
grant select on public.network_client to authenticated;

-- ── network_client_session ──────────────────────────────────────────────────
create table if not exists public.network_client_session (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.clinics(id) on delete cascade,
  client_id   uuid not null,
  token_hash  text not null unique,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  revoked_at  timestamptz,
  constraint network_client_session_client_fk foreign key (client_id, org_id)
    references public.network_client (id, org_id) on delete cascade,
  constraint network_client_session_hash_valid check (token_hash ~ '^[0-9a-f]{64}$')
);
create index if not exists network_client_session_client_idx on public.network_client_session (client_id);
alter table public.network_client_session enable row level security;
-- No policy at all: nobody reads sessions but the functions below.
revoke all on public.network_client_session from public, anon, authenticated;

-- ── client_order ────────────────────────────────────────────────────────────
create table if not exists public.client_order (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.clinics(id) on delete cascade,
  client_id      uuid not null,
  format_version int not null,
  payload        jsonb not null,
  work_type      text not null,
  patient_ref    text not null,
  due            date,
  status         text not null default 'received',
  reject_reason  text,
  job_id         uuid references public.jobs(id) on delete set null,
  created_at     timestamptz not null default now(),
  decided_at     timestamptz,
  decided_by     uuid,
  constraint client_order_id_org unique (id, org_id),
  constraint client_order_client_fk foreign key (client_id, org_id)
    references public.network_client (id, org_id) on delete cascade,
  constraint client_order_status_valid check (status in ('received', 'accepted', 'rejected')),
  constraint client_order_reason check ((status = 'rejected') = (reject_reason is not null)),
  constraint client_order_reason_valid check (reject_reason is null or length(btrim(reject_reason)) between 1 and 500),
  constraint client_order_ref_valid check (length(btrim(patient_ref)) between 1 and 40),
  constraint client_order_work_type_valid check (length(btrim(work_type)) between 1 and 120),
  constraint client_order_payload_size check (pg_column_size(payload) <= 20000)
);
create index if not exists client_order_org_status_idx on public.client_order (org_id, status, created_at desc);
create index if not exists client_order_client_idx on public.client_order (client_id, created_at desc);
alter table public.client_order enable row level security;
drop policy if exists "client_order_select" on public.client_order;
create policy "client_order_select" on public.client_order
  for select to authenticated using (public.may_handle_orders(org_id));
revoke all on public.client_order from public, anon, authenticated;
grant select on public.client_order to authenticated;

-- ── client_order_message ────────────────────────────────────────────────────
create table if not exists public.client_order_message (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.clinics(id) on delete cascade,
  order_id     uuid not null,
  from_client  boolean not null,
  author_id    uuid,
  body         text not null,
  created_at   timestamptz not null default now(),
  constraint client_order_message_order_fk foreign key (order_id, org_id)
    references public.client_order (id, org_id) on delete cascade,
  constraint client_order_message_body_valid check (length(btrim(body)) between 1 and 4000)
);
create index if not exists client_order_message_order_idx on public.client_order_message (order_id, created_at);
alter table public.client_order_message enable row level security;
drop policy if exists "client_order_message_select" on public.client_order_message;
create policy "client_order_message_select" on public.client_order_message
  for select to authenticated using (public.may_handle_orders(org_id));
revoke all on public.client_order_message from public, anon, authenticated;
grant select on public.client_order_message to authenticated;

-- ── client_order_file ───────────────────────────────────────────────────────
create table if not exists public.client_order_file (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.clinics(id) on delete cascade,
  order_id      uuid not null,
  file_name     text not null,
  size          bigint not null,
  sha256        text not null,
  mime_type     text,
  storage_path  text not null unique,
  created_at    timestamptz not null default now(),
  completed_at  timestamptz,
  job_file_id   uuid references public.job_file(id) on delete set null,
  constraint client_order_file_order_fk foreign key (order_id, org_id)
    references public.client_order (id, org_id) on delete cascade,
  constraint client_order_file_name_valid check (length(btrim(file_name)) between 1 and 200 and file_name !~ '[/\\]'),
  constraint client_order_file_size_valid check (size between 0 and 2147483648),
  constraint client_order_file_sha_valid check (sha256 ~ '^[0-9a-f]{64}$')
);
create index if not exists client_order_file_order_idx on public.client_order_file (order_id);
alter table public.client_order_file enable row level security;
drop policy if exists "client_order_file_select" on public.client_order_file;
create policy "client_order_file_select" on public.client_order_file
  for select to authenticated using (public.may_handle_orders(org_id));
revoke all on public.client_order_file from public, anon, authenticated;
grant select on public.client_order_file to authenticated;

-- ── A new order rings the bell ──────────────────────────────────────────────
alter table public.notification drop constraint if exists notification_kind_valid;
alter table public.notification add constraint notification_kind_valid
  check (kind in ('job_shared', 'stage_handover', 'question', 'files_added', 'stage_reached', 'assigned',
                  'mfa_removed', 'mfa_reset', 'update_installed', 'update_failed', 'update_stale',
                  'stage_progress', 'stage_assigned', 'mail_quota', 'option_assigned',
                  'client_order', 'client_request'));

/** The owner(s) hear of a new order or a new connection request. No patient, no reference: only that there is one. */
create or replace function public.notify_order_handlers(p_org uuid, p_kind text, p_detail jsonb)
returns void
language sql
volatile
security definer
set search_path = public
as $$
  insert into public.notification (org_id, user_id, kind, detail)
  select p_org, p.id, p_kind, p_detail
    from public.profiles p
   where p.clinic_id = p_org and p.role = 'owner'
$$;
revoke execute on function public.notify_order_handlers(uuid, text, jsonb) from public, anon, authenticated;

-- ============================================================================
-- The client's side: SERVICE ROLE ONLY (the network-client Edge Function)
-- ============================================================================

/** The client a session belongs to, if the session is live, the client confirmed and the portal on. */
create or replace function public.network_session_client(p_session text)
returns public.network_client
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  c public.network_client;
begin
  if p_session is null or p_session !~ '^[0-9a-f]{64}$' then
    raise exception 'Session not valid' using errcode = '42501';
  end if;
  select nc.* into c
    from public.network_client_session s
    join public.network_client nc on nc.id = s.client_id and nc.org_id = s.org_id
    join public.network_settings ns on ns.org_id = s.org_id
   where s.token_hash = encode(extensions.digest(p_session, 'sha256'), 'hex')
     and s.revoked_at is null and s.expires_at > now()
     and nc.state = 'confirmed' and ns.enabled;
  if c.id is null then
    raise exception 'Session not valid' using errcode = '42501';
  end if;
  return c;
end;
$$;

/** Which clinic a Network id is, with its key: for the function to check a token. */
create or replace function public.network_settings_for(p_network_clinic uuid)
returns table (org_id uuid, enabled boolean, network_public_key text, session_hours int)
language sql
stable
security definer
set search_path = public
as $$
  select s.org_id, s.enabled, s.network_public_key, s.session_hours
    from public.network_settings s where s.network_clinic_id = p_network_clinic
$$;

/**
 * A checked Network token arrives (the function has verified its signature,
 * its age and that it is for this clinic). A new account becomes a request;
 * a known one is updated; a confirmed one gets a session.
 */
create or replace function public.network_connect(p_network_clinic uuid, p_account uuid, p_connection uuid, p_profile jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  s public.network_settings;
  c public.network_client;
  v_token text;
  v_expires timestamptz;
  v_name text := left(btrim(coalesce(p_profile->>'name', '')), 120);
  v_kind text := p_profile->>'kind';
  v_role text := p_profile->>'role';
  v_company text := nullif(left(btrim(coalesce(p_profile->>'company', '')), 160), '');
  v_country text := nullif(p_profile->>'country', '');
begin
  select * into s from public.network_settings where network_clinic_id = p_network_clinic;
  if s.org_id is null or not s.enabled then
    raise exception 'This clinic does not take orders through the Network' using errcode = '42501';
  end if;
  if v_name = '' then raise exception 'A name is needed' using errcode = '22023'; end if;

  insert into public.network_client (org_id, account_id, connection_id, kind, role, display_name, company_name, country)
  values (s.org_id, p_account, p_connection, v_kind, v_role, v_name, v_company, v_country)
  on conflict (org_id, account_id) do update
     set connection_id = excluded.connection_id, kind = excluded.kind, role = excluded.role,
         display_name = excluded.display_name, company_name = excluded.company_name,
         country = excluded.country, updated_at = now(),
         -- Ended earlier and asking again: back to the owner.
         state = case when public.network_client.state = 'ended' then 'requested' else public.network_client.state end,
         requested_at = case when public.network_client.state = 'ended' then now() else public.network_client.requested_at end,
         ended_at = case when public.network_client.state = 'ended' then null else public.network_client.ended_at end,
         ended_by = case when public.network_client.state = 'ended' then null else public.network_client.ended_by end
  returning * into c;

  if c.state = 'requested' and c.requested_at >= now() - interval '1 second' then
    perform public.notify_order_handlers(s.org_id, 'client_request', jsonb_build_object('client', c.id));
  end if;

  if c.state <> 'confirmed' then
    return jsonb_build_object('state', c.state);
  end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_expires := now() + make_interval(hours => s.session_hours);
  insert into public.network_client_session (org_id, client_id, token_hash, expires_at)
  values (s.org_id, c.id, encode(extensions.digest(v_token, 'sha256'), 'hex'), v_expires);
  -- Old sessions of this client that have run out are not kept.
  delete from public.network_client_session where client_id = c.id and expires_at < now() - interval '1 day';

  return jsonb_build_object(
    'state', 'confirmed', 'session', v_token, 'expires_at', v_expires,
    'can_see', c.can_see,
    'clinic', (select name from public.clinics where id = s.org_id));
end;
$$;

/** The clinic's work types as a client may choose them (prices only if allowed). */
create or replace function public.client_catalog(p_session text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c public.network_client := public.network_session_client(p_session);
  v_types jsonb;
  v_library jsonb;
begin
  select coalesce(work_types, '[]'::jsonb), coalesce(pricing->'tooValikud', '[]'::jsonb)
    into v_types, v_library
    from public.clinic_settings where clinic_id = c.org_id;
  return coalesce((
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'name', wt->>'nimi',
      'teeth', case
        when wt->>'liik' in ('single', 'bridge') then 'tooth'
        when wt->>'liik' = 'arch' then 'arch'
        when wt->>'liik' = 'none' then 'none'
        when wt->>'hambaviis' in ('tooth', 'arch', 'none') then wt->>'hambaviis'
        else 'tooth' end,
      'groups', coalesce((
        select jsonb_agg(jsonb_build_object(
          'key', g->>'key', 'name', g->>'nimi', 'multi', coalesce((g->>'mitu')::boolean, false),
          'options', coalesce((
            select jsonb_agg(jsonb_build_object('id', o.id, 'name', coalesce(lib->>'nimi', o.id)) order by o.ord)
              from jsonb_array_elements_text(coalesce(g->'valikud', '[]'::jsonb)) with ordinality as o(id, ord)
              left join lateral (select l from jsonb_array_elements(v_library) l where l->>'id' = o.id limit 1) x(lib) on true
             where coalesce((lib->>'arhiivis')::boolean, false) = false), '[]'::jsonb)) order by gi.ord)
          from jsonb_array_elements(coalesce(wt->'valikuGrupid', '[]'::jsonb)) with ordinality as gi(g, ord)), '[]'::jsonb),
      'price', case when coalesce((c.can_see->>'prices')::boolean, false) then (wt->>'hind')::numeric end,
      'unit', case when coalesce((c.can_see->>'prices')::boolean, false) then coalesce(wt->>'hinnaTyyp', 'too') end
    )) order by t.ord)
      from jsonb_array_elements(v_types) with ordinality as t(wt, ord)
     where coalesce(btrim(wt->>'nimi'), '') <> ''), '[]'::jsonb);
end;
$$;

/** How a client sees an order's progress, in four words (or rejected). */
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
    when j.delivery_status in ('teel', 'yle_antud') then 'sent'
    when j.status = (public.stage_order(o.org_id))[array_length(public.stage_order(o.org_id), 1)] then 'ready'
    else 'in_progress' end
    from (select 1) one
    left join public.jobs j on j.id = o.job_id and j.deleted_at is null
$$;

/** The client's own orders, newest first. */
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
      'messages', (select count(*) from public.client_order_message m where m.order_id = o.id)
    ) order by o.created_at desc)
      from public.client_order o where o.client_id = c.id and o.org_id = c.org_id), '[]'::jsonb);
end;
$$;

/** One of the client's own orders, with its messages and files if the owner allows them. */
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
      select jsonb_agg(jsonb_build_object('id', m.id, 'from_client', m.from_client, 'body', m.body, 'created_at', m.created_at) order by m.created_at)
        from public.client_order_message m where m.order_id = o.id), '[]'::jsonb) end,
    'files', case when coalesce((c.can_see->>'files')::boolean, true) then coalesce((
      select jsonb_agg(jsonb_build_object('id', f.id, 'file_name', f.file_name, 'size', f.size, 'created_at', f.created_at) order by f.created_at)
        from public.client_order_file f where f.order_id = o.id and f.completed_at is not null), '[]'::jsonb) end);
end;
$$;

/** A new order, "Wivo order" v1. Checked here as well as in the function: the database has the last word. */
create or replace function public.client_new_order(p_session text, p_payload jsonb)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  c public.network_client := public.network_session_client(p_session);
  v_id uuid;
  v_type text := btrim(coalesce(p_payload->>'work_type', ''));
  v_ref text := btrim(coalesce(p_payload->>'patient_ref', ''));
  v_due date;
  v_recent int;
begin
  if jsonb_typeof(p_payload) <> 'object' or p_payload->>'format' <> 'wivo-order' or p_payload->>'version' <> '1' then
    raise exception 'Not a Wivo order (v1)' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_object_keys(p_payload) k
              where k not in ('format', 'version', 'work_type', 'teeth', 'options', 'shade', 'due', 'patient_ref', 'notes')) then
    raise exception 'Unknown field in the order' using errcode = '22023';
  end if;
  if not exists (select 1 from public.clinic_settings s, jsonb_array_elements(coalesce(s.work_types, '[]'::jsonb)) wt
                  where s.clinic_id = c.org_id and wt->>'nimi' = v_type) then
    raise exception 'This work type is not in the clinic''s catalogue' using errcode = '22023';
  end if;
  if length(v_ref) not between 1 and 40 then
    raise exception 'The patient reference is 1 to 40 characters' using errcode = '22023';
  end if;
  if coalesce(p_payload->>'teeth', '') !~ '^([1-8][1-8](,[1-8][1-8])*)?$' then
    raise exception 'Teeth are FDI numbers, comma-separated' using errcode = '22023';
  end if;
  if length(coalesce(p_payload->>'notes', '')) > 2000 or length(coalesce(p_payload->>'shade', '')) > 20 then
    raise exception 'The order is too long' using errcode = '22023';
  end if;
  if p_payload ? 'options' and jsonb_typeof(p_payload->'options') not in ('object', 'null') then
    raise exception 'Options are an object' using errcode = '22023';
  end if;
  if nullif(p_payload->>'due', '') is not null then
    if p_payload->>'due' !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'The due date is YYYY-MM-DD' using errcode = '22023'; end if;
    v_due := (p_payload->>'due')::date;
  end if;
  -- A client sends orders, not a flood: at most 60 an hour.
  select count(*) into v_recent from public.client_order where client_id = c.id and created_at > now() - interval '1 hour';
  if v_recent >= 60 then raise exception 'Too many orders in an hour' using errcode = '54000'; end if;

  insert into public.client_order (org_id, client_id, format_version, payload, work_type, patient_ref, due)
  values (c.org_id, c.id, 1, p_payload, v_type, v_ref, v_due)
  returning id into v_id;
  perform public.notify_order_handlers(c.org_id, 'client_order', jsonb_build_object('order', v_id));
  return v_id;
end;
$$;

/** The client writes about its own order (if messages are allowed). */
create or replace function public.client_post_message(p_session text, p_order uuid, p_body text)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  c public.network_client := public.network_session_client(p_session);
  v_id uuid;
begin
  if not coalesce((c.can_see->>'messages')::boolean, true) then
    raise exception 'Messages are off for you here' using errcode = '42501';
  end if;
  if not exists (select 1 from public.client_order where id = p_order and client_id = c.id and org_id = c.org_id) then
    raise exception 'Order not found' using errcode = '42501';
  end if;
  insert into public.client_order_message (org_id, order_id, from_client, body)
  values (c.org_id, p_order, true, btrim(p_body)) returning id into v_id;
  return v_id;
end;
$$;

/** A place for a file the client is about to upload with its order. */
create or replace function public.client_file_slot(p_session text, p_order uuid, p_name text, p_size bigint, p_sha256 text, p_mime text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  c public.network_client := public.network_session_client(p_session);
  v_id uuid := gen_random_uuid();
  v_path text;
begin
  if not exists (select 1 from public.client_order where id = p_order and client_id = c.id and org_id = c.org_id and status <> 'rejected') then
    raise exception 'Order not found' using errcode = '42501';
  end if;
  if (select count(*) from public.client_order_file where order_id = p_order) >= 30 then
    raise exception 'At most 30 files with one order' using errcode = '54000';
  end if;
  v_path := 'client-orders/' || c.org_id || '/' || p_order || '/' || v_id;
  insert into public.client_order_file (id, org_id, order_id, file_name, size, sha256, mime_type, storage_path)
  values (v_id, c.org_id, p_order, btrim(p_name), p_size, lower(p_sha256), left(p_mime, 120), v_path);
  return jsonb_build_object('file_id', v_id, 'path', v_path);
end;
$$;

/** The bytes are in Storage. */
create or replace function public.client_file_done(p_session text, p_file uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  c public.network_client := public.network_session_client(p_session);
  f public.client_order_file;
begin
  select f2.* into f from public.client_order_file f2
    join public.client_order o on o.id = f2.order_id
   where f2.id = p_file and o.client_id = c.id and o.org_id = c.org_id;
  if f.id is null or not exists (select 1 from storage.objects where bucket_id = 'job-files' and name = f.storage_path) then
    raise exception 'File not found' using errcode = '22023';
  end if;
  update public.client_order_file set completed_at = coalesce(completed_at, now()) where id = p_file;
end;
$$;

/** Where one of the client's own order files is, to sign a short link (if files are allowed). */
create or replace function public.client_file_path(p_session text, p_file uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c public.network_client := public.network_session_client(p_session);
  v_path text;
begin
  if not coalesce((c.can_see->>'files')::boolean, true) then
    raise exception 'Files are off for you here' using errcode = '42501';
  end if;
  select f.storage_path into v_path from public.client_order_file f
    join public.client_order o on o.id = f.order_id
   where f.id = p_file and f.completed_at is not null and o.client_id = c.id and o.org_id = c.org_id;
  if v_path is null then raise exception 'File not found' using errcode = '42501'; end if;
  return v_path;
end;
$$;

/** The client ends the connection itself (or its Network account did). */
create or replace function public.client_end(p_session text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  c public.network_client := public.network_session_client(p_session);
begin
  update public.network_client set state = 'ended', ended_at = now(), ended_by = 'client', updated_at = now() where id = c.id;
  update public.network_client_session set revoked_at = now() where client_id = c.id and revoked_at is null;
end;
$$;

-- ============================================================================
-- The clinic's side: its own people, signed in (authenticated, aal2)
-- ============================================================================

create or replace function public.network_save_settings(p_enabled boolean, p_public_key text, p_network_clinic uuid, p_session_hours int)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_org uuid := public.my_org_id();
begin
  if public.my_role() is distinct from 'owner' or v_org is null then
    raise exception 'Only the owner' using errcode = '42501';
  end if;
  insert into public.network_settings (org_id, enabled, network_public_key, network_clinic_id, session_hours, updated_at, updated_by)
  values (v_org, coalesce(p_enabled, false), nullif(btrim(p_public_key), ''), p_network_clinic, coalesce(p_session_hours, 8), now(), auth.uid())
  on conflict (org_id) do update
     set enabled = excluded.enabled, network_public_key = excluded.network_public_key,
         network_clinic_id = excluded.network_clinic_id, session_hours = excluded.session_hours,
         updated_at = now(), updated_by = auth.uid();
  -- Turned off: every client session ends now.
  if not coalesce(p_enabled, false) then
    update public.network_client_session set revoked_at = now() where org_id = v_org and revoked_at is null;
  end if;
end;
$$;

/**
 * The owner confirms a request: the account becomes a customer, under
 * Clients ('clients': a person) or Clinics ('clinics': a clinic or a lab),
 * and may send orders. What it sees is the owner's choice.
 */
create or replace function public.network_confirm_client(p_client uuid, p_list text, p_can_see jsonb)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid := public.my_org_id();
  c public.network_client;
  v_customer uuid;
begin
  if public.my_role() is distinct from 'owner' then raise exception 'Only the owner' using errcode = '42501'; end if;
  select * into c from public.network_client where id = p_client and org_id = v_org;
  if c.id is null then raise exception 'Not found' using errcode = '42501'; end if;
  if p_list not in ('clients', 'clinics') then raise exception 'Clients or Clinics' using errcode = '22023'; end if;
  v_customer := c.customer_id;
  if v_customer is null or not exists (select 1 from public.customers where id = v_customer and archived_at is null) then
    insert into public.customers (clinic_id, name, kind, contact_name, note)
    values (v_org, coalesce(nullif(btrim(c.company_name), ''), c.display_name),
            case when p_list = 'clinics' then 'clinic' else 'person' end,
            case when c.kind = 'company' then c.display_name end,
            'Wivo Network')
    returning id into v_customer;
  end if;
  update public.network_client
     set state = 'confirmed', confirmed_at = now(), confirmed_by = auth.uid(), customer_id = v_customer,
         can_see = jsonb_build_object(
           'status',   coalesce((p_can_see->>'status')::boolean, true),
           'messages', coalesce((p_can_see->>'messages')::boolean, true),
           'files',    coalesce((p_can_see->>'files')::boolean, true),
           'prices',   coalesce((p_can_see->>'prices')::boolean, false)),
         ended_at = null, ended_by = null, updated_at = now()
   where id = c.id;
  perform public.audit(v_org, 'partnership', 'network_client:' || c.id, jsonb_build_object('confirmed', true));
  return v_customer;
end;
$$;

create or replace function public.network_set_client_visibility(p_client uuid, p_can_see jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if public.my_role() is distinct from 'owner' then raise exception 'Only the owner' using errcode = '42501'; end if;
  update public.network_client
     set can_see = jsonb_build_object(
           'status',   coalesce((p_can_see->>'status')::boolean, true),
           'messages', coalesce((p_can_see->>'messages')::boolean, true),
           'files',    coalesce((p_can_see->>'files')::boolean, true),
           'prices',   coalesce((p_can_see->>'prices')::boolean, false)),
         updated_at = now()
   where id = p_client and org_id = public.my_org_id();
end;
$$;

/** The owner ends a connection: every session of the client ends now; its orders and jobs stay. */
create or replace function public.network_end_client(p_client uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_org uuid := public.my_org_id();
begin
  if public.my_role() is distinct from 'owner' then raise exception 'Only the owner' using errcode = '42501'; end if;
  update public.network_client set state = 'ended', ended_at = now(), ended_by = 'clinic', updated_at = now()
   where id = p_client and org_id = v_org and state <> 'ended';
  update public.network_client_session set revoked_at = now() where client_id = p_client and org_id = v_org and revoked_at is null;
  perform public.audit(v_org, 'partnership', 'network_client:' || p_client, jsonb_build_object('ended', true));
end;
$$;

/**
 * Accept an order: it becomes an ordinary job with the chosen template (or
 * the default), for the client's customer row, with the order's files as the
 * job's files. Returns the job.
 */
create or replace function public.accept_client_order(p_order uuid, p_template uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid := public.my_org_id();
  o public.client_order;
  c public.network_client;
  v_job uuid;
  v_code text;
  v_first text;
  v_template uuid;
  v_kind text;
  f record;
  v_file uuid;
  n int := 0;
begin
  if not public.has_perm('jobs.write') then raise exception 'Edit jobs is needed' using errcode = '42501'; end if;
  select * into o from public.client_order where id = p_order and org_id = v_org for update;
  if o.id is null then raise exception 'Order not found' using errcode = '42501'; end if;
  if o.status <> 'received' then raise exception 'This order is already decided' using errcode = '22023'; end if;
  select * into c from public.network_client where id = o.client_id;
  v_template := coalesce(p_template, public.default_template(v_org));
  if not exists (select 1 from public.workflow_template where id = v_template and org_id = v_org and archived_at is null) then
    raise exception 'No such template' using errcode = '22023';
  end if;
  select stage_key into v_first from public.workflow_template_stage where template_id = v_template order by position limit 1;
  v_first := coalesce(v_first, (public.stage_order(v_org))[1]);
  select kind into v_kind from public.customers where id = c.customer_id;

  insert into public.jobs (clinic_id, status, kuupaev, valmis_kuupaev, patsient, too, hambad, varv, kirjeldus,
                           customer_id, customer_ref, work_items, template_id, order_source)
  values (v_org, v_first, current_date, o.due, o.patient_ref, o.work_type,
          nullif(o.payload->>'teeth', ''), nullif(o.payload->>'shade', ''), nullif(o.payload->>'notes', ''),
          c.customer_id, o.patient_ref,
          jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
            'id', gen_random_uuid()::text, 'too', o.work_type, 'hambad', coalesce(o.payload->>'teeth', ''),
            'valikud', case when jsonb_typeof(o.payload->'options') = 'object' and o.payload->'options' <> '{}'::jsonb
                            then o.payload->'options' end))),
          v_template, case when v_kind = 'clinic' then 'clinic' else 'person' end)
  returning id, job_code into v_job, v_code;

  for f in select * from public.client_order_file where order_id = o.id and completed_at is not null order by created_at loop
    n := n + 1;
    insert into public.job_file (job_id, org_id, type, sha256, size, mime_type, file_name, storage_path, completed_at)
    values (v_job, v_org,
            case when lower(f.file_name) ~ '\.(stl|ply|obj|dcm|3oxz)$' then 'scan'
                 when lower(f.file_name) ~ '\.(jpe?g|png|heic|webp)$' then 'photo' else 'other' end,
            f.sha256, f.size, f.mime_type,
            coalesce(v_code, 'order') || ' ' || n || coalesce(substring(f.file_name from '(\.[A-Za-z0-9]{1,8})$'), ''),
            f.storage_path, now())
    returning id into v_file;
    update public.client_order_file set job_file_id = v_file where id = f.id;
  end loop;

  update public.client_order set status = 'accepted', job_id = v_job, decided_at = now(), decided_by = auth.uid() where id = o.id;
  perform public.audit(v_org, 'create', 'job:' || v_job, jsonb_build_object('from_order', o.id));
  return v_job;
end;
$$;

create or replace function public.reject_client_order(p_order uuid, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if not public.has_perm('jobs.write') then raise exception 'Edit jobs is needed' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_reason, ''))) not between 1 and 500 then
    raise exception 'Say why, in at most 500 characters' using errcode = '22023';
  end if;
  update public.client_order set status = 'rejected', reject_reason = btrim(p_reason), decided_at = now(), decided_by = auth.uid()
   where id = p_order and org_id = public.my_org_id() and status = 'received';
  if not found then raise exception 'This order is already decided' using errcode = '22023'; end if;
end;
$$;

/** The clinic answers about an order. */
create or replace function public.post_order_message(p_order uuid, p_body text)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_id uuid; v_org uuid := public.my_org_id();
begin
  if not public.may_handle_orders(v_org) then raise exception 'Not allowed' using errcode = '42501'; end if;
  if not exists (select 1 from public.client_order where id = p_order and org_id = v_org) then
    raise exception 'Order not found' using errcode = '42501';
  end if;
  insert into public.client_order_message (org_id, order_id, from_client, author_id, body)
  values (v_org, p_order, false, auth.uid(), btrim(p_body)) returning id into v_id;
  return v_id;
end;
$$;

/** A file sent with an order, for the clinic's people: rights and the audit entry, then file-link signs it. */
create or replace function public.request_order_file_download(p_file uuid)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare f public.client_order_file;
begin
  select * into f from public.client_order_file where id = p_file and completed_at is not null;
  if f.id is null or not public.may_handle_orders(f.org_id) then
    raise exception 'File not found' using errcode = '42501';
  end if;
  perform public.audit(f.org_id, 'download', 'order_file:' || p_file, jsonb_build_object('order', f.order_id));
  return f.storage_path;
end;
$$;

-- ── Who may run what ────────────────────────────────────────────────────────
do $$
declare f text;
begin
  -- The client's side: the service role only (network-client).
  foreach f in array array[
    'public.network_session_client(text)', 'public.network_settings_for(uuid)',
    'public.network_connect(uuid, uuid, uuid, jsonb)', 'public.client_catalog(text)',
    'public.client_order_status(public.client_order, boolean)', 'public.client_orders(text)',
    'public.client_order_detail(text, uuid)', 'public.client_new_order(text, jsonb)',
    'public.client_post_message(text, uuid, text)', 'public.client_file_slot(text, uuid, text, bigint, text, text)',
    'public.client_file_done(text, uuid)', 'public.client_file_path(text, uuid)', 'public.client_end(text)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  -- The clinic's people.
  foreach f in array array[
    'public.may_handle_orders(uuid)', 'public.network_save_settings(boolean, text, uuid, int)',
    'public.network_confirm_client(uuid, text, jsonb)', 'public.network_set_client_visibility(uuid, jsonb)',
    'public.network_end_client(uuid)', 'public.accept_client_order(uuid, uuid)',
    'public.reject_client_order(uuid, text)', 'public.post_order_message(uuid, text)',
    'public.request_order_file_download(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ── Realtime: a new order shows at once ─────────────────────────────────────
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['client_order', 'client_order_message', 'network_client'] loop
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

select public.ensure_mfa_policies();
select public.lock_anon_functions();

-- ─── Verify (read only) ─────────────────────────────────────────────────────
-- select tablename, rowsecurity from pg_tables where schemaname = 'public'
--  and tablename in ('network_settings', 'network_client', 'network_client_session',
--                    'client_order', 'client_order_message', 'client_order_file');   -> six rows, all true
-- select has_function_privilege('authenticated', 'public.client_orders(text)', 'execute');   -> false
-- Afterwards, in SQL Editor on its own: notify pgrst, 'reload schema';
