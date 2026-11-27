-- ============================================================================
-- 152: where an invoice to a client goes
-- ============================================================================
--
-- Run AFTER 151.
--
-- A client's invoice goes to the first of:
--   1. its billing e-mail      customers.billing_email (new): the client's
--                              card, or the client's own Network profile
--                              ("Billing e-mail for invoices")
--   2. its invoice e-mail      customers.email, as before
--   3. the ordering account    the confirmed Network client's own address
--                              (network_client.email, sql/142)
-- "Send by e-mail" starts filled in with it, and the automatic invoice
-- (sql/151) is a draft "no invoice e-mail" only when none of the three exists.
--
-- From the Network:
--   - confirming a client (or the client's address arriving later): its
--     record's invoice e-mail becomes the Network account's address, when the
--     record has none;
--   - the client's billing e-mail (Network 004, in its token): onto its record,
--     when the record has none or still has the one the client gave before
--     (a billing e-mail the clinic typed itself is never overwritten).
-- Existing Network clients get the same now (only empty fields are filled).

set lock_timeout = '10s';

-- ── The columns ─────────────────────────────────────────────────────────────
alter table public.customers add column if not exists billing_email text;
alter table public.network_client add column if not exists billing_email text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'customers_billing_email_valid') then
    alter table public.customers add constraint customers_billing_email_valid
      check (billing_email is null or (length(billing_email) between 3 and 254 and billing_email ~ '^[^@[:space:]]+@[^@[:space:]]+$'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'network_client_billing_email_valid') then
    alter table public.network_client add constraint network_client_billing_email_valid
      check (billing_email is null or (length(billing_email) between 3 and 254 and billing_email ~ '^[^@[:space:]]+@[^@[:space:]]+$'));
  end if;
end $$;

-- ── Where a client's invoice goes ───────────────────────────────────────────

/** The billing e-mail, else the invoice e-mail, else the confirmed Network account's. No checks: for the functions here. */
create or replace function public.customer_invoice_address(p_customer uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select nullif(btrim(billing_email), '') from public.customers where id = p_customer),
    (select nullif(btrim(email), '') from public.customers where id = p_customer),
    (select nullif(btrim(n.email), '') from public.network_client n
      where n.customer_id = p_customer and n.state = 'confirmed' and nullif(btrim(n.email), '') is not null
      order by n.confirmed_at desc nulls last limit 1))
$$;

/** The same for "Send by e-mail": a client of the person's own clinic, for whoever may see its record. */
create or replace function public.invoice_recipient_email(p_customer uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.customers where id = p_customer and clinic_id = public.my_clinic_id())
     or not (public.has_perm('jobs.read') or public.has_perm_or_admin('payments.read')) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return public.customer_invoice_address(p_customer);
end;
$$;

-- ── From the Network: the client's billing e-mail, from its token ───────────

/** The billing e-mail from the client's signed Network token (Network 004; checked by network-client first). */
create or replace function public.client_set_billing(p_network_clinic uuid, p_account uuid, p_billing text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_org uuid;
begin
  select org_id into v_org from public.network_settings where network_clinic_id = p_network_clinic;
  if v_org is null then return; end if;
  update public.network_client
     set billing_email = case when btrim(coalesce(p_billing, '')) ~ '^[^@[:space:]]+@[^@[:space:]]+$'
                                and length(btrim(p_billing)) between 3 and 254 then btrim(p_billing) end
   where org_id = v_org and account_id = p_account
     and billing_email is distinct from case when btrim(coalesce(p_billing, '')) ~ '^[^@[:space:]]+@[^@[:space:]]+$'
                                                and length(btrim(p_billing)) between 3 and 254 then btrim(p_billing) end;
end;
$$;

/**
 * A confirmed client's addresses onto its record: the account's address as
 * the invoice e-mail when the record has none; the billing e-mail when the
 * record has none or still has the one the client gave before.
 */
create or replace function public.network_client_customer_contact()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_billing text := case when tg_op = 'UPDATE' then old.billing_email end;
begin
  if new.customer_id is null or new.state <> 'confirmed' then return new; end if;
  if nullif(btrim(coalesce(new.email, '')), '') is not null then
    update public.customers set email = btrim(new.email), updated_at = now()
     where id = new.customer_id and nullif(btrim(coalesce(email, '')), '') is null;
  end if;
  if new.billing_email is distinct from v_old_billing or tg_op = 'INSERT'
     or (tg_op = 'UPDATE' and (old.state is distinct from new.state or old.customer_id is distinct from new.customer_id)) then
    update public.customers set billing_email = new.billing_email, updated_at = now()
     where id = new.customer_id
       and (billing_email is null or billing_email is not distinct from v_old_billing)
       and billing_email is distinct from new.billing_email
       and (new.billing_email is not null or billing_email is not distinct from v_old_billing);
  end if;
  return new;
end;
$$;
drop trigger if exists network_client_customer_contact on public.network_client;
create trigger network_client_customer_contact
  after insert or update of state, customer_id, email, billing_email on public.network_client
  for each row execute function public.network_client_customer_contact();

-- ── Existing Network clients: only empty fields ─────────────────────────────
update public.customers k
   set email = n.email, updated_at = now()
  from (select distinct on (customer_id) customer_id, btrim(email) as email
          from public.network_client
         where state = 'confirmed' and customer_id is not null and nullif(btrim(coalesce(email, '')), '') is not null
         order by customer_id, confirmed_at desc nulls last) n
 where k.id = n.customer_id and nullif(btrim(coalesce(k.email, '')), '') is null;

-- ── The automatic invoice (sql/151) asks the same question ──────────────────
-- As in 151, with "no invoice e-mail" meaning none of the three.
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
    -- sql/152: the billing e-mail, else the invoice e-mail, else the ordering Network account's.
    if coalesce(public.customer_invoice_address(v_cust), '') !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
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

-- ── Who may run what ────────────────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'public.customer_invoice_address(uuid)', 'public.network_client_customer_contact()', 'public.auto_invoice_make(uuid[], text)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
  -- send-invoices asks it with the service key.
  execute 'grant execute on function public.customer_invoice_address(uuid) to service_role';
  execute 'revoke execute on function public.client_set_billing(uuid, uuid, text) from public, anon, authenticated';
  execute 'grant execute on function public.client_set_billing(uuid, uuid, text) to service_role';
  execute 'revoke execute on function public.invoice_recipient_email(uuid) from public, anon';
  execute 'grant execute on function public.invoice_recipient_email(uuid) to authenticated';
end $$;

select public.lock_anon_functions();

-- ─── Verify (read only) ─────────────────────────────────────────────────────
-- select count(*) from public.customers k join public.network_client n on n.customer_id = k.id
--  where n.state = 'confirmed' and n.email is not null and k.email is null;   -> 0
-- select tgname from pg_trigger where tgname = 'network_client_customer_contact';   -> one row
-- Afterwards, in SQL Editor on its own: notify pgrst, 'reload schema';
