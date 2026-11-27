-- ============================================================================
-- Wivo NETWORK — migration 001: accounts, the clinic directory, connections
-- For the project `wivo-network` ONLY (docs/NETWORK-SETUP.md). Never a
-- clinic's project: those have their own sql/ (sql/138 is the clinic's side).
-- ============================================================================
--
-- WHAT THE NETWORK HOLDS (docs/PLAN-NETWORK-1.md, N1)
--   account     a person's or a company's own login and profile; nobody else
--               reads it (a clinic learns the name, kind, role, company and
--               country from the signed token the account asks for)
--   clinic      the directory: Wivo clinics that take orders through the
--               Network. Listed ones can be found; any one can be reached
--               with its invite code. Written by Wivo (Kevin), not by users.
--   connection  account ↔ clinic: requested / confirmed / ended
--
-- WHAT IT NEVER HOLDS: an order, a file, a message, a price, a patient or
-- anything that points to one. Those live in the clinic's own project.
--
-- EVERYTHING needs the second factor (aal2): a restrictive policy on every
-- table, and every function checks it too (N6).
--
-- Idempotent.

set lock_timeout = '10s';
create extension if not exists pgcrypto with schema extensions;

/** The session was signed in with the second factor. */
create or replace function public.is_aal2()
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(auth.jwt()->>'aal', '') = 'aal2' and auth.uid() is not null
$$;

-- ── account ─────────────────────────────────────────────────────────────────
create table if not exists public.account (
  id            uuid primary key references auth.users(id) on delete cascade,
  kind          text not null,
  role          text not null,
  display_name  text not null,
  company_name  text,
  country       text,
  city          text,
  about         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint account_kind_valid check (kind in ('person', 'company')),
  constraint account_role_valid check (role in ('technician', 'doctor', 'clinic', 'lab')),
  constraint account_name_valid check (length(btrim(display_name)) between 1 and 120),
  constraint account_company_valid check (company_name is null or length(company_name) <= 160),
  constraint account_company_for_company check (kind = 'person' or length(btrim(coalesce(company_name, ''))) > 0),
  constraint account_country_valid check (country is null or country ~ '^[A-Z]{2}$'),
  constraint account_city_valid check (city is null or length(city) <= 120),
  constraint account_about_valid check (about is null or length(about) <= 1000)
);
alter table public.account enable row level security;

drop policy if exists "account_aal2" on public.account;
create policy "account_aal2" on public.account as restrictive for all to authenticated
  using (public.is_aal2()) with check (public.is_aal2());
drop policy if exists "account_own_select" on public.account;
create policy "account_own_select" on public.account for select to authenticated using (id = auth.uid());
drop policy if exists "account_own_insert" on public.account;
create policy "account_own_insert" on public.account for insert to authenticated with check (id = auth.uid());
drop policy if exists "account_own_update" on public.account;
create policy "account_own_update" on public.account for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

revoke all on public.account from public, anon, authenticated;
grant select, insert, update (kind, role, display_name, company_name, country, city, about, updated_at) on public.account to authenticated;
grant insert (id) on public.account to authenticated;

-- ── clinic: the directory ───────────────────────────────────────────────────
create table if not exists public.clinic (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  country      text not null,
  city         text,
  -- The clinic's own project address, where its network-client function is:
  -- https://<ref>.supabase.co. Public anyway (it ships in the clinic's phone app).
  api_url      text not null,
  listed       boolean not null default false,
  invite_code  text not null unique default encode(extensions.gen_random_bytes(9), 'hex'),
  created_at   timestamptz not null default now(),
  constraint clinic_name_valid check (length(btrim(name)) between 1 and 160),
  constraint clinic_country_valid check (country ~ '^[A-Z]{2}$'),
  constraint clinic_api_url_valid check (api_url ~ '^https://[a-z0-9]{20}\.supabase\.co$'),
  constraint clinic_invite_valid check (invite_code ~ '^[a-z0-9]{12,40}$')
);
alter table public.clinic enable row level security;

drop policy if exists "clinic_aal2" on public.clinic;
create policy "clinic_aal2" on public.clinic as restrictive for all to authenticated
  using (public.is_aal2()) with check (public.is_aal2());
revoke all on public.clinic from public, anon, authenticated;
grant select (id, name, country, city, api_url, listed) on public.clinic to authenticated;

-- ── connection ──────────────────────────────────────────────────────────────
create table if not exists public.connection (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references public.account(id) on delete cascade,
  clinic_id     uuid not null references public.clinic(id) on delete cascade,
  state         text not null default 'requested',
  requested_at  timestamptz not null default now(),
  confirmed_at  timestamptz,
  ended_at      timestamptz,
  ended_by      text,
  constraint connection_unique unique (account_id, clinic_id),
  constraint connection_state_valid check (state in ('requested', 'confirmed', 'ended')),
  constraint connection_ended_by_valid check (ended_by is null or ended_by in ('account', 'clinic')),
  constraint connection_ended_has_time check ((state = 'ended') = (ended_at is not null))
);
create index if not exists connection_clinic_idx on public.connection (clinic_id);
alter table public.connection enable row level security;

