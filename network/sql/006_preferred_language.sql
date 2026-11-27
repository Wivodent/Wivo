-- ============================================================================
-- Wivo NETWORK — migration 006: the account's language, in its token
-- For the project `wivo-network` ONLY (docs/NETWORK-SETUP.md, A3).
-- ============================================================================
--
-- Wivo Network speaks English, Latvian, Russian and Estonian
-- (NETWORK_LANGUAGES in shared/i18n). The language picker saves the choice on
-- the account, so it follows the person to another device, and each clinic
-- the account is connected to learns it from the token, as it learns the name
-- (the clinic's sql/154): its e-mails about orders are then in that language.
--
--   account.preferred_language   'en' | 'lv' | 'ru' | 'et'; empty = not chosen yet
--   token_language               that language, for the token (token_contact,
--                                003, and token_billing, 004, keep their
--                                columns so that they can run again)
--
-- Idempotent.

set lock_timeout = '10s';

alter table public.account add column if not exists preferred_language text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'account_preferred_language_valid') then
    alter table public.account add constraint account_preferred_language_valid
      check (preferred_language is null or preferred_language in ('en', 'lv', 'ru', 'et'));
  end if;
end $$;
grant update (preferred_language) on public.account to authenticated;
grant insert (preferred_language) on public.account to authenticated;

/** The account's language for one clinic it is connected to. Nothing for an ended connection or without the second factor. */
create or replace function public.token_language(p_clinic uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select a.preferred_language
    from public.account a
    join public.connection c on c.account_id = a.id
   where public.is_aal2() and a.id = auth.uid() and c.clinic_id = p_clinic and c.state <> 'ended'
$$;
revoke execute on function public.token_language(uuid) from public, anon;
grant execute on function public.token_language(uuid) to authenticated;

-- ─── Verify (read only) ─────────────────────────────────────────────────────
-- select column_name from information_schema.columns where table_name = 'account' and column_name = 'preferred_language';   -> one row
-- select has_function_privilege('anon', 'public.token_language(uuid)', 'execute');                                          -> false
