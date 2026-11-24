# Work type options — plan

**Status:** plan only (Kevin, 2026-11-25). No code, no migration yet.

**The need.** A work type can come in variants that change the price, the
cost, the stages or the pay: All-on-4 **with a metal bar** or **with a
titanium mesh**; a crown **screw-retained** or **cemented**. The owner sets the
choices up once under the work type in Settings; whoever adds a job picks one
on the work item's card, with big buttons.

The design already reserves the place: docs/design production.html shows a
"Framework: Metal bar · Titanium mesh · None" row on the work item card. 2.1.0
left it out on purpose because nothing stores it yet.

---

## 1. What exists today, and what can carry this

| Existing | Where | Covers options? | Reuse |
|---|---|---|---|
| **Work types** | `clinic_settings.work_types` (jsonb), `WorkType` in shared/pricing/workTypes.ts | No — one price, one cost list per type | **Yes: options live on the type**, in the same jsonb. No migration for the setup. |
| **Material step** | wizard step 3, `materialByType`; `WorkItem.materjal` | One free-text choice per item, from the clinic's material list | No: materials are a clinic-wide list with their own prices and costs; an option belongs to ONE type. Kept separate so the material price logic does not change. |
| **Materials list / prices** | `materjalid`, `materialPrices`, `materialCosts` | Price and cost per material | Pattern to copy (price + cost per choice), not the storage. |
| **Stage conditions** | `workflow_template_stage.only_if` (text[], sql/122), `ONLY_IF_RULES` in shared/workflow | Fixed list: digital, conventional, implants_gt_1, print, mill, printed_model | **Extend**: a rule `option:<key>` — "this stage only when this option is chosen". Needs the CHECK constraint widened (migration). |
| **Prices** | `WorkType.hind / soodushind / hinnaTyyp / astmed` | — | An option adds an **extra price** on top, per job or per tooth, like `hinnaTyyp`. |
| **Costs** | `WorkType.kulud` (name, amount, per job/tooth) | — | An option carries its **own cost lines** of the same shape; the margin adds them. |
| **Pay rules** | `worker_rates` (kind, amount, scope, `work_type` text, priority) | Rule per work type, several types joined with `|` | **Extend** with one nullable column `option_key`: "only when this option is chosen" (migration). |
| **Job work items** | `jobs.work_items` (jsonb), `WorkItem` in types/job.ts | — | **Yes**: the chosen options are stored on the item, `valikud: { [groupKey]: optionKey[] }`. No migration. |

So: setup and the job's choice need **no** migration (both are jsonb); the stage
rule and the pay condition need **one** small migration.

---

## 2. Data model

### On the work type (clinic_settings.work_types, jsonb)

```ts
interface WorkTypeOptionGroup {
  key: string            // stable, never shown; slug made once ('framework')
  nimi: string           // "Framework"
  mitu: boolean          // false = choose one, true = choose any
  kohustuslik: boolean   // a job cannot be saved without a choice
  valikud: WorkTypeOption[]
}
interface WorkTypeOption {
  key: string            // stable ('metal_bar'); renaming the label keeps it
  nimi: string           // "Metal bar"
  lisahind?: number      // extra on the client price
  lisahinnaTyyp?: PriceMode   // 'too' | 'hammas', like WorkType.hinnaTyyp
  kulud?: WorkTypeCost[]      // our cost, same shape as WorkType.kulud
  lisaEtapp?: string          // optional: a stage key this option adds (see below)
  arhiivis?: boolean          // hidden from new jobs, kept for old ones
}
// WorkType gains:  valikuGrupid?: WorkTypeOptionGroup[]
```

Keys, not labels, are stored on jobs: renaming "Metal bar" to "Metal frame"
must not orphan every job that picked it. An option is never deleted once a job
used it — it is archived (`arhiivis`), exactly why the old jobs still read.

### On the job (jobs.work_items, jsonb)

```ts
// WorkItem gains:
valikud?: Record<string /* group key */, string[] /* option keys */>
```

Absent = nothing chosen, which is what every existing job means.

### Migration 128 (the next free number after 127)

1. `workflow_template_stage.only_if`: widen the CHECK so an entry may also be
   `option:<key>` (`<key>` = `[a-z0-9_]{1,40}`). Existing values unchanged.
2. `worker_rates.option_key text null` with a format CHECK; NULL = the rule
   applies whatever the options (every existing rule).
3. No new table, so no new RLS: both tables keep their policies (org_id/RLS
   already in place). Ends with `select public.lock_anon_functions();` only if
   a function changes (the materialise function reads `only_if`; if its body
   changes it is re-created and the lock runs). Schema check regenerated.
4. Old jobs: nothing to backfill. A job with no `valikud` is priced, costed and
   paid exactly as today, and a stage with an `option:` rule is not added to it.

---

## 3. Where it shows

- **Settings › Work types & prices** (the price card from 2.1.0): a fourth
  block **"Options"** under "Our cost". "+ Add option group" asks two things in
  words, not switches: *"Can they pick more than one?"* and *"Must they pick
  one?"*. Each option is a row like a cost row: name, extra price (€ / job or
  € / tooth), "+ cost", and an "i" explaining that the extra is added to the
  client price. Archive instead of delete once used.
- **Settings › Job stages › Templates**: the stage row's "Only when" list gets
  the options of the template's work types ("Only when: Titanium mesh").
- **Payroll › How X is paid › + Add rule**: an optional "Only with option"
  select under the work type select.
- **New job › Production**: on each work item card, one row per option group,
  with big buttons (the design's "Framework" row). A required group is marked
  like "Required" on the patient field, and validation names it.
- **Job card and job page**: the chosen options as small chips after the work
  type ("All-on-4 · Titanium mesh"). Editable on the job page.
- **Price and invoice**: the quote adds each chosen option's extra (per job or
  × teeth) as its own line, so the invoice reads "All-on-4" and "Titanium mesh"
  separately. Reprice (Settings › More price settings) includes options.
- **Pay**: `calculateEarnings` matches a rule with `option_key` only when the
  item has that option; priority unchanged (a more specific rule wins).
- **Phone**: the job page shows the chips (read only). Creating jobs on the
  phone is not in scope.
- **Overview / statistics**: none in the first version.

---

## 4. Build plan, small steps

1. **Types + pure functions** (shared/): `WorkTypeOptionGroup`, `WorkItem.valikud`,
   `optionExtras(type, item)` for price and cost, with tests. No UI.
2. **Settings**: the "Options" block on the price card (jsonb, no migration).
3. **Wizard**: the option rows on the work item card + validation of required
   groups; `toJobInput` writes `valikud`. Tests on the state.
4. **Price**: the quote and the review step add the extras; invoice lines.
5. **Job page and card**: chips, editing.
6. **Migration 128**: stage `option:` rule and `worker_rates.option_key`; the
   template editor and the pay rule editor; `calculateEarnings`; SQL tests.
7. Reprice and the phone's read-only chips.

**Minimal first version in one day: steps 1–3 plus the price in step 4**
(options set up in Settings, chosen on the card, added to the price and the
cost, shown in the review). No migration in it. Stages and pay by option
(step 6) come after, once Riga has used the options for a week and says which
of them should change the stages or the pay.
