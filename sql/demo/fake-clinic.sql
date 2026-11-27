-- ============================================================================
-- Wivo — FAKE CLINIC. Fills an EMPTY project with made-up data for testing.
-- ============================================================================
--
-- WHAT IT IS
--   One invented Latvian lab ("Fakeville Dental Lab") with six people in
--   different roles, work types from Wivo's catalogue (with their pictures),
--   prices, options with their own prices (Framework: Metal bar …), workflow
--   templates, 40 jobs at different stages, 30 obviously fake patients, a few
--   invoices, pay rules (one by option) and stock. NOT ONE real name, code,
--   phone number or address: nothing here comes from the test copy or from
--   any clinic.
--
-- WHAT IT IS NOT
--   Not a migration. It never goes into sql/ numbering and changes no schema.
--
-- HOW IT IS RUN
--   `node scripts/seed-fake-clinic.mjs` (docs/TEST-PROJECT.md). The script
--   asks for the connection and the passwords hidden, refuses production, the
--   test copy and every clinic's project by their ids, fills in the password
--   below and pipes this file into psql. By hand in the SQL Editor works too:
--   replace <FAKE_PASSWORD> first (at least 12 characters).
--
-- GUARDS (all in this file, so a paste into the wrong editor tab stops here)
--   1. The password placeholder must be replaced.
--   2. No clinic other than the fake one may exist.
--   3. No user outside @fake.wivodent.com may exist.
--   The test copy and every clinic's project fail 2 and 3 at once.
--
-- RUNNING IT TWICE adds nothing: every row has a fixed id or is skipped when
-- the clinic already has its jobs.
--
-- Kept honest by sql/test/fakeClinic.test.ts, which runs this file on a
-- database built from every migration.
-- ============================================================================

do $$
declare
  v_pw     text := '<FAKE_PASSWORD>';
  v_strays int;
begin
  if v_pw = '<FAKE_' || 'PASSWORD>' or length(v_pw) < 12 then
    raise exception 'The password is not filled in or is shorter than 12 characters (see the header).';
  end if;
  select count(*) into v_strays from public.clinics where id <> 'f0000000-0000-4000-8000-000000000001';
  if v_strays > 0 then
    raise exception 'This database has % clinic(s) that are not the fake one. It is not an empty test project: nothing was written.', v_strays;
  end if;
  select count(*) into v_strays from auth.users where email is null or email not like '%@fake.wivodent.com';
  if v_strays > 0 then
    raise exception 'This database has % user(s) outside @fake.wivodent.com. It is not an empty test project: nothing was written.', v_strays;
  end if;
end $$;

-- ── The clinic ──────────────────────────────────────────────────────────────
insert into public.clinics (id, name, address, city, postal_code, phone, email,
                            reg_code, vat_number, country, default_language, code_prefix)
values ('f0000000-0000-4000-8000-000000000001', 'Fakeville Dental Lab',
        'Nowhere iela 0', 'Fakeville', 'LV-0000', '+371 2000 0000',
        'lab@fake.wivodent.com', '40000000000', 'LV40000000000', 'LV', 'en', 'FK')
on conflict (id) do nothing;

-- ── Settings: catalogue work types with pictures, prices, options ───────────
-- Each work type is what Settings → Prices → "Add from catalogue" makes from
-- the entry named in `katalog` (shared/pricing/workTypeCatalogue), plus a
-- price and a picture choice; the test compares them with the catalogue.
insert into public.clinic_settings (clinic_id, work_types, materials, material_prices,
                                    machines, pipeline_stages, pricing, features, payroll)
