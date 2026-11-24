-- ============================================================================
-- Wivo — migration 126: one "you are on stages A, B, C" per person, not one per stage
-- Run AFTER sql/125. Then, as a SEPARATE query:  notify pgrst, 'reload schema';
-- ============================================================================
--
-- Kevin, after the first week in Riga: when one person is put on several
-- stages of the same job at once, they get one notification naming all the
-- stages ("You were put on job X's stages A, B, C"), not one per stage.
--
-- sql/123 told them per stage:
--   * a new job: once per person, naming only their FIRST stage;
--   * set_job_stage_people(): once per stage. The app calls it per stage (the
--     new-job form's stage edits, "assign to another stage"), so three stages
--     were three notifications.
--
-- What changes, in notify_stage_assigned() only (same signature, so every
-- caller in sql/123 keeps calling it):
--   * a new job: the notification names every stage of the job the person is
--     on (not skipped), in the job's order;
--   * a later stage, for the same person on the same job, while the earlier
--     notification is still unread and less than 2 minutes old: added to
--     that notification instead of a new one. A read one, or an older one,
--     is left as it is and a new notification is made.
--
-- `detail` keeps `stage` (the first stage) and `new`, as before, so a desktop
-- older than 2.0.7 still shows the first stage. `stages` is added only when
-- there is more than one.
--
-- Still the bell only: no e-mail, no push (sql/123). No patient in it.
-- Tests: sql/test/stageAssignedOnce.test.ts.
-- ============================================================================

set lock_timeout = '10s';

create or replace function public.notify_stage_assigned(p_org uuid, p_job uuid, p_user uuid, p_stage text, p_new boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stages text[];
  n        public.notification;
  v_all    text[];
begin
  -- Nobody is told what they did themselves (as notify_member).
  if p_user is not distinct from auth.uid() then
    return;
  end if;

  if p_new then
    -- A new job: every stage the person is on, in the job's order.
    select coalesce(array_agg(s.stage_key order by s.position), '{}') into v_stages
      from public.job_stage s
      join public.job_stage_person jp on jp.job_stage_id = s.id
     where s.job_id = p_job and jp.profile_id = p_user and s.skipped_at is null;
    if cardinality(v_stages) = 0 then
      v_stages := array[p_stage];
    end if;
  else
    v_stages := array[p_stage];
  end if;

  -- The same person, the same job, a moment ago, not read yet: one notification.
  select * into n from public.notification
   where user_id = p_user and job_id = p_job and org_id = p_org and kind = 'stage_assigned'
     and read_at is null and created_at > now() - interval '2 minutes'
   order by created_at desc
   limit 1
   for update;

  if n.id is not null then
    v_all := coalesce(
      (select array_agg(x order by o) from jsonb_array_elements_text(n.detail -> 'stages') with ordinality as e(x, o)),
      array[n.detail ->> 'stage']);
    v_all := v_all || array(select x from unnest(v_stages) x where not (x = any(v_all)));
    -- In the job's order, whichever call came first.
    select coalesce(array_agg(x order by coalesce(s.position, 2147483647), x), v_all) into v_all
      from unnest(v_all) x
      left join public.job_stage s on s.job_id = p_job and s.stage_key = x;
    update public.notification
       set detail = jsonb_build_object('stage', v_all[1], 'new', coalesce((n.detail ->> 'new')::boolean, false) or p_new)
                    || case when cardinality(v_all) > 1 then jsonb_build_object('stages', to_jsonb(v_all)) else '{}'::jsonb end
     where id = n.id;
    return;
  end if;

  perform public.notify_member(p_org, p_user, p_job, 'stage_assigned',
    jsonb_build_object('stage', v_stages[1], 'new', p_new)
    || case when cardinality(v_stages) > 1 then jsonb_build_object('stages', to_jsonb(v_stages)) else '{}'::jsonb end);
end;
$$;
revoke execute on function public.notify_stage_assigned(uuid, uuid, uuid, text, boolean) from public, anon, authenticated;

select public.ensure_mfa_policies();
select public.lock_anon_functions();
