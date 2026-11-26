-- ============================================================================
-- Wivo — migration 133: a workflow template is saved in one step
-- Run after 132.
-- ============================================================================
--
-- WHY
--   Until 2.2.4 the app saved a template as four requests: the name, delete
--   every stage, insert the stages, insert their people. A connection lost
--   after the delete left the template with no stages at all; two people
--   saving at once could interleave the four. save_workflow_template does all
--   of it in one call, which PostgREST runs as one transaction: everything is
--   saved, or nothing is.
--
-- WHO MAY
--   SECURITY INVOKER: each statement is checked by the tables' own rules, as
--   the four requests were (sql/122: "Manage stages", one's own clinic, people
--   of one's own clinic, the second factor). Nothing here widens them.
--
-- SOMEBODY ELSE SAVED FIRST (2.2.3)
--   p_expected_updated_at is the template's updated_at when the form was
--   filled. If it has changed, nothing is written and the call fails with
--   WV003, which the app shows as "Someone else changed this while you were
--   editing" + Reload. Null: no such check (a new template).
--
-- p_stages: a JSON list, in order; each
--   { stage_key, task, optional, default_on, only_if: [...], orderer,
--     pay_role, people: [profile ids] }.
--   The position is the place in the list. The tables' checks (one pay kind
--   per template, a known rule, a switch or a rule) refuse what is wrong, and
--   then nothing at all is saved.
-- Returns { id, updated_at }.

set lock_timeout = '10s';

create or replace function public.save_workflow_template(
  p_id uuid,
  p_name text,
  p_stages jsonb,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_org uuid := public.my_org_id();
  v_id uuid := p_id;
  v_at timestamptz;
  v_stage uuid;
  s jsonb;
  i int := 0;
begin
  if v_org is null then
    raise exception 'No clinic' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_stages, '[]'::jsonb)) <> 'array' then
    raise exception 'The stages must be a list' using errcode = '22023';
  end if;

  if v_id is null then
    insert into public.workflow_template (org_id, name)
    values (v_org, btrim(p_name))
    returning id, updated_at into v_id, v_at;
  else
    update public.workflow_template
       set name = btrim(p_name), updated_at = now()
     where id = v_id and org_id = v_org and archived_at is null
       and (p_expected_updated_at is null or updated_at = p_expected_updated_at)
    returning updated_at into v_at;
    if not found then
      if exists (select 1 from public.workflow_template
                  where id = v_id and org_id = v_org and archived_at is null
                    and p_expected_updated_at is not null and updated_at <> p_expected_updated_at) then
        raise exception 'Someone else saved this template meanwhile' using errcode = 'WV003';
      end if;
      -- Not there, archived, another clinic's, or not this person's to change.
      raise exception 'This template cannot be saved' using errcode = '42501';
    end if;
    delete from public.workflow_template_stage where template_id = v_id;
  end if;

  for s in select value from jsonb_array_elements(coalesce(p_stages, '[]'::jsonb)) loop
    insert into public.workflow_template_stage
      (org_id, template_id, stage_key, position, task, optional, default_on, only_if, orderer, pay_role)
    values (
      v_org, v_id, btrim(s->>'stage_key'), i,
      nullif(btrim(coalesce(s->>'task', '')), ''),
      coalesce((s->>'optional')::boolean, false),
      coalesce((s->>'default_on')::boolean, false),
      coalesce(array(select jsonb_array_elements_text(coalesce(s->'only_if', '[]'::jsonb))), '{}'::text[]),
      coalesce((s->>'orderer')::boolean, false),
      nullif(s->>'pay_role', '')
    )
    returning id into v_stage;

    insert into public.workflow_template_stage_person (template_stage_id, profile_id, org_id)
    select distinct v_stage, p.value::uuid, v_org
      from jsonb_array_elements_text(coalesce(s->'people', '[]'::jsonb)) p;

    i := i + 1;
  end loop;

  return jsonb_build_object('id', v_id, 'updated_at', v_at);
end
$$;

revoke execute on function public.save_workflow_template(uuid, text, jsonb, timestamptz) from public, anon;
grant execute on function public.save_workflow_template(uuid, text, jsonb, timestamptz) to authenticated;

select public.lock_anon_functions();
