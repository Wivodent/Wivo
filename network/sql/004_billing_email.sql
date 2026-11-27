-- ============================================================================
-- Wivo NETWORK — migration 004: a billing e-mail for invoices, in the token
-- For the project `wivo-network` ONLY (docs/NETWORK-SETUP.md).
-- ============================================================================
--
-- An account may give the address its invoices should go to, when that is not
-- its sign-in address (an accountant, a shared invoices@ mailbox). Optional.
-- It reaches each clinic the account is connected to the way the name does:
-- in the token the account asks for (the clinic's sql/152 puts it on the
-- account's client record there as its billing e-mail).
--
--   account.billing_email   empty = none; the account changes it in its profile
--   token_billing           that address, for the token (token_contact, 003,
--                           keeps its columns so that 003 can run again)
--
-- Idempotent.

set lock_timeout = '10s';

alter table public.account add column if not exists billing_email text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'account_billing_email_valid') then
    alter table public.account add constraint account_billing_email_valid
      check (billing_email is null or (length(billing_email) between 3 and 254 and billing_email ~ '^[^@[:space:]]+@[^@[:space:]]+$'));
  end if;
end $$;
grant update (billing_email) on public.account to authenticated;
grant insert (billing_email) on public.account to authenticated;

/** The account's billing e-mail for one clinic it is connected to. Nothing for an ended connection or without the second factor. */
create or replace function public.token_billing(p_clinic uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select a.billing_email
    from public.account a
    join public.connection c on c.account_id = a.id
   where public.is_aal2() and a.id = auth.uid() and c.clinic_id = p_clinic and c.state <> 'ended'
$$;
revoke execute on function public.token_billing(uuid) from public, anon;
grant execute on function public.token_billing(uuid) to authenticated;

-- ─── Verify (read only) ─────────────────────────────────────────────────────
-- select column_name from information_schema.columns where table_name = 'account' and column_name = 'billing_email';   -> one row
