-- ============================================================================
-- Wivo NETWORK — migration 005: which Terms of Use the account accepted
-- For the project `wivo-network` ONLY (docs/NETWORK-SETUP.md, A3).
-- ============================================================================
--
-- The Terms of Use and the Privacy Notice (docs/legal/) are accepted at sign-up
-- and again whenever their version changes (TERMS_VERSION in
-- src/renderer/src/lib/legal.ts). The account keeps the latest acceptance:
--
--   account.accepted_terms_version   e.g. '2026-11-draft'
--   account.accepted_terms_at        the server's time of acceptance
--
-- Written ONLY by accept_terms(): a user cannot put a version or a time there
-- directly. A trigger keeps both columns on any insert or update that does not
-- come from accept_terms (an insert gets nulls, an update keeps the old
-- values), whatever the grants allow. The account reads them (the table's
-- select grant).
--
-- Only the latest acceptance is kept (docs/legal/QUESTIONS-FOR-LAWYER.md, 10).
--
-- Idempotent.

set lock_timeout = '10s';

alter table public.account add column if not exists accepted_terms_version text;
alter table public.account add column if not exists accepted_terms_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'account_terms_version_valid') then
    alter table public.account add constraint account_terms_version_valid
      check (accepted_terms_version is null or (length(accepted_terms_version) <= 40
             and accepted_terms_version ~ '^[0-9]{4}-[0-9]{2}(-[a-z0-9]+)*$'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'account_terms_together') then
    alter table public.account add constraint account_terms_together
      check ((accepted_terms_version is null) = (accepted_terms_at is null));
  end if;
end $$;

/** Keeps the acceptance columns unless accept_terms() is writing them. */
create or replace function public.account_terms_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(current_setting('wivo.accepting_terms', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.accepted_terms_version := null;
    new.accepted_terms_at := null;
  else
    new.accepted_terms_version := old.accepted_terms_version;
    new.accepted_terms_at := old.accepted_terms_at;
  end if;
  return new;
end;
$$;
revoke execute on function public.account_terms_guard() from public, anon, authenticated;

drop trigger if exists account_terms_guard on public.account;
create trigger account_terms_guard before insert or update on public.account
  for each row execute function public.account_terms_guard();

/**
 * The signed-in account accepts the Terms of Use and the Privacy Notice of
 * version p_version, now. Needs the second factor and a profile.
 */
create or replace function public.accept_terms(p_version text)
returns table (accepted_terms_version text, accepted_terms_at timestamptz)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if not public.is_aal2() then raise exception 'Second factor needed' using errcode = '42501'; end if;
  if p_version is null or length(p_version) > 40 or p_version !~ '^[0-9]{4}-[0-9]{2}(-[a-z0-9]+)*$' then
    raise exception 'Not a terms version' using errcode = '22023';
  end if;
  perform set_config('wivo.accepting_terms', 'on', true);
  update public.account a
     set accepted_terms_version = p_version, accepted_terms_at = now()
   where a.id = auth.uid()
  returning a.id into v_id;
  perform set_config('wivo.accepting_terms', '', true);
  if v_id is null then raise exception 'Make your profile first' using errcode = '22023'; end if;
  return query select a.accepted_terms_version, a.accepted_terms_at from public.account a where a.id = v_id;
end;
$$;
revoke execute on function public.accept_terms(text) from public, anon;
grant execute on function public.accept_terms(text) to authenticated;

-- ─── Verify (read only) ─────────────────────────────────────────────────────
-- select column_name from information_schema.columns
--  where table_name = 'account' and column_name in ('accepted_terms_version', 'accepted_terms_at');   -> two rows
-- select tgname from pg_trigger where tgname = 'account_terms_guard';                                 -> one row
-- select has_function_privilege('anon', 'public.accept_terms(text)', 'execute');                      -> false
