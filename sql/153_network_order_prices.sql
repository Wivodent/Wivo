-- ============================================================================
-- 153: prices of Wivo Network orders, the client's own price, a price to approve
-- ============================================================================
--
-- Run AFTER 152.
--
-- 1. Which work types a client may order, and how their price shows
--    (clinic_settings.work_types, per type, Settings → Work types & prices):
--      klientidele   false: not offered to clients (absent: offered, as before)
--      kliendiHind   'exact' (the price), 'from' (the lowest price: "from X €"),
--                    'request' (no price: "on request", the clinic quotes)
--    Prices show only to a client the owner lets see prices (can_see.prices,
--    sql/138), as before. A type's options (Metal bar) show their price the
--    same way.
-- 2. A client's own price (Clients → the client's card):
--      customers.discount_pct    off every price of the clinic's list (work
--                                types, their tiers, options, materials)
--      customers.client_prices   {"<work type>": unit price}: this client's own
--                                price for a type, over the list and the discount
--    The client sees only its own prices. The app's price engine counts them
--    the same way (shared/pricing/clientPrices.ts clientPriceBook).
-- 3. An order's price (client_order):
--      estimated_price   what the catalogue's prices make of it when it is
--                        sent (null: on request, a custom request, no price)
--      price             the price the clinic set: on accepting, or quoted
--      price_state       estimated → confirmed (accepted with its price);
--                        needs_quote → quoted → approved (the job starts) or
--                        declined (the clinic quotes again or rejects)
--    accept_client_order(order, template, price) writes the price on the job
--    (jobs.hind): the app works it out with the price engine and the client's
--    prices; the clinic types it where there is none. An order that needs a
--    quote (a type "on request", or "Other / custom request") is not accepted
--    but quoted (quote_client_order); the client approves or declines it
--    (client_price_decision, through network-client), and approving starts
--    the job with that price. Both sides are told.
-- 4. "Other / custom request" (order v2, payload.custom = true): a title, a
--    description, teeth and files, outside the catalogue; always quoted.
-- 5. An accepted order whose job has no price (before this): "Set price"
--    (set_order_price).

set lock_timeout = '10s';

-- ── A client's own price ────────────────────────────────────────────────────
alter table public.customers add column if not exists discount_pct numeric(5,2);
alter table public.customers add column if not exists client_prices jsonb not null default '{}'::jsonb;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'customers_discount_pct_valid') then
    alter table public.customers add constraint customers_discount_pct_valid check (discount_pct is null or discount_pct between 0 and 100);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'customers_client_prices_object') then
    alter table public.customers add constraint customers_client_prices_object check (jsonb_typeof(client_prices) = 'object');
  end if;
end $$;

-- ── An order's price ────────────────────────────────────────────────────────
alter table public.client_order add column if not exists estimated_price numeric(12,2);
alter table public.client_order add column if not exists price numeric(12,2);
alter table public.client_order add column if not exists price_state text;
alter table public.client_order add column if not exists quote_template uuid;
alter table public.client_order add column if not exists quoted_at timestamptz;
alter table public.client_order add column if not exists quoted_by uuid;
alter table public.client_order add column if not exists price_decided_at timestamptz;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'client_order_price_state_valid') then
    alter table public.client_order add constraint client_order_price_state_valid
      check (price_state is null or price_state in ('estimated', 'needs_quote', 'quoted', 'approved', 'declined', 'confirmed'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'client_order_price_valid') then
    alter table public.client_order add constraint client_order_price_valid check (price is null or price between 0 and 9999999);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'client_order_estimate_valid') then
    alter table public.client_order add constraint client_order_estimate_valid check (estimated_price is null or estimated_price between 0 and 9999999);
  end if;
end $$;
-- Accepted before this: the price, if the job has one, is the confirmed one.
update public.client_order o set price = j.hind, price_state = 'confirmed'
  from public.jobs j
 where o.job_id = j.id and o.status = 'accepted' and o.price_state is null and coalesce(j.hind, 0) > 0;

