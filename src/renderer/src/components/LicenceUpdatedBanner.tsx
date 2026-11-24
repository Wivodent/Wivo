/**
 * "Licence updated", for the owner: a licence arrived with the updates
 * (main/licenceDelivery.ts) and this says what changed. It stays until the
 * owner closes it, on this machine, so an owner who opens Wivo next week
 * still sees it. Nobody else sees it, and only closing it clears it.
 */
import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, X } from 'lucide-react'
import { parseLicenceChange, type LicenceChange } from '@shared/license/published'
import { usePermissions } from '../hooks/usePermissions'
import { licenceChangeLines } from '../lib/licenceChange'
import { t } from '@/lib/i18n'

export function LicenceUpdatedBanner({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { isOwner } = usePermissions()
  const [change, setChange] = useState<LicenceChange | null>(null)

  const load = useCallback(async () => {
    try {
      setChange(parseLicenceChange(await window.wivo?.licenceChange?.()))
    } catch {
      setChange(null)
    }
  }, [])

  useEffect(() => { if (isOwner) void load() }, [isOwner, load])
  useEffect(() => window.wivo?.onLicenceUpdated?.(c => setChange(parseLicenceChange(c))), [])

  if (!isOwner || !change) return null

  const seen = () => {
    setChange(null)
    void window.wivo?.licenceChangeSeen?.()
  }

  return (
    <div className="flex items-start gap-2 px-4 py-2 bg-emerald-500/10 border-b border-emerald-500/30 flex-shrink-0">
      <CheckCircle2 size={14} className="text-emerald-600 flex-shrink-0 mt-0.5" />
      <div className="text-xs text-ink flex-1">
        <strong>{t('licenceUpdated.title')}</strong>{' '}
        {licenceChangeLines(change).join(' · ')}
      </div>
      <button onClick={() => { seen(); onOpenSettings() }} className="text-xs font-medium text-accent hover:underline">
        {t('licenceUpdated.open')}
      </button>
      <button onClick={seen} className="text-ink-faint hover:text-ink" title={t('licenseBanner.dismiss')}>
        <X size={13} />
      </button>
    </div>
  )
}
