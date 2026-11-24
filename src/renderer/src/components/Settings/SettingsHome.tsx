/**
 * Settings' front page (docs/design setup-and-settings.html): the owner's
 * "Set up your clinic" list, then tiles in groups — Clinic, Jobs, Money,
 * Help, and the person's own settings. A tile shows only when its module is in
 * the licence and the person may open it; a group with no tiles is not shown.
 */
import { useState } from 'react'
import type { ViewMode } from '../../types/view'
import type { GroupKey } from '../SettingsPage'
import { useAuth } from '../../context/AuthContext'
import { usePermissions } from '../../hooks/usePermissions'
import { useSettings } from '../../stores/useSettings'
import { clinicCountry } from '../../lib/country'
import { wivoMailto } from '../../config/contact'
import { SetupChecklist, setupHidden } from './SetupChecklist'
import { t } from '@/lib/i18n'

interface Tile {
  key: string
  title: string
  desc: string
  onClick?: () => void
  href?: string
  primary?: boolean
}

/** A country's name in the reader's language; the code for one not listed. */
export function countryName(code: string): string {
  switch (code) {
    case 'EE': return t('country.EE')
    case 'LV': return t('country.LV')
    case 'LT': return t('country.LT')
    case 'FI': return t('country.FI')
    default: return code
  }
}

function TileGroup({ title, tiles, cols }: { title: string; tiles: Tile[]; cols: string }) {
  if (tiles.length === 0) return null
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-bold text-ink-soft uppercase tracking-wider">{title}</h3>
      <div className={`grid grid-cols-1 sm:grid-cols-2 ${cols} gap-3.5`}>
        {tiles.map(tile => {
          const cls = `text-left rounded-2xl p-5 flex flex-col gap-1.5 min-h-[92px] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent ${
            tile.primary ? 'bg-accent text-white hover:opacity-95' : 'card hover:border-accent/50'
          }`
          const body = (
            <>
              <b className="text-lg">{tile.title}</b>
              <span className={`text-base ${tile.primary ? 'text-white/85' : 'text-ink-muted'}`}>{tile.desc}</span>
            </>
          )
          return tile.href
            ? <a key={tile.key} href={tile.href} className={cls}>{body}</a>
            : <button key={tile.key} type="button" onClick={tile.onClick} className={cls}>{body}</button>
        })}
      </div>
    </div>
  )
}