-- ── The rules, once (as shared/pricing/clientPrices.ts) ─────────────────────

/** A client's discount as a factor (1 = none) and its own prices, from its record. */
create or replace function public.client_pricing(p_customer uuid)
returns table (factor numeric, prices jsonb)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(1 - least(greatest(coalesce((select discount_pct from public.customers where id = p_customer), 0), 0), 100) / 100, 1),
         coalesce((select client_prices from public.customers where id = p_customer), '{}'::jsonb)
$$;

/** A positive number from JSON, else null. */
create or replace function public.json_price(p jsonb)
returns numeric
language sql
immutable
set search_path = public
as $$
  select case when jsonb_typeof(p) = 'number' and (p #>> '{}')::numeric > 0 then (p #>> '{}')::numeric
              when jsonb_typeof(p) = 'string' and btrim(p #>> '{}') ~ '^[0-9]+(\.[0-9]+)?$' and (p #>> '{}')::numeric > 0 then (p #>> '{}')::numeric end
$$;

/**
 * A work type's unit price for this client at this quantity (shared/pricing
 * workTypePriceFor + clientPriceBook): its own price for the type; else the
 * tier with the highest "from" at or below the quantity, else the base price,
 * times the discount. Null: no price.
 */
create or replace function public.client_unit_price(wt jsonb, p_factor numeric, p_prices jsonb, p_qty int)
returns numeric
language sql
immutable
set search_path = public
as $$
  select coalesce(
    round(public.json_price(p_prices -> (wt->>'nimi')), 2),
    round(coalesce(
      (select public.json_price(a->'hind') from jsonb_array_elements(case when jsonb_typeof(wt->'astmed') = 'array' then wt->'astmed' else '[]'::jsonb end) a
        where p_qty > 0 and public.json_price(a->'hind') is not null and coalesce(public.json_price(a->'alates'), 0) between 0.0001 and p_qty
        order by public.json_price(a->'alates') desc limit 1),
      public.json_price(wt->'hind')) * p_factor, 2))
$$;

/** The lowest unit price the client can get for a type ("from X €"). */
create or replace function public.client_from_price(wt jsonb, p_factor numeric, p_prices jsonb)
returns numeric
language sql
immutable
set search_path = public
as $$
  select coalesce(
    round(public.json_price(p_prices -> (wt->>'nimi')), 2),
    round((select min(x) from (
       select public.json_price(wt->'hind') as x
       union all
       select public.json_price(a->'hind') from jsonb_array_elements(case when jsonb_typeof(wt->'astmed') = 'array' then wt->'astmed' else '[]'::jsonb end) a
         where public.json_price(a->'alates') is not null) p) * p_factor, 2))
$$;

/** An option's extra price on a type for this client, and its unit (workOptions effectiveOption, times the discount). */
create or replace function public.client_option_price(wt jsonb, lib jsonb, p_option text, p_factor numeric)
returns table (price numeric, unit text)
language sql
immutable
set search_path = public
as $$
  select round(coalesce(public.json_price(wt->'valikuHinnad'->p_option->'lisahind'), public.json_price(o->'lisahind'), 0) * p_factor, 2),
         case when public.json_price(wt->'valikuHinnad'->p_option->'lisahind') is not null then coalesce(nullif(wt->>'hinnaTyyp', ''), 'too')
              when o->>'yhik' = 'hammas' then 'hammas' else 'too' end
    from (select (select l from jsonb_array_elements(case when jsonb_typeof(lib) = 'array' then lib else '[]'::jsonb end) l
                   where l->>'id' = p_option limit 1) as o) x
$$;

/** How a type's price shows to clients: 'exact', 'from' or 'request'. */
create or replace function public.client_price_form(wt jsonb)
returns text
language sql
immutable
set search_path = public
as $$ select case when wt->>'kliendiHind' in ('from', 'request') then wt->>'kliendiHind' else 'exact' end $$;

/** May clients order this type (absent: yes, as before 153). */
create or replace function public.client_may_order(wt jsonb)
returns boolean
language sql
immutable
set search_path = public
as $$ select coalesce(wt->>'klientidele', 'true') <> 'false' $$;

/**
 * What an order comes to at the catalogue's prices for its client, as the
 * price engine counts it (the type's unit price times its teeth for a
 * per-tooth type, plus each option per job or per tooth). Null: on request, a
 * custom request, or no price. Only an estimate: the clinic's price on
 * accepting is the price.
 */
create or replace function public.client_order_estimate(p_org uuid, p_customer uuid, p_payload jsonb)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  wt jsonb;
  lib jsonb;
  v_factor numeric; v_prices jsonb;
  v_teeth int;
  v_mode text;
  v_unit numeric;
  v_total numeric;
  r record;
begin
  if coalesce((p_payload->>'custom')::boolean, false) then return null; end if;
  select x, coalesce(s.pricing->'tooValikud', '[]'::jsonb) into wt, lib
    from public.clinic_settings s, jsonb_array_elements(coalesce(s.work_types, '[]'::jsonb)) x
   where s.clinic_id = p_org and x->>'nimi' = p_payload->>'work_type' limit 1;
  if wt is null or public.client_price_form(wt) = 'request' then return null; end if;
  select factor, prices into v_factor, v_prices from public.client_pricing(p_customer);
  v_teeth := coalesce(array_length(array(select distinct t from unnest(string_to_array(nullif(p_payload->>'teeth', ''), ',')) t), 1), 0);
  v_mode := case when wt->>'hinnaTyyp' = 'hammas' then 'hammas' else 'too' end;
  v_unit := public.client_unit_price(wt, v_factor, v_prices, v_teeth);
  if v_unit is null or (v_mode = 'hammas' and v_teeth = 0) then return null; end if;
  v_total := v_unit * case when v_mode = 'hammas' then v_teeth else 1 end;
  for r in select id from jsonb_each(case when jsonb_typeof(p_payload->'options') = 'object' then p_payload->'options' else '{}'::jsonb end) g,
                          jsonb_array_elements_text(case when jsonb_typeof(g.value) = 'array' then g.value else '[]'::jsonb end) id loop
    v_total := v_total + coalesce((select p.price * case when p.unit = 'hammas' then v_teeth else 1 end
                                     from public.client_option_price(wt, lib, r.id, v_factor) p), 0);
  end loop;
  return round(v_total, 2);
end;
$$;

-- ── The client's catalogue: offered types, and their price as the client sees it ─

/** As in 141: only the types offered to clients; each price in its form and the client's own amount; options with theirs. */
create or replace function public.client_catalog(p_session text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c public.network_client := public.network_session_client(p_session);
  v_types jsonb;
  v_library jsonb;
  v_prices_on boolean := coalesce((c.can_see->>'prices')::boolean, false);
  v_factor numeric; v_own jsonb;
begin
  select coalesce(work_types, '[]'::jsonb), coalesce(pricing->'tooValikud', '[]'::jsonb)
    into v_types, v_library
    from public.clinic_settings where clinic_id = c.org_id;
  select factor, prices into v_factor, v_own from public.client_pricing(c.customer_id);
  return coalesce((
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'name', wt->>'nimi',
      'teeth', case
        when wt->>'liik' in ('single', 'bridge') then 'tooth'
        when wt->>'liik' = 'arch' then 'arch'
        when wt->>'liik' = 'none' then 'none'
        when wt->>'hambaviis' in ('tooth', 'arch', 'none') then wt->>'hambaviis'
        else 'tooth' end,
      'groups', coalesce((
        select jsonb_agg(jsonb_build_object(
          'key', g->>'key', 'name', g->>'nimi', 'multi', coalesce((g->>'mitu')::boolean, false),
          'options', coalesce((
            select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', o.id, 'name', coalesce(lib->>'nimi', o.id),
                     'price', case when v_prices_on and public.client_price_form(wt) <> 'request'
                                   then nullif((select p.price from public.client_option_price(wt, v_library, o.id, v_factor) p), 0) end,
                     'unit', case when v_prices_on and public.client_price_form(wt) <> 'request'
                                  and coalesce((select p.price from public.client_option_price(wt, v_library, o.id, v_factor) p), 0) > 0
                                  then (select p.unit from public.client_option_price(wt, v_library, o.id, v_factor) p) end)) order by o.ord)
              from jsonb_array_elements_text(coalesce(g->'valikud', '[]'::jsonb)) with ordinality as o(id, ord)
              left join lateral (select l from jsonb_array_elements(v_library) l where l->>'id' = o.id limit 1) x(lib) on true
             where coalesce((lib->>'arhiivis')::boolean, false) = false), '[]'::jsonb)) order by gi.ord)
          from jsonb_array_elements(coalesce(wt->'valikuGrupid', '[]'::jsonb)) with ordinality as gi(g, ord)), '[]'::jsonb),
      'price_form', case when v_prices_on then public.client_price_form(wt) end,
      'price', case when not v_prices_on then null
                    when public.client_price_form(wt) = 'from' then public.client_from_price(wt, v_factor, v_own)
                    when public.client_price_form(wt) = 'exact' then public.client_unit_price(wt, v_factor, v_own, 1) end,
      'unit', case when v_prices_on and public.client_price_form(wt) <> 'request' then coalesce(wt->>'hinnaTyyp', 'too') end,
      'liik', case when wt->>'liik' in ('single', 'bridge', 'arch', 'none') then wt->>'liik' end,
      'hambaviis', case when wt->>'hambaviis' in ('tooth', 'arch', 'none') then wt->>'hambaviis' end,
      'katalog', nullif(left(wt->>'katalog', 80), ''),
      'match', case when jsonb_typeof(wt->'match') = 'array' then (
        select jsonb_agg(left(m, 80)) from (select m from jsonb_array_elements_text(wt->'match') m limit 20) mm) end,
      'order_version', 2
    )) order by t.ord)
      from jsonb_array_elements(v_types) with ordinality as t(wt, ord)
     where coalesce(btrim(wt->>'nimi'), '') <> '' and public.client_may_order(wt)), '[]'::jsonb);