values (
  'f0000000-0000-4000-8000-000000000001',
  '[
    {"nimi": "Zirconia crown", "hex": "#3B82F6", "hinnaTyyp": "hammas", "hind": 120,
     "katalog": "crown-zirconia", "pildiValik": "crown-zirconia", "match": []},
    {"nimi": "Metal-ceramic crown", "hex": "#3B82F6", "hinnaTyyp": "hammas", "hind": 95,
     "katalog": "crown-metal-ceramic", "pildiValik": "crown-metal-ceramic", "match": []},
    {"nimi": "Veneer", "hex": "#3B82F6", "hinnaTyyp": "hammas", "hind": 140,
     "katalog": "veneer", "pildiValik": "veneer", "match": []},
    {"nimi": "Bridge", "hex": "#8B5CF6", "hinnaTyyp": "hammas", "hind": 110,
     "astmed": [{"alates": 4, "hind": 100}], "katalog": "bridge", "pildiValik": "bridge", "match": []},
    {"nimi": "Implant crown", "hex": "#6366F1", "hinnaTyyp": "hammas", "hind": 180,
     "katalog": "crown-implant", "pildiValik": "crown-implant", "match": [],
     "kulud": [{"nimi": "Screw", "summa": 12, "tyyp": "hammas"}],
     "valikuGrupid": [
       {"key": "retention", "nimi": "Retention", "mitu": false, "valikud": ["screw-retained", "cement-retained"]},
       {"key": "attachments", "nimi": "Attachments", "mitu": true, "valikud": ["multi-unit", "ti-base"]}
     ],
     "valikuHinnad": {"multi-unit": {"lisahind": 45, "kulu": 30}}},
    {"nimi": "All-on-4", "hex": "#6366F1", "hinnaTyyp": "too", "hind": 2400,
     "katalog": "all-on-4", "pildiValik": "all-on-4", "match": [],
     "valikuGrupid": [
       {"key": "framework", "nimi": "Framework", "mitu": false, "valikud": ["metal-bar", "zirconia-framework", "cocr-framework", "peek-bar"]},
       {"key": "attachments", "nimi": "Attachments", "mitu": true, "valikud": ["multi-unit", "ti-base"]},
       {"key": "extras", "nimi": "Extras", "mitu": true, "valikud": ["pink-gingiva", "temporary-pmma"]}
     ],
     "valikuHinnad": {"metal-bar": {"lisahind": 400, "kulu": 150}, "zirconia-framework": {"lisahind": 900, "kulu": 320}}},
    {"nimi": "Full denture", "hex": "#F43F5E", "hinnaTyyp": "too", "hind": 450,
     "katalog": "denture-full", "pildiValik": "denture-full", "match": []},
    {"nimi": "Night guard / splint", "hex": "#06B6D4", "hinnaTyyp": "too", "hind": 160,
     "katalog": "night-guard", "pildiValik": "night-guard", "match": []},
    {"nimi": "Surgical guide", "hex": "#6366F1", "hinnaTyyp": "too", "hind": 260,
     "katalog": "surgical-guide", "pildiValik": "surgical-guide", "match": []},
    {"nimi": "Model", "hex": "#94A3B8", "hinnaTyyp": "too", "hind": 25,
     "katalog": "model", "pildiValik": "model", "match": []}
  ]'::jsonb,
  '["Zirconia", "E.max", "PMMA", "Resin", "CoCr"]'::jsonb,
  '{"Zirconia": 45, "E.max": 55, "PMMA": 18, "Resin": 12, "CoCr": 30}'::jsonb,
  '["Printer A", "Printer B", "Mill 1"]'::jsonb,
  '[{"key": "disain",  "label": "Design",    "hex": "#6366F1"},
    {"key": "print",   "label": "Printing",  "hex": "#F59E0B"},
    {"key": "poleeri", "label": "Polishing", "hex": "#10B981"},
    {"key": "puhasta", "label": "Cleaning",  "hex": "#3B82F6"},
    {"key": "varvi",   "label": "Staining",  "hex": "#EC4899"},
    {"key": "valmis",  "label": "Done",      "hex": "#22C55E"}]'::jsonb,
  '{"designFee": 35, "kiirtooKordaja": 1.5, "kmMaar": 21, "makseTahtaegPaevades": 14,
    "tooValikud": [
      {"id": "screw-retained",     "nimi": "Screw-retained",      "yhik": "too"},
      {"id": "cement-retained",    "nimi": "Cement-retained",     "yhik": "too"},
      {"id": "ti-base",            "nimi": "Ti-base",             "yhik": "hammas", "lisahind": 35, "kulu": 22},
      {"id": "multi-unit",         "nimi": "Multi-unit abutment", "yhik": "hammas", "lisahind": 55, "kulu": 30},
      {"id": "metal-bar",          "nimi": "Metal bar",           "yhik": "too", "lisahind": 600, "kulu": 150},
      {"id": "cocr-framework",     "nimi": "CoCr framework",      "yhik": "too", "lisahind": 450, "kulu": 120},
      {"id": "zirconia-framework", "nimi": "Zirconia framework",  "yhik": "too", "lisahind": 1100, "kulu": 320},
      {"id": "peek-bar",           "nimi": "PEEK bar",            "yhik": "too", "lisahind": 500, "kulu": 140},
      {"id": "pink-gingiva",       "nimi": "Pink gingiva",        "yhik": "too", "lisahind": 120, "kulu": 15},
      {"id": "temporary-pmma",     "nimi": "Temporary PMMA",      "yhik": "too", "lisahind": 180, "kulu": 25}
    ]}'::jsonb,
  '{"lab": true, "clinical": true}'::jsonb,
  '{}'::jsonb
)
on conflict (clinic_id) do nothing;

