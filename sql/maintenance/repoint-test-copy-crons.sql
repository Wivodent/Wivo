-- ============================================================================
-- Wivo — the TEST COPY's scheduled jobs call the test copy, not production
-- ============================================================================
--
-- NOT a migration. Kevin runs it by hand, in the SQL Editor of the test copy
-- (jhqyvancrzykxhzwnost), and only there.
--
-- Why: the test copy was restored from production (wrtucsfmpbwekugzzzxw), so
-- it has production's scheduled jobs and production's Vault:
--   wivo-send-invoices       sql/052 wrote production's address into it;
--   wivo-send-notifications  calls the Vault's address (wivo_functions_url,
--                            sql/077), copied from production;
--   both send the Vault's service key (wivo_service_role_key), production's.
-- So every hour the test copy starts production's invoice run, with
-- production's key, at the same minute as production's own. Production never
-- runs the test copy's.
--
-- The other jobs (wivo-delivery-reminders, wivo-auto-invoices, the chat and
-- visit-request jobs) run SQL inside this database and call nothing; part 2
-- leaves them as they are.
--
-- FOUR PARTS. Run them one at a time, in order (select a part, then Run):
--   PART 1  read only: every scheduled job and what it calls.
--   PART 2  changes: each Wivo job that calls a functions address now calls
--           the test copy's, with the same schedule; the Vault's address is
--           the test copy's; production's service key (and anything else in
--           the Vault that cannot work here) is deleted. One transaction: if
--           anything fails, nothing is changed. It stops, changing nothing,
--           unless you typed the test copy's ref where it says so, and on a
--           database that is production or Dentiks's.
--   PART 3  not SQL: the test copy's own secret key into the Vault, through
--           the Dashboard. The key is never written into SQL.
--   PART 4  read only: no job calls another project, and the Vault holds no
--           key of another project.
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════════════
-- PART 1 — read only: the scheduled jobs and their targets
-- ════════════════════════════════════════════════════════════════════════════
-- Two SELECTs. The first reads only the jobs; the second, the Vault's address.
-- If the second stops with a decryption error, the Vault came with the copy
-- from production and cannot be read here at all (PART 2 deletes what cannot
-- be read). Changes nothing; shows no key.

-- 1a. Every job: its schedule, whether it runs, and what it calls.
with project(ref, name) as (values
  ('wrtucsfmpbwekugzzzxw', 'PRODUCTION'),
  ('jhqyvancrzykxhzwnost', 'the test copy'),
  ('fwsrnsdrlrlmjfkkkhvp', 'Dentiks')
)
select j.jobid, j.jobname, j.schedule, j.active,
       case
         when j.command ~ 'https://[a-z0-9]+\.(functions\.)?supabase\.co'
           then substring(j.command from 'https://[a-z0-9]+\.(?:functions\.)?supabase\.co[^''"[:space:]]*')
         when j.command like '%wivo_functions_url%' then '(the Vault''s wivo_functions_url, see 1b) + its path'
         else '(nothing outside this database)'
       end as target,
       coalesce((select p.name from project p where j.command like '%' || p.ref || '%'),
                case when j.command ~ 'https://' then 'ANOTHER PROJECT'
                     when j.command like '%wivo_functions_url%' then 'see 1b' else '—' end) as calls
  from cron.job j
 order by j.jobname;

-- 1b. The Vault's address, which wivo-send-notifications calls.
select name, decrypted_secret as address,
       case when decrypted_secret like '%wrtucsfmpbwekugzzzxw%' then 'PRODUCTION'
            when decrypted_secret like '%jhqyvancrzykxhzwnost%' then 'the test copy'
            when decrypted_secret like '%fwsrnsdrlrlmjfkkkhvp%' then 'Dentiks'
            else 'ANOTHER PROJECT' end as calls
  from vault.decrypted_secrets where name = 'wivo_functions_url';


-- ════════════════════════════════════════════════════════════════════════════
-- PART 2 — changes: repoint the Wivo jobs and clean the Vault (test copy only)
-- ════════════════════════════════════════════════════════════════════════════
-- Before running: type the test copy's ref between the quotes on the line
-- marked "TYPE HERE". It is in the Dashboard's address while you are in the
-- test copy (…/project/<ref>/…). Anything else and nothing is changed.

set lock_timeout = '10s';

drop table if exists pg_temp.repoint_report;
create temp table repoint_report (n serial, part text, what text);

