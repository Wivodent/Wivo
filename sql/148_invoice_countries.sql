-- ============================================================================
-- 148: invoices for more than one country (Latvia next to Estonia), and sending one by e-mail by hand
-- ============================================================================
--
-- Run AFTER 147.
--
-- Which countries have Wivo's invoices is the app's country file
-- (shared/billing/countryInvoice.ts); this adds what an invoice in the EU must
-- carry (Council Directive 2006/112/EC, art. 226) and Wivo did not keep yet,
-- each stored ON THE INVOICE when it is made, as the VAT rate already is, so
-- a later change in the settings or the client's record never restates an
-- issued document:
--   service_date      the date of the service, when it differs from the issue date
--   language          the document's language: et, lv or en
--   vat_exempt_note   the reason no VAT is charged (e.g. the article of
--                     Latvia's VAT law), printed on the invoice; with VAT 0
--   buyer_reg_code, buyer_vat_number, buyer_address   the client's details
--
-- The number: the clinic's prefix (Settings, clinic_settings.pricing
-- ->>'arvePrefiks'; letters, digits, - / _ only, no spaces) before the same
-- yearly sequence as before, e.g. "DEN-2026-0007". No prefix: "2026-0007",
-- exactly as before. The counter is the clinic's per year whatever the
-- prefix, so a number is never given twice (and invoices_number_per_clinic
-- still refuses a duplicate).

set lock_timeout = '10s';

alter table public.invoices add column if not exists service_date date;
alter table public.invoices add column if not exists language text;
alter table public.invoices add column if not exists vat_exempt_note text;
alter table public.invoices add column if not exists buyer_reg_code text;
alter table public.invoices add column if not exists buyer_vat_number text;
alter table public.invoices add column if not exists buyer_address text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'invoices_language_valid') then
    alter table public.invoices add constraint invoices_language_valid check (language is null or language in ('et', 'lv', 'en'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'invoices_vat_exempt_valid') then
    alter table public.invoices add constraint invoices_vat_exempt_valid
      check (vat_exempt_note is null or (length(vat_exempt_note) between 1 and 500 and vat_rate = 0));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'invoices_buyer_valid') then
    alter table public.invoices add constraint invoices_buyer_valid
      check (coalesce(length(buyer_reg_code), 0) <= 40 and coalesce(length(buyer_vat_number), 0) <= 40 and coalesce(length(buyer_address), 0) <= 300);
  end if;
end $$;

