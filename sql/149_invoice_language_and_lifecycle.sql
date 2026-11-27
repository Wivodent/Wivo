-- ============================================================================
-- 149: an invoice's language per client and per invoice; deleting, cancelling
--      and crediting invoices by the rules
-- ============================================================================
--
-- Run AFTER 148.
--
-- 1. Language. A client's own invoice language (customers.invoice_language,
--    empty: the clinic's default) and country (customers.country: a client
--    abroad is offered English). Each invoice keeps the language it was made
--    in (invoices.language, sql/148); a later change changes no issued one.
--
-- 2. A draft has no number yet. A new invoice is a draft (status 'mustand')
--    and holds a placeholder, 'draft:<its id>', not a number of the
--    sequence; it gets the next number when it is issued: marked Sent (or
--    Paid), or sent by e-mail (invoice_issue). So a deleted draft leaves no
--    hole in the numbers. A placeholder can never be a real number (a prefix
--    keeps letters, digits, - / _ only: no colon). The column stays NOT NULL
--    (sql/109 restores it on a repaired copy; a placeholder keeps the two in
--    step). The trigger below is what keeps an issued invoice from ever
--    holding a placeholder. Drafts that already have a number keep it. A payment plan's
--    instalments are numbered when the plan is made, as before.
--
-- 3. Deleting: only a draft, by someone who may edit payments, and not one
--    with money received on it (a payment used to be deleted with its
--    invoice: payments.invoice_id cascades). Enforced on any DELETE, so an
--    older build is held to it too. Every delete is in the audit log.
--
-- 4. An issued invoice is never deleted: it is cancelled (cancel_invoice: a
--    reason is required; the number stays; it no longer counts as revenue,
--    as before for Cancelled), or credited (create_credit_note: a new invoice
--    with its own number, the same lines with the opposite sign, credit_of the
--    original). A cancelled invoice stays cancelled. A payment plan's
--    instalments are cancelled with the plan, the reason filled in.

set lock_timeout = '10s';

-- ── 1. Language ─────────────────────────────────────────────────────────────
alter table public.customers add column if not exists invoice_language text;
alter table public.customers add column if not exists country text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'customers_invoice_language_valid') then
    alter table public.customers add constraint customers_invoice_language_valid check (invoice_language is null or invoice_language in ('et', 'lv', 'en'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'customers_country_valid') then
    alter table public.customers add constraint customers_country_valid check (country is null or country ~ '^[A-Z]{2}$');
  end if;
end $$;

-- A Network client's record knows its country from the Network (sql/138).
update public.customers k
   set country = upper(c.country)
  from public.network_client c
 where c.customer_id = k.id and k.country is null and c.country ~* '^[a-z]{2}$';

/** A client confirmed (or confirmed again) gets its country on its record, when the record has none. */
create or replace function public.network_client_customer_country()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.customer_id is not null and new.country ~* '^[a-z]{2}$' then
    update public.customers set country = upper(new.country) where id = new.customer_id and country is null;
  end if;
  return new;
end;
$$;
drop trigger if exists network_client_customer_country on public.network_client;
create trigger network_client_customer_country after insert or update of customer_id, country on public.network_client
  for each row execute function public.network_client_customer_country();
revoke execute on function public.network_client_customer_country() from public, anon, authenticated;

-- ── 2.–4. The invoice's life ────────────────────────────────────────────────
alter table public.invoices add column if not exists cancel_reason text;
alter table public.invoices add column if not exists cancelled_at timestamptz;
alter table public.invoices add column if not exists cancelled_by uuid references public.profiles(id) on delete set null;
alter table public.invoices add column if not exists credit_of uuid references public.invoices(id) on delete restrict;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'invoices_cancel_reason_valid') then
    alter table public.invoices add constraint invoices_cancel_reason_valid check (cancel_reason is null or length(cancel_reason) between 1 and 500);
  end if;
end $$;
create index if not exists invoices_credit_of_idx on public.invoices (credit_of) where credit_of is not null;

alter table public.audit_log drop constraint if exists audit_log_action_valid;
alter table public.audit_log add constraint audit_log_action_valid
  check (action in ('view', 'download', 'upload', 'share', 'unshare', 'stage_move',
                    'partnership', 'export', 'question', 'delete', 'restore', 'stock_override',
                    'mfa_added', 'mfa_removed', 'mfa_reset', 'account_deleted',
                    'create', 'edit', 'permission', 'file_deleted', 'update',
                    'stage_start', 'stage_edit', 'password_set', 'purge', 'cancel', 'credit'));