-- ── Six people ──────────────────────────────────────────────────────────────
-- The profile row comes from the sql/012 trigger. Password in bcrypt; the
-- auth.identities row is what lets e-mail and password sign in; GoTrue reads
-- its token columns as strings, so they are '' and never NULL (a NULL there
-- makes every sign-in fail with "Database error querying schema").
do $$
declare
  v_pw     text := '<FAKE_PASSWORD>';
  v_hash   text := crypt(v_pw, gen_salt('bf'));
  v_clinic uuid := 'f0000000-0000-4000-8000-000000000001';
  r        record;
  v_id     uuid;
  c        text;
begin
  for r in
    select * from (values
      ('f0000000-0000-4000-8000-0000000000a1'::uuid, 'owner@fake.wivodent.com',   'Olly Ownerfake',   'owner',  'owner',      array[]::text[]),
      ('f0000000-0000-4000-8000-0000000000a2'::uuid, 'doctor@fake.wivodent.com',  'Dr Dotty Fakesmile', 'worker', 'doctor',
        array['jobs.write', 'patients.read', 'patients.write', 'visits.read', 'visits.write']),
      ('f0000000-0000-4000-8000-0000000000a3'::uuid, 'design@fake.wivodent.com',  'Dana Pixelmock',   'worker', 'technician',
        array['jobs.write', 'stock.read', 'stock.write', 'pipeline.write']),
      ('f0000000-0000-4000-8000-0000000000a4'::uuid, 'tech@fake.wivodent.com',    'Tomas Testcrown',  'worker', 'technician',
        array['jobs.write', 'stock.read', 'stock.write']),
      ('f0000000-0000-4000-8000-0000000000a5'::uuid, 'money@fake.wivodent.com',   'Penny Payrollson', 'worker', 'admin',
        array['payroll.manage', 'payments.read']),
      ('f0000000-0000-4000-8000-0000000000a6'::uuid, 'desk@fake.wivodent.com',    'Sammy Samplewell', 'worker', 'assistant',
        array['jobs.read', 'patients.read', 'visits.read', 'visits.write', 'files.write'])
    ) as t(id, email, full_name, role, org_role, perms)
  loop
    select id into v_id from auth.users where email = r.email;
    if v_id is null then
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                              email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
      values ('00000000-0000-0000-0000-000000000000', r.id, 'authenticated', 'authenticated',
              r.email, v_hash, now(),
              '{"provider": "email", "providers": ["email"]}'::jsonb,
              jsonb_build_object('full_name', r.full_name))
      returning id into v_id;

      if to_regclass('auth.identities') is not null then
        execute format(
          'insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at)
             values (%L, %L, %L::jsonb, %L, now()) on conflict do nothing',
          v_id::text, v_id,
          jsonb_build_object('sub', v_id::text, 'email', r.email, 'email_verified', true)::text,
          'email');
      end if;
    end if;

    update public.profiles
       set clinic_id = v_clinic, role = r.role, org_role = r.org_role,
           full_name = r.full_name, language = 'en'
     where id = v_id;

    delete from public.worker_permissions where profile_id = v_id;
    insert into public.worker_permissions (profile_id, clinic_id, permission, granted)
    select v_id, v_clinic, p, true from unnest(r.perms) as p;
  end loop;

  foreach c in array array['confirmation_token', 'recovery_token', 'email_change', 'email_change_token_new',
                           'email_change_token_current', 'phone_change', 'phone_change_token', 'reauthentication_token'] loop
    if exists (select 1 from information_schema.columns
                where table_schema = 'auth' and table_name = 'users' and column_name = c) then
      execute format('update auth.users set %I = coalesce(%I, %L) where email like %L', c, c, '', '%@fake.wivodent.com');
    end if;
  end loop;
