-- ============================================================================
-- Wivo — migration 129: a pay rule that applies only with a work type option
-- Run AFTER sql/128. Then, as a SEPARATE query:  notify pgrst, 'reload schema';
-- ============================================================================
--
-- Payroll → Pay rules gets "Only with option" beside "Only for work types"
-- (docs/WORKTYPE-OPTIONS-PLAN.md §2–3): "All-on-4 200 €, and with a metal bar
-- 50 € more".
--
-- worker_rates.option_key  the id of an option in the clinic's option library
--   (clinic_settings.pricing.tooValikud, e.g. 'metal-bar'). A rule with one
--   pays only for work on which that option was chosen. NULL = whatever the
--   options, which is every existing rule: NOTHING is rewritten and every
--   rule pays exactly as before.
--
-- An option id, never its name: renaming "Metal bar" must not orphan the rule.
-- The format is the one the app makes ids in (English kebab-case,
-- shared/pricing/workOptions.ts newId).
--
-- No new table, so no new RLS: worker_rates keeps its policies (sql/027,
-- sql/109). No function is added or changed. The column says nothing about a
-- patient.
--
-- Tests: sql/test/workerRateOption.test.ts. Schema check regenerated.
-- ============================================================================

set lock_timeout = '10s';

alter table public.worker_rates
  add column if not exists option_key text;

alter table public.worker_rates drop constraint if exists worker_rates_option_key_format;
alter table public.worker_rates add constraint worker_rates_option_key_format
  check (option_key is null or (length(option_key) <= 80 and option_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'));

comment on column public.worker_rates.option_key is
  'Only with this work type option chosen (an id from clinic_settings.pricing.tooValikud). NULL: whatever the options. sql/129.';