do $$
declare
  c_test  constant text := 'jhqyvancrzykxhzwnost';
  c_base  constant text := 'https://jhqyvancrzykxhzwnost.supabase.co/functions/v1';
  c_typed constant text := '';   -- TYPE HERE: the ref of the project this SQL Editor is open in
  j record;
  s record;
  v_new text;
  v_val text;
  v_ref text;
  v_ok boolean;
begin
  -- Guards: the operator's word, then what the database itself says.
  if c_typed <> c_test then
    raise exception 'Type the test copy''s ref (%) on the line marked TYPE HERE. Nothing was changed.', c_test;
  end if;
  if to_regprocedure('public.lock_anon_functions()') is null then
    raise exception 'This database lacks sql/101: production (frozen at 091 and 098). Nothing was changed.';
  end if;
  if exists (select 1 from public.clinics where id = '0641ae3d-5bdb-4e67-b147-6cc45ba59bb4')
     and not exists (select 1 from public.clinics where id <> '0641ae3d-5bdb-4e67-b147-6cc45ba59bb4') then
    raise exception 'This database holds only Dentiks: Dentiks''s own project, not the test copy. Nothing was changed.';
  end if;
  if to_regclass('cron.job') is null then
    raise exception 'No pg_cron here: there are no scheduled jobs to repoint. Nothing was changed.';
  end if;

  -- 1. Every Wivo job that calls a functions address: the test copy's, the same function, the same schedule.
  for j in select jobid, jobname, schedule, command from cron.job where jobname like 'wivo-%' order by jobname loop
    v_new := regexp_replace(j.command,
      'https://[a-z0-9]+\.(functions\.supabase\.co|supabase\.co/functions/v1)/', c_base || '/', 'g');
    if v_new is distinct from j.command then
      perform cron.alter_job(job_id := j.jobid, command := v_new);
      insert into pg_temp.repoint_report (part, what) values ('1. jobs',
        format('%s (%s): now calls %s', j.jobname, j.schedule,
               substring(v_new from 'https://[a-z0-9]+\.supabase\.co/functions/v1/[A-Za-z0-9_-]+')));
    elsif j.command like '%wivo_functions_url%' then
      insert into pg_temp.repoint_report (part, what) values ('1. jobs',
        format('%s (%s): calls the Vault''s address, set below', j.jobname, j.schedule));
    else
      insert into pg_temp.repoint_report (part, what) values ('1. jobs',
        format('%s (%s): calls nothing outside this database; left as it is', j.jobname, j.schedule));
    end if;
  end loop;

  -- 2. The Vault's address (wivo-send-notifications appends its own path). An address, not a secret.
  delete from vault.secrets where name = 'wivo_functions_url';
  perform vault.create_secret(c_base, 'wivo_functions_url', 'The test copy''s Edge Functions (sql/maintenance/repoint-test-copy-crons.sql)');
  insert into pg_temp.repoint_report (part, what) values ('2. Vault', 'wivo_functions_url = ' || c_base);

  -- 3. Production's service key: deleted. The test copy's own goes in through the Dashboard (PART 3).
  if exists (select 1 from vault.secrets where name = 'wivo_service_role_key') then
    delete from vault.secrets where name = 'wivo_service_role_key';
    insert into pg_temp.repoint_report (part, what) values ('3. Vault',
      'wivo_service_role_key deleted (the copied key). Until PART 3 the jobs send no key and the functions answer 401: nothing runs.');
  else
    insert into pg_temp.repoint_report (part, what) values ('3. Vault', 'wivo_service_role_key was not there');
  end if;

  -- Anything else in the Vault that cannot work here: a secret this project cannot decrypt (it came
  -- with the copy), or a key whose payload names another project. Others are named, never shown.
  for s in select id, name from vault.secrets where name is distinct from 'wivo_functions_url' order by name loop
    v_ok := true; v_ref := null;
    begin
      select decrypted_secret into v_val from vault.decrypted_secrets where id = s.id;
    exception when others then
      v_ok := false;
    end;
    if v_ok and v_val like 'eyJ%' then
      begin  -- what the key's payload says; a payload that is not one is simply not a key of another project
        v_ref := substring(convert_from(decode(translate(split_part(v_val, '.', 2), '-_', '+/')
                   || repeat('=', (4 - length(split_part(v_val, '.', 2)) % 4) % 4), 'base64'), 'UTF8') from '"ref" *: *"([a-z0-9]+)"');
      exception when others then
        v_ref := null;
      end;
    end if;
    if not v_ok then
      delete from vault.secrets where id = s.id;
      insert into pg_temp.repoint_report (part, what) values ('3. Vault', coalesce(s.name, '(no name)') || ': deleted, it cannot be decrypted here (copied from another project)');
    elsif v_ref is not null and v_ref <> c_test then
      delete from vault.secrets where id = s.id;
      insert into pg_temp.repoint_report (part, what) values ('3. Vault', coalesce(s.name, '(no name)') || ': deleted, a key of project ' || v_ref);
    else
      insert into pg_temp.repoint_report (part, what) values ('3. Vault', coalesce(s.name, '(no name)') || ': kept');
    end if;
  end loop;
