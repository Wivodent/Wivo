-- ============================================================================
-- Wivo — migration 135: the security review's database fixes (2.2.5)
-- Run after 134. Then, as a SEPARATE query:  notify pgrst, 'reload schema';
-- docs/SECURITY-REVIEW-2026-11.md D1, D2, R1, S2.
-- ============================================================================
--
-- 1. A WORKER'S PASSWORD, SET BY THE OWNER (D1)
--   admin_set_worker_password (sql/030, 113) wrote no audit entry, asked for
--   no fresh code, and left the worker's open sessions running. From 2.2.5
--   the Edge Function `team-account` does it in three steps:
--     authorize_password_set(user)   as the owner: the owner of the same
--                                    clinic, with an authenticator code from
--                                    the last 5 minutes (sql/120); the target
--                                    a worker of that clinic, or the owner
--                                    themself; never another owner;
--     (GoTrue's admin API sets the password: the service key, in the function)
--     complete_password_set(…)       as the service role only: the audit entry
--                                    (`password_set`, never the password) and
--                                    every session of the worker ended.
--   admin_set_worker_password is closed to signed-in users; a 2.2.4 desktop
--   that still calls it is told it may not (no permission).
--
-- 2. CLEAN-UP THAT RUNS FOR EVERY CLINIC (D2)
--   chat_prune() and purge_visit_requests() delete, across every clinic on the
--   project, what is past its keeping time. The nightly pg_cron runs them as
--   the database owner; a signed-in user could run them too. Closed to them.
--
-- 3. NO TABLE RIGHTS FOR THE ANONYMOUS KEY (R1, SEC4)
--   Supabase's defaults give `anon` every right on every table; row security
--   has stopped it so far (sql/098, the tenant tests). Taken away, here and for
--   tables made later: what the anonymous key may do is nothing, by grant as
--   well as by policy. The booking page and the public functions use the
--   service key in Edge Functions; nothing in the app reads a table as anon.
--
-- 4. A PREVIEW IS A SMALL IMAGE (S2)
--   confirm_job_file_preview accepted any object at the preview path. A
--   preview is shown as a picture and handed out by signed link: it must be
--   image/png, image/webp or image/jpeg, and at most 5 MB.

set lock_timeout = '10s';

-- ── 1. A worker's password ──────────────────────────────────────────────────

alter table public.audit_log drop constraint if exists audit_log_action_valid;
alter table public.audit_log add constraint audit_log_action_valid
  check (action in ('view', 'download', 'upload', 'share', 'unshare', 'stage_move',
                    'partnership', 'export', 'question', 'delete', 'restore', 'stock_override',
                    'mfa_added', 'mfa_removed', 'mfa_reset', 'account_deleted',
                    'create', 'edit', 'permission', 'file_deleted', 'update',
                    'stage_start', 'stage_edit', 'password_set'));

/**
 * May the caller set this person's password? Their organisation, ids and
 * name for complete_password_set, or a refusal. Changes nothing.
 */
create or replace function public.authorize_password_set(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := public.require_own_mfa();
  t     record;
begin
  if not exists (select 1 from public.profiles
                  where id = auth.uid() and clinic_id = v_org and (role = 'owner' or org_role = 'owner')) then
    raise exception 'Only the owner can set a password' using errcode = '42501';
  end if;
  if not public.fresh_second_factor(300) then
    raise exception 'Enter a code from your authenticator app first' using errcode = '42501', hint = 'fresh_code';
  end if;
  select p.id, coalesce(p.full_name, '') as name, (p.role = 'owner' or p.org_role = 'owner') as is_owner into t
    from public.profiles p
   where p.id = p_user and p.clinic_id = v_org and p.role in ('owner', 'worker');
  if not found then
    raise exception 'Not a member of your organisation' using errcode = '42501';
  end if;
  if t.is_owner and p_user <> auth.uid() then
    raise exception 'Another owner''s password cannot be set' using errcode = '42501';
  end if;
  return jsonb_build_object('ok', true, 'actor_id', auth.uid(), 'user_id', p_user, 'org_id', v_org, 'name', t.name);
end;
$$;

revoke execute on function public.authorize_password_set(uuid) from public, anon;
grant execute on function public.authorize_password_set(uuid) to authenticated;

/**
 * After GoTrue has set the password: the audit entry and the person's
 * sessions ended (their refresh tokens go with them; an access token already
 * handed out runs out within the hour). The service role only.
 */
create or replace function public.complete_password_set(p_org uuid, p_actor uuid, p_target uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_target_name text;
begin
  select coalesce(full_name, '') into v_target_name from public.profiles where id = p_target and clinic_id = p_org;
  if not found then
    raise exception 'Not a member of that organisation' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = p_actor and clinic_id = p_org) then
    raise exception 'The actor is not a member of that organisation' using errcode = '42501';
  end if;

  insert into public.audit_log (org_id, user_id, action, object, detail)
  values (p_org, p_actor, 'password_set', 'user:' || p_target,
          jsonb_build_object('target_name', v_target_name, 'signed_out', p_target <> p_actor));

  -- The owner setting their own password keeps the session they are in.
  if p_target <> p_actor then
    delete from auth.sessions where user_id = p_target;
    delete from public.push_subscription where user_id = p_target;
  end if;
end;
$$;

revoke execute on function public.complete_password_set(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.complete_password_set(uuid, uuid, uuid) to service_role;

do $$
begin
  if to_regprocedure('public.admin_set_worker_password(uuid, text)') is not null then
    revoke execute on function public.admin_set_worker_password(uuid, text) from public, anon, authenticated;
  end if;
end $$;

-- ── 2. Clean-up for every clinic: the database's own job ────────────────────

do $$
begin
  if to_regprocedure('public.chat_prune()') is not null then
    revoke execute on function public.chat_prune() from public, anon, authenticated;
  end if;
  if to_regprocedure('public.purge_visit_requests()') is not null then
    revoke execute on function public.purge_visit_requests() from public, anon, authenticated;
  end if;
end $$;

-- ── 3. No table rights for the anonymous key ────────────────────────────────

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- Tables and sequences made later get none either. Supabase makes them as
-- `postgres` (the SQL Editor, migrations) and `supabase_admin` (its own
-- tooling); a role this session may not speak for is skipped, and said.
do $$
declare r text;
begin
  foreach r in array array['postgres', 'supabase_admin'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      begin
        execute format('alter default privileges for role %I in schema public revoke all on tables from anon', r);
        execute format('alter default privileges for role %I in schema public revoke all on sequences from anon', r);
      exception when insufficient_privilege then
        raise notice 'default privileges of % not changed: not allowed from this session', r;
      end;
    end if;
  end loop;
end $$;

-- ── 4. A preview is a small image ───────────────────────────────────────────

create or replace function public.confirm_job_file_preview(p_file uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  f public.job_file;
  o record;
begin
  select * into f from public.job_file where id = p_file and uploaded_by = auth.uid();
  if f.id is null or f.preview_path is null then
    raise exception 'Preview not found' using errcode = '22023';
  end if;
  select metadata into o from storage.objects where bucket_id = 'job-files' and name = f.preview_path;
  if not found then
    raise exception 'Preview not found' using errcode = '22023';
  end if;
  if coalesce(o.metadata ->> 'mimetype', '') not in ('image/png', 'image/webp', 'image/jpeg')
     or (case when jsonb_typeof(o.metadata -> 'size') = 'number' then (o.metadata ->> 'size')::numeric else 0 end) > 5 * 1024 * 1024 then
    raise exception 'A preview must be a PNG, WebP or JPEG image of at most 5 MB' using errcode = '22023';
  end if;
  update public.job_file set preview_ready_at = coalesce(preview_ready_at, now()) where id = p_file;
end;
$$;

select public.lock_anon_functions();
