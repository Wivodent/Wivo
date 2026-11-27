-- ============================================================================
-- 143: files in an order's messages, both ways, and "Needs your review"
-- ============================================================================
--
-- A message on an order (client ↔ clinic) can carry files: photos, PDFs,
-- scans, several at once. They are order files (client_order_file) with the
-- message they came with, in the same bucket under the same rules as an
-- order's files: a slot first, the bytes straight to Storage, then "done";
-- a download is a short link signed by the server (network-client for the
-- client, file-link for the clinic). The clinic's own size limit holds (the
-- job-files bucket's, docs/CLINIC-SETUP.md §4). A client sees only the files
-- of its own orders, and only if the owner lets it see files.
--
-- The clinic can mark a message "Needs your review". The client answers it:
-- Approve, or Request changes with a comment it must write. The answer is a
-- message of its own on the order (review_of, review_state), rings the
-- clinic's bell (client_review), and the job page shows the latest answer.
--
--   client_order_message  + needs_review, review_of, review_state
--   client_order_file     + message_id, from_client, created_by
--   the client (service role, network-client):
--     client_message_file_slot   a file for one of its own messages
--     client_review              Approve / Request changes
--     client_order_detail        + each message's review fields, each file's message
--   the clinic (signed in):
--     post_order_message_v2      a message, optionally needing review
--     order_file_slot / order_file_done   a file for one of the clinic's messages
--     (the storage policy order_files_insert lets the slot's maker upload once)

set lock_timeout = '10s';

-- ── Columns ─────────────────────────────────────────────────────────────────
alter table public.client_order_message add column if not exists needs_review boolean not null default false;
alter table public.client_order_message add column if not exists review_of uuid references public.client_order_message(id) on delete cascade;
alter table public.client_order_message add column if not exists review_state text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'client_order_message_review_valid') then
    alter table public.client_order_message add constraint client_order_message_review_valid
      check ((review_of is null) = (review_state is null) and (review_state is null or review_state in ('approved', 'changes')));
  end if;
end $$;

alter table public.client_order_file add column if not exists message_id uuid references public.client_order_message(id) on delete set null;
alter table public.client_order_file add column if not exists from_client boolean not null default true;
alter table public.client_order_file add column if not exists created_by uuid;
create index if not exists client_order_file_message_idx on public.client_order_file (message_id);

/** The clinic's own limit for one file: the job-files bucket's (500 MB unless set otherwise). */
create or replace function public.order_file_limit()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select file_size_limit from storage.buckets where id = 'job-files'), 524288000)::bigint
$$;

-- ── The client's side (service role, network-client) ────────────────────────