export function SettingsHome({ allowed, onOpenGroup, onOpenView }: {
  /** Whether a settings group may be opened here (licence, mode, permission). */
  allowed: (k: GroupKey) => boolean
  onOpenGroup: (k: GroupKey) => void
  onOpenView?: (v: ViewMode) => void
}) {
  const auth = useAuth()
  const { moduleOn, sees } = usePermissions()
  const { settings } = useSettings()
  const isOwner = auth.role === 'owner'
  const [hidden, setHidden] = useState(() => setupHidden(auth.clinicId))

  const g = (k: GroupKey, title: string, desc: string): Tile | null =>
    allowed(k) ? { key: k, title, desc, onClick: () => onOpenGroup(k) } : null
  const v = (view: ViewMode, ok: boolean, title: string, desc: string): Tile | null =>
    ok && onOpenView ? { key: view, title, desc, onClick: () => onOpenView(view) } : null
  const list = (xs: (Tile | null)[]): Tile[] => xs.filter((x): x is Tile => x !== null)

  const clinicTiles = list([
    g('kliinik', t('settingsHome.clinicDetails'), t('settingsHome.clinicDetailsDesc')),
    v('workers', isOwner, t('settingsHome.team'), t('settingsHome.teamDesc')),
    g('litsents', t('settingsPage.licence'), t('settingsHome.licenceDesc')),
    g('kalender', t('settingsHome.calendar'), t('settingsHome.calendarDesc')),
    settings.kliinilineRezhiim ? g('avalik', t('settingsPage.patientPriceList'), t('settingsHome.patientPriceListDesc')) : null,
  ])
  const jobTiles = list([
    g('hinnad', t('settingsPage.workTypesAndPrices'), t('settingsHome.pricesDesc')),
    g('etapid', t('settingsHome.stages'), t('settingsHome.stagesDesc')),
    g('masinad', t('settingsPage.machines'), t('settingsHome.machinesDesc')),
    g('valikud', t('settingsPage.materials'), t('settingsHome.materialsDesc')),
  ])
  const moneyTiles = list([
    v('tootasud', moduleOn('payroll') && sees('tootasud'), t('settingsHome.payRules'), t('settingsHome.payRulesDesc')),
    g('maksud', t('settingsHome.taxes'), t('settingsHome.taxesDesc', { country: countryName(clinicCountry(auth.clinic)) })),
    g('epost', t('settingsHome.invoiceEmail'), t('settingsHome.invoiceEmailDesc')),
  ])
  const requestHref = wivoMailto(t('settingsHome.requestSubject'), t('settingsHome.requestBody', {
    clinic: auth.clinic?.name ?? '', name: auth.profile?.full_name ?? '',
  }))
  const contactHref = wivoMailto(t('settingsHome.contactSubject'), t('settingsHome.requestBody', {
    clinic: auth.clinic?.name ?? '', name: auth.profile?.full_name ?? '',
  }))
  const helpTiles: Tile[] = [
    ...(requestHref ? [{ key: 'request', title: t('settingsHome.requestFeature'), desc: t('settingsHome.requestFeatureDesc'), href: requestHref, primary: true }] : []),
    ...(contactHref ? [{ key: 'contact', title: t('settingsHome.contact'), desc: t('settingsHome.contactDesc'), href: contactHref }] : []),
  ]
  const mineTiles = list([
    g('profiil', t('settingsPage.profile'), t('settingsHome.profileDesc')),
    g('turvalisus', t('security.title'), t('settingsHome.securityDesc')),
    g('kasutajaliides', t('settingsHome.interface'), t('settingsHome.interfaceDesc')),
  ])
  const advanced = (['partnerlused', 'auditilogi', 'andmebaas'] as GroupKey[]).some(allowed)
  const both = moneyTiles.length > 0 && helpTiles.length > 0

  return (
    <div className="space-y-7 max-w-6xl">
      {isOwner && !hidden && (
        <SetupChecklist
          onOpenGroup={onOpenGroup}
          onOpenView={view => onOpenView?.(view)}
          onHide={() => setHidden(true)}
        />
      )}

      <div>
        <p className="text-sm text-ink-muted">{t('settingsPage.settings')}</p>
        <h1 className="text-3xl font-bold text-page-ink">{t('settingsHome.title')}</h1>
      </div>

      <TileGroup title={t('settingsHome.groupClinic')} tiles={clinicTiles} cols="lg:grid-cols-3" />
      <TileGroup title={t('settingsHome.groupJobs')} tiles={jobTiles} cols="lg:grid-cols-4" />
      {/* Money and Help side by side only when both are there: one alone
          takes the full width rather than leaving a hole beside it. */}
      <div className={both ? 'grid grid-cols-1 xl:grid-cols-2 gap-6' : 'space-y-7'}>
        <TileGroup title={t('settingsHome.groupMoney')} tiles={moneyTiles} cols={both ? '' : 'lg:grid-cols-3'} />
        <TileGroup title={t('settingsHome.groupHelp')} tiles={helpTiles} cols={both ? '' : 'lg:grid-cols-3'} />
      </div>
      <TileGroup title={t('settingsHome.groupMine')} tiles={mineTiles} cols="lg:grid-cols-3" />

      {advanced && <p className="text-sm text-ink-muted">{t('settingsHome.advancedNote')}</p>}
      {isOwner && hidden && (
        <button type="button" onClick={() => { try { localStorage.removeItem(`wivo.setupHidden.${auth.clinicId ?? 'none'}`) } catch { /* private mode */ } setHidden(false) }}
          className="text-sm text-accent hover:underline">
          {t('settingsHome.showSetup')}
        </button>
      )}
    </div>
  )
}
