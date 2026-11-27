-- ============================================================================
-- 140: an order reference made by the clinic, e.g. TF-DE-261127-001
-- ============================================================================
--
--   <orderer 2 letters>-<clinic 2 letters>-<YYMMDD>-<NNN>
--
--   orderer  the first letters of the first and last name (Tess Fake → TF); one
--            name → its first two letters. A second orderer in the same clinic
--            with the same letters gets TF2 (the next TF3), and keeps it.
--   clinic   the first letters of the clinic's first two words; one word → its
--            first two letters (Dentiks → DE).
--   only A–Z: letters with marks and Cyrillic are written in Latin first.
--   NNN      counts this orderer's references at this clinic on this day
--            (001, 002 …), in the clinic's time (Europe/Tallinn = Riga's).
--
-- Where it is used:
--   * a Network order: the phone shows the next one filled in
--     (client_reference_preview); on send, client_new_order claims it. If two
--     orders took the same number at once, the later one gets the next number.
--     A reference the client typed instead is kept as it is, unless the clinic
--     already has it: then the order is refused with 23505 ("already used").
--   * a job made in Wivo for a client: the form fills the client reference
--     (preview_order_reference) and the insert claims it (jobs trigger), the
--     same way. The owner can switch the filling off (Settings); nothing here
--     depends on it, a reference typed by hand is left alone.
--
-- Three tables, all for the clinic's own people to read, written only by the
-- functions below:
--   reference_party    orderer → letters (TF, TF2), kept for good
--   reference_counter  orderer letters + day → the last number given
--   order_reference    every reference given out, unique in the clinic
--
-- Two at once cannot get the same number: the counter row is locked by its
-- upsert, and the register's unique index is the last guard.

set lock_timeout = '10s';

-- ── Tables ──────────────────────────────────────────────────────────────────
create table if not exists public.reference_party (
  org_id      uuid not null references public.clinics(id) on delete cascade,
  -- The client (customers.id) or, for a Network client without one, 'nc:<network_client.id>'.
  party       text not null,
  code        text not null,
  created_at  timestamptz not null default now(),
  primary key (org_id, party),
  constraint reference_party_code_unique unique (org_id, code),
  constraint reference_party_code_valid check (code ~ '^[A-Z]{2}[0-9]{0,4}$')
);
alter table public.reference_party enable row level security;
drop policy if exists "reference_party_select" on public.reference_party;
create policy "reference_party_select" on public.reference_party for select to authenticated
  using (public.may_handle_orders(org_id));
revoke all on public.reference_party from public, anon, authenticated;
grant select on public.reference_party to authenticated;

create table if not exists public.reference_counter (
  org_id  uuid not null references public.clinics(id) on delete cascade,
  code    text not null,
  day     date not null,
  n       int not null default 0,
  primary key (org_id, code, day),
  constraint reference_counter_n_valid check (n between 0 and 9999)
);
alter table public.reference_counter enable row level security;
drop policy if exists "reference_counter_select" on public.reference_counter;
create policy "reference_counter_select" on public.reference_counter for select to authenticated
  using (public.may_handle_orders(org_id));
revoke all on public.reference_counter from public, anon, authenticated;
grant select on public.reference_counter to authenticated;

create table if not exists public.order_reference (
  org_id      uuid not null references public.clinics(id) on delete cascade,
  ref         text not null,
  source      text not null default 'order',
  party       text,
  created_at  timestamptz not null default now(),
  primary key (org_id, ref),
  constraint order_reference_source_valid check (source in ('order', 'job')),
  constraint order_reference_ref_valid check (length(btrim(ref)) between 1 and 40)
);
-- Unique without regard to case or spaces around it: CASE-118 and case-118 are one reference.
create unique index if not exists order_reference_key on public.order_reference (org_id, lower(btrim(ref)));
alter table public.order_reference enable row level security;
drop policy if exists "order_reference_select" on public.order_reference;
create policy "order_reference_select" on public.order_reference for select to authenticated
  using (public.may_handle_orders(org_id));
revoke all on public.order_reference from public, anon, authenticated;
grant select on public.order_reference to authenticated;

-- ── Letters ─────────────────────────────────────────────────────────────────

