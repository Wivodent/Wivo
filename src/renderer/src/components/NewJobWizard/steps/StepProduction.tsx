import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { WizardStepComponent } from '../types'
import { fieldErrors } from '../types'
import type { NewJobState } from '@shared/wizard'
import { baseTypeName, sortTeeth } from '@shared/wizard'
import { useSettings, useWorkTypes } from '@/stores/useSettings'
import { WizardField } from '../ui/WizardField'
import { WizardSelect } from '../ui/WizardSelect'
import { WizardWorkerSelect } from '../production/WizardWorkerSelect'
import { PriorityPicker } from '../production/PriorityPicker'
import { DesignSplit } from '../production/DesignSplit'
import { PartnerShare } from '../production/PartnerShare'
import { WorkflowSection } from '../production/WorkflowSection'
import { WIZARD_INPUT, FOCUS_RING } from '../wizardTheme'
import { OptionGroupButtons } from '../production/OptionGroupButtons'
import { SectionCard } from '../../ui/SectionCard'
import { t } from '@/lib/i18n'

/**
 * Step 4 — who makes it, on what, and by when (docs/design production.html).
 *
 * One card per work item, then the stages, then the dates, each in its own
 * section. The long explanations are behind the "i" of each section; the
 * screen itself only names the fields.
 *
 * The machine is per work item (machineByType). The technician and the
 * designer are the JOB's (one each), so they are asked once, above the cards,
 * not on every card: a per-card choice would promise something the job does
 * not store.
 */

/** "13–16" for a run of neighbouring teeth, "14, 16" otherwise. */
function teethText(teeth: number[]): string {
  const s = sortTeeth(teeth)
  if (s.length === 0) return ''
  const run = s.every((n, i) => i === 0 || n - s[i - 1] === 1)
  return run && s.length > 2 ? `${s[0]}–${s[s.length - 1]}` : s.join(', ')
}