end;
$$;

/** As in 141, with "Other / custom request", only the types offered to clients, and the estimate (sql/153). */
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
  v_version int;
  v_teeth text[];
  v_implants text[];
  v_key text;
  v_custom boolean;
  v_wt jsonb;
  v_quote boolean;
begin
  if jsonb_typeof(p_payload) <> 'object' or p_payload->>'format' <> 'wivo-order' or coalesce(p_payload->>'version', '') not in ('1', '2') then
    raise exception 'Not a Wivo order (v1 or v2)' using errcode = '22023';
  end if;
  v_version := (p_payload->>'version')::int;
  if exists (select 1 from jsonb_object_keys(p_payload) k
              where k not in ('format', 'version', 'work_type', 'teeth', 'options', 'shade', 'due', 'patient_ref', 'notes')
                and not (v_version = 2 and k in ('implants', 'abutment', 'custom'))) then
    raise exception 'Unknown field in the order' using errcode = '22023';
  end if;
  -- sql/153: "Other / custom request": a title of its own, outside the catalogue, always quoted.
  v_custom := v_version = 2 and coalesce(p_payload->>'custom', 'false') = 'true';
  if p_payload ? 'custom' and jsonb_typeof(p_payload->'custom') <> 'boolean' then
    raise exception 'custom is true or false' using errcode = '22023';
  end if;
  if v_custom then
    if length(v_type) not between 1 and 80 then raise exception 'A custom request has a title of 1 to 80 characters' using errcode = '22023'; end if;
    if length(btrim(coalesce(p_payload->>'notes', ''))) = 0 then raise exception 'A custom request says what is wanted' using errcode = '22023'; end if;
  else
    select x into v_wt from public.clinic_settings s, jsonb_array_elements(coalesce(s.work_types, '[]'::jsonb)) x
     where s.clinic_id = c.org_id and x->>'nimi' = v_type limit 1;
    -- Only a type offered to clients (sql/153).
    if v_wt is null or not public.client_may_order(v_wt) then
      raise exception 'This work type is not in the clinic''s catalogue' using errcode = '22023';
    end if;
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
  -- Version 2: the implants are among the teeth; a screw / abutment only for implants.
  if v_version = 2 then
    v_teeth := string_to_array(nullif(coalesce(p_payload->>'teeth', ''), ''), ',');
    if jsonb_typeof(p_payload->'implants') is distinct from 'string'
       or coalesce(p_payload->>'implants', '') !~ '^([1-8][1-8](,[1-8][1-8])*)?$' then
      raise exception 'Implants are FDI numbers, comma-separated' using errcode = '22023';
    end if;
    v_implants := coalesce(string_to_array(nullif(p_payload->>'implants', ''), ','), '{}');
    if not (v_implants <@ coalesce(v_teeth, '{}')) then
      raise exception 'An implant is not one of the teeth' using errcode = '22023';
    end if;
    if jsonb_typeof(p_payload->'abutment') = 'object' then
      if cardinality(v_implants) = 0 then raise exception 'A screw / abutment needs an implant' using errcode = '22023'; end if;
      if exists (select 1 from jsonb_object_keys(p_payload->'abutment') ak where ak not in ('all', 'teeth'))
         or jsonb_typeof(p_payload->'abutment'->'teeth') is distinct from 'object'
         or (p_payload->'abutment'->>'all' is not null and length(btrim(p_payload->'abutment'->>'all')) not between 1 and 60) then
        raise exception 'The screw / abutment is not right' using errcode = '22023';
      end if;
      for v_key in select jsonb_object_keys(p_payload->'abutment'->'teeth') loop
        if not (v_key = any(v_implants)) or length(btrim(coalesce(p_payload->'abutment'->'teeth'->>v_key, ''))) not between 1 and 60 then
          raise exception 'The screw / abutment is not right' using errcode = '22023';
        end if;
      end loop;
    elsif p_payload ? 'abutment' and jsonb_typeof(p_payload->'abutment') <> 'null' then
      raise exception 'The screw / abutment is not right' using errcode = '22023';
    end if;
  end if;
  if nullif(p_payload->>'due', '') is not null then
    if p_payload->>'due' !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'The due date is YYYY-MM-DD' using errcode = '22023'; end if;
    v_due := (p_payload->>'due')::date;
  end if;
  -- A client sends orders, not a flood: at most 60 an hour.
  select count(*) into v_recent from public.client_order where client_id = c.id and created_at > now() - interval '1 hour';
  if v_recent >= 60 then raise exception 'Too many orders in an hour' using errcode = '54000'; end if;

  v_ref := public.ref_claim(c.org_id, public.ref_party_of(c), c.display_name, v_ref, 'order');

  -- sql/153: what it comes to at the client's prices; on request and custom requests wait for the clinic's price.
  v_quote := v_custom or public.client_price_form(v_wt) = 'request';
  insert into public.client_order (org_id, client_id, format_version, payload, work_type, patient_ref, due, estimated_price, price_state)
  values (c.org_id, c.id, v_version, jsonb_set(p_payload, '{patient_ref}', to_jsonb(v_ref)), v_type, v_ref, v_due,
          case when not v_quote then public.client_order_estimate(c.org_id, c.customer_id, p_payload) end,
          case when v_quote then 'needs_quote' else 'estimated' end)
  returning id into v_id;
  perform public.notify_order_handlers(c.org_id, 'client_order', jsonb_build_object('order', v_id));
  return v_id;
