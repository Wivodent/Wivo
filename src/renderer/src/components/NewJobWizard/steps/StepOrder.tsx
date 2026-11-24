import { useId } from 'react'
import { AlertCircle, UserRound, Building2 } from 'lucide-react'
import { SectionCard } from '../../ui/SectionCard'
import type { WizardStepComponent } from '../types'
import { fieldErrors } from '../types'
import { WizardField } from '../ui/WizardField'
import { WizardCustomerSelect } from '../patient/WizardCustomerSelect'
import { WIZARD_INPUT, WIZARD_LABEL, WIZARD_HELP, WIZARD_ERROR } from '../wizardTheme'
import { t } from '@/lib/i18n'
import { PatientPicker } from '@/components/Patients/PatientPicker'

/**
 * Step 5 — "Patsient ja tellimus" (docs/design patient-order.html).
 *
 * Two boxes side by side: Patient (who the work is for) and Ordered by (the
 * client and their own order number), each with an "i" saying who the
 * information is for and where it is shown. The description and the notes are
 * their own section below. What is required has not changed.
 */
export const StepOrder: WizardStepComponent = ({ state, patch, errors, showErrors }) => {
  const customerId = useId()
  const refId = useId()
  const descriptionId = useId()
  const notesId = useId()

  const patientError = showErrors ? fieldErrors(errors, 'patient')[0]?.message ?? null : null
  const customerError = showErrors ? fieldErrors(errors, 'customer')[0]?.message ?? null : null
  const refError = showErrors ? fieldErrors(errors, 'customerReference')[0]?.message ?? null : null

  return (
    <div className="space-y-6">
      <div className="grid gap-5 lg:grid-cols-2 items-start">

      {/* ── Patient ────────────────────────────────────────────────────────── */}
      <SectionCard
        title={t('wizard.patientBox')}
        subtitle={t('wizard.patientBoxSub')}
        icon={UserRound}
        iconTint="bg-violet-100 text-violet-700"
        info={`${t('wizard.typeThePatientSNameIf')} ${t('wizard.patientBoxInfo')}`}
      >

        {/* PatientPicker is reused verbatim — it owns the patient-record linking
            and the "Loo patsient" shortcut, and forking it here would give the
            wizard a second way to create a patient. It ships its own <label>,
            so it is NOT wrapped in a WizardField (two labels on one input reads
            as two fields). Its chrome is sized up to the wizard's 16px / 44px
            floor from the outside instead. */}
        <div
          // The dropdown ROWS are patched too, not just the input: the option
          // labels are 14px and their clinic/doctor line and the seotud badge
          // are 10px, which is a quarter of the size this wizard promises. The
          // descendant selectors out-specify the component's own text-[10px].
          onKeyDown={e => {
            // Escape belongs to the dropdown before it belongs to the wizard.
            // PatientPicker has no Escape handler of its own, so the key used to
            // travel up to the shell's window listener and raise the
            // unsaved-changes dialog on a form the user was mid-way through
            // typing into. Stopping it here is enough — the shell listens on
            // `window`, which is the last node the event reaches. The synthetic
            // mousedown is what the picker itself treats as "clicked away".
            if (e.key !== 'Escape') return
            e.stopPropagation()
            document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
          }}
          className="
            [&_.label]:text-base [&_.label]:font-semibold [&_.label]:text-ink-soft [&_.label]:mb-1.5
            [&_input]:min-h-[44px] [&_input]:text-base [&_input]:rounded-xl [&_input]:px-3.5
            [&_button]:min-h-[44px] [&_button]:text-base
            [&_button_span]:text-base [&_label_span]:text-sm
            [&_button]:outline-none [&_button:focus-visible]:ring-2
            [&_button:focus-visible]:ring-stage-varvi
          "
        >
          <PatientPicker
            name={state.patient?.name ?? ''}
            patientId={state.patient?.patientId ?? null}
            onChange={(name, patientId) =>
              // An emptied field is "no patient", not a patient with a blank
              // name — otherwise validation would see an object and pass.
              patch({ patient: name.trim() || patientId ? { name, patientId } : null })
            }
            required
          />
          {patientError && (
            <p className={WIZARD_ERROR} role="alert">
              <AlertCircle className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
              {patientError}
            </p>
          )}
        </div>
      </SectionCard>

      {/* ── Ordered by ─────────────────────────────────────────────────────── */}
      <SectionCard
        title={t('wizard.orderedByBox')}
        subtitle={t('wizard.orderedByBoxSub')}
        icon={Building2}
        info={`${t('wizard.theClinicOrDentistWhoOrdered')} ${t('wizard.theClientSOwnOrderNumber')}`}
      >
        <WizardField
          label={t('wizard.client')}
          htmlFor={customerId}
          error={customerError}
        >
          <WizardCustomerSelect
            id={customerId}
            value={state.customer}
            onChange={value => patch({ customer: value })}
            invalid={!!customerError}
          />
        </WizardField>

        <WizardField
          label={t('wizard.clientReference')}
          htmlFor={refId}
          error={refError}
        >
          <input
            id={refId}
            type="text"
            value={state.customerReference}
            onChange={e => patch({ customerReference: e.target.value })}
            placeholder={t('wizard.eG2024118')}
            autoComplete="off"
            className={WIZARD_INPUT}
          />
        </WizardField>
      </SectionCard>
      </div>

      {/* Väljastus is deliberately NOT asked here. A job being created is at the
          lab by definition, so the question has exactly one possible answer —
          and a step that can only be answered one way is a step that teaches
          people to click through without reading. It appears on the job page
          once the work reaches the done stage, which is when it starts to mean
          something. */}

      {/* ── Vaba tekst ─────────────────────────────────────────────────────── */}
      <SectionCard
        title={t('wizard.notesForTheJob')}
        subtitle={t('wizard.optional')}
        info={`${t('wizard.writeItAsYouWouldExplain')} ${t('wizard.extraInformationForTheLabIt')}`}
      >
        <div className="grid gap-5 lg:grid-cols-2">
        <div>
          <label htmlFor={descriptionId} className={WIZARD_LABEL}>{t('wizard.description')}</label>
          <textarea
            id={descriptionId}
            value={state.description}
            onChange={e => patch({ description: e.target.value })}
            rows={3}
            placeholder={t('wizard.whatExactlyIsBeingMade')}
            className={WIZARD_INPUT + ' resize-y'}
          />
        </div>

        <div>
          <label htmlFor={notesId} className={WIZARD_LABEL}>{t('wizard.notes')}</label>
          <textarea
            id={notesId}
            value={state.notes}
            onChange={e => patch({ notes: e.target.value })}
            rows={3}
            placeholder={t('wizard.extraInformationForTheLab')}
            className={WIZARD_INPUT + ' resize-y'}
          />
          {/* Honest about where it lands: notes have no column of their own and
              are folded into the job description, so promising privacy here
              would be a lie the user finds out about on the job page. */}
          <p className={WIZARD_HELP}>
            {t('wizard.notesShownOnJob')}
          </p>
        </div>
        </div>
      </SectionCard>
    </div>
  )
}
