/**
 * "Not a bridge? Change type" beside a bridge that has one tooth (2.2.2).
 *
 * A work type's kind is its own setting (Settings → Prices → "Type"), and a
 * type renamed from "Bridge" may still be one. Only the owner can change it,
 * so only the owner sees the link; it keeps the job as a draft and opens that
 * type's card. The steps take fixed props (../types), so the way out comes
 * through this context, which NewJobWizard fills in.
 */
import { createContext, useContext } from 'react'
import type { ValidationError } from '@shared/wizard'
import { useAuth } from '@/context/AuthContext'
import { t } from '@/lib/i18n'

export const WizardLinksContext = createContext<{ openWorkType?: (nimi: string) => void }>({})

export function ChangeTypeLink({ error }: { error: ValidationError }): JSX.Element | null {
  const { openWorkType } = useContext(WizardLinksContext)
  const { role } = useAuth()
  if (!error.changeType || !openWorkType || role !== 'owner') return null
  const nimi = error.changeType
  return (
    <button
      type="button"
      onClick={() => openWorkType(nimi)}
      className="ml-1 font-semibold underline underline-offset-2 hover:opacity-80"
    >
      {t('wizard.notABridgeChangeType')}
    </button>
  )
}