end;
$$;

/** 141's accept, with the price on the job and who decided. No checks: for the functions below. */
create or replace function public.accept_order_with_price(p_order uuid, p_template uuid, p_price numeric, p_by uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid := (select org_id from public.client_order where id = p_order);
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
                           customer_id, customer_ref, work_items, template_id, order_source, hind)
  values (v_org, v_first, current_date, o.due, o.patient_ref, o.work_type,
          nullif(o.payload->>'teeth', ''), nullif(o.payload->>'shade', ''), nullif(o.payload->>'notes', ''),
          c.customer_id, o.patient_ref,
          jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
            'id', gen_random_uuid()::text, 'too', o.work_type, 'hambad', coalesce(o.payload->>'teeth', ''),
            'valikud', case when jsonb_typeof(o.payload->'options') = 'object' and o.payload->'options' <> '{}'::jsonb
                            then o.payload->'options' end,
            -- sql/141 (order v2): where the implants are, and what sits on them,
            -- exactly as the new-job form writes them (WorkItem.implantaadid, kruvi, kruvid).
            'implantaadid', nullif(o.payload->>'implants', ''),
            'kruvi', nullif(btrim(o.payload->'abutment'->>'all'), ''),
            'kruvid', case when jsonb_typeof(o.payload->'abutment'->'teeth') = 'object'
                            and o.payload->'abutment'->'teeth' <> '{}'::jsonb then o.payload->'abutment'->'teeth' end))),
          v_template, case when v_kind = 'clinic' then 'clinic' else 'person' end, p_price)
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

  update public.client_order set status = 'accepted', job_id = v_job, decided_at = now(), decided_by = p_by,
         price = p_price, price_state = case when price_state = 'approved' then 'approved' when p_price is not null then 'confirmed' else price_state end
   where id = o.id;
  perform public.audit(v_org, 'create', 'job:' || v_job, jsonb_build_object('from_order', o.id, 'price', p_price));
  return v_job;