/** A name in capital A–Z and spaces: marks dropped, Cyrillic in Latin, anything else a space. */
create or replace function public.ref_ascii(p_text text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare v text := coalesce(p_text, '');
begin
  v := replace(v, 'Щ', 'SHCH');
  v := replace(v, 'щ', 'SHCH');
  v := replace(v, 'Ж', 'ZH');
  v := replace(v, 'ж', 'ZH');
  v := replace(v, 'Х', 'KH');
  v := replace(v, 'х', 'KH');
  v := replace(v, 'Ц', 'TS');
  v := replace(v, 'ц', 'TS');
  v := replace(v, 'Ч', 'CH');
  v := replace(v, 'ч', 'CH');
  v := replace(v, 'Ш', 'SH');
  v := replace(v, 'ш', 'SH');
  v := replace(v, 'Ю', 'YU');
  v := replace(v, 'ю', 'YU');
  v := replace(v, 'Я', 'YA');
  v := replace(v, 'я', 'YA');
  v := replace(v, 'Ё', 'YO');
  v := replace(v, 'ё', 'YO');
  v := replace(v, 'Є', 'YE');
  v := replace(v, 'є', 'YE');
  v := replace(v, 'Ї', 'YI');
  v := replace(v, 'ї', 'YI');
  v := replace(v, 'ß', 'SS');
  v := replace(v, 'Æ', 'AE');
  v := replace(v, 'æ', 'AE');
  v := replace(v, 'Œ', 'OE');
  v := replace(v, 'œ', 'OE');
  v := replace(v, 'Þ', 'TH');
  v := replace(v, 'þ', 'TH');
  v := replace(v, 'Ð', 'D');
  v := replace(v, 'ð', 'D');
  v := replace(v, 'Ø', 'O');
  v := replace(v, 'ø', 'O');
  v := replace(v, 'Ł', 'L');
  v := replace(v, 'ł', 'L');
  v := replace(v, 'Đ', 'D');
  v := replace(v, 'đ', 'D');
  v := replace(v, 'Ħ', 'H');
  v := replace(v, 'ħ', 'H');
  v := replace(v, 'ı', 'I');
  v := translate(v, 'ЪЬъь', '');
  v := translate(v, 'ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝàáâãäåçèéêëìíîïñòóôõöùúûüýÿĀāĂăĄąĆćĈĉĊċČčĎďĒēĔĕĖėĘęĚěĜĝĞğĠġĢģĤĥĨĩĪīĬĭĮįİĴĵĶķĹĺĻļĽľŃńŅņŇňŌōŎŏŐőŔŕŖŗŘřŚśŜŝŞşŠšŢţŤťŨũŪūŬŭŮůŰűŲųŴŵŶŷŸŹźŻżŽžƠơƯưǍǎǏǐǑǒǓǔǕǖǗǘǙǚǛǜǞǟǠǡǦǧǨǩǪǫǬǭǰǴǵǸǹǺǻȀȁȂȃȄȅȆȇȈȉȊȋȌȍȎȏȐȑȒȓȔȕȖȗȘșȚțȞȟȦȧȨȩȪȫȬȭȮȯȰȱȲȳАаБбВвГгДдЕеЗзИиЙйКкЛлМмНнОоПпРрСсТтУуФфЫыЭэІіҐґЎў', 'AAAAAACEEEEIIIINOOOOOUUUUYAAAAAACEEEEIIIINOOOOOUUUUYYAAAAAACCCCCCCCDDEEEEEEEEEEGGGGGGGGHHIIIIIIIIIJJKKLLLLLLNNNNNNOOOOOORRRRRRSSSSSSSSTTTTUUUUUUUUUUUUWWYYYZZZZZZOOUUAAIIOOUUUUUUUUUUAAAAGGKKOOOOJGGNNAAAAAAEEEEIIIIOOOORRRRUUUUSSTTHHAAEEOOOOOOOOYYAABBVVGGDDEEZZIIYYKKLLMMNNOOPPRRSSTTUUFFYYEEIIGGUU');
  v := upper(v);
  return btrim(regexp_replace(v, '[^A-Z]+', ' ', 'g'));
end;
$$;

/** Two letters from a name: first and last word (a person) or first and second (a clinic); one word, its first two. */
create or replace function public.ref_letters(p_name text, p_clinic boolean)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare w text[] := array_remove(string_to_array(public.ref_ascii(p_name), ' '), '');
begin
  if coalesce(array_length(w, 1), 0) = 0 then return 'XX'; end if;
  if array_length(w, 1) = 1 then return rpad(left(w[1], 2), 2, 'X'); end if;
  return left(w[1], 1) || left(case when p_clinic then w[2] else w[array_length(w, 1)] end, 1);
end;
$$;

/** The clinic's two letters, from its name. */
create or replace function public.ref_clinic_letters(p_org uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select public.ref_letters((select name from public.clinics where id = p_org), true)
$$;

/** The day a reference is counted in: the clinic's own calendar day. */
create or replace function public.ref_day()
returns date
language sql
stable
set search_path = public
as $$
  select (now() at time zone 'Europe/Tallinn')::date
$$;

-- ── The orderer's letters, kept for good ────────────────────────────────────

/** What the orderer's letters are, or would be: theirs if given, else the first free of TF, TF2, TF3 … */
create or replace function public.ref_party_code_preview(p_org uuid, p_party text, p_name text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_code text;
  v_base text := public.ref_letters(p_name, false);
  i int := 1;
begin
  select code into v_code from public.reference_party where org_id = p_org and party = p_party;
  if v_code is not null then return v_code; end if;
  loop
    v_code := v_base || case when i = 1 then '' else i::text end;
    exit when not exists (select 1 from public.reference_party where org_id = p_org and code = v_code);
    i := i + 1;
  end loop;
  return v_code;
end;
$$;

/** The orderer's letters, given the first time and kept. Safe when two ask at once. */
create or replace function public.ref_party_code(p_org uuid, p_party text, p_name text)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_code text;
  v_base text := public.ref_letters(p_name, false);
  i int := 1;
begin
  loop
    select code into v_code from public.reference_party where org_id = p_org and party = p_party;
    if v_code is not null then return v_code; end if;
    v_code := v_base || case when i = 1 then '' else i::text end;
    begin
      insert into public.reference_party (org_id, party, code) values (p_org, p_party, v_code);
      return v_code;
    exception when unique_violation then
      -- Either this orderer was given letters a moment ago (read them on the
      -- next turn) or these letters belong to someone else (try the next).
      i := i + 1;
    end;
  end loop;
end;
$$;

-- ── Taken or free ───────────────────────────────────────────────────────────

/** Whether the clinic already has this reference: given out, on a job, or on an order. */
create or replace function public.ref_taken(p_org uuid, p_ref text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.order_reference where org_id = p_org and lower(btrim(ref)) = lower(btrim(p_ref)))
      or exists (select 1 from public.jobs where clinic_id = p_org and deleted_at is null and lower(btrim(customer_ref)) = lower(btrim(p_ref)))
      or exists (select 1 from public.client_order where org_id = p_org and lower(btrim(patient_ref)) = lower(btrim(p_ref)))
$$;

/** Whether a reference is in this clinic's automatic form (any orderer, any day). */
create or replace function public.ref_is_auto(p_org uuid, p_ref text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(p_ref, '') ~ '^[A-Z]{2}[0-9]{0,4}-[A-Z]{2}-[0-9]{6}-[0-9]{3,4}$'
     and split_part(p_ref, '-', 2) = public.ref_clinic_letters(p_org)
$$;

/** The next reference for this orderer today, without giving it out. */
create or replace function public.ref_preview(p_org uuid, p_party text, p_name text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_code text := public.ref_party_code_preview(p_org, p_party, p_name);
  v_clinic text := public.ref_clinic_letters(p_org);
  v_day date := public.ref_day();
  v_n int;
  v_ref text;
begin
  select n into v_n from public.reference_counter where org_id = p_org and code = v_code and day = v_day;
  v_n := coalesce(v_n, 0);
  loop
    v_n := v_n + 1;
    v_ref := v_code || '-' || v_clinic || '-' || to_char(v_day, 'YYMMDD') || '-' || lpad(v_n::text, 3, '0');
    exit when not public.ref_taken(p_org, v_ref) or v_n >= 9999;
  end loop;
  return v_ref;
end;
$$;

/**
 * Give out a reference. In the automatic form: this orderer's own, today's,
 * still free → kept as it is; otherwise the next free number. Anything else
 * is the orderer's own reference: kept, unless the clinic has it already
 * (23505). Returns the reference as given out.
 */
create or replace function public.ref_claim(p_org uuid, p_party text, p_name text, p_ref text, p_source text)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_ref text := btrim(coalesce(p_ref, ''));
  v_code text;
  v_clinic text;
  v_day date;
  v_stamp text;
  v_n int;
begin
  if v_ref <> '' and not public.ref_is_auto(p_org, v_ref) then
    if public.ref_taken(p_org, v_ref) then
      raise exception 'This reference is already used in this clinic' using errcode = '23505';
    end if;
    begin
      insert into public.order_reference (org_id, ref, source, party) values (p_org, v_ref, p_source, p_party);
    exception when unique_violation then
      raise exception 'This reference is already used in this clinic' using errcode = '23505';
    end;
    return v_ref;
  end if;

  v_code := public.ref_party_code(p_org, p_party, p_name);
  v_clinic := public.ref_clinic_letters(p_org);
  v_day := public.ref_day();
  v_stamp := to_char(v_day, 'YYMMDD');

  -- The orderer's own number for today, as shown to them: kept while it is free.
  if v_ref <> '' and split_part(v_ref, '-', 1) = v_code and split_part(v_ref, '-', 3) = v_stamp then
    v_n := split_part(v_ref, '-', 4)::int;
    -- The upsert locks today's counter: a second claim waits here, then sees the first.
    insert into public.reference_counter as rc (org_id, code, day, n) values (p_org, v_code, v_day, v_n)
    on conflict (org_id, code, day) do update set n = greatest(rc.n, excluded.n);
    if not public.ref_taken(p_org, v_ref) then
      begin
        insert into public.order_reference (org_id, ref, source, party) values (p_org, v_ref, p_source, p_party);
        return v_ref;
      exception when unique_violation then null;  -- taken in the meantime: the next number below
      end;
    end if;
  end if;

  loop
    insert into public.reference_counter as rc (org_id, code, day, n) values (p_org, v_code, v_day, 1)
    on conflict (org_id, code, day) do update set n = rc.n + 1
    returning n into v_n;
    v_ref := v_code || '-' || v_clinic || '-' || v_stamp || '-' || lpad(v_n::text, 3, '0');
    if not public.ref_taken(p_org, v_ref) then
      begin
        insert into public.order_reference (org_id, ref, source, party) values (p_org, v_ref, p_source, p_party);
        return v_ref;
      exception when unique_violation then null;
      end;
    end if;
  end loop;
end;
$$;

-- ── Wivo: a job for a client ────────────────────────────────────────────────

/** The client reference the new-job form fills in for this client (not given out yet). */
create or replace function public.preview_order_reference(p_customer uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := public.my_org_id();
  v_name text;
begin
  if v_org is null or not public.has_perm('jobs.write') then return null; end if;
  select name into v_name from public.customers where id = p_customer and clinic_id = v_org;
  if v_name is null then return null; end if;
  return public.ref_preview(v_org, p_customer::text, v_name);
end;
$$;

/**
 * A job saved with a reference in the automatic form claims it: kept when
 * still free, else the next number. A reference typed by hand is left alone.
 * The job an accepted Network order becomes carries the order's reference,
 * given out already (accept_client_order says so for its own insert).
 */
create or replace function public.jobs_claim_reference()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.customer_id is null or new.customer_ref is null or not public.ref_is_auto(new.clinic_id, new.customer_ref) then
    return new;
  end if;
  if coalesce(current_setting('wivo.reference_from_order', true), '') = new.customer_ref then
    return new;
  end if;
  new.customer_ref := public.ref_claim(new.clinic_id, new.customer_id::text,
    (select name from public.customers where id = new.customer_id), new.customer_ref, 'job');
  return new;
end;
$$;

drop trigger if exists jobs_claim_reference on public.jobs;
create trigger jobs_claim_reference before insert on public.jobs
  for each row execute function public.jobs_claim_reference();

-- ── The Network: the client's order ─────────────────────────────────────────

/** Who the orderer is for references: the client it became, else the Network client itself. */
create or replace function public.ref_party_of(c public.network_client)
returns text
language sql
stable
set search_path = public
as $$
  select coalesce(c.customer_id::text, 'nc:' || c.id::text)
$$;

/** The reference the client's New order form shows filled in. Not given out until the order is sent. */
create or replace function public.client_reference_preview(p_session text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare c public.network_client := public.network_session_client(p_session);
begin
  return public.ref_preview(c.org_id, public.ref_party_of(c), c.display_name);
end;
$$;

/** As in 138, and the reference is claimed (kept, renumbered, or refused as already used). */
create or replace function public.client_new_order(p_session text, p_payload jsonb)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  c public.network_client := public.network_session_client(p_session);
  v_id uuid;
  v_type text := btrim(coalesce(p_payload->>'work_type', ''));
  v_ref text := btrim(coalesce(p_payload->>'patient_ref', ''));
  v_due date;
  v_recent int;
begin
  if jsonb_typeof(p_payload) <> 'object' or p_payload->>'format' <> 'wivo-order' or p_payload->>'version' <> '1' then
    raise exception 'Not a Wivo order (v1)' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_object_keys(p_payload) k
              where k not in ('format', 'version', 'work_type', 'teeth', 'options', 'shade', 'due', 'patient_ref', 'notes')) then
    raise exception 'Unknown field in the order' using errcode = '22023';
  end if;
  if not exists (select 1 from public.clinic_settings s, jsonb_array_elements(coalesce(s.work_types, '[]'::jsonb)) wt
                  where s.clinic_id = c.org_id and wt->>'nimi' = v_type) then
    raise exception 'This work type is not in the clinic''s catalogue' using errcode = '22023';
  end if;
  if length(v_ref) not between 1 and 40 then
    raise exception 'The patient reference is 1 to 40 characters' using errcode = '22023';
  end if;
  if coalesce(p_payload->>'teeth', '') !~ '^([1-8][1-8](,[1-8][1-8])*)?$' then
    raise exception 'Teeth are FDI numbers, comma-separated' using errcode = '22023';
  end if;
  if length(coalesce(p_payload->>'notes', '')) > 2000 or length(coalesce(p_payload->>'shade', '')) > 20 then
    raise exception 'The order is too long' using errcode = '22023';
  end if;
  if p_payload ? 'options' and jsonb_typeof(p_payload->'options') not in ('object', 'null') then
    raise exception 'Options are an object' using errcode = '22023';
  end if;
  if nullif(p_payload->>'due', '') is not null then
    if p_payload->>'due' !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'The due date is YYYY-MM-DD' using errcode = '22023'; end if;
    v_due := (p_payload->>'due')::date;
  end if;
  -- A client sends orders, not a flood: at most 60 an hour.
  select count(*) into v_recent from public.client_order where client_id = c.id and created_at > now() - interval '1 hour';
  if v_recent >= 60 then raise exception 'Too many orders in an hour' using errcode = '54000'; end if;

  v_ref := public.ref_claim(c.org_id, public.ref_party_of(c), c.display_name, v_ref, 'order');

  insert into public.client_order (org_id, client_id, format_version, payload, work_type, patient_ref, due)
  values (c.org_id, c.id, 1, jsonb_set(p_payload, '{patient_ref}', to_jsonb(v_ref)), v_type, v_ref, v_due)
  returning id into v_id;
  perform public.notify_order_handlers(c.org_id, 'client_order', jsonb_build_object('order', v_id));
  return v_id;
end;
$$;

/** As in 138; the job keeps the order's reference (given out when the order came in). */
create or replace function public.accept_client_order(p_order uuid, p_template uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid := public.my_org_id();
  o public.client_order;
  c public.network_client;
  v_job uuid;
  v_code text;
  v_first text;
  v_template uuid;
  v_kind text;
  f record;
  v_file uuid;
  n int := 0;
begin
  if not public.has_perm('jobs.write') then raise exception 'Edit jobs is needed' using errcode = '42501'; end if;
  select * into o from public.client_order where id = p_order and org_id = v_org for update;
  if o.id is null then raise exception 'Order not found' using errcode = '42501'; end if;
  if o.status <> 'received' then raise exception 'This order is already decided' using errcode = '22023'; end if;
  select * into c from public.network_client where id = o.client_id;
  v_template := coalesce(p_template, public.default_template(v_org));
  if not exists (select 1 from public.workflow_template where id = v_template and org_id = v_org and archived_at is null) then
    raise exception 'No such template' using errcode = '22023';
  end if;
  select stage_key into v_first from public.workflow_template_stage where template_id = v_template order by position limit 1;
  v_first := coalesce(v_first, (public.stage_order(v_org))[1]);
  select kind into v_kind from public.customers where id = c.customer_id;

  -- The order's reference is given out already: the jobs trigger keeps it on this job (sql/140).
  perform set_config('wivo.reference_from_order', o.patient_ref, true);
  insert into public.jobs (clinic_id, status, kuupaev, valmis_kuupaev, patsient, too, hambad, varv, kirjeldus,
                           customer_id, customer_ref, work_items, template_id, order_source)
  values (v_org, v_first, current_date, o.due, o.patient_ref, o.work_type,
          nullif(o.payload->>'teeth', ''), nullif(o.payload->>'shade', ''), nullif(o.payload->>'notes', ''),
          c.customer_id, o.patient_ref,
          jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
            'id', gen_random_uuid()::text, 'too', o.work_type, 'hambad', coalesce(o.payload->>'teeth', ''),
            'valikud', case when jsonb_typeof(o.payload->'options') = 'object' and o.payload->'options' <> '{}'::jsonb
                            then o.payload->'options' end))),
          v_template, case when v_kind = 'clinic' then 'clinic' else 'person' end)
  returning id, job_code into v_job, v_code;
  perform set_config('wivo.reference_from_order', '', true);

  for f in select * from public.client_order_file where order_id = o.id and completed_at is not null order by created_at loop
    n := n + 1;
    insert into public.job_file (job_id, org_id, type, sha256, size, mime_type, file_name, storage_path, completed_at)
    values (v_job, v_org,
            case when lower(f.file_name) ~ '\.(stl|ply|obj|dcm|3oxz)$' then 'scan'
                 when lower(f.file_name) ~ '\.(jpe?g|png|heic|webp)$' then 'photo' else 'other' end,
            f.sha256, f.size, f.mime_type,
            coalesce(v_code, 'order') || ' ' || n || coalesce(substring(f.file_name from '(\.[A-Za-z0-9]{1,8})$'), ''),
            f.storage_path, now())
    returning id into v_file;
    update public.client_order_file set job_file_id = v_file where id = f.id;
  end loop;

  update public.client_order set status = 'accepted', job_id = v_job, decided_at = now(), decided_by = auth.uid() where id = o.id;
  perform public.audit(v_org, 'create', 'job:' || v_job, jsonb_build_object('from_order', o.id));
  return v_job;
end;
$$;

-- ── Who may run what ────────────────────────────────────────────────────────
do $$
declare f text;
begin
  -- Inside only: called by the functions and the trigger above.
  foreach f in array array[
    'public.ref_ascii(text)', 'public.ref_letters(text, boolean)', 'public.ref_clinic_letters(uuid)', 'public.ref_day()',
    'public.ref_party_code_preview(uuid, text, text)', 'public.ref_party_code(uuid, text, text)',
    'public.ref_taken(uuid, text)', 'public.ref_is_auto(uuid, text)', 'public.ref_preview(uuid, text, text)',
    'public.ref_claim(uuid, text, text, text, text)', 'public.jobs_claim_reference()', 'public.ref_party_of(public.network_client)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
  -- The client's side: the service role only (network-client).
  execute 'revoke execute on function public.client_reference_preview(text) from public, anon, authenticated';
  execute 'grant execute on function public.client_reference_preview(text) to service_role';
  -- The clinic's people.
  execute 'revoke execute on function public.preview_order_reference(uuid) from public, anon';
  execute 'grant execute on function public.preview_order_reference(uuid) to authenticated';
end $$;

select public.ensure_mfa_policies();
select public.lock_anon_functions();

-- ─── Verify (read only) ─────────────────────────────────────────────────────
-- select tablename, rowsecurity from pg_tables where schemaname = 'public'
--  and tablename in ('reference_party', 'reference_counter', 'order_reference');        -> three rows, all true
-- select public.ref_letters('Tess Fake', false), public.ref_letters('Dentiks', true);  -- not callable by people; as postgres: TF, DE
-- select has_function_privilege('authenticated', 'public.ref_claim(uuid, text, text, text, text)', 'execute');  -> false
-- Afterwards, in SQL Editor on its own: notify pgrst, 'reload schema';
