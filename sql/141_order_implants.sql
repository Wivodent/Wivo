-- ============================================================================
-- 141: implants in an order from outside (Wivo order version 2)
-- ============================================================================
--
-- The client's New order form marks implants as the new-job form does
-- (docs/WIVO-ORDER-FORMAT.md, version 2): `implants` (FDI numbers among the
-- teeth; a bridge's pontics are the rest) and `abutment` (one screw / abutment
-- for every implant, and the implants that differ). Accepting the order makes
-- a job whose work item carries exactly these (implantaadid, kruvi, kruvid).
--
--   client_catalog       + each type's own words (liik, hambaviis, katalog,
--                          match), so the phone reads the same rules as the
--                          new-job form; + order_version 2
--   client_new_order     takes version 1 (as before) and version 2
--   accept_client_order  the job's work item gets the implants and abutment
--
-- Version 1 orders, old and new, work as before.

set lock_timeout = '10s';

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
begin
  select coalesce(work_types, '[]'::jsonb), coalesce(pricing->'tooValikud', '[]'::jsonb)
    into v_types, v_library
    from public.clinic_settings where clinic_id = c.org_id;
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
            select jsonb_agg(jsonb_build_object('id', o.id, 'name', coalesce(lib->>'nimi', o.id)) order by o.ord)
              from jsonb_array_elements_text(coalesce(g->'valikud', '[]'::jsonb)) with ordinality as o(id, ord)
              left join lateral (select l from jsonb_array_elements(v_library) l where l->>'id' = o.id limit 1) x(lib) on true
             where coalesce((lib->>'arhiivis')::boolean, false) = false), '[]'::jsonb)) order by gi.ord)
          from jsonb_array_elements(coalesce(wt->'valikuGrupid', '[]'::jsonb)) with ordinality as gi(g, ord)), '[]'::jsonb),
      'price', case when coalesce((c.can_see->>'prices')::boolean, false) then (wt->>'hind')::numeric end,
      'unit', case when coalesce((c.can_see->>'prices')::boolean, false) then coalesce(wt->>'hinnaTyyp', 'too') end,
      -- sql/141: the type's own words, so the phone reads from them what the
      -- new-job form reads (built on implants, a bridge, a screw/abutment);
      -- and the highest order version this clinic takes.
      'liik', case when wt->>'liik' in ('single', 'bridge', 'arch', 'none') then wt->>'liik' end,
      'hambaviis', case when wt->>'hambaviis' in ('tooth', 'arch', 'none') then wt->>'hambaviis' end,
      'katalog', nullif(left(wt->>'katalog', 80), ''),
      'match', case when jsonb_typeof(wt->'match') = 'array' then (
        select jsonb_agg(left(m, 80)) from (select m from jsonb_array_elements_text(wt->'match') m limit 20) mm) end,
      'order_version', 2
    )) order by t.ord)
      from jsonb_array_elements(v_types) with ordinality as t(wt, ord)
     where coalesce(btrim(wt->>'nimi'), '') <> ''), '[]'::jsonb);
end;
$$;

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
begin
  if jsonb_typeof(p_payload) <> 'object' or p_payload->>'format' <> 'wivo-order' or coalesce(p_payload->>'version', '') not in ('1', '2') then
    raise exception 'Not a Wivo order (v1 or v2)' using errcode = '22023';
  end if;
  v_version := (p_payload->>'version')::int;
  if exists (select 1 from jsonb_object_keys(p_payload) k
              where k not in ('format', 'version', 'work_type', 'teeth', 'options', 'shade', 'due', 'patient_ref', 'notes')
                and not (v_version = 2 and k in ('implants', 'abutment'))) then
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

  insert into public.client_order (org_id, client_id, format_version, payload, work_type, patient_ref, due)
  values (c.org_id, c.id, v_version, jsonb_set(p_payload, '{patient_ref}', to_jsonb(v_ref)), v_type, v_ref, v_due)
  returning id into v_id;
  perform public.notify_order_handlers(c.org_id, 'client_order', jsonb_build_object('order', v_id));
  return v_id;
end;
$$;

/** As in 140; the work item also carries the order's implants and screw / abutment (version 2). */
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
                            then o.payload->'options' end,
            -- sql/141 (order v2): where the implants are, and what sits on them,
            -- exactly as the new-job form writes them (WorkItem.implantaadid, kruvi, kruvid).
            'implantaadid', nullif(o.payload->>'implants', ''),
            'kruvi', nullif(btrim(o.payload->'abutment'->>'all'), ''),
            'kruvid', case when jsonb_typeof(o.payload->'abutment'->'teeth') = 'object'
                            and o.payload->'abutment'->'teeth' <> '{}'::jsonb then o.payload->'abutment'->'teeth' end))),
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

select public.lock_anon_functions();

-- ─── Verify (read only) ─────────────────────────────────────────────────────
-- select has_function_privilege('authenticated', 'public.client_new_order(text, jsonb)', 'execute');  -> false
-- Afterwards, in SQL Editor on its own: notify pgrst, 'reload schema';