end $$;

select part, what from pg_temp.repoint_report order by n;


-- ════════════════════════════════════════════════════════════════════════════
-- PART 3 — not SQL: the test copy's own secret key into the Vault (Dashboard)
-- ════════════════════════════════════════════════════════════════════════════
-- The key is never typed into SQL, a file or a command line.
--
--   1. In the test copy's Dashboard: Project Settings → API Keys → Secret keys.
--      Create a secret key for the scheduled jobs (name it e.g. "cron"), and
--      copy it (it starts sb_secret_).
--   2. Integrations → Vault → Secrets → Add new secret:
--        Name:   wivo_service_role_key      (exactly this: the jobs read it)
--        Secret: the key you copied
--      Save.
--   3. If the functions then answer 401 (PART 4's last row, or
--      net._http_response): Edge Functions → Secrets → add
--      WIVO_SERVICE_SECRET_KEY with the same key (the functions accept it
--      there when the platform does not hand them its own list of secret
--      keys; supabase/functions/_shared/serviceAuth.ts).
--   4. Deploy send-invoices and send-notifications to the test copy with
--      --no-verify-jwt if they are not there yet (docs/MIGRATIONS.md).


-- ════════════════════════════════════════════════════════════════════════════
-- PART 4 — read only: nothing points at another project
-- ════════════════════════════════════════════════════════════════════════════
-- Expected: every row says "ok", except "not set yet" for the key before
-- PART 3. Changes nothing; shows no key, only which project a key was made for.

with c(test) as (values ('jhqyvancrzykxhzwnost')),
url as (select decrypted_secret as u from vault.decrypted_secrets where name = 'wivo_functions_url'),
keys as (
  select v.name, v.decrypted_secret as s,
         case when v.decrypted_secret like 'eyJ%' and split_part(v.decrypted_secret, '.', 2) ~ '^[A-Za-z0-9_-]+$'
                   and length(split_part(v.decrypted_secret, '.', 2)) % 4 <> 1 then
           substring(convert_from(decode(translate(split_part(v.decrypted_secret, '.', 2), '-_', '+/')
             || repeat('=', (4 - length(split_part(v.decrypted_secret, '.', 2)) % 4) % 4), 'base64'), 'UTF8') from '"ref" *: *"([a-z0-9]+)"')
         end as ref
    from vault.decrypted_secrets v
)
select 'job ' || j.jobname as what,
       case
         when j.command ~ 'https://[a-z0-9]+\.(functions\.)?supabase\.co'
           then case when j.command ~ ('https://' || (select test from c) || '\.')
                       and j.command !~ ('https://(?!' || (select test from c) || '\.)[a-z0-9]+\.(functions\.)?supabase\.co')
                     then 'ok: calls the test copy' else 'WRONG: calls another project' end
         when j.command like '%wivo_functions_url%'
           then case when (select u from url) like 'https://' || (select test from c) || '.%' then 'ok: the Vault''s address, the test copy''s'
                     when (select u from url) is null then 'WRONG: the Vault''s address is not set'
                     else 'WRONG: the Vault''s address is another project''s' end
         else 'ok: calls nothing outside this database'
       end as finding
  from cron.job j
union all
select 'Vault wivo_functions_url',
       coalesce((select case when u like 'https://' || (select test from c) || '.%' then 'ok: ' || u else 'WRONG: ' || u end from url), 'WRONG: not set')
union all
select 'Vault wivo_service_role_key',
       coalesce((select case when s like 'sb\_secret\_%' then 'ok: an sb_secret key (added in PART 3)'
                             when ref = (select test from c) then 'ok: a key of the test copy'
                             when ref is not null then 'WRONG: a key of project ' || ref
                             else 'WRONG: not a key the functions accept' end
                   from keys where name = 'wivo_service_role_key'), 'not set yet: PART 3')
union all
select 'Vault ' || coalesce(name, '(no name)'), 'WRONG: a key of project ' || ref
  from keys where ref is not null and ref <> (select test from c) and name is distinct from 'wivo_service_role_key'
union all
select 'last answer to this database''s calls',
       coalesce((select status_code::text || ' at ' || created from net._http_response order by created desc limit 1), 'none yet')
order by 1;
