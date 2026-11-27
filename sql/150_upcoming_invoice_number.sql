-- 150: the number a draft will get, shown before it is sent.
--
-- A draft has no number of the sequence until it is issued (sql/149), so the
-- "Send by e-mail" letter said "Invoice DRAFT". The dialog now fills the letter
-- with the number the draft will get: the next one of the clinic's sequence,
-- read without taking it. If someone takes that number first, the sender
-- (Edge Function send-invoice) notices that the issued number differs from the
-- one in the letter. It does not send: the dialog updates the subject and the
-- message and shows the new number.
--
-- Read only (stable): nothing is taken, so an abandoned dialog leaves no gap.
-- Edit payments, own clinic only, like next_invoice_number.

create or replace function public.upcoming_invoice_number(p_clinic uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_year int := extract(year from current_date);
  v_last int;
begin
  if p_clinic is null or p_clinic <> my_clinic_id() or not public.has_perm_or_admin('payments.write') then
    raise exception 'not allowed to number invoices for this clinic' using errcode = '42501';
  end if;
  select last_no into v_last from public.invoice_counters where clinic_id = p_clinic and year = v_year;
  return public.invoice_prefix(p_clinic) || v_year || '-' || lpad((coalesce(v_last, 0) + 1)::text, 4, '0');
end;
$$;

revoke execute on function public.upcoming_invoice_number(uuid) from public, anon;
grant execute on function public.upcoming_invoice_number(uuid) to authenticated;

select public.lock_anon_functions();

-- ─── Verify (read only) ─────────────────────────────────────────────────────
-- select provolatile from pg_proc where proname = 'upcoming_invoice_number';   -> s
-- Afterwards, in SQL Editor on its own: notify pgrst, 'reload schema';