end;
$$;

/**
 * The clinic accepts an order with its price (the app's price engine with the
 * client's prices, or what the clinic typed). An order waiting for the
 * client's approval of a quote cannot be accepted; an approved one has its
 * price already.
 */
create or replace function public.accept_client_order(p_order uuid, p_template uuid, p_price numeric)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare o public.client_order;
begin
  if not public.has_perm('jobs.write') then raise exception 'Edit jobs is needed' using errcode = '42501'; end if;
  select * into o from public.client_order where id = p_order and org_id = public.my_org_id();
  if o.id is null then raise exception 'Order not found' using errcode = '42501'; end if;
  if o.price_state in ('needs_quote', 'quoted', 'declined') then
    raise exception 'This order waits for the client to approve its price' using errcode = '22023', hint = 'needs_quote';
  end if;
  if p_price is not null and (p_price < 0 or p_price > 9999999) then raise exception 'A price is 0 or more' using errcode = '22023'; end if;
  return public.accept_order_with_price(p_order, p_template, case when o.price_state = 'approved' then o.price else round(p_price, 2) end, auth.uid());
end;
$$;

/** As in 141, for an app before 153: the job without a price, unless the client approved one. */
create or replace function public.accept_client_order(p_order uuid, p_template uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$ begin return public.accept_client_order(p_order, p_template, null); end; $$;

/** The clinic's price for an order that needs one (on request, a custom request), or a new one after a decline. The client is asked. */
create or replace function public.quote_client_order(p_order uuid, p_price numeric, p_template uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare o public.client_order;
begin
  if not public.has_perm('jobs.write') then raise exception 'Edit jobs is needed' using errcode = '42501'; end if;
  select * into o from public.client_order where id = p_order and org_id = public.my_org_id() for update;
  if o.id is null then raise exception 'Order not found' using errcode = '42501'; end if;
  if o.status <> 'received' then raise exception 'This order is already decided' using errcode = '22023'; end if;
  if p_price is null or p_price < 0 or p_price > 9999999 then raise exception 'A price is 0 or more' using errcode = '22023'; end if;
  if p_template is not null and not exists (select 1 from public.workflow_template where id = p_template and org_id = o.org_id and archived_at is null) then
    raise exception 'No such template' using errcode = '22023';
  end if;
  update public.client_order set price = round(p_price, 2), price_state = 'quoted', quote_template = p_template,
         quoted_at = now(), quoted_by = auth.uid(), price_decided_at = null
   where id = o.id;
  perform public.notify_client(o.org_id, o.client_id, o.id, 'quoted', to_char(round(p_price, 2), 'FM9999990.00'));
  perform public.audit(o.org_id, 'update', 'client_order:' || o.id, jsonb_build_object('quoted', round(p_price, 2)));
end;
$$;

/** The client approves (the job starts, with that price) or declines the clinic's price. */
create or replace function public.client_price_decision(p_session text, p_order uuid, p_approve boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  c public.network_client := public.network_session_client(p_session);
  o public.client_order;
  v_job uuid;
begin
  select * into o from public.client_order where id = p_order and client_id = c.id and org_id = c.org_id for update;
  if o.id is null then raise exception 'Order not found' using errcode = '42501'; end if;
  if o.status <> 'received' or o.price_state is distinct from 'quoted' then
    raise exception 'There is no price to approve' using errcode = '22023';
  end if;
  if p_approve then
    update public.client_order set price_state = 'approved', price_decided_at = now() where id = o.id;
    v_job := public.accept_order_with_price(o.id, o.quote_template, o.price, o.quoted_by);
  else
    update public.client_order set price_state = 'declined', price_decided_at = now() where id = o.id;
  end if;
  perform public.notify_order_handlers(o.org_id, 'client_price',
    jsonb_build_object('order', o.id, 'decision', case when p_approve then 'approved' else 'declined' end, 'price', o.price, 'ref', o.patient_ref));
  return jsonb_build_object('approved', p_approve, 'job', v_job is not null);
end;
$$;

/** An accepted order whose job has no price (accepted before 153): its price, on the job and the order. */
create or replace function public.set_order_price(p_order uuid, p_price numeric)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare o public.client_order;
begin
  if not public.has_perm('jobs.write') then raise exception 'Edit jobs is needed' using errcode = '42501'; end if;
  select * into o from public.client_order where id = p_order and org_id = public.my_org_id() for update;
  if o.id is null or o.job_id is null or o.status <> 'accepted' then raise exception 'Order not found' using errcode = '42501'; end if;
  if p_price is null or p_price <= 0 or p_price > 9999999 then raise exception 'A price is more than 0' using errcode = '22023'; end if;
  if exists (select 1 from public.jobs where id = o.job_id and coalesce(hind, 0) > 0) then
    raise exception 'This job has a price already: change it on the job' using errcode = '22023';
  end if;
  update public.jobs set hind = round(p_price, 2), updated_at = now() where id = o.job_id;
  update public.client_order set price = round(p_price, 2), price_state = 'confirmed' where id = o.id;
end;
$$;

-- ── What the client sees of its orders: the price and its state ─────────────

/** The order's price as its client may see it: an estimate with prices on; a quote, an approved or a confirmed price always once quoted. */
create or replace function public.client_order_price(o public.client_order, p_prices_on boolean)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'price_state', case
      when o.price_state in ('needs_quote', 'quoted', 'approved', 'declined') then o.price_state
      when o.price_state = 'confirmed' and (p_prices_on or o.quoted_at is not null) then 'confirmed'
      when o.price_state = 'estimated' and p_prices_on and o.estimated_price is not null then 'estimated' end,
    'price', case
      when o.price_state in ('quoted', 'approved', 'declined') then o.price
      when o.price_state = 'confirmed' and (p_prices_on or o.quoted_at is not null) then o.price
      when o.price_state = 'estimated' and p_prices_on then o.estimated_price end))
$$;

/** As in 146, with the price and its state (sql/153). */
create or replace function public.client_orders(p_session text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c public.network_client := public.network_session_client(p_session);
  v_show boolean := coalesce((c.can_see->>'status')::boolean, true);
  v_prices boolean := coalesce((c.can_see->>'prices')::boolean, false);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', o.id, 'created_at', o.created_at, 'work_type', o.work_type, 'patient_ref', o.patient_ref,
      'due', o.due, 'status', public.client_order_status(o, v_show), 'reject_reason', o.reject_reason,
      'cancel_reason', o.cancel_reason,
      'messages', (select count(*) from public.client_order_message m where m.order_id = o.id)
    ) || public.client_order_price(o, v_prices) order by o.created_at desc)
      from public.client_order o where o.client_id = c.id and o.org_id = c.org_id), '[]'::jsonb);
