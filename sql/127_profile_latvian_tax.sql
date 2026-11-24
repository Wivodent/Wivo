-- ============================================================================
-- Wivo — migration 127: a Latvian employee's tax situation
-- Run AFTER sql/126. Then, as a SEPARATE query:  notify pgrst, 'reload schema';
-- ============================================================================
--
-- The payroll estimate follows the clinic's country (shared/payroll/countryTax.ts).
-- In Latvia two facts about the person change the numbers and have no column:
--
--   ulalpeetavad  number of dependents (250 € a month each off taxable income)
--   pensionar     receives an old-age pension (9.25% / 20.77% instead of
--                 10.5% / 23.59% social insurance)
--
-- The third Latvian fact, whether the tax booklet is with this employer, is the
-- existing maksuvaba_tulu (sql/054): 0 = no non-taxable minimum here, NULL =
-- the country's default (the booklet is with us).
--
-- Both are pay and tax fields, so they follow sql/117 exactly: NOT granted for
-- select on profiles (a colleague cannot read them), returned by
-- pay_settings() to the person themselves and to payroll. Writing is unchanged:
-- the same policies and guard_profile_change decide who changes what.
--
-- NULL means "not set": 0 dependents, not a pensioner. The app reads a
-- database without this migration the same way, so nothing breaks before it.
--
-- No new table. Tests: sql/test/profilePay.test.ts.
-- ============================================================================

set lock_timeout = '10s';

alter table public.profiles
  add column if not exists ulalpeetavad smallint,
  add column if not exists pensionar boolean;

alter table public.profiles drop constraint if exists profiles_ulalpeetavad_valid;
alter table public.profiles add constraint profiles_ulalpeetavad_valid
  check (ulalpeetavad is null or (ulalpeetavad >= 0 and ulalpeetavad <= 20));

comment on column public.profiles.ulalpeetavad is
  'Latvia: number of dependents for the payroll estimate. NULL = 0. Pay data: not readable by colleagues (sql/117, sql/127).';
comment on column public.profiles.pensionar is
  'Latvia: receives an old-age pension (lower social insurance). NULL = no. Pay data: not readable by colleagues (sql/117, sql/127).';

-- The returned columns change, so the function is dropped and made again.
drop function if exists public.pay_settings();

create function public.pay_settings()
returns table (profile_id uuid, toosuhe text, tasu_arvestus text, kogumispension_protsent numeric,
               maksuvaba_tulu numeric, kiirtoo_kordaja numeric, ulalpeetavad smallint, pensionar boolean)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.toosuhe, p.tasu_arvestus, p.kogumispension_protsent, p.maksuvaba_tulu, p.kiirtoo_kordaja,
         p.ulalpeetavad, p.pensionar
    from public.profiles p
   where p.id = auth.uid()
      or (public.my_clinic_id() is not null
          and public.can_manage_payroll()
          and (p.clinic_id = public.my_clinic_id()
               or (p.clinic_id is null and p.removed_from = public.my_clinic_id())))
$$;

revoke execute on function public.pay_settings() from public, anon;
grant execute on function public.pay_settings() to authenticated;

select public.lock_anon_functions();