drop policy if exists "connection_aal2" on public.connection;
create policy "connection_aal2" on public.connection as restrictive for all to authenticated
  using (public.is_aal2()) with check (public.is_aal2());
drop policy if exists "connection_own_select" on public.connection;
create policy "connection_own_select" on public.connection for select to authenticated using (account_id = auth.uid());
-- No write policy: every change goes through the functions below.
revoke all on public.connection from public, anon, authenticated;
grant select on public.connection to authenticated;

-- Listed clinics are the directory; an unlisted one only through its invite
-- code (clinic_by_invite) or once connected.
drop policy if exists "clinic_listed_select" on public.clinic;
create policy "clinic_listed_select" on public.clinic for select to authenticated using (
  listed or exists (select 1 from public.connection c where c.clinic_id = clinic.id and c.account_id = auth.uid())
);

-- ── Functions ───────────────────────────────────────────────────────────────

/** An unlisted clinic, by the code in its invite link. */
create or replace function public.clinic_by_invite(p_code text)
returns table (id uuid, name text, country text, city text, api_url text)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.name, c.country, c.city, c.api_url from public.clinic c
   where public.is_aal2() and c.invite_code = lower(btrim(p_code))
$$;

/** Ask a clinic to connect. A new request, or again after it was ended. */
create or replace function public.request_connection(p_clinic uuid)
returns public.connection
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v public.connection;
begin
  if not public.is_aal2() then raise exception 'Second factor needed' using errcode = '42501'; end if;
  if not exists (select 1 from public.account where id = auth.uid()) then
    raise exception 'Make your profile first' using errcode = '22023';
  end if;
  if not exists (select 1 from public.clinic where id = p_clinic) then
    raise exception 'No such clinic' using errcode = '22023';
  end if;
  insert into public.connection (account_id, clinic_id) values (auth.uid(), p_clinic)
  on conflict (account_id, clinic_id) do update
     set state = 'requested', requested_at = now(), confirmed_at = null, ended_at = null, ended_by = null
   where public.connection.state = 'ended'
  returning * into v;
  if v.id is null then
    select * into v from public.connection where account_id = auth.uid() and clinic_id = p_clinic;
  end if;
  return v;
end;
$$;

/**
 * What the clinic said, as the account's app reports it (N7): confirmed or
 * ended. Shown only; the clinic's own project decides access.
 */
create or replace function public.report_connection_state(p_connection uuid, p_state text)
returns public.connection
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v public.connection;
begin
  if not public.is_aal2() then raise exception 'Second factor needed' using errcode = '42501'; end if;
  if p_state not in ('confirmed', 'ended') then raise exception 'Not a state' using errcode = '22023'; end if;
  update public.connection
     set state = p_state,
         confirmed_at = case when p_state = 'confirmed' then coalesce(confirmed_at, now()) else confirmed_at end,
         ended_at = case when p_state = 'ended' then now() end,
         ended_by = case when p_state = 'ended' then 'clinic' end
   where id = p_connection and account_id = auth.uid()
     and (state = 'requested' and p_state = 'confirmed' or state <> 'ended' and p_state = 'ended')
  returning * into v;
  if v.id is null then select * into v from public.connection where id = p_connection and account_id = auth.uid(); end if;
  if v.id is null then raise exception 'No such connection' using errcode = '42501'; end if;
  return v;
end;
$$;

/** The account ends a connection itself. No more tokens for that clinic. */
create or replace function public.end_connection(p_connection uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if not public.is_aal2() then raise exception 'Second factor needed' using errcode = '42501'; end if;
  update public.connection set state = 'ended', ended_at = now(), ended_by = 'account'
   where id = p_connection and account_id = auth.uid() and state <> 'ended';
end;
$$;

/**
 * What network-token signs (N2): the account and its live connection to ONE
 * clinic. Nothing for an ended connection, a missing profile or a session
 * without the second factor.
 */
create or replace function public.token_claims(p_clinic uuid)
returns table (account_id uuid, connection_id uuid, name text, kind text, role text,
               company text, country text, clinic_id uuid, api_url text)
language sql
stable
security definer
set search_path = public
as $$
  select a.id, c.id, a.display_name, a.kind, a.role, a.company_name, a.country, k.id, k.api_url
    from public.account a
    join public.connection c on c.account_id = a.id
    join public.clinic k on k.id = c.clinic_id
   where public.is_aal2() and a.id = auth.uid() and c.clinic_id = p_clinic and c.state <> 'ended'
$$;

-- Only signed-in accounts run anything; the anon key runs nothing.
do $$
declare f text;
begin
  foreach f in array array['public.is_aal2()', 'public.clinic_by_invite(text)', 'public.request_connection(uuid)',
                           'public.report_connection_state(uuid, text)', 'public.end_connection(uuid)',
                           'public.token_claims(uuid)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ─── Verify (read only) ─────────────────────────────────────────────────────
-- select tablename, rowsecurity from pg_tables where schemaname = 'public';  -> account, clinic, connection: all true