end;
$$;

/** As in 146, with the price and its state (sql/153). */
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
    'cancel_reason', o.cancel_reason,
    'messages', case when coalesce((c.can_see->>'messages')::boolean, true) then coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'from_client', m.from_client, 'body', m.body, 'created_at', m.created_at,
                                          'needs_review', m.needs_review, 'review_of', m.review_of, 'review_state', m.review_state,
                                          'fit_state', m.fit_state, 'delivery_state', m.delivery_state, 'delivery_reason', m.delivery_reason)
                       order by m.created_at)
        from public.client_order_message m where m.order_id = o.id), '[]'::jsonb) end,
    'files', case when coalesce((c.can_see->>'files')::boolean, true) then coalesce((
      select jsonb_agg(jsonb_build_object('id', f.id, 'file_name', f.file_name, 'size', f.size, 'created_at', f.created_at,
                                          'message_id', f.message_id, 'from_client', f.from_client, 'mime_type', f.mime_type) order by f.created_at)
        from public.client_order_file f where f.order_id = o.id and f.completed_at is not null), '[]'::jsonb) end)
    || public.client_order_price(o, coalesce((c.can_see->>'prices')::boolean, false));
end;
$$;

-- ── Notices: "Price: X € — Approve / Decline" to the client; its answer to the clinic ─
alter table public.client_notification drop constraint if exists client_notification_kind_valid;
alter table public.client_notification add constraint client_notification_kind_valid
  check (kind in ('message', 'accepted', 'rejected', 'ready', 'sent', 'connected', 'declined',
                  'received_reminder', 'problem_resolved', 'cancelled', 'reinstated', 'quoted'));