/** A place for a file with one of the client's own messages. */
create or replace function public.client_message_file_slot(p_session text, p_message uuid, p_name text, p_size bigint, p_sha256 text, p_mime text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  c public.network_client := public.network_session_client(p_session);
  m public.client_order_message;
  v_id uuid := gen_random_uuid();
  v_path text;
begin
  if not coalesce((c.can_see->>'files')::boolean, true) or not coalesce((c.can_see->>'messages')::boolean, true) then
    raise exception 'Files are off for you here' using errcode = '42501';
  end if;
  select m2.* into m from public.client_order_message m2
    join public.client_order o on o.id = m2.order_id
   where m2.id = p_message and m2.from_client and o.client_id = c.id and o.org_id = c.org_id;
  if m.id is null then raise exception 'Message not found' using errcode = '42501'; end if;
  if p_size > public.order_file_limit() then raise exception 'The file is larger than this clinic takes' using errcode = '54000'; end if;
  if (select count(*) from public.client_order_file where message_id = p_message) >= 20 then
    raise exception 'At most 20 files with one message' using errcode = '54000';
  end if;
  if (select count(*) from public.client_order_file where order_id = m.order_id) >= 200 then
    raise exception 'At most 200 files with one order' using errcode = '54000';
  end if;
  v_path := 'client-orders/' || c.org_id || '/' || m.order_id || '/' || v_id;
  insert into public.client_order_file (id, org_id, order_id, message_id, from_client, file_name, size, sha256, mime_type, storage_path)
  values (v_id, c.org_id, m.order_id, m.id, true, btrim(p_name), p_size, lower(p_sha256), left(p_mime, 120), v_path);
  return jsonb_build_object('file_id', v_id, 'path', v_path);
end;
$$;

/** The client answers a message that needs its review: approved, or changes (with the comment it must write). */
create or replace function public.client_review(p_session text, p_message uuid, p_decision text, p_comment text)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  c public.network_client := public.network_session_client(p_session);
  m public.client_order_message;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  v_id uuid;
begin
  if not coalesce((c.can_see->>'messages')::boolean, true) then
    raise exception 'Messages are off for you here' using errcode = '42501';
  end if;
  if p_decision not in ('approved', 'changes') then raise exception 'Approve or request changes' using errcode = '22023'; end if;
  if p_decision = 'changes' and v_comment is null then raise exception 'Say what to change' using errcode = '22023'; end if;
  if length(coalesce(v_comment, '')) > 4000 then raise exception 'The comment is too long' using errcode = '22023'; end if;
  select m2.* into m from public.client_order_message m2
    join public.client_order o on o.id = m2.order_id
   where m2.id = p_message and not m2.from_client and m2.needs_review and o.client_id = c.id and o.org_id = c.org_id;
  if m.id is null then raise exception 'Message not found' using errcode = '42501'; end if;
  insert into public.client_order_message (org_id, order_id, from_client, body, review_of, review_state)
  values (c.org_id, m.order_id, true, coalesce(v_comment, '✓'), m.id, p_decision)
  returning id into v_id;
  perform public.notify_order_people(m.order_id, 'client_review', jsonb_build_object('decision', p_decision));
  return v_id;
end;
$$;

/** As in 138, with each message's review fields and the message each file came with (sql/143). */
create or replace function public.client_order_detail(p_session text, p_order uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c public.network_client := public.network_session_client(p_session);
  o public.client_order;
begin
  select * into o from public.client_order where id = p_order and client_id = c.id and org_id = c.org_id;
  if o.id is null then raise exception 'Order not found' using errcode = '42501'; end if;
  return jsonb_build_object(
    'id', o.id, 'created_at', o.created_at, 'payload', o.payload,
    'status', public.client_order_status(o, coalesce((c.can_see->>'status')::boolean, true)),
    'reject_reason', o.reject_reason,
    'messages', case when coalesce((c.can_see->>'messages')::boolean, true) then coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'from_client', m.from_client, 'body', m.body, 'created_at', m.created_at,
                                          'needs_review', m.needs_review, 'review_of', m.review_of, 'review_state', m.review_state) order by m.created_at)
        from public.client_order_message m where m.order_id = o.id), '[]'::jsonb) end,
    'files', case when coalesce((c.can_see->>'files')::boolean, true) then coalesce((
      select jsonb_agg(jsonb_build_object('id', f.id, 'file_name', f.file_name, 'size', f.size, 'created_at', f.created_at,
                                          'message_id', f.message_id, 'from_client', f.from_client, 'mime_type', f.mime_type) order by f.created_at)
        from public.client_order_file f where f.order_id = o.id and f.completed_at is not null), '[]'::jsonb) end);
end;
$$;

/** As in 142; a client's review answer is told once, as client_review. */
create or replace function public.client_order_message_notices()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare o public.client_order;
begin
  select * into o from public.client_order where id = new.order_id;
  if o.id is null then return new; end if;
  if new.from_client then
    -- A review answer rings as client_review (client_review() does it), not as a second notice.
    if new.review_state is null then perform public.notify_order_people(o.id, 'client_message', '{}'::jsonb); end if;
  else
    perform public.notify_client(o.org_id, o.client_id, o.id, 'message');
  end if;
  return new;
end;
$$;

-- ── The clinic's side (signed in) ───────────────────────────────────────────

