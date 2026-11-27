-- ============================================================================
-- 154: a Network client's language, for the e-mails it gets about its orders
-- ============================================================================
--
-- Run AFTER 153.
--
-- The client chooses Wivo Network's language (English, Latvian, Russian or
-- Estonian) and it is kept on its Network account (Network 006). Its token
-- carries it, as it carries the name and the e-mail; network-client puts it
-- here with client_set_language. send-notifications then writes the client's
-- e-mails ("New message on TF-… from Dentiks") in it (pending_client_emails
-- now says which language); without one, in English, as before.
--
--   network_client.language   'en' | 'lv' | 'ru' | 'et'; null = not known
--
-- Only the e-mails' subject line and their "Open Wivo Network" line change:
-- never the message, the reason, a name or anything about the patient.

set lock_timeout = '10s';

alter table public.network_client add column if not exists language text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'network_client_language_valid') then
    alter table public.network_client add constraint network_client_language_valid
      check (language is null or language in ('en', 'lv', 'ru', 'et'));
  end if;
end $$;

/** The language from the client's signed Network token (Network 006; checked by network-client first). Unknown → not known. */
create or replace function public.client_set_language(p_network_clinic uuid, p_account uuid, p_lang text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_lang text := case when p_lang in ('en', 'lv', 'ru', 'et') then p_lang end;
begin
  select org_id into v_org from public.network_settings where network_clinic_id = p_network_clinic;
  if v_org is null then return; end if;
  update public.network_client set language = v_lang
   where org_id = v_org and account_id = p_account and language is distinct from v_lang;
end;
$$;

-- The notices to e-mail, now with the client's language (sql/142 had none, and
-- a function's columns cannot change in place).
drop function if exists public.pending_client_emails(int);
create function public.pending_client_emails(p_limit int default 200)
returns table (id uuid, email text, kind text, ref text, clinic text, created_at timestamptz, language text)
language sql
stable
security definer
set search_path = public
as $$
  select n.id, c.email, n.kind, n.ref, k.name, n.created_at, c.language
    from public.client_notification n
    join public.network_client c on c.id = n.client_id and c.org_id = n.org_id
    join public.clinics k on k.id = n.org_id
   where n.emailed_at is null and n.read_at is null
     and c.email is not null and c.email_notifications
     and n.created_at > now() - interval '1 day'
   order by n.created_at
   limit p_limit
$$;

do $$
declare f text;
begin
  foreach f in array array['public.client_set_language(uuid, uuid, text)', 'public.pending_client_emails(int)'] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

select public.lock_anon_functions();

-- ─── Verify (read only) ─────────────────────────────────────────────────────
-- select column_name from information_schema.columns where table_name = 'network_client' and column_name = 'language';   -> one row
-- select has_function_privilege('authenticated', 'public.client_set_language(uuid, uuid, text)', 'execute');            -> false
-- select pg_get_function_result('public.pending_client_emails(int)'::regprocedure) like '%language text%';              -> true
-- Afterwards, in SQL Editor on its own: notify pgrst, 'reload schema';