end $$;

-- ── Customers: three ordering clinics and one private doctor ────────────────
insert into public.customers (id, clinic_id, name, kind, reg_code, email, phone,
                              contact_name, billing_mode, payment_terms_days)
values
  ('f0000000-0000-4000-8000-000000000101', 'f0000000-0000-4000-8000-000000000001',
   'Mockton Dental Centre', 'clinic', '40100000001', 'mockton@fake.wivodent.com', '+371 2000 0001',
   'Dr Mocky Mockton', 'per_job', 14),
  ('f0000000-0000-4000-8000-000000000102', 'f0000000-0000-4000-8000-000000000001',
   'Pretendia Smile Clinic', 'clinic', '40100000002', 'pretendia@fake.wivodent.com', '+371 2000 0002',
   'Dr Polly Pretend', 'monthly', 30),
  ('f0000000-0000-4000-8000-000000000103', 'f0000000-0000-4000-8000-000000000001',
   'Imaginary Implants Ltd', 'clinic', '40100000003', 'imaginary@fake.wivodent.com', '+371 2000 0003',
   'Dr Ivo Imaginary', 'per_job', 7),
  ('f0000000-0000-4000-8000-000000000104', 'f0000000-0000-4000-8000-000000000001',
   'Dr Felix Notreal', 'person', null, 'felix@fake.wivodent.com', '+371 2000 0004',
   null, 'per_job', 14)
on conflict (id) do nothing;

-- ── 30 patients, obviously fake ─────────────────────────────────────────────
-- No personal codes at all: what is not there cannot leak.
insert into public.patients (id, clinic_id, nimi, synniaeg, telefon, email, arst, kliinik)
select ('f0000000-0000-4000-8000-0000000002' || lpad(n::text, 2, '0'))::uuid,
       'f0000000-0000-4000-8000-000000000001',
       (array['Fakey', 'Testa', 'Mocky', 'Dummy', 'Sample', 'Placeholder', 'Pretendo', 'Notta', 'Fictio', 'Bogus'])[1 + (n - 1) % 10]
         || ' ' ||
       (array['McFakeface', 'Testington', 'Mockovich', 'Dummyberg', 'Samplesson', 'Notreal'])[1 + (n - 1) % 6],
       (date '1950-01-01' + (n * 613) % 18000),
       '+371 2000 ' || lpad((100 + n)::text, 4, '0'),
       'patient' || n || '@fake.wivodent.com',
       (array['Dr Mocky Mockton', 'Dr Polly Pretend', 'Dr Ivo Imaginary', 'Dr Felix Notreal'])[1 + n % 4],
       (array['Mockton Dental Centre', 'Pretendia Smile Clinic', 'Imaginary Implants Ltd', 'Dr Felix Notreal'])[1 + n % 4]
  from generate_series(1, 30) as n