function WorkItemCard({ typeKey, state, patch, first }: {
  typeKey: string
  state: NewJobState
  patch: (p: Partial<NewJobState>) => void
  first: boolean
}) {
  const { settings } = useSettings()
  const { hex } = useWorkTypes()
  const nimi = baseTypeName(typeKey)
  const teeth = state.selectedTeeth[typeKey] ?? []
  const machine = state.machineByType[typeKey] ?? (first ? state.machine : null) ?? null

  const assign = (value: string | null) => {
    // No work type picked yet: the job-level machine, as the single dropdown always was.
    if (!typeKey) { patch({ machine: value }); return }
    const next = { ...state.machineByType }
    if (value) next[typeKey] = value
    else delete next[typeKey]
    // `machine` follows the first item, as MachinePicker always kept it.
    patch({ machineByType: next, machine: next[state.jobTypes[0] ?? ''] ?? null })
  }

  return (
    <div className={`rounded-2xl border-2 p-5 flex flex-col gap-4 bg-bg-card ${machine ? 'border-ink-faint/25' : 'border-accent'}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="w-3.5 h-3.5 rounded-full flex-shrink-0" style={{ background: hex(nimi) }} aria-hidden="true" />
          <h3 className="text-lg font-bold text-ink truncate">{nimi || t('wizard.workItems')}</h3>
        </div>
        {teeth.length > 0 && (
          <span className="text-sm text-ink-muted bg-bg-sidebar px-2.5 py-1 rounded-lg flex-shrink-0 tabular-nums">
            {t('wizard.teethChip', { teeth: teethText(teeth), n: teeth.length })}
          </span>
        )}
      </div>
      <WizardField label={t('wizard.machine')} htmlFor={`wizard-masin-${typeKey}`}>
        <WizardSelect
          id={`wizard-masin-${typeKey}`}
          value={machine}
          onChange={assign}
          placeholder={t('wizard.notSet')}
          options={settings.masinad.map(m => ({ value: m, label: m }))}
        />
      </WizardField>
      {!first && !state.machineByType[typeKey] && state.machineByType[state.jobTypes[0] ?? ''] && (
        <button
          type="button"
          onClick={() => assign(state.machineByType[state.jobTypes[0] ?? ''] ?? null)}
          className={`self-start min-h-[40px] px-3.5 rounded-xl border border-dashed border-ink-faint/50 text-sm text-ink-soft hover:border-accent ${FOCUS_RING}`}
        >
          {t('wizard.sameMachineAsFirst')}
        </button>
      )}
      {/* The type's options (Framework: Metal bar · Titanium mesh · None),
          set up under Settings → Prices. */}
      {typeKey && <OptionGroupButtons typeKey={typeKey} state={state} patch={patch} />}
    </div>
  )
}

export const StepProduction: WizardStepComponent = ({ state, patch, rules, errors, showErrors }) => {
  const [moreOpen, setMoreOpen] = useState(Boolean(state.printId || state.designId))
  const deadlineError = showErrors ? fieldErrors(errors, 'deadline')[0]?.message ?? null : null
  const items = state.jobTypes.length > 0 ? state.jobTypes : ['']

  return (
    <div className="space-y-6">
      <SectionCard
        title={t('wizard.whoMakesWhat')}
        subtitle={t('wizard.whoMakesWhatSub')}
        info={[t('wizard.whoMakesTheJobCanBe'), t('wizard.whoDesignsTheJobCanBe'), t('wizard.eachWorkItemCanRunOn'), t('wizard.aWorkItemWithNoMachine')].join(' ')}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <WizardWorkerSelect
            id="wizard-teostaja"
            label={t('wizard.technician')}
            value={state.technician}
            onChange={technician => patch({ technician })}
          />
          <WizardWorkerSelect
            id="wizard-disainija"
            label={t('wizard.designer2')}
            value={state.designer}
            onChange={designer => patch({ designer })}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {items.map((key, i) => (
            <WorkItemCard key={key || 'none'} typeKey={key} state={state} patch={patch} first={i === 0} />
          ))}
        </div>

        <DesignSplit state={state} patch={patch} toothTypes={rules.toothTypes} />
        <PartnerShare />
      </SectionCard>

      {/* The stages: its own card, rendered only when the clinic has a template. */}
      <WorkflowSection state={state} patch={patch} asCard />

      <SectionCard
        title={t('wizard.datesTitle')}
        info={[t('wizard.theDateTheJobArrivedAt'), t('wizard.whenTheJobHasToBe'), t('wizard.ifAnExactTimeWasAgreed')].join(' ')}
      >
        <div className="grid gap-4 md:grid-cols-3">
          <WizardField label={t('wizard.dateReceived')} htmlFor="wizard-kuupaev">
            <input
              id="wizard-kuupaev"
              type="date"
              value={state.date ?? ''}
              onChange={e => patch({ date: e.target.value || null })}
              className={WIZARD_INPUT}
            />
          </WizardField>
          <WizardField label={t('wizard.dueDate')} htmlFor="wizard-tahtaeg" error={deadlineError}>
            <input
              id="wizard-tahtaeg"
              type="date"
              value={state.deadline ?? ''}
              onChange={e => patch({ deadline: e.target.value || null })}
              className={WIZARD_INPUT}
            />
          </WizardField>
          <WizardField label={t('wizard.time')} htmlFor="wizard-kellaaeg">
            <input
              id="wizard-kellaaeg"
              type="time"
              value={state.time ?? ''}
              onChange={e => patch({ time: e.target.value || null })}
              className={WIZARD_INPUT}
            />
          </WizardField>
        </div>
      </SectionCard>

      <SectionCard title={t('wizard.priority')} info={t('wizard.chooseWhetherThisIsAStandard')}>
        <PriorityPicker rush={state.rush} model={state.model} onChange={patch} />
        {/* The model is a separate print with its own number: asked only once
            Model is chosen. */}
        {state.model && (
          <div className="max-w-sm">
            <WizardField label={t('wizard.modelID')} htmlFor="wizard-mudel-id" help={t('wizard.theModelJobNumberIfIt')}>
              <input
                id="wizard-mudel-id"
                type="text"
                value={state.modelId}
                onChange={e => patch({ modelId: e.target.value })}
                placeholder={t('wizard.eGM3310')}
                className={WIZARD_INPUT}
              />
            </WizardField>
          </div>
        )}
      </SectionCard>

      {/* Rarely needed: folded shut unless one of them is already filled. */}
      <section className="card px-5 py-2">
        <button
          type="button"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen(o => !o)}
          className={`w-full min-h-[52px] flex items-center justify-between text-base font-bold text-ink ${FOCUS_RING}`}
        >
          {t('wizard.printAndDesignNumbers')}
          <span className="flex items-center gap-1 text-sm font-medium text-ink-muted">
            {moreOpen ? t('wizard.hide') : t('wizard.show')}
            {moreOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </span>
        </button>
        {moreOpen && (
          <div className="grid gap-4 md:grid-cols-2 pt-2 pb-4 border-t border-ink-faint/15">
            <WizardField label={t('wizard.printID')} htmlFor="wizard-print-id" help={t('wizard.theSprintRayJobNumberIfIt')}>
              <input
                id="wizard-print-id"
                type="text"
                value={state.printId}
                onChange={e => patch({ printId: e.target.value })}
                placeholder={t('wizard.eGSR10432')}
                className={WIZARD_INPUT}
              />
            </WizardField>
            <WizardField label={t('wizard.designID')} htmlFor="wizard-disain-id" help={t('wizard.aReferenceToTheDesignFile')}>
              <input
                id="wizard-disain-id"
                type="text"
                value={state.designId}
                onChange={e => patch({ designId: e.target.value })}
                placeholder={t('wizard.eGD2291')}
                className={WIZARD_INPUT}
              />
            </WizardField>
          </div>
        )}
      </section>
    </div>
  )
}
