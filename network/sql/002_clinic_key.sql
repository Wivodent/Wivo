-- ============================================================================
-- Wivo NETWORK — migration 002: a clinic changes its own directory entry
-- For the project `wivo-network` ONLY (docs/NETWORK-SETUP.md, A3 and A8).
-- ============================================================================
--
-- A clinic's owner turns "Show my clinic in the Wivo Network directory" on or
-- off in Wivo (Orders → Wivo Network) and sees the invite link. The clinic
-- has no Network account: its Edge Function network-directory signs a request
-- with the clinic's own private key (shared/network/clinicRequest.ts), and
-- the Network's Edge Function network-clinic checks it against the public key
-- kept here, then calls the functions below with the service key.
--
--   clinic_public_key   the clinic's Ed25519 public key (raw, base64url, 43
--                       characters); set by Wivo (Kevin), like the row itself
--   last_request_ms     the `iat` of the last change taken: a change needs a
--                       later one, so a replayed request does nothing
--
-- Neither column is readable by an account: the grant on public.clinic names
-- its columns (001), and these are not among them. The functions are for the
-- service role only.
--
-- Idempotent.

set lock_timeout = '10s';

alter table public.clinic add column if not exists clinic_public_key text;
alter table public.clinic add column if not exists last_request_ms bigint not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'clinic_public_key_valid') then
    alter table public.clinic add constraint clinic_public_key_valid
      check (clinic_public_key is null or clinic_public_key ~ '^[A-Za-z0-9_-]{43}$');
  end if;
end $$;

/** The key a request from this clinic must be signed with; null for a clinic without one. */
create or replace function public.clinic_request_key(p_clinic uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select c.clinic_public_key from public.clinic c where c.id = p_clinic
$$;

/** The clinic's own entry, as its owner sees it in Wivo. */
create or replace function public.clinic_own_entry(p_clinic uuid)
returns table (listed boolean, invite_code text, name text, city text, country text)
language sql
stable
security definer
set search_path = public
as $$
  select c.listed, c.invite_code, c.name, c.city, c.country from public.clinic c where c.id = p_clinic
$$;

/**
 * Listed or not, for a request signed at p_at (milliseconds). Nothing changes
 * unless p_at is later than the last change taken; then it says so.
 */
create or replace function public.clinic_set_listed(p_clinic uuid, p_listed boolean, p_at bigint)
returns table (listed boolean, invite_code text, name text, city text, country text)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if p_listed is null or p_at is null then raise exception 'Bad request' using errcode = '22023'; end if;
  update public.clinic c set listed = p_listed, last_request_ms = p_at
   where c.id = p_clinic and c.last_request_ms < p_at
  returning c.id into v_id;
  if v_id is null then
    if exists (select 1 from public.clinic c where c.id = p_clinic) then
      raise exception 'An older request' using errcode = '40001';
    end if;
    raise exception 'No such clinic' using errcode = '22023';
  end if;
  return query select c.listed, c.invite_code, c.name, c.city, c.country from public.clinic c where c.id = p_clinic;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array['public.clinic_request_key(uuid)', 'public.clinic_own_entry(uuid)',
                           'public.clinic_set_listed(uuid, boolean, bigint)'] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- ─── Verify (read only) ─────────────────────────────────────────────────────
-- select has_function_privilege('authenticated', 'public.clinic_set_listed(uuid, boolean, bigint)', 'execute');  -> false
-- select column_name from information_schema.column_privileges
--  where table_name = 'clinic' and grantee = 'authenticated' and column_name in ('clinic_public_key', 'last_request_ms');  -> no rows