on conflict (id) do nothing;

-- ── Workflow templates (the Default one comes from the clinic's stages) ─────
insert into public.workflow_template (id, org_id, name)
values ('f0000000-0000-4000-8000-000000000301', 'f0000000-0000-4000-8000-000000000001', 'Implant work'),
       ('f0000000-0000-4000-8000-000000000302', 'f0000000-0000-4000-8000-000000000001', 'Quick repair')
on conflict (id) do nothing;

insert into public.workflow_template_stage (org_id, template_id, stage_key, position, task, optional, default_on, pay_role)
select 'f0000000-0000-4000-8000-000000000001', t.tpl, t.stage_key, t.pos, t.task, t.opt, t.def, t.pay
  from (values
    ('f0000000-0000-4000-8000-000000000301'::uuid, 'disain',  0, 'Design on the scan, check the implant positions', false, false, 'disain'),
    ('f0000000-0000-4000-8000-000000000301'::uuid, 'print',   1, 'Print the model and the try-in',                  false, false, 'mudel'),
    ('f0000000-0000-4000-8000-000000000301'::uuid, 'poleeri', 2, null,                                              false, false, 'too'),
    ('f0000000-0000-4000-8000-000000000301'::uuid, 'varvi',   3, 'Stain to the shade on the order',                 true,  true,  null),
    ('f0000000-0000-4000-8000-000000000301'::uuid, 'valmis',  4, null,                                              false, false, null),
    ('f0000000-0000-4000-8000-000000000302'::uuid, 'poleeri', 0, 'Repair and polish',                               false, false, 'too'),
    ('f0000000-0000-4000-8000-000000000302'::uuid, 'valmis',  1, null,                                              false, false, null)
  ) as t(tpl, stage_key, pos, task, opt, def, pay)
on conflict (template_id, stage_key) do nothing;

insert into public.workflow_template_stage_person (template_stage_id, profile_id, org_id)
select s.id, p.profile, s.org_id
  from public.workflow_template_stage s
  join (values ('disain', 'f0000000-0000-4000-8000-0000000000a3'::uuid),
               ('print',  'f0000000-0000-4000-8000-0000000000a3'::uuid),
               ('poleeri','f0000000-0000-4000-8000-0000000000a4'::uuid),
               ('varvi',  'f0000000-0000-4000-8000-0000000000a4'::uuid)) as p(stage_key, profile)
    on p.stage_key = s.stage_key
 where s.template_id = 'f0000000-0000-4000-8000-000000000301'
on conflict do nothing;

-- ── 40 jobs at different stages ─────────────────────────────────────────────
-- Spread over the board: every stage has some, a few rush jobs, some handed
-- over and paid (so Payroll and Statistics show something), implant work with
-- its options chosen (Framework: Metal bar …). The stages before a job's
-- current one are marked done by the person on them.
do $$
declare
  v_clinic  uuid := 'f0000000-0000-4000-8000-000000000001';
  v_design  uuid := 'f0000000-0000-4000-8000-0000000000a3';
  v_tech    uuid := 'f0000000-0000-4000-8000-0000000000a4';
  v_doctor  uuid := 'f0000000-0000-4000-8000-0000000000a2';
  v_stages  text[] := array['disain', 'print', 'poleeri', 'puhasta', 'varvi', 'valmis'];
  v_types   text[] := array['Zirconia crown', 'Metal-ceramic crown', 'Veneer', 'Bridge', 'Implant crown',
                            'All-on-4', 'Full denture', 'Night guard / splint', 'Surgical guide', 'Model'];
  v_teeth   text[] := array['16', '26', '11,21', '14,15,16', '36', '', '', '', '', ''];
  v_prices  numeric[] := array[120, 95, 280, 330, 180, 3000, 450, 160, 260, 25];
  v_mat     text[] := array['Zirconia', 'CoCr', 'E.max', 'Zirconia', 'Zirconia', 'PMMA', 'PMMA', 'Resin', 'Resin', 'Resin'];
  v_shades  text[] := array['A1', 'A2', 'A3', 'B1', 'B2'];
  v_customers uuid[] := array['f0000000-0000-4000-8000-000000000101', 'f0000000-0000-4000-8000-000000000102',
                              'f0000000-0000-4000-8000-000000000103', 'f0000000-0000-4000-8000-000000000104']::uuid[];
  n       int;
  k       int;
  s       int;
  v_job   uuid;
  v_items jsonb;
  v_done  boolean;
  v_patient uuid;
begin
  if exists (select 1 from public.jobs where clinic_id = v_clinic) then
    raise notice 'The fake clinic already has its jobs: none added.';
    return;
  end if;

  for n in 1..40 loop
    k := 1 + (n - 1) % 10;                       -- the work type
    s := least(6, 1 + (n * 7) % 6);              -- the stage
    v_done := s = 6;
    v_job := ('f0000000-0000-4000-8000-0000000004' || lpad(n::text, 2, '0'))::uuid;
    v_patient := ('f0000000-0000-4000-8000-0000000002' || lpad((1 + (n - 1) % 30)::text, 2, '0'))::uuid;
    v_items := jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'id', 'f0000000-0000-4000-8000-0000000008' || lpad(n::text, 2, '0'),
      'too', v_types[k],
      'hambad', v_teeth[k],
      'materjal', v_mat[k],
      'valikud', case
        when v_types[k] = 'All-on-4' then
          jsonb_build_object('framework', jsonb_build_array((array['metal-bar', 'cocr-framework', 'zirconia-framework'])[1 + n % 3]),
                             'extras', case when n % 2 = 0 then '["pink-gingiva"]'::jsonb else '[]'::jsonb end)
        when v_types[k] = 'Implant crown' then
          jsonb_build_object('retention', '["screw-retained"]'::jsonb,
                             'attachments', jsonb_build_array((array['ti-base', 'multi-unit'])[1 + n % 2]))
        else null end
    )));

    insert into public.jobs (id, clinic_id, status, kuupaev, valmis_kuupaev, patsient, patient_id, too, materjal,
                             varv, hambad, hind, disain_hind, assigned_to, designed_by, customer_id,
                             masina, kiirtoo, delivery_status, delivered_at, makstud, makse_kuupaev,
                             kirjeldus, work_items, template_id, order_source, ordered_by)
    select v_job, v_clinic, v_stages[s], current_date - (40 - n), current_date - (40 - n) + 7 + n % 5,
           p.nimi, p.id, v_types[k], v_mat[k],
           case when k <= 5 then v_shades[1 + n % 5] end, nullif(v_teeth[k], ''),
           v_prices[k], case when k <= 6 then 35 end,
           v_tech, case when k <= 6 or k = 9 then v_design end, v_customers[1 + n % 4],
           case when k in (6, 8, 9, 10) then (array['Printer A', 'Printer B'])[1 + n % 2] when k <= 5 then 'Mill 1' end,
           n % 9 = 0,
           case when v_done and n % 2 = 0 then 'yle_antud' when v_done then 'teel' else 'labor' end,
           case when v_done and n % 2 = 0 then now() - make_interval(days => n % 4) end,
           v_done and n % 4 = 0, case when v_done and n % 4 = 0 then current_date - 1 end,
           (array['Scan received, please check the margin on the distal side.',
                  'Patient wants a natural look, a little translucent at the edge.',
                  'Rush: the patient travels on Friday.',
                  null, null])[1 + n % 5],
           v_items,
           case when k in (5, 6) then 'f0000000-0000-4000-8000-000000000301'::uuid
                when k = 10 then 'f0000000-0000-4000-8000-000000000302'::uuid end,
           'clinic', v_doctor
      from public.patients p where p.id = v_patient;

    -- The stages before the current one are done; the current one started.
    update public.job_stage js
       set started_at = now() - make_interval(days => 10 - js.position),
           started_by = coalesce((select jp.profile_id from public.job_stage_person jp where jp.job_stage_id = js.id limit 1), v_tech),
           done_at = case when js.position < cur.position or v_done
                          then now() - make_interval(days => 9 - js.position) end,
           done_by = case when js.position < cur.position or v_done
                          then coalesce((select jp.profile_id from public.job_stage_person jp where jp.job_stage_id = js.id limit 1), v_tech) end
      from public.job_stage cur
     where js.job_id = v_job and cur.job_id = v_job and cur.stage_key = v_stages[s]
       and js.position <= cur.position;

    -- A note on every fourth job, written as the app writes one.
    if n % 4 = 1 then
      update public.jobs set markused = jsonb_build_array(jsonb_build_object(
        'id', 'f0000000-0000-4000-8000-0000000009' || lpad(n::text, 2, '0'),
        'ts', to_char((now() - interval '2 days') at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'autor', 'Dana Pixelmock', 'by', v_design::text,
        'tekst', 'Checked the scan, the design is ready for the doctor to approve.'))
       where id = v_job;
    end if;
  end loop;
end $$;

-- ── A few invoices ──────────────────────────────────────────────────────────
-- Invoices are switched off in the app for Latvia until its rules are known;
-- the rows are here so the invoice screens can be tried with the country set
-- to Estonia in Settings, and so Finance has something to add up.
insert into public.invoices (id, clinic_id, number, patsient, status, issue_date, due_date, vat_rate,
                             net_total, vat_total, gross_total, customer_id, bill_to_kind, created_by)
select ('f0000000-0000-4000-8000-0000000005' || lpad(n::text, 2, '0'))::uuid,
       'f0000000-0000-4000-8000-000000000001', 'FK-2026-' || lpad(n::text, 3, '0'),
       j.patsient, (array['mustand', 'saadetud', 'makstud', 'saadetud', 'makstud'])[n],
       current_date - (10 - n), current_date - (10 - n) + 14, 21,
       j.hind, round(j.hind * 0.21, 2), round(j.hind * 1.21, 2), j.customer_id, 'customer',
       'f0000000-0000-4000-8000-0000000000a1'
  from generate_series(1, 5) as n
  join public.jobs j on j.id = ('f0000000-0000-4000-8000-0000000004' || lpad((n * 6)::text, 2, '0'))::uuid
on conflict (id) do nothing;

insert into public.invoice_lines (id, invoice_id, job_id, description, qty, unit_price)
select ('f0000000-0000-4000-8000-0000000006' || lpad(n::text, 2, '0'))::uuid,
       ('f0000000-0000-4000-8000-0000000005' || lpad(n::text, 2, '0'))::uuid,
       j.id, j.too || ' (' || coalesce(j.job_code, 'job') || ')', 1, j.hind
  from generate_series(1, 5) as n
  join public.jobs j on j.id = ('f0000000-0000-4000-8000-0000000004' || lpad((n * 6)::text, 2, '0'))::uuid
on conflict (id) do nothing;

-- ── Pay rules (one only with an option) and some hours ──────────────────────
insert into public.worker_rates (id, clinic_id, profile_id, kind, amount, work_type, applies_to, label, option_key)
values
  ('f0000000-0000-4000-8000-000000000701', 'f0000000-0000-4000-8000-000000000001',
   'f0000000-0000-4000-8000-0000000000a3', 'hammas', 18, 'Zirconia crown', 'disain', 'Design, per crown', null),
  ('f0000000-0000-4000-8000-000000000702', 'f0000000-0000-4000-8000-000000000001',
   'f0000000-0000-4000-8000-0000000000a3', 'too', 60, 'All-on-4', 'disain', 'Design, All-on-4', null),
  ('f0000000-0000-4000-8000-000000000703', 'f0000000-0000-4000-8000-000000000001',
   'f0000000-0000-4000-8000-0000000000a4', 'too', 80, 'All-on-4', 'too', 'Metal bar made', 'metal-bar'),
  ('f0000000-0000-4000-8000-000000000704', 'f0000000-0000-4000-8000-000000000001',
   'f0000000-0000-4000-8000-0000000000a4', 'protsent', 12, null, 'too', 'Share of the job', null),
  ('f0000000-0000-4000-8000-000000000705', 'f0000000-0000-4000-8000-000000000001',
   'f0000000-0000-4000-8000-0000000000a6', 'tund', 11, null, 'too', 'Hourly', null)
on conflict (id) do nothing;

insert into public.work_hours (clinic_id, profile_id, work_date, hours, note, recorded_by)
select 'f0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-0000000000a6',
       current_date - d, 8, 'Front desk', 'f0000000-0000-4000-8000-0000000000a6'
  from generate_series(1, 5) as d
 where not exists (select 1 from public.work_hours w
                    where w.profile_id = 'f0000000-0000-4000-8000-0000000000a6' and w.work_date = current_date - d);

-- ── Stock: one expiring, one running low, the rest ordinary ─────────────────
do $$
declare
  v_clinic uuid := 'f0000000-0000-4000-8000-000000000001';
  v_by     uuid := 'f0000000-0000-4000-8000-0000000000a4';
  v_item   uuid;
  r        record;
begin
  if exists (select 1 from public.stock_item where org_id = v_clinic) then
    return;
  end if;
  for r in
    select * from (values
      ('implant',  'Fakedent Implants', 'MockLine', '4.1 x 10', 'Implant 4.1x10', 'FAKE-LOT-1', (current_date + 400)::date, 12),
      ('implant',  'Fakedent Implants', 'MockLine', '3.5 x 12', 'Implant 3.5x12', 'FAKE-LOT-2', (current_date + 300)::date,  6),
      ('abutment', 'Fakedent Implants', 'MockLine', 'standard', 'Abutment std',   'FAKE-LOT-3', (current_date + 25)::date,   4),
      ('membrane', 'Pretend Bio',       null,       '15 x 20',  'Membrane 15x20', 'FAKE-LOT-4', (current_date + 200)::date,  1),
      ('bone',     'Pretend Bio',       null,       '0.5 g',    'Bone graft 0.5g','FAKE-LOT-5', (current_date + 500)::date,  9)
    ) as t(category, manufacturer, system, size, product, lot, expiry_date, qty)
  loop
    insert into public.stock_item (org_id, category, manufacturer, system, size, product, lot, expiry_date, created_by)
    values (v_clinic, r.category, r.manufacturer, r.system, r.size, r.product, r.lot, r.expiry_date, v_by)
    returning id into v_item;
    insert into public.stock_movement (org_id, item_id, kind, delta, reason, by_user)
    values (v_clinic, v_item, 'in', r.qty, 'Fake opening stock', v_by);
  end loop;
end $$;

-- ── What was made ───────────────────────────────────────────────────────────
select 'clinic' as what, count(*) from public.clinics
union all select 'people',      count(*) from public.profiles where clinic_id = 'f0000000-0000-4000-8000-000000000001'
union all select 'customers',   count(*) from public.customers where clinic_id = 'f0000000-0000-4000-8000-000000000001'
union all select 'patients',    count(*) from public.patients where clinic_id = 'f0000000-0000-4000-8000-000000000001'
union all select 'jobs',        count(*) from public.jobs where clinic_id = 'f0000000-0000-4000-8000-000000000001'
union all select 'templates',   count(*) from public.workflow_template where org_id = 'f0000000-0000-4000-8000-000000000001'
union all select 'invoices',    count(*) from public.invoices where clinic_id = 'f0000000-0000-4000-8000-000000000001'
union all select 'pay rules',   count(*) from public.worker_rates where clinic_id = 'f0000000-0000-4000-8000-000000000001'
union all select 'stock items', count(*) from public.stock_item where org_id = 'f0000000-0000-4000-8000-000000000001';