/** The clinic's invoice prefix, as numbers use it: only letters, digits, - / _ (no spaces), at most 12. */
create or replace function public.invoice_prefix(p_clinic uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select left(regexp_replace(coalesce((select pricing->>'arvePrefiks' from public.clinic_settings where clinic_id = p_clinic), ''),
                             '[^A-Za-z0-9/_-]', '', 'g'), 12)
$$;

/** As in 102, with the clinic's prefix before the yearly sequence. */
create or replace function public.next_invoice_number(p_clinic uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year int := extract(year from current_date);
  v_no   int;
begin
  if p_clinic is null or p_clinic <> my_clinic_id() or not public.has_perm_or_admin('payments.write') then
    raise exception 'not allowed to number invoices for this clinic' using errcode = '42501';
  end if;
  insert into public.invoice_counters (clinic_id, year, last_no)
  values (p_clinic, v_year, 1)
  on conflict (clinic_id, year)
  do update set last_no = public.invoice_counters.last_no + 1
  returning last_no into v_no;
  return public.invoice_prefix(p_clinic) || v_year || '-' || lpad(v_no::text, 4, '0');
end;
$$;

revoke execute on function public.invoice_prefix(uuid) from public, anon, authenticated;

-- ── Sending one invoice by e-mail, by hand ──────────────────────────────────
-- The invoice panel's "Send by e-mail" (Edge Function send-invoice): to whom,
-- the subject and the message as the person wrote them, the PDF attached,
-- from the clinic's mailbox with Reply-To the person's own address. Asked of
-- the database as that person (invoice_send_prepare: Edit payments, their
-- clinic's invoice); written with the service key once the mail server
-- answered (invoice_send_record): Sent, or the error and the invoice as it
-- was. Every try is kept (invoice_send_log): who, when, to whom, the subject.

create table if not exists public.invoice_send_log (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.clinics(id) on delete cascade,
  invoice_id      uuid not null references public.invoices(id) on delete cascade,
  sent_by         uuid references public.profiles(id) on delete set null,
  sent_at         timestamptz not null default now(),
  recipients      text[] not null,
  subject         text not null,
  copy_to_sender  boolean not null default false,
  redirected_to   text,
  ok              boolean not null,
  error           text,
  constraint invoice_send_log_recipients_valid check (coalesce(array_length(recipients, 1), 0) between 1 and 10),
  constraint invoice_send_log_subject_valid check (length(subject) between 1 and 300),
  constraint invoice_send_log_error_valid check (error is null or length(error) <= 500)
);
create index if not exists invoice_send_log_invoice_idx on public.invoice_send_log (invoice_id, sent_at desc);
alter table public.invoice_send_log enable row level security;
drop policy if exists "invoice_send_log_select" on public.invoice_send_log;
create policy "invoice_send_log_select" on public.invoice_send_log for select to authenticated
  using (org_id = public.my_org_id() and public.has_perm_or_admin('payments.read'));
revoke all on public.invoice_send_log from public, anon, authenticated;
grant select on public.invoice_send_log to authenticated;

/**
 * Everything one hand-sent invoice needs, for someone who may edit payments
 * in the invoice's clinic: the invoice with its lines and payments, the
 * clinic's details and country, its mail settings and invoice language, how
 * many invoices went out in the last 24 hours (the daily cap), and the
 * person's own address (Reply-To).
 */
create or replace function public.invoice_send_prepare(p_invoice uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  i public.invoices;
  v_clinic uuid := public.my_clinic_id();
begin
  if not public.has_perm_or_admin('payments.write') then raise exception 'Edit payments is needed' using errcode = '42501'; end if;
  select * into i from public.invoices where id = p_invoice and clinic_id = v_clinic;
  if i.id is null then raise exception 'Invoice not found' using errcode = '42501'; end if;
  return jsonb_build_object(
    'invoice', to_jsonb(i) || jsonb_build_object(
      'lines', coalesce((select jsonb_agg(to_jsonb(l) order by l.sort_order) from public.invoice_lines l where l.invoice_id = i.id), '[]'::jsonb),
      'payments', coalesce((select jsonb_agg(to_jsonb(p)) from public.payments p where p.invoice_id = i.id), '[]'::jsonb)),
    'clinic', (select jsonb_build_object('id', c.id, 'name', c.name, 'address', c.address, 'postal_code', c.postal_code, 'city', c.city,
                                         'reg_code', c.reg_code, 'vat_number', c.vat_number, 'phone', c.phone, 'email', c.email,
                                         'bank_name', c.bank_name, 'bank_account', c.bank_account, 'country', c.country)
                 from public.clinics c where c.id = v_clinic),
    'email', coalesce((select email from public.clinic_settings where clinic_id = v_clinic), '{}'::jsonb),
    'language', (select pricing->>'arveKeel' from public.clinic_settings where clinic_id = v_clinic),
    'sent_today', (select count(*) from public.invoices where clinic_id = v_clinic and sent_at > now() - interval '24 hours'),
    'caller', jsonb_build_object('id', auth.uid(), 'email', (select email from auth.users where id = auth.uid())));
end;
$$;

/** What the mail server answered, kept: Sent (a draft becomes Sent), or the error and the invoice as it was. */
create or replace function public.invoice_send_record(p_invoice uuid, p_by uuid, p_to text[], p_subject text, p_copy boolean,
                                                      p_redirected text, p_ok boolean, p_error text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare i public.invoices;
begin
  select * into i from public.invoices where id = p_invoice;
  if i.id is null then raise exception 'Invoice not found' using errcode = '42501'; end if;
  insert into public.invoice_send_log (org_id, invoice_id, sent_by, recipients, subject, copy_to_sender, redirected_to, ok, error)
  values (i.clinic_id, i.id, p_by, p_to, left(p_subject, 300), coalesce(p_copy, false), p_redirected, p_ok, left(p_error, 500));
  if p_ok then
    update public.invoices
       set sent_at = now(), send_error = null, updated_at = now(),
           status = case when status = 'mustand' then 'saadetud' else status end
     where id = i.id;
  else
    update public.invoices set send_error = left(p_error, 500), updated_at = now() where id = i.id;
  end if;
end;
$$;

revoke execute on function public.invoice_send_prepare(uuid) from public, anon;
grant execute on function public.invoice_send_prepare(uuid) to authenticated;
revoke execute on function public.invoice_send_record(uuid, uuid, text[], text, boolean, text, boolean, text) from public, anon, authenticated;
grant execute on function public.invoice_send_record(uuid, uuid, text[], text, boolean, text, boolean, text) to service_role;

select public.ensure_mfa_policies();
select public.lock_anon_functions();

-- ─── Verify (read only) ─────────────────────────────────────────────────────
-- select rowsecurity from pg_tables where tablename = 'invoice_send_log';   -> true
-- select column_name from information_schema.columns where table_name = 'invoices'
--    and column_name in ('service_date', 'language', 'vat_exempt_note', 'buyer_reg_code', 'buyer_vat_number', 'buyer_address');  -> 6 rows
-- Afterwards, in SQL Editor on its own: notify pgrst, 'reload schema';
