-- ============================================================================
-- 151: automatic invoicing
-- ============================================================================
--
-- Run AFTER 150.
--
-- Settings → Invoices → "Automatic invoicing" (clinic_settings.pricing ->
-- 'autoArve'), off by default; a client's card can override any part of it
-- (customers.auto_invoice_*: empty = the clinic's choice).
--
--   when    received  the client confirms Received (jobs.received_at, sql/145)
--           fitted    the client confirms Fitted   (jobs.fitted_at, sql/144)
--   how     per_job   one invoice per job, at once
--           monthly   the client's monthly invoice: on the last day of the
--                     month at 20:00 in the clinic's time, every job of the
--                     month that reached the step and is not billed yet
--   send    draft     created as a draft for review (default); the owner gets
--                     "Invoice ready to check"
--           auto      issued (Sent, with its number) and e-mailed by the
--                     existing sender, send-invoices, with its daily cap, the
--                     test address and EMAIL_ALLOW_ONLY
--
-- Only a job with a client (jobs.customer_id) is invoiced this way. The
-- invoice is what "Invoice unbilled work" makes from the job's own figures:
-- the client's reference first, the work and its teeth (as ranges) at the
-- job's price, the design fee, each extra service, each priced remake not yet
-- billed; in the client's invoice language (sql/149: theirs, English for a
-- client abroad, else the clinic's default); the clinic's VAT rate or its
-- exemption and reason; the client's registry code, VAT number and address.
--
-- Draft only, with the reason, and the owner told:
--   no_price       a job has no price (its line is there at 0)
--   no_email       the client has no invoice e-mail (only when sending)
--   buyer_details  a company client lacks its registry code or address
--   mail_off       sending is chosen, but automatic e-mail is off in
--                  Settings → Email
--
-- Never twice: invoice_lines_once refuses a job (or a remake) that is already
-- on a live invoice of the clinic, for every invoice, by hand too. A
-- cancelled invoice, a credited one (sql/149) and the instalments of one
-- payment plan (which share their jobs, sql/049) do not count.
--
-- Every automatic invoice says so (invoices.auto_trigger, auto_period,
-- auto_reasons, auto_created_at): "Created automatically" on the invoice, and
-- an audit entry. The queue (auto_invoice_item) keeps each job's step: when
-- it was reached, the invoice it went on, or why not.
--
-- In the background: pg_cron runs auto_invoice_run() every half hour, where
-- the project has pg_cron. It makes the monthly invoices that are due and
-- retries a per-job invoice that failed. A per-job invoice is made at once, in
-- the confirmation itself; an error there never undoes the confirmation.

set lock_timeout = '10s';

-- ── A client's own choice ───────────────────────────────────────────────────
alter table public.customers add column if not exists auto_invoice_on boolean;
alter table public.customers add column if not exists auto_invoice_trigger text;
alter table public.customers add column if not exists auto_invoice_mode text;
alter table public.customers add column if not exists auto_invoice_send text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'customers_auto_invoice_trigger_valid') then
    alter table public.customers add constraint customers_auto_invoice_trigger_valid
      check (auto_invoice_trigger is null or auto_invoice_trigger in ('received', 'fitted'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'customers_auto_invoice_mode_valid') then
    alter table public.customers add constraint customers_auto_invoice_mode_valid
      check (auto_invoice_mode is null or auto_invoice_mode in ('per_job', 'monthly'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'customers_auto_invoice_send_valid') then
    alter table public.customers add constraint customers_auto_invoice_send_valid
      check (auto_invoice_send is null or auto_invoice_send in ('auto', 'draft'));
  end if;
end $$;

-- ── What an invoice says about how it was made ──────────────────────────────
alter table public.invoices add column if not exists auto_trigger text;
alter table public.invoices add column if not exists auto_period text;
alter table public.invoices add column if not exists auto_reasons text[];
alter table public.invoices add column if not exists auto_created_at timestamptz;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'invoices_auto_trigger_valid') then
    alter table public.invoices add constraint invoices_auto_trigger_valid check (auto_trigger is null or auto_trigger in ('received', 'fitted'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'invoices_auto_period_valid') then
    alter table public.invoices add constraint invoices_auto_period_valid check (auto_period is null or auto_period ~ '^[0-9]{4}-[0-9]{2}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'invoices_auto_reasons_valid') then
    alter table public.invoices add constraint invoices_auto_reasons_valid
      check (auto_reasons is null or auto_reasons <@ array['no_price', 'no_email', 'buyer_details', 'mail_off', 'review']::text[]);
  end if;
end $$;
-- One monthly invoice per client and month (a cancelled one aside).
create unique index if not exists invoices_auto_period_once
  on public.invoices (customer_id, auto_period)
  where auto_period is not null and status <> 'tuhistatud';

-- ── The queue: each job's step, and what became of it ───────────────────────
create table if not exists public.auto_invoice_item (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.clinics(id) on delete cascade,
  job_id       uuid not null references public.jobs(id) on delete cascade,
  customer_id  uuid not null references public.customers(id) on delete cascade,
  trigger      text not null constraint auto_invoice_item_trigger_valid check (trigger in ('received', 'fitted')),
  mode         text not null constraint auto_invoice_item_mode_valid check (mode in ('per_job', 'monthly')),
  send         text not null constraint auto_invoice_item_send_valid check (send in ('auto', 'draft')),
  reached_at   timestamptz not null default now(),
  status       text not null default 'pending'
                 constraint auto_invoice_item_status_valid check (status in ('pending', 'invoiced', 'skipped', 'failed')),
  invoice_id   uuid references public.invoices(id) on delete set null,
  note         text constraint auto_invoice_item_note_valid check (note is null or length(note) <= 200),
  attempts     int not null default 0,
  processed_at timestamptz,
  constraint auto_invoice_item_job_once unique (job_id)
);
create index if not exists auto_invoice_item_pending on public.auto_invoice_item (org_id, customer_id) where status = 'pending';

alter table public.auto_invoice_item enable row level security;
drop policy if exists "auto_invoice_item_select" on public.auto_invoice_item;
create policy "auto_invoice_item_select" on public.auto_invoice_item
  for select to authenticated using (org_id = public.my_clinic_id());
-- No insert, update or delete policy: only the functions below write it.

-- ── The rules ───────────────────────────────────────────────────────────────

/** The clinic's choice with the client's on top: on, trigger, mode, send. */
create or replace function public.auto_invoice_policy(p_clinic uuid, p_customer uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with clinic as (
    select coalesce((select pricing->'autoArve' from public.clinic_settings where clinic_id = p_clinic), '{}'::jsonb) as a
  ), own as (
    select auto_invoice_on, auto_invoice_trigger, auto_invoice_mode, auto_invoice_send
      from public.customers where id = p_customer and clinic_id = p_clinic
  )
  select jsonb_build_object(
    'on', coalesce((select auto_invoice_on from own), (select (a->>'on') = 'true' from clinic), false),
    'trigger', coalesce((select auto_invoice_trigger from own),
                        (select case when a->>'trigger' in ('received', 'fitted') then a->>'trigger' end from clinic), 'received'),
    'mode', coalesce((select auto_invoice_mode from own),
                     (select case when a->>'mode' in ('per_job', 'monthly') then a->>'mode' end from clinic), 'per_job'),
    'send', coalesce((select auto_invoice_send from own),
                     (select case when a->>'send' in ('auto', 'draft') then a->>'send' end from clinic), 'draft'))
$$;

/** The clinic's clock, by its country (EE, LV, LT, FI share the same time). */
create or replace function public.clinic_timezone(p_clinic uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case upper(coalesce((select country from public.clinics where id = p_clinic), 'EE'))
    when 'LV' then 'Europe/Riga' when 'LT' then 'Europe/Vilnius' when 'FI' then 'Europe/Helsinki'
    else 'Europe/Tallinn' end
$$;

/**
 * The month a job's step belongs to: from the last day of a month at 20:00 in
 * the clinic's time, it is the next month's (that day's monthly invoice is made
 * then). 'YYYY-MM'.
 */
create or replace function public.auto_invoice_period(p_clinic uuid, p_at timestamptz)
returns text
language sql
stable
set search_path = public
as $$ select to_char((p_at at time zone public.clinic_timezone(p_clinic)) + interval '4 hours', 'YYYY-MM') $$;

/** A number from free JSON text, else 0 (a job's extras and remakes are JSON the app wrote). */
create or replace function public.num_or_zero(p text)
returns numeric
language sql
immutable
set search_path = public
as $$ select case when btrim(coalesce(p, '')) ~ '^-?[0-9]+(\.[0-9]+)?$' then round(btrim(p)::numeric, 2) else 0 end $$;

/** Teeth as an invoice line says them: neighbours in an arch as a range ("17–27"), as lib/orderView teethLabel. */
create or replace function public.teeth_label(p_teeth text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_set int[] := array(select distinct btrim(x)::int from unnest(string_to_array(coalesce(p_teeth, ''), ',')) x where btrim(x) ~ '^[0-9]{2}$');
  v_arches int[][] := array[array[18,17,16,15,14,13,12,11,21,22,23,24,25,26,27,28],
                            array[48,47,46,45,44,43,42,41,31,32,33,34,35,36,37,38]];
  v_parts text[] := '{}';
  v_run int[];
  a int; i int; n int;
begin
  for a in 1..2 loop
    v_run := '{}';
    for i in 1..16 loop
      n := v_arches[a][i];
      if n = any(v_set) then
        v_run := v_run || n;
      end if;
      if (not (n = any(v_set)) or i = 16) and cardinality(v_run) > 0 then
        if cardinality(v_run) >= 3 then
          v_parts := v_parts || (v_run[1]::text || '–' || v_run[cardinality(v_run)]::text);
        else
          v_parts := v_parts || array(select x::text from unnest(v_run) x);
        end if;
        v_run := '{}';
      end if;
    end loop;
  end loop;
  return coalesce(nullif(array_to_string(v_parts, ', '), ''), nullif(btrim(coalesce(p_teeth, '')), ''));
end;
$$;

/** The words of an invoice line (shared/billing/invoiceDoc `line`), in et, lv or en. */
create or replace function public.invoice_line_word(p_lang text, p_word text, p_arg text default null)
returns text
language sql
immutable
set search_path = public
as $$
  select case p_word
    when 'work'  then case p_lang when 'lv' then 'Darbs' when 'en' then 'Work' else 'Töö' end
    when 'teeth' then case p_lang when 'lv' then 'zobi ' when 'en' then 'teeth ' else 'hambad ' end || coalesce(p_arg, '')
    when 'remake' then case p_lang when 'lv' then 'labojums #' when 'en' then 'remake #' else 'muudatus #' end || coalesce(p_arg, '')
    when 'design' then case p_lang when 'lv' then 'Dizains' when 'en' then 'Design' else 'Disain' end
    when 'extra' then case p_lang when 'lv' then 'Papildpakalpojums' when 'en' then 'Extra service' else 'Lisateenus' end
  end
$$;

/** The invoice a job or remake is already on: a live invoice of the clinic, not credited, not the same payment plan. */
create or replace function public.job_billed_on(p_job uuid, p_revision text, p_except uuid, p_plan uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select i.id
    from public.invoice_lines l
    join public.invoices i on i.id = l.invoice_id
   where l.job_id = p_job and l.revision_id is not distinct from p_revision
     and i.id is distinct from p_except
     and i.status <> 'tuhistatud' and i.credit_of is null
     and not exists (select 1 from public.invoices c where c.credit_of = i.id and c.status <> 'tuhistatud')
     and (p_plan is null or i.payment_plan_id is distinct from p_plan)
   limit 1
$$;

/** A job (or one of its remakes) on one live invoice only, by hand or automatically. */
create or replace function public.invoice_lines_once()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv record;
  v_on uuid;
begin
  if new.job_id is null then return new; end if;
  select status, credit_of, payment_plan_id into v_inv from public.invoices where id = new.invoice_id;
  if v_inv.status = 'tuhistatud' or v_inv.credit_of is not null then return new; end if;
  v_on := public.job_billed_on(new.job_id, new.revision_id, new.invoice_id, v_inv.payment_plan_id);
  if v_on is not null then
    raise exception 'This work is already on invoice %', (select number from public.invoices where id = v_on)
      using errcode = '23505', hint = 'job_already_invoiced';
  end if;
  return new;
end;
$$;
drop trigger if exists invoice_lines_once on public.invoice_lines;
create trigger invoice_lines_once
  before insert or update of job_id, revision_id, invoice_id on public.invoice_lines
  for each row execute function public.invoice_lines_once();

/**
 * One automatic invoice: the given queue items of one client (one job, or a
 * month's), the lines from each job's own figures, a draft or issued as the
 * policy and the checks say. Returns the invoice, or null when nothing was
 * left to bill (each item then says why).
 */
create or replace function public.auto_invoice_make(p_items uuid[], p_period text)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid; v_cust uuid; v_trigger text; v_send text;
  c record; s record; k record; j record; r record; e record; it record;
  v_country text; v_lang text; v_tz text; v_today date;
  v_vat numeric; v_exempt boolean; v_exempt_note text; v_days int;
  v_reasons text[] := '{}';
  v_status text;
  v_inv uuid;
  v_ref text; v_work text; v_teeth text; v_sort int := 0;
  v_jobs int := 0;
begin
  select org_id, customer_id, trigger, send into v_org, v_cust, v_trigger, v_send
    from public.auto_invoice_item where id = p_items[1];
  if v_org is null then return null; end if;
  select * into c from public.customers where id = v_cust and clinic_id = v_org;
  select * into s from public.clinic_settings where clinic_id = v_org;
  select country into v_country from public.clinics where id = v_org;
  v_country := upper(coalesce(v_country, 'EE'));

  -- Work already billed is not billed again: the item says so.
  update public.auto_invoice_item a set status = 'skipped', note = 'already_invoiced', processed_at = now()
   where a.id = any(p_items) and a.status = 'pending'
     and public.job_billed_on(a.job_id, null, null, null) is not null;
  if not exists (select 1 from public.auto_invoice_item where id = any(p_items) and status = 'pending') then return null; end if;

  -- The client's language (sql/149): theirs, English for a client abroad, else the clinic's default.
  v_lang := case
    when c.invoice_language in ('et', 'lv', 'en') then c.invoice_language
    when nullif(btrim(coalesce(c.country, '')), '') is not null and upper(btrim(c.country)) <> v_country then 'en'
    when s.pricing->>'arveKeel' in ('et', 'lv', 'en') then s.pricing->>'arveKeel'
    when v_country = 'LV' then 'lv' when v_country = 'EE' then 'et' else 'en' end;

  v_exempt := coalesce((s.pricing->>'kmVaba') = 'true', false);
  v_exempt_note := case when v_exempt then nullif(left(btrim(coalesce(s.pricing->>'kmVabaViide', '')), 500), '') end;
  v_vat := case when v_exempt then 0 else public.num_or_zero(s.pricing->>'kmMaar') end;
  v_days := case when (s.pricing->>'makseTahtaegPaevades') ~ '^[0-9]{1,3}$' then (s.pricing->>'makseTahtaegPaevades')::int else 14 end;
  v_tz := public.clinic_timezone(v_org);
  v_today := (now() at time zone v_tz)::date;

  -- What keeps it a draft.
  if exists (select 1 from public.auto_invoice_item a join public.jobs jj on jj.id = a.job_id
              where a.id = any(p_items) and a.status = 'pending' and coalesce(jj.hind, 0) <= 0) then
    v_reasons := v_reasons || 'no_price'::text;
  end if;
  if coalesce(c.kind, 'clinic') <> 'person'
     and (nullif(btrim(coalesce(c.reg_code, '')), '') is null or nullif(btrim(coalesce(c.address, '')), '') is null) then
    v_reasons := v_reasons || 'buyer_details'::text;
  end if;
  if v_send = 'auto' then
    if coalesce(btrim(c.email), '') !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
      v_reasons := v_reasons || 'no_email'::text;
    end if;
    if not (coalesce((s.email->>'saatmineLubatud') = 'true', false) and coalesce((s.email->>'lubaArved') = 'true', false)
            and nullif(btrim(coalesce(s.email->>'saatjaAadress', '')), '') is not null) then
      v_reasons := v_reasons || 'mail_off'::text;
    end if;
  end if;
  v_status := case when v_send = 'auto' and cardinality(v_reasons) = 0 then 'saadetud' else 'mustand' end;

  insert into public.invoices (clinic_id, patsient, customer_id, patient_id, bill_to_kind, status, issue_date, due_date,
                               vat_rate, language, vat_exempt_note, buyer_reg_code, buyer_vat_number, buyer_address,
                               created_by, auto_trigger, auto_period, auto_reasons, auto_created_at)
  values (v_org, coalesce(nullif(btrim(c.name), ''), '—'), v_cust, null, 'customer', v_status, v_today, v_today + v_days,
          v_vat, v_lang, v_exempt_note, nullif(btrim(coalesce(c.reg_code, '')), ''), nullif(btrim(coalesce(c.vat_number, '')), ''),
          nullif(btrim(coalesce(c.address, '')), ''), auth.uid(), v_trigger, p_period,
          case when v_send = 'draft' then v_reasons || 'review'::text else v_reasons end, now())
  returning id into v_inv;

  -- The lines, as "Invoice unbilled work" writes a job from its own figures.
  for it in select a.id, a.job_id from public.auto_invoice_item a
             where a.id = any(p_items) and a.status = 'pending' order by a.reached_at, a.id loop
    select * into j from public.jobs where id = it.job_id;
    v_ref := coalesce(nullif(btrim(coalesce(j.customer_ref, '')), ''), nullif(btrim(coalesce(j.patsient, '')), ''));
    v_work := coalesce(
      nullif((select string_agg(distinct btrim(w->>'too'), ', ') from jsonb_array_elements(
                case when jsonb_typeof(to_jsonb(j.work_items)) = 'array' then to_jsonb(j.work_items) else '[]'::jsonb end) w
               where nullif(btrim(coalesce(w->>'too', '')), '') is not null), ''),
      nullif(btrim(coalesce(j.too, '')), ''),
      public.invoice_line_word(v_lang, 'work'));
    v_teeth := public.teeth_label(j.hambad);
    v_sort := v_sort + 1;
    insert into public.invoice_lines (invoice_id, job_id, revision_id, description, qty, unit_price, sort_order)
    values (v_inv, j.id, null,
            concat_ws(' · ', v_ref, v_work, case when v_teeth is not null then public.invoice_line_word(v_lang, 'teeth', v_teeth) end),
            1, round(greatest(coalesce(j.hind, 0), 0), 2), v_sort);
    if coalesce(j.disain_hind, 0) > 0 then
      v_sort := v_sort + 1;
      insert into public.invoice_lines (invoice_id, job_id, revision_id, description, qty, unit_price, sort_order)
      values (v_inv, j.id, null, concat_ws(' · ', v_ref, public.invoice_line_word(v_lang, 'design')), 1, round(j.disain_hind, 2), v_sort);
    end if;
    for e in select x from jsonb_array_elements(case when jsonb_typeof(to_jsonb(j.extras)) = 'array' then to_jsonb(j.extras) else '[]'::jsonb end) x loop
      if public.num_or_zero(e.x->>'hind') <> 0 then
        v_sort := v_sort + 1;
        insert into public.invoice_lines (invoice_id, job_id, revision_id, description, qty, unit_price, sort_order)
        values (v_inv, j.id, null, concat_ws(' · ', v_ref, coalesce(nullif(btrim(coalesce(e.x->>'nimi', '')), ''), public.invoice_line_word(v_lang, 'extra'))),
                1, public.num_or_zero(e.x->>'hind'), v_sort);
      end if;
    end loop;
    -- A priced remake not billed yet: its own line.
    for r in select x, n from jsonb_array_elements(case when jsonb_typeof(to_jsonb(j.revisions)) = 'array' then to_jsonb(j.revisions) else '[]'::jsonb end)
               with ordinality as t(x, n) loop
      if public.num_or_zero(r.x->>'price') > 0 and nullif(r.x->>'id', '') is not null
         and public.job_billed_on(j.id, r.x->>'id', null, null) is null then
        v_sort := v_sort + 1;
        insert into public.invoice_lines (invoice_id, job_id, revision_id, description, qty, unit_price, sort_order)
        values (v_inv, j.id, r.x->>'id',
                concat_ws(' · ', v_ref, coalesce(nullif(btrim(coalesce(j.too, '')), ''), public.invoice_line_word(v_lang, 'work'))
                  || ' — ' || public.invoice_line_word(v_lang, 'remake', r.n::text)
                  || coalesce(' (' || nullif(case when jsonb_typeof(r.x->'reasons') = 'array'
                                                    then (select string_agg(btrim(y), ', ') from jsonb_array_elements_text(r.x->'reasons') y where btrim(y) <> '')
                                                    else btrim(coalesce(r.x->>'reason', '')) end, '') || ')', '')),
                1, public.num_or_zero(r.x->>'price'), v_sort);
      end if;
    end loop;
    v_jobs := v_jobs + 1;
  end loop;

  update public.auto_invoice_item set status = 'invoiced', invoice_id = v_inv, processed_at = now(),
         note = nullif(array_to_string(v_reasons, ','), '')
   where id = any(p_items) and status = 'pending';

  perform public.audit(v_org, 'create', 'invoice:' || v_inv,
    jsonb_build_object('auto', true, 'trigger', v_trigger, 'period', p_period, 'jobs', v_jobs, 'status', v_status, 'reasons', to_jsonb(v_reasons)));

  -- A draft: the owner is told it is ready to check, and why it is a draft.
  if v_status = 'mustand' then
    insert into public.notification (org_id, user_id, kind, detail)
    select v_org, p.id, 'invoice_ready',
           jsonb_build_object('invoice', v_inv, 'client', c.name, 'reasons', to_jsonb(v_reasons), 'trigger', v_trigger, 'period', p_period)
      from public.profiles p
     where p.clinic_id = v_org and p.role = 'owner';
  end if;
  return v_inv;
end;
$$;

/** Try one per-job item (or retry it); an error is kept on the item and never undoes what called it. */
create or replace function public.auto_invoice_try(p_item uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v uuid; v_org uuid; v_attempts int;
begin
  begin
    v := public.auto_invoice_make(array[p_item], null);
    return v;
  exception when others then
    update public.auto_invoice_item set attempts = attempts + 1, note = left('error ' || sqlstate, 200),
           status = case when attempts + 1 >= 3 then 'failed' else status end
     where id = p_item returning org_id, attempts into v_org, v_attempts;
    if v_attempts >= 3 then
      insert into public.notification (org_id, user_id, kind, detail)
      select v_org, p.id, 'invoice_ready', jsonb_build_object('failed', true, 'reasons', '["failed"]'::jsonb)
        from public.profiles p where p.clinic_id = v_org and p.role = 'owner';
    end if;
    return null;
  end;
end;
$$;

/** A client's job reached Received or Fitted: queued if the policy says so, and a per-job invoice made at once. */
create or replace function public.jobs_auto_invoice()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event text;
  v_policy jsonb;
  v_item uuid;
begin
  if new.customer_id is null then return new; end if;
  if old.received_at is null and new.received_at is not null then v_event := 'received';
  elsif old.fitted_at is null and new.fitted_at is not null then v_event := 'fitted';
  else return new; end if;
  if not exists (select 1 from public.customers where id = new.customer_id and clinic_id = new.clinic_id and archived_at is null) then
    return new;
  end if;
  v_policy := public.auto_invoice_policy(new.clinic_id, new.customer_id);
  if not (v_policy->>'on')::boolean or v_policy->>'trigger' <> v_event then return new; end if;
  insert into public.auto_invoice_item (org_id, job_id, customer_id, trigger, mode, send, reached_at)
  values (new.clinic_id, new.id, new.customer_id, v_event, v_policy->>'mode', v_policy->>'send', now())
  on conflict (job_id) do nothing
  returning id into v_item;
  if v_item is not null and v_policy->>'mode' = 'per_job' then
    perform public.auto_invoice_try(v_item);
  end if;
  return new;
end;
$$;
drop trigger if exists jobs_auto_invoice on public.jobs;
create trigger jobs_auto_invoice
  after update of received_at, fitted_at on public.jobs
  for each row execute function public.jobs_auto_invoice();

/**
 * Every half hour (pg_cron): the monthly invoices that are due (a month's
 * items once its last day's 20:00 has passed in the clinic's time; a missed
 * month on the next run), and per-job items that failed, again (three tries).
 * Returns how many invoices it made.
 */
create or replace function public.auto_invoice_run()
returns int
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  g record;
  v_item uuid;
  v_made int := 0;
  v uuid;
begin
  for v_item in select id from public.auto_invoice_item
                 where status = 'pending' and mode = 'per_job' and reached_at < now() - interval '5 minutes' order by reached_at loop
    if public.auto_invoice_try(v_item) is not null then v_made := v_made + 1; end if;
  end loop;

  for g in select org_id, customer_id, public.auto_invoice_period(org_id, reached_at) as period, array_agg(id order by reached_at) as items
             from public.auto_invoice_item
            where status = 'pending' and mode = 'monthly'
            group by org_id, customer_id, public.auto_invoice_period(org_id, reached_at)
           having public.auto_invoice_period(org_id, reached_at) < public.auto_invoice_period(org_id, now()) loop
    begin
      v := public.auto_invoice_make(g.items, g.period);
      if v is not null then v_made := v_made + 1; end if;
    exception when others then
      update public.auto_invoice_item set attempts = attempts + 1, note = left('error ' || sqlstate, 200),
             status = case when attempts + 1 >= 3 then 'failed' else status end
       where id = any(g.items);
    end;
  end loop;
  return v_made;
end;
$$;

-- ── Notifications: "Invoice ready to check" (owners) ────────────────────────
alter table public.notification drop constraint if exists notification_kind_valid;
alter table public.notification add constraint notification_kind_valid
  check (kind in ('job_shared', 'stage_handover', 'question', 'files_added', 'stage_reached', 'assigned',
                  'mfa_removed', 'mfa_reset', 'update_installed', 'update_failed', 'update_stale',
                  'stage_progress', 'stage_assigned', 'mail_quota', 'option_assigned',
                  'client_order', 'client_request', 'client_message', 'client_review',
                  'job_adjust', 'client_fit',
                  'delivery_problem', 'problem_resolved', 'received_reminder',
                  'invoice_ready'));

-- ── Who may run what ────────────────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'public.auto_invoice_policy(uuid, uuid)', 'public.clinic_timezone(uuid)', 'public.auto_invoice_period(uuid, timestamptz)',
    'public.num_or_zero(text)', 'public.teeth_label(text)', 'public.invoice_line_word(text, text, text)',
    'public.job_billed_on(uuid, text, uuid, uuid)', 'public.invoice_lines_once()', 'public.auto_invoice_make(uuid[], text)',
    'public.auto_invoice_try(uuid)', 'public.jobs_auto_invoice()', 'public.auto_invoice_run()'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
end $$;

-- ── Every half hour (pg_cron, where the project has it) ─────────────────────
-- Inside the database: no address, no key. It only makes invoices; e-mail
-- goes through send-invoices as before.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    execute $c$select cron.unschedule('wivo-auto-invoices') where exists (select 1 from cron.job where jobname = 'wivo-auto-invoices')$c$;
    execute $c$select cron.schedule('wivo-auto-invoices', '7,37 * * * *', 'select public.auto_invoice_run();')$c$;
  end if;
end $$;

select public.ensure_mfa_policies();
select public.lock_anon_functions();

-- ─── Verify (read only) ─────────────────────────────────────────────────────
-- select tablename, rowsecurity from pg_tables where tablename = 'auto_invoice_item';   -> true
-- select tgname from pg_trigger where tgname in ('jobs_auto_invoice', 'invoice_lines_once');   -> two rows
-- select jobname, schedule from cron.job where jobname = 'wivo-auto-invoices';   -> 7,37 * * * * (where pg_cron exists)
-- Afterwards, in SQL Editor on its own: notify pgrst, 'reload schema';
