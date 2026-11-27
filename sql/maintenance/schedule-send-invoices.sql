-- ============================================================================
-- Wivo — schedule the invoice sender (wivo-send-invoices), every 15 minutes
-- ============================================================================
--
-- NOT a migration. Kevin runs it by hand in the SQL Editor of the project
-- that should e-mail its invoices: the test copy, or a clinic's own project
-- (Dentiks). Never production. It can be run again: it replaces the job.
--
-- Why: the test copy has no wivo-send-invoices job, and neither has a clinic
-- set up with docs/CLINIC-SETUP.md (scripts/fresh-schema.mjs removes sql/052's
-- job, because 052 wrote PRODUCTION's address into it). Without it, an
-- invoice marked Sent, or issued by automatic invoicing (sql/151) with "Send
-- automatically", is never e-mailed.
--
-- The job is built like wivo-send-notifications (sql/077): the address is the
-- Vault's wivo_functions_url + /send-invoices, the key the Vault's
-- wivo_service_role_key. Nothing is written into the job itself, so it calls
-- this project's own function and no other. Without wivo_functions_url the
-- job does nothing.
--
-- Every 15 minutes, at :09, :24, :39 and :54: two minutes after automatic
-- invoicing (wivo-auto-invoices, :07 and :37), off the full hour. What may go
-- out is still the clinic's own choice (Settings → Email: automatic sending
-- on, invoices allowed, the daily cap, the test address), and on the test
-- copy only to EMAIL_ALLOW_ONLY.
--
-- TWO PARTS. Select a part, then Run:
--   PART 1  schedules the job (stops, changing nothing, on production, without
--           pg_cron, or without the Vault's address and key)
--   PART 2  read only: the job, where it goes, with what key, the last answers
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════════════
-- PART 1 — schedule wivo-send-invoices (idempotent)
-- ════════════════════════════════════════════════════════════════════════════

do $$
declare v_url text;
begin
  if to_regprocedure('public.lock_anon_functions()') is null then
    raise exception 'This database lacks sql/101: production (frozen at 091 and 098). Nothing was changed.';
  end if;
  if to_regclass('cron.job') is null or to_regnamespace('net') is null then
    raise exception 'pg_cron and pg_net are needed (Database → Extensions). Nothing was changed.';
  end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'wivo_functions_url';
  if v_url is null then
    raise exception 'The Vault has no wivo_functions_url (this project''s functions address; docs/CLINIC-SETUP.md step 3). Nothing was changed.';
  end if;
  if v_url like '%wrtucsfmpbwekugzzzxw%' then
    raise exception 'The Vault''s wivo_functions_url is PRODUCTION''s (a test copy: run sql/maintenance/repoint-test-copy-crons.sql first). Nothing was changed.';
  end if;
  if not exists (select 1 from vault.secrets where name = 'wivo_service_role_key') then
    raise exception 'The Vault has no wivo_service_role_key (this project''s sb_secret key, added in the Dashboard). Nothing was changed.';
  end if;
end $$;

select cron.unschedule('wivo-send-invoices')
 where exists (select 1 from cron.job where jobname = 'wivo-send-invoices');

select cron.schedule(
  'wivo-send-invoices',
  '9,24,39,54 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'wivo_functions_url') || '/send-invoices',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'wivo_service_role_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  )
  where exists (select 1 from vault.decrypted_secrets where name = 'wivo_functions_url');
  $$
);


-- ════════════════════════════════════════════════════════════════════════════
-- PART 2 — read only: is it right?
-- ════════════════════════════════════════════════════════════════════════════
-- Expected: every row "ok". The last row needs the job to have run once
-- (wait until the next :09, :24, :39 or :54): 200 = the sender ran (Settings
-- → Email then says when); 401 = the Vault's key and the function's
-- WIVO_SERVICE_SECRET_KEY are not the same sb_secret key; 404 = send-invoices
-- is not deployed in this project; 500 "SMTP" = its SMTP secrets are missing.
-- Shows no key, only its kind.

with job as (select schedule, active, command from cron.job where jobname = 'wivo-send-invoices'),
url as (select decrypted_secret as u from vault.decrypted_secrets where name = 'wivo_functions_url'),
key as (select decrypted_secret as k from vault.decrypted_secrets where name = 'wivo_service_role_key')
select 1 as o, 'job wivo-send-invoices' as what,
       coalesce((select case when not active then 'WRONG: paused'
                             when schedule <> '9,24,39,54 * * * *' then 'WRONG: schedule ' || schedule
                             else 'ok: ' || schedule end from job), 'WRONG: not scheduled (run PART 1)') as finding
union all
select 2, 'its address',
       coalesce((select case when command ~ 'https://' then 'WRONG: an address written into the job'
                             when command like '%wivo_functions_url%' and command like '%/send-invoices%' then 'ok: the Vault''s address + /send-invoices'
                             else 'WRONG: not the Vault''s address' end from job), '—')
union all
select 3, 'Vault wivo_functions_url',
       coalesce((select case when u like '%wrtucsfmpbwekugzzzxw%' then 'WRONG: PRODUCTION''s: ' || u
                             when u ~ '^https://[a-z0-9]{20}\.(functions\.supabase\.co|supabase\.co/functions/v1)/?$' then 'ok: ' || u
                             else 'WRONG: not a functions address: ' || u end from url), 'WRONG: not set')
union all
select 4, 'Vault wivo_service_role_key',
       coalesce((select case when k like 'sb\_secret\_%' then 'ok: an sb_secret key'
                             when k like 'eyJ%' then 'WRONG: a legacy JWT (a new project''s gateway answers it 401): put the sb_secret key in'
                             else 'WRONG: not a key the functions accept' end from key), 'WRONG: not set')
union all
select 5, 'last answers to this database''s calls',
       coalesce((select string_agg(coalesce(status_code::text, 'none') || ' at ' || to_char(created, 'YYYY-MM-DD HH24:MI'), ', ' order by created desc)
                   from (select status_code, created from net._http_response order by created desc limit 5) r), 'none yet')
order by 1;