alter table public.notification drop constraint if exists notification_kind_valid;
alter table public.notification add constraint notification_kind_valid
  check (kind in ('job_shared', 'stage_handover', 'question', 'files_added', 'stage_reached', 'assigned',
                  'mfa_removed', 'mfa_reset', 'update_installed', 'update_failed', 'update_stale',
                  'stage_progress', 'stage_assigned', 'mail_quota', 'option_assigned',
                  'client_order', 'client_request', 'client_message', 'client_review',
                  'job_adjust', 'client_fit',
                  'delivery_problem', 'problem_resolved', 'received_reminder',
                  'invoice_ready', 'client_price'));

-- ── Who may run what ────────────────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'public.client_pricing(uuid)', 'public.json_price(jsonb)', 'public.client_unit_price(jsonb, numeric, jsonb, int)',
    'public.client_from_price(jsonb, numeric, jsonb)', 'public.client_option_price(jsonb, jsonb, text, numeric)',
    'public.client_price_form(jsonb)', 'public.client_may_order(jsonb)', 'public.client_order_estimate(uuid, uuid, jsonb)',
    'public.accept_order_with_price(uuid, uuid, numeric, uuid)', 'public.client_order_price(public.client_order, boolean)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'public.client_catalog(text)', 'public.client_new_order(text, jsonb)', 'public.client_orders(text)',
    'public.client_order_detail(text, uuid)', 'public.client_price_decision(text, uuid, boolean)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array[
    'public.accept_client_order(uuid, uuid, numeric)', 'public.accept_client_order(uuid, uuid)',
    'public.quote_client_order(uuid, numeric, uuid)', 'public.set_order_price(uuid, numeric)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

select public.lock_anon_functions();

-- ─── Verify (read only) ─────────────────────────────────────────────────────
-- select count(*) from public.client_order where status = 'accepted' and price_state is null;   -> the accepted orders whose job has no price ("No price" on Orders)
-- select has_function_privilege('authenticated', 'public.client_price_decision(text, uuid, boolean)', 'execute');   -> false
-- Afterwards, in SQL Editor on its own: notify pgrst, 'reload schema';
