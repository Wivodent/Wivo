/**
 * Tells the database whether this clinic's licence has `ratings` (sql/144):
 * the owner's Wivo writes clinic_settings.features.ratings from the licence,
 * and ratings_on() reads it. Only once the licence is read (while loading,
 * every module counts as on) and only the owner (who writes clinic settings).
 */
import { useEffect } from 'react'
import { useLicense } from '../hooks/useLicense'
import { usePermissions } from '../hooks/usePermissions'
import { useSettings } from '../stores/useSettings'

export function RatingsLicenceSync(): null {
  const { moduleOn, loading } = useLicense()
  const { isOwner } = usePermissions()
  const { settings, setFlag } = useSettings()
  const on = moduleOn('ratings')
  useEffect(() => {
    if (loading || !isOwner) return
    if (settings.hinnangud !== on) setFlag('hinnangud', on)
  }, [loading, isOwner, on, settings.hinnangud, setFlag])
  return null
}
