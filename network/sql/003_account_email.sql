-- ============================================================================
-- Wivo NETWORK — migration 003: the account's e-mail choice, in its token
-- For the project `wivo-network` ONLY (docs/NETWORK-SETUP.md, A3).
-- ============================================================================
--
-- A clinic e-mails a client about its orders (the clinic's sql/142, through
-- the clinic's own Resend): "New message on TF-DE-261127-001 from Dentiks"
-- and a link, nothing more. The clinic learns the address and whether the
-- client wants such e-mails from the token the account asks for, as it learns
-- the name. The Network keeps the choice; it keeps no notices.
--
--   account.email_notifications   on by default; the client turns it off in its profile
--   token_contact                 the sign-in address and email_notifications, for the token
--
-- Idempotent.

set lock_timeout = '10s';

alter table public.account add column if not exists email_notifications boolean not null default true;
grant update (email_notifications) on public.account to authenticated;

/**
 * The account's address and e-mail choice for one clinic it is connected to,
 * beside token_claims (001; its columns stay as they are, so 001 can run
 * again). Nothing for an ended connection or without the second factor.
 */
create or replace function public.token_contact(p_clinic uuid)
returns table (email text, email_notifications boolean)
language sql
stable
security definer
set search_path = public
as $$
  select u.email::text, a.email_notifications
    from public.account a
    join auth.users u on u.id = a.id
    join public.connection c on c.account_id = a.id
   where public.is_aal2() and a.id = auth.uid() and c.clinic_id = p_clinic and c.state <> 'ended'
$$;
revoke execute on function public.token_contact(uuid) from public, anon;
grant execute on function public.token_contact(uuid) to authenticated;