/** The next number of a clinic's sequence (sql/148's prefix and yearly counter). No checks: called by the functions below. */
create or replace function public.take_invoice_number(p_clinic uuid)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_year int := extract(year from current_date);
  v_no   int;
begin
  insert into public.invoice_counters (clinic_id, year, last_no)
  values (p_clinic, v_year, 1)
  on conflict (clinic_id, year)
  do update set last_no = public.invoice_counters.last_no + 1
  returning last_no into v_no;
  return public.invoice_prefix(p_clinic) || v_year || '-' || lpad(v_no::text, 4, '0');
end;
$$;

/** As in 148, for someone who may write invoices (a payment plan numbers its instalments with it). */
create or replace function public.next_invoice_number(p_clinic uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_clinic is null or p_clinic <> my_clinic_id() or not public.has_perm_or_admin('payments.write') then
    raise exception 'not allowed to number invoices for this clinic' using errcode = '42501';
  end if;
  return public.take_invoice_number(p_clinic);
end;
$$;

/**
 * The rules on every change of an invoice's status:
 *  - a new draft without a number: its placeholder ('draft:<id>');
 *  - issued (no longer a draft) with the placeholder: the next number now;
 *  - cancelled: a reason (a payment plan's instalment gets one by itself);
 *    a draft is deleted, not cancelled (a plan's instalment excepted);
 *  - a cancelled invoice stays cancelled.
 */
create or replace function public.invoices_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and old.status = 'tuhistatud' and new.status is distinct from 'tuhistatud' then
    raise exception 'A cancelled invoice stays cancelled' using errcode = '22023';
  end if;
  if new.status = 'tuhistatud' and (tg_op = 'INSERT' or old.status is distinct from 'tuhistatud') then
    if new.payment_plan_id is not null then
      new.cancel_reason := coalesce(new.cancel_reason, 'Payment plan cancelled');
    else
      if tg_op = 'UPDATE' and old.status = 'mustand' then
        raise exception 'A draft is deleted, not cancelled' using errcode = '22023';
      end if;
      if nullif(btrim(coalesce(new.cancel_reason, '')), '') is null then
        raise exception 'A reason is needed to cancel an invoice' using errcode = '22023';
      end if;
    end if;
    new.cancelled_at := coalesce(new.cancelled_at, now());
    new.cancelled_by := coalesce(new.cancelled_by, auth.uid());
  end if;
  if new.number is null and new.status = 'mustand' then
    new.number := 'draft:' || new.id;
  end if;
  if (new.number is null or new.number like 'draft:%') and new.status <> 'mustand' then
    new.number := public.take_invoice_number(new.clinic_id);
  end if;
  return new;
end;
$$;
drop trigger if exists invoices_lifecycle on public.invoices;
create trigger invoices_lifecycle before insert or update on public.invoices
  for each row execute function public.invoices_lifecycle();

/**
 * Deleting an invoice: only a draft with no money on it, and recorded. A
 * delete with no user (the service role, an organisation leaving) is not held
 * to it.
 */
create or replace function public.invoices_delete_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then return old; end if;
  if old.status <> 'mustand' then
    raise exception 'Only a draft can be deleted: cancel the invoice or credit it' using errcode = '22023';
  end if;
  if exists (select 1 from public.payments where invoice_id = old.id) then
    raise exception 'This draft has payments: it cannot be deleted' using errcode = '22023';
  end if;
  perform public.audit(old.clinic_id, 'delete', 'invoice:' || old.id,
    jsonb_strip_nulls(jsonb_build_object('number', nullif(old.number, 'draft:' || old.id), 'gross_total', old.gross_total)));
  return old;
end;
$$;
drop trigger if exists invoices_delete_guard on public.invoices;
create trigger invoices_delete_guard before delete on public.invoices
  for each row execute function public.invoices_delete_guard();

/** Someone who may edit payments, and an invoice of their clinic: the invoice, or nothing. */
create or replace function public.invoice_for_change(p_invoice uuid)
returns public.invoices
language plpgsql
stable
security definer
set search_path = public
as $$
declare i public.invoices;
begin
  if not public.has_perm_or_admin('payments.write') then raise exception 'Edit payments is needed' using errcode = '42501'; end if;
  select * into i from public.invoices where id = p_invoice and clinic_id = public.my_clinic_id();
  if i.id is null then raise exception 'Invoice not found' using errcode = '42501'; end if;
  return i;
end;
$$;

/** Delete a draft (the guard above decides; this says it first, plainly). */
create or replace function public.delete_invoice(p_invoice uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare i public.invoices := public.invoice_for_change(p_invoice);
begin
  delete from public.invoices where id = i.id;
end;
$$;

/** A draft gets its number (before it is e-mailed: the e-mail and its PDF carry it). Returns the number. */
create or replace function public.invoice_issue(p_invoice uuid)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare i public.invoices := public.invoice_for_change(p_invoice);
begin
  if i.number not like 'draft:%' then return i.number; end if;
  update public.invoices set number = public.take_invoice_number(i.clinic_id), updated_at = now()
   where id = i.id returning number into i.number;
  return i.number;
end;
$$;

/** Cancel an issued invoice, with its reason. The number stays; it no longer counts. */
create or replace function public.cancel_invoice(p_invoice uuid, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  i public.invoices := public.invoice_for_change(p_invoice);
  v_reason text := nullif(left(btrim(coalesce(p_reason, '')), 500), '');
begin
  if i.status = 'tuhistatud' then return; end if;
  if v_reason is null then raise exception 'A reason is needed to cancel an invoice' using errcode = '22023'; end if;
  update public.invoices set status = 'tuhistatud', cancel_reason = v_reason, cancelled_at = now(), cancelled_by = auth.uid(), updated_at = now()
   where id = i.id;
  perform public.audit(i.clinic_id, 'cancel', 'invoice:' || i.id, jsonb_build_object('number', i.number));
end;
$$;

/**
 * A credit note for an issued invoice: a new invoice with its own number, the
 * same lines with the opposite sign, pointing at the original. Once per
 * invoice. Returns the credit note.
 */
create or replace function public.create_credit_note(p_invoice uuid, p_reason text)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  i public.invoices := public.invoice_for_change(p_invoice);
  v_reason text := nullif(left(btrim(coalesce(p_reason, '')), 500), '');
  v_id uuid;
begin
  if i.status not in ('saadetud', 'makstud') then raise exception 'Only an issued invoice is credited' using errcode = '22023'; end if;
  if i.credit_of is not null then raise exception 'A credit note is not credited' using errcode = '22023'; end if;
  if exists (select 1 from public.invoices where credit_of = i.id) then raise exception 'This invoice already has a credit note' using errcode = '22023'; end if;
  if v_reason is null then raise exception 'A reason is needed for a credit note' using errcode = '22023'; end if;
  insert into public.invoices (clinic_id, patient_id, patsient, customer_id, bill_to_kind, status, issue_date, due_date, vat_rate,
                               note, created_by, language, vat_exempt_note, buyer_reg_code, buyer_vat_number, buyer_address, credit_of)
  values (i.clinic_id, i.patient_id, i.patsient, i.customer_id, i.bill_to_kind, 'saadetud', current_date, current_date, i.vat_rate,
          v_reason, auth.uid(), i.language, i.vat_exempt_note, i.buyer_reg_code, i.buyer_vat_number, i.buyer_address, i.id)
  returning id into v_id;
  insert into public.invoice_lines (invoice_id, job_id, revision_id, description, qty, unit_price, sort_order)
  select v_id, l.job_id, l.revision_id, l.description, -l.qty, l.unit_price, l.sort_order
    from public.invoice_lines l where l.invoice_id = i.id;
  perform public.audit(i.clinic_id, 'credit', 'invoice:' || i.id,
    jsonb_build_object('number', i.number, 'credit_note', (select number from public.invoices where id = v_id)));
  return v_id;
end;
$$;

-- ── Who may run what ────────────────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'public.take_invoice_number(uuid)', 'public.invoices_lifecycle()', 'public.invoices_delete_guard()', 'public.invoice_for_change(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'public.delete_invoice(uuid)', 'public.invoice_issue(uuid)', 'public.cancel_invoice(uuid, text)', 'public.create_credit_note(uuid, text)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

select public.lock_anon_functions();

-- ─── Verify (read only) ─────────────────────────────────────────────────────
-- select count(*) from public.invoices where number like 'draft:%' and status <> 'mustand';   -> 0
-- select tgname from pg_trigger where tgrelid = 'public.invoices'::regclass and not tgisinternal order by 1;   -> includes invoices_delete_guard, invoices_lifecycle
-- Afterwards, in SQL Editor on its own: notify pgrst, 'reload schema';