/** A message on an order, optionally needing the client's review. */
create or replace function public.post_order_message_v2(p_order uuid, p_body text, p_needs_review boolean)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_id uuid; v_org uuid := public.my_org_id();
begin
  if not public.may_handle_orders(v_org) then raise exception 'Not allowed' using errcode = '42501'; end if;
  if not exists (select 1 from public.client_order where id = p_order and org_id = v_org) then
    raise exception 'Order not found' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_body, ''))) not between 1 and 4000 then raise exception 'A message is 1 to 4000 characters' using errcode = '22023'; end if;
  insert into public.client_order_message (org_id, order_id, from_client, author_id, body, needs_review)
  values (v_org, p_order, false, auth.uid(), btrim(p_body), coalesce(p_needs_review, false)) returning id into v_id;
  return v_id;
end;
$$;

/** A place for a file with one of the clinic's messages. Only its maker may upload to it, once. */
create or replace function public.order_file_slot(p_message uuid, p_name text, p_size bigint, p_sha256 text, p_mime text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  m public.client_order_message;
  v_id uuid := gen_random_uuid();
  v_path text;
begin
  select * into m from public.client_order_message where id = p_message and not from_client;
  if m.id is null or not public.may_handle_orders(m.org_id) or not public.has_perm('jobs.write') then
    raise exception 'Message not found' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_name, ''))) not between 1 and 200 or p_name ~ '[/\\]' then raise exception 'A file name, with no folder' using errcode = '22023'; end if;
  if coalesce(p_sha256, '') !~ '^[0-9a-fA-F]{64}$' or p_size is null or p_size < 0 then raise exception 'Not a file' using errcode = '22023'; end if;
  if p_size > public.order_file_limit() then raise exception 'The file is larger than this clinic takes' using errcode = '54000'; end if;
  if (select count(*) from public.client_order_file where message_id = p_message) >= 20 then
    raise exception 'At most 20 files with one message' using errcode = '54000';
  end if;
  v_path := 'client-orders/' || m.org_id || '/' || m.order_id || '/' || v_id;
  insert into public.client_order_file (id, org_id, order_id, message_id, from_client, created_by, file_name, size, sha256, mime_type, storage_path)
  values (v_id, m.org_id, m.order_id, m.id, false, auth.uid(), btrim(p_name), p_size, lower(p_sha256), left(p_mime, 120), v_path);
  return jsonb_build_object('file_id', v_id, 'path', v_path);
end;
$$;

/** Whether the signed-in person may upload to this path now: their own open slot (the storage policy). */
create or replace function public.order_upload_slot_open(p_path text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.client_order_file f
                  where f.storage_path = p_path and not f.from_client and f.created_by = auth.uid() and f.completed_at is null)
$$;

drop policy if exists "order_files_insert" on storage.objects;
create policy "order_files_insert" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'job-files' and public.order_upload_slot_open(name)
  );

/** The clinic's file is in Storage. */
create or replace function public.order_file_done(p_file uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare f public.client_order_file;
begin
  select * into f from public.client_order_file where id = p_file and not from_client and created_by = auth.uid();
  if f.id is null or not exists (select 1 from storage.objects where bucket_id = 'job-files' and name = f.storage_path) then
    raise exception 'File not found' using errcode = '22023';
  end if;
  update public.client_order_file set completed_at = coalesce(completed_at, now()) where id = p_file;
end;
$$;

-- ── Who may run what ────────────────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array['public.client_message_file_slot(text, uuid, text, bigint, text, text)', 'public.client_review(text, uuid, text, text)'] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array['public.post_order_message_v2(uuid, text, boolean)', 'public.order_file_slot(uuid, text, bigint, text, text)',
                           'public.order_file_done(uuid)', 'public.order_upload_slot_open(text)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  execute 'revoke execute on function public.order_file_limit() from public, anon, authenticated';
end $$;

select public.lock_anon_functions();

-- ─── Verify (read only) ─────────────────────────────────────────────────────
-- select has_function_privilege('authenticated', 'public.client_review(text, uuid, text, text)', 'execute');  -> false
-- select policyname from pg_policies where tablename = 'objects' and policyname = 'order_files_insert';        -> one row
-- Afterwards, in SQL Editor on its own: notify pgrst, 'reload schema';
