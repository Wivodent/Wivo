-- ============================================================================
-- 147: a Network order's job keeps its client's record (for invoicing)
-- ============================================================================
--
-- Run AFTER 146.
--
-- Confirming a Network client makes (or reuses) its record in Clients
-- (network_client.customer_id, sql/138), and accepting an order puts that
-- record on the job (jobs.customer_id), so the invoice form's "Bill to:
-- Client" finds the job under Unbilled work. Two ways the link could break:
--   - the job has no record (the record was deleted: on delete set null), or
--     one that was archived;
--   - the client was confirmed again after its record was archived: a new
--     record, and the old jobs still on the archived one.
-- relink_order_jobs() puts the client's current record on such jobs (only
-- those: a job whose record someone changed to another live one is left
-- alone), now for what is already there, and from now on whenever a client's
-- record changes (network_client_relink_jobs).

set lock_timeout = '10s';

/** Every accepted order's job with no live client record gets its client's current one. Returns how many. */
create or replace function public.relink_order_jobs(p_client uuid default null)
returns int
language plpgsql
volatile
security definer
set search_path = public
as $$
declare n int;
begin
  update public.jobs j
     set customer_id = c.customer_id, updated_at = now()
    from public.client_order o
    join public.network_client c on c.id = o.client_id and c.org_id = o.org_id
   where o.job_id = j.id and o.status = 'accepted' and j.clinic_id = o.org_id
     and (p_client is null or c.id = p_client)
     and c.customer_id is not null
     and exists (select 1 from public.customers k where k.id = c.customer_id and k.archived_at is null)
     and j.customer_id is distinct from c.customer_id
     and (j.customer_id is null
          or not exists (select 1 from public.customers k where k.id = j.customer_id and k.archived_at is null));
  get diagnostics n = row_count;
  return n;
end;
$$;

/** A client's record changed (confirmed again with a new one): its order jobs follow. */
create or replace function public.network_client_relink_jobs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.customer_id is distinct from old.customer_id and new.customer_id is not null then
    perform public.relink_order_jobs(new.id);
  end if;
  return new;
end;
$$;
drop trigger if exists network_client_relink_jobs on public.network_client;
create trigger network_client_relink_jobs after update of customer_id on public.network_client
  for each row execute function public.network_client_relink_jobs();

-- What is already there.
select public.relink_order_jobs();

revoke execute on function public.relink_order_jobs(uuid) from public, anon, authenticated;
revoke execute on function public.network_client_relink_jobs() from public, anon, authenticated;

select public.lock_anon_functions();

-- ─── Verify (read only) ─────────────────────────────────────────────────────
-- Jobs from accepted Network orders without their client's live record:  -> 0
-- select count(*) from public.client_order o join public.network_client c on c.id = o.client_id
--   join public.jobs j on j.id = o.job_id
--  where o.status = 'accepted' and j.customer_id is distinct from c.customer_id;
-- Afterwards, in SQL Editor on its own: notify pgrst, 'reload schema';
