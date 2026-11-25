/**
 * Step 2 — "Vali hambad".
 *
 * What this step renders is decided entirely by the rules module, never by a
 * work-type name written here:
 *
 *   teethStepMode 'tooth' → odontogram + chip row + bulk controls
 *                           (plus the arch question, if the job ALSO carries an
 *                            arch-level type such as All-on-X)
 *   teethStepMode 'arch'  → the arch question only — no individual teeth exist
 *                           for a full-arch job
 *   teethStepMode 'none'  → the shell skips this step; the branch below only
 *                           catches a restored draft that lands here anyway
 *
 * The step holds exactly one piece of local state: which work type the next
 * click belongs to. Everything else lives in NewJobState so Back never loses it.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Info, Bolt, FlipHorizontal2 } from 'lucide-react'
import type { ArchSelection, NewJobState, ValidationError } from '@shared/wizard'
import type { MarkMode } from '@/components/teeth/toothInteraction'
import { useOdontogramMirrorToggle } from '@/components/JobDetail/MultiOdontogramPicker'
import { hambadToTeeth, sortTeeth, baseTypeName, makeTypeKey, archTeeth } from '@shared/wizard'
import { useWorkTypes } from '@/stores/useSettings'
import type { WizardStepComponent } from '../types'
import { wizardWorkItems } from '../state/workItems'
import { WizardErrors } from '../ui/WizardErrors'
import { ArchSelector } from '../teeth/ArchSelector'
import { ToothControls, type ToothLegendEntry } from '../teeth/ToothControls'
import { WizardOdontogram } from '../teeth/WizardOdontogram'
import { WorkTypeTabs, teethCountLabel, type WorkTypeTab } from '../teeth/WorkTypeTabs'
import { AbutmentPicker } from '../teeth/AbutmentPicker'
import { WIZARD_FALLBACK_HEX } from '../wizardTheme'
import { t } from '@/lib/i18n'

export const StepTeeth: WizardStepComponent = ({ state, patch, rules, errors, showErrors }) => {
  const { types } = useWorkTypes()

  const items = useMemo(() => wizardWorkItems(state, types), [state, types])

  /**
   * Only tooth-level work reaches the chart.
   *
   * An arch-level type (All-on-X, Proteez) carries the WHOLE arch in its
   * `hambad`, derived from the arch answer. Painting that on the odontogram
   * would colour in all 16 or 32 teeth and — because the wrapper refuses to
   * take a tooth another item owns — leave a crown on the same job with no
   * tooth it could ever be given. The user would sit on a step whose Continue
   * can never go green. The arch answer is already stated by the ArchSelector
   * beside the chart and named in the legend, so nothing is hidden by leaving
   * it off the teeth themselves.
   */
  const toothItems = useMemo(
    () => items.filter(i => rules.perType.find(r => r.too === i.too)?.toothMode === 'tooth'),
    [items, rules]
  )

  const colorMap = useMemo(
    () => Object.fromEntries(types.map(type => [type.nimi, type.hex])),
    [types]
  )
  const rulesByName = useMemo(
    () => new Map(rules.perType.map(r => [r.too, r])),
    [rules]
  )

  // Keys from jobTypes that are tooth-mode (includes duplicates like Sild§2)
  const toothTypeKeys = useMemo(
    () => state.jobTypes.filter(key => {
      const nimi = baseTypeName(key)
      return rulesByName.get(nimi)?.toothMode === 'tooth'
    }),
    [state.jobTypes, rulesByName]
  )
  const toothKey = toothTypeKeys.join('|')
  const [activeType, setActiveType] = useState<string | null>(() => toothTypeKeys[0] ?? null)

  useEffect(() => {
    if (toothTypeKeys.length === 0) {
      setActiveType(null)
      return
    }
    setActiveType(prev => (prev && toothTypeKeys.includes(prev) ? prev : toothTypeKeys[0]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toothKey])

  // ─── Ownership ─────────────────────────────────────────────────────────────
  // Built from EVERY work item, not just the ones the chart paints. An arch
  // type carries its 16 or 32 teeth in `hambad`, and leaving them out meant a
  // crown could be assigned to a tooth the All-on-X already owned: the same FDI
  // shipped on two work items and was priced twice. The arch teeth are still
  // not PAINTED (see toothItems above) — they are only reserved.
  // Map each tooth to the key (not base name) that owns it
  const owners = useMemo(() => {
    const m = new Map<number, string>()
    for (const key of state.jobTypes) {
      for (const tooth of (state.selectedTeeth[key] ?? [])) m.set(tooth, key)
    }
    return m
  }, [state.jobTypes, state.selectedTeeth])

  const blocked = useMemo(() => {
    const s = new Set<number>()
    for (const [fdi, key] of owners) if (key !== activeType) s.add(fdi)
    return s
  }, [owners, activeType])

  /** Teeth the user picked BY HAND, across every tooth-mode type. This and not
   *  `owners.size` is what the action bar counts and what "Tühjenda" clears —
   *  an arch type's 16 or 32 teeth are derived from the arch answer, so
   *  counting them would promise a Tühjenda that cannot remove them. */
  const pickedCount = useMemo(() => {
    const s = new Set<number>()
    for (const key of toothTypeKeys) for (const tooth of (state.selectedTeeth[key] ?? [])) s.add(tooth)
    return s.size
  }, [toothTypeKeys, state.selectedTeeth])

  /** Teeth an arch-level type has reserved, and the type that reserved them.
   *  Named separately so the refusal can say "terve lõualuu" rather than
   *  pointing at a tooth the user cannot see on the chart. */
  const archOwners = useMemo(() => {
    const m = new Map<number, string>()
    for (const item of items) {
      if (rulesByName.get(item.too)?.toothMode !== 'arch') continue
      for (const tooth of hambadToTeeth(item.hambad)) m.set(tooth, item.too)
    }
    return m
  }, [items, rulesByName])

  const activeTeeth = useMemo(
    () => (activeType ? (state.selectedTeeth[activeType] ?? []) : []),
    [activeType, state.selectedTeeth]
  )

  // ─── Error visibility ──────────────────────────────────────────────────────
  // showErrors only flips after a blocked Continue, which would leave a user who
  // has already picked a broken bridge staring at a dead button. So a type the
  // user has actually touched reports its own problems immediately, and
  // everything else waits for Continue. Warnings are never gated — they are
  // information, not accusations.
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set<string>())

  const isVisible = (e: ValidationError): boolean =>
    e.severity === 'warning' || showErrors || (e.workType != null && touched.has(e.workType))

  const visibleErrors = useMemo(
    () => errors.filter(isVisible),
    // isVisible closes over showErrors + touched; both are in the deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [errors, showErrors, touched]
  )

  const archInvalid = visibleErrors.some(e => e.field === 'arch' && e.severity === 'error')

  const errorFor = (nimi: string): string | null =>
    visibleErrors.find(e => e.field === 'teeth' && e.workType === nimi && e.severity === 'error')
      ?.message ?? null

  // ─── Writes ────────────────────────────────────────────────────────────────
  function markTouched(nimi: string) {
    setTouched(prev => (prev.has(nimi) ? prev : new Set([...prev, nimi])))
  }

  const rulesOf = (key: string) => rulesByName.get(key) ?? rulesByName.get(baseTypeName(key))

  function setTeethFor(nimi: string, teeth: number[]) {
    markTouched(nimi)
    const sorted = sortTeeth(teeth)
    const next: Partial<NewJobState> = { selectedTeeth: { ...state.selectedTeeth, [nimi]: sorted } }
    // Work built on implants (an implant crown or bridge, an abutment): a
    // tooth picked for it IS an implant until someone says otherwise, e.g. a
    // bridge's pontic. Only newly picked teeth are marked, so a mark taken off
    // stays off while other teeth are added.
    if (rulesOf(nimi)?.implantBased) {
      const before = new Set(state.selectedTeeth[nimi] ?? [])
      const kept = (state.implantsByType[nimi] ?? []).filter(tooth => sorted.includes(tooth))
      const added = sorted.filter(tooth => !before.has(tooth))
      next.implantsByType = { ...state.implantsByType, [nimi]: sortTeeth([...kept, ...added]) }
    }
    patch(next)
  }

  function toggleTooth(fdi: number) {
    if (!activeType) return
    const cur = state.selectedTeeth[activeType] ?? []
    setTeethFor(activeType, cur.includes(fdi) ? cur.filter(tooth => tooth !== fdi) : [...cur, fdi])
  }

  /**
   * Mark or unmark one tooth as sitting on an implant.
   *
   * Only a tooth this type already has: an implant under a tooth nobody is
   * making is not a fact about the job, and marking one would put a screw on
   * the invoice for a unit that does not exist.
   */
  function toggleImplantFor(key: string, fdi: number, teeth: readonly number[]) {
    if (!teeth.includes(fdi)) return
    const cur = state.implantsByType[key] ?? []
    const next = cur.includes(fdi) ? cur.filter(tooth => tooth !== fdi) : [...cur, fdi]
    patch({ implantsByType: { ...state.implantsByType, [key]: sortTeeth(next) } })
  }

  function toggleImplant(fdi: number) {
    if (!activeType) return
    toggleImplantFor(activeType, fdi, state.selectedTeeth[activeType] ?? [])
  }

  /** The teeth a work type has on this job: its picks, or for a jaw its arch. */
  const teethOf = (key: string): number[] =>
    rulesOf(key)?.toothMode === 'arch'
      ? hambadToTeeth(items.filter(i => i.id === `wiz:${key}` || i.id.startsWith(`wiz:${key}:`)).map(i => i.hambad).join(','))
      : (state.selectedTeeth[key] ?? [])

  /** The marked implants among a work type's teeth, in the teeth's order. */
  const implantsOf = (key: string): number[] => {
    const marked = new Set(state.implantsByType[key] ?? [])
    return sortTeeth(teethOf(key).filter(tooth => marked.has(tooth)))
  }

  // ── The toolbar beside 2D/3D, and the line under the chart ──────────────────
  const [markMode, setMarkMode] = useState<MarkMode | null>(null)
  const [mirror, toggleMirror] = useOdontogramMirrorToggle()
  const toolbar = (
    <>
      <ToolbarButton
        active={markMode === 'implant'}
        onClick={() => setMarkMode(m => (m === 'implant' ? null : 'implant'))}
        icon={<Bolt className="h-4 w-4" aria-hidden="true" />}
      >
        {t('jobDetail.implants')}
      </ToolbarButton>
      <ToolbarButton active={mirror} onClick={toggleMirror} icon={<FlipHorizontal2 className="h-4 w-4" aria-hidden="true" />}>
        {mirror ? t('jobDetail.patientView') : t('jobDetail.dentistView')}
      </ToolbarButton>
    </>
  )

  /** "4 teeth · 2 implants (14, 11) · 2 pontics (13, 12)" for one work type. */
  function summaryOf(key: string | null): ReactNode {
    if (!key) return null
    const teeth = sortTeeth(teethOf(key))
    if (teeth.length === 0) return null
    const implants = implantsOf(key)
    const r = rulesOf(key)
    const pontics = r?.isBridge && r.implantBased ? teeth.filter(tooth => !implants.includes(tooth)) : []
    const list = (xs: number[]) => xs.join(', ')
    const parts = [teethCountLabel(teeth.length)]
    if (implants.length > 0) {
      parts.push(implants.length === 1
        ? t('wizard.summaryImplant1', { teeth: list(implants) })
        : t('wizard.summaryImplants', { n: implants.length, teeth: list(implants) }))
    }
    if (pontics.length > 0) {
      parts.push(pontics.length === 1
        ? t('wizard.summaryPontic1', { teeth: list(pontics) })
        : t('wizard.summaryPontics', { n: pontics.length, teeth: list(pontics) }))
    }
    return (
      <div className="space-y-1">
        <p className="text-base font-semibold text-ink" aria-live="polite">{parts.join(' · ')}</p>
        <p className="text-sm text-ink-muted">{t('wizard.implantsHelp')}</p>
      </div>
    )
  }

  /** Screw / abutment, asked only for work with an implant marked. */
  function abutmentPickerFor(keys: readonly string[]): ReactNode {
    const withImplants = keys.filter(key => implantsOf(key).length > 0)
    if (withImplants.length === 0) return null
    return (
      <AbutmentPicker
        types={withImplants.map(too => ({
          too,
          hex: colorMap[baseTypeName(too)] ?? WIZARD_FALLBACK_HEX,
          teeth: implantsOf(too),
        }))}
        byType={state.abutmentByType}
        byTooth={state.abutmentByTooth}
        onChangeType={(too, code) => patch({
          abutmentByType: { ...state.abutmentByType, [too]: code },
        })}
        onChangeTooth={(tooth, code) => patch({
          abutmentByTooth: { ...state.abutmentByTooth, [tooth]: code },
        })}
      />
    )
  }

  function clearAll() {
    patch({ selectedTeeth: {}, implantsByType: {}, designByType: {} })
  }

  /**
   * Toggle one tooth on an arch-level type.
   *
   * Seeded from the arch on the first click, because until then the selection
   * is "untouched" and taking a tooth off an untouched jaw has to start from
   * the full jaw — not from an empty list, which would drop 15 teeth to remove
   * one. Refuses anything outside the chosen arch: the arch answer is above it
   * on the same screen and the two must not contradict each other.
   */
  // Which arch type the chart's clicks land on. Only ever matters when a job
  // carries more than one — the usual case has exactly one and needs no tabs.
  const [activeArchType, setActiveArchType] = useState<string | null>(null)
  useEffect(() => {
    if (rules.archTypes.length === 0) { setActiveArchType(null); return }
    if (!activeArchType || !rules.archTypes.includes(activeArchType)) {
      setActiveArchType(rules.archTypes[0])
    }
  }, [rules.archTypes, activeArchType])

  const archTabs: WorkTypeTab[] = rules.archTypes.map(key => ({
    key,
    nimi: baseTypeName(key),
    hex: colorMap[baseTypeName(key)] ?? WIZARD_FALLBACK_HEX,
    count: hambadToTeeth(items.find(i => i.too === key)?.hambad ?? '').length,
    // An arch type is never a bridge — the flag exists for the chip row's
    // connector drawing, which a full jaw has no use for.
    isBridge: false,
  }))

  function toggleArchTooth(key: string, tooth: number) {
    if (!state.selectedArch) return
    const inArch = new Set(archTeeth(state.selectedArch))
    if (!inArch.has(tooth)) return
    const current = state.selectedTeeth[key] ?? archTeeth(state.selectedArch)
    const next = current.includes(tooth)
      ? current.filter(other => other !== tooth)
      : [...current, tooth]
    patch({ selectedTeeth: { ...state.selectedTeeth, [key]: next } })
  }

  function changeArch(arch: ArchSelection) {
    // Just the arch, and deliberately nothing else. There is no auto-fill of
    // selectedTeeth for arch-mode types anywhere any more (it used to live in
    // the wizard's patch(), wrote entries nothing read, and was deleted):
    // wizardWorkItems() derives an arch type's teeth straight from
    // `selectedArch`, and archTeeth() in archRules.ts is the one answer to
    // "which teeth does this arch cover".
    //
    // Any per-tooth narrowing IS dropped, though: a selection made against the
    // upper jaw means nothing once the answer becomes "lower", and carrying it
    // over would silently hand the new arch a hole someone chose for the old
    // one. Changing the arch starts the jaw whole again.
    const cleared = { ...state.selectedTeeth }
    for (const key of rules.archTypes) delete cleared[key]
    patch({ selectedArch: arch, selectedTeeth: cleared })
  }

  // ─── View data ─────────────────────────────────────────────────────────────
  const tabs: WorkTypeTab[] = toothTypeKeys.map(key => {
    const nimi = baseTypeName(key)
    // Count how many of this base type exist for labeling (Sild 1, Sild 2)
    const sameType = toothTypeKeys.filter(k => baseTypeName(k) === nimi)
    const idx = sameType.indexOf(key) + 1
    const label = sameType.length > 1 ? `${nimi} ${idx}` : nimi
    return {
      key,
      nimi: label,
      hex: colorMap[nimi] ?? rulesByName.get(nimi)?.hex ?? WIZARD_FALLBACK_HEX,
      count: (state.selectedTeeth[key] ?? []).length,
      isBridge: rulesByName.get(nimi)?.isBridge ?? false,
      error: errorFor(nimi),
    }
  })

  // One entry PER WORK TYPE, not per work item: an arch type on both jaws is
  // two items and the legend must still name it once, with the teeth added up.
  const legend: ToothLegendEntry[] = useMemo(() => {
    const byName = new Map<string, ToothLegendEntry>()
    for (const item of items) {
      const r = rulesByName.get(item.too)
      const existing = byName.get(item.too)
      const count = hambadToTeeth(item.hambad).length
      if (existing) {
        existing.count += count
        continue
      }
      byName.set(item.too, {
        nimi: item.too,
        hex: colorMap[item.too] ?? r?.hex ?? WIZARD_FALLBACK_HEX,
        count,
        isBridge: item.bridge === true,
        fromArch: r?.toothMode === 'arch',
      })
    }
    return [...byName.values()].filter(l => l.count > 0 || toothTypeKeys.some(k => baseTypeName(k) === l.nimi))
  }, [items, rulesByName, colorMap, toothTypeKeys])

  // ─── 'none' — defensive only ───────────────────────────────────────────────
  if (rules.teethStepMode === 'none') {
    return (
      <p className="flex items-start gap-2 rounded-xl bg-bg-sidebar p-4 text-base text-ink-soft">
        <Info className="mt-0.5 h-5 w-5 shrink-0 text-ink-muted" aria-hidden="true" />
        {t('wizard.theSelectedWorkDoesnTNeed')}
      </p>
    )
  }

  // ─── 'arch' — the arch question alone ──────────────────────────────────────
  if (rules.teethStepMode === 'arch') {
    return (
      <div className="space-y-6">
        <p className="max-w-prose text-base text-ink-soft">
          {rules.archTypes.length === 1
            ? t('wizard.coversTheWholeJawSoYou', { archTypes: rules.archTypes[0] })
            : t('wizard.theSelectedWorkCoversTheWhole')}{' '}
          {t('wizard.chooseWhichJawThisJobIs')}
        </p>

        <ArchSelector value={state.selectedArch} onChange={changeArch} invalid={archInvalid} />

        {/* The jaw, once one is chosen. The arch buttons are all-or-nothing and
            an All-on-4 routinely stops short of the last molar — until this was
            here there was no way to say so at all. */}
        {state.selectedArch && (
          <div className="space-y-2">
            <div>
              <h3 className="text-sm font-semibold text-ink-soft">{t('wizard.teethInThisJaw')}</h3>
              <p className="text-base text-ink-muted">
                {t('wizard.allTeethAreIncludedByDefault')}{' '}
                <strong>{t('wizard.not')}</strong> {t('wizard.coverForExampleTheLastMolar')}
              </p>
            </div>

            {rules.archTypes.length > 1 && (
              <WorkTypeTabs
                tabs={archTabs}
                activeType={activeArchType}
                onSelect={setActiveArchType}
              />
            )}

            <WizardOdontogram
              items={items.filter(i => i.too === (activeArchType ?? rules.archTypes[0]))}
              activeType={activeArchType ?? rules.archTypes[0]}
              colorMap={colorMap}
              onToggleTooth={tooth => toggleArchTooth(activeArchType ?? rules.archTypes[0], tooth)}
              // Where an All-on-4's implants are: marked by hand, never all of
              // the jaw at once (four implants carry twelve teeth).
              onToggleImplant={tooth => {
                const key = activeArchType ?? rules.archTypes[0]
                toggleImplantFor(key, tooth, teethOf(key))
              }}
              implantButtons
              toolbar={toolbar}
              markMode={markMode}
            />
            {summaryOf(activeArchType ?? rules.archTypes[0])}
            {abutmentPickerFor(rules.archTypes)}
          </div>
        )}

        <WizardErrors errors={visibleErrors} />
      </div>
    )
  }

  // ─── 'tooth' — odontogram ──────────────────────────────────────────────────
  // One column, centred. The chart, the pills that explain its colours and the
  // action bar that operates it are one object and are stacked as one; the
  // two-column split put the buttons a chart's width away from the thing they
  // act on.
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-[minmax(180px,1fr)_minmax(480px,3fr)] gap-6 items-start">
        {/* ── Left: tabs + controls ── */}
        <div className="space-y-4">
          {tabs.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-ink-soft">{t('wizard.whichWorkType')}</h3>
              <WorkTypeTabs
                tabs={tabs}
                activeType={activeType}
                onSelect={setActiveType}
                onDuplicate={key => {
                  const nimi = baseTypeName(key)
                  const existing = state.jobTypes.filter(k => baseTypeName(k) === nimi)
                  const nextIdx = existing.length + 1
                  const newKey = makeTypeKey(nimi, nextIdx)
                  patch({ jobTypes: [...state.jobTypes, newKey] })
                  setActiveType(newKey)
                }}
                onRemove={key => {
                  const next = state.jobTypes.filter(k => k !== key)
                  const { [key]: _, ...rest } = state.selectedTeeth
                  patch({ jobTypes: next, selectedTeeth: rest })
                  if (activeType === key) setActiveType(next[0] ?? null)
                }}
              />
              <p className="text-xs text-ink-muted">
                {t('wizard.aToothCanBelongToOnly')}
              </p>
            </div>
          )}

          <ToothControls
            activeType={activeType}
            activeTeeth={activeTeeth}
            blocked={blocked}
            total={pickedCount}
            onSetActiveTeeth={teeth => activeType && setTeethFor(activeType, teeth)}
            onClearAll={clearAll}
          />

          {/* Which abutment each implant sits on. Here rather than on a later
              step because the answer belongs to the teeth that were just
              picked; asked only once at least one implant is marked. */}
          {abutmentPickerFor(toothTypeKeys)}

          {/* Arch selector if needed */}
          {rules.archTypes.length > 0 && (
            <div className="space-y-2 border-t border-ink-faint/30 pt-3">
              <h3 className="text-sm font-semibold text-ink-soft">
                {t('wizard.jaw')} — {rules.archTypes.join(', ')}
              </h3>
              <ArchSelector value={state.selectedArch} onChange={changeArch} invalid={archInvalid} />
            </div>
          )}

          <WizardErrors errors={visibleErrors} />
        </div>

        {/* ── Right: odontogram ── */}
        <div>
          <WizardOdontogram
            items={toothItems}
            activeType={activeType}
            colorMap={colorMap}
            onToggleTooth={toggleTooth}
            // Any picked tooth can sit on an implant (2.2.0).
            onToggleImplant={activeType ? toggleImplant : undefined}
            implantButtons
            toolbar={toolbar}
            markMode={markMode}
            reservedByArch={archOwners}
          />
          {summaryOf(activeType)}
        </div>
      </div>
    </div>
  )
}

/** A button of the chart's toolbar, beside 2D/3D. `data-chrome`: the chart's own, not repainted white. */
function ToolbarButton({ active, onClick, icon, children }: {
  active: boolean
  onClick: () => void
  icon: ReactNode
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-chrome="chart"
      className={[
        'inline-flex items-center gap-1.5 border font-semibold',
        active ? 'border-slate-900 bg-slate-900 text-white' : 'border-ink-faint/30 bg-bg-card text-ink-soft hover:text-ink',
      ].join(' ')}
    >
      {icon}
      {children}
    </button>
  )
}
