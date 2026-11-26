import { useEffect, useRef, useState } from 'react'
import { CalendarDays, Globe, Cpu, Pencil, Layers, ChevronUp, ChevronDown, ChevronLeft, Trash2, RotateCcw, Plus, X, ArrowRight, User, Palette, CalendarClock, Euro, Building2, Type, ListChecks, KeyRound, Mail, ShieldCheck, AlertTriangle, Database, Languages, Handshake, ScrollText, Bell
} from 'lucide-react'
import { useSettings, THEMES, TEXT_SIZES } from '../stores/useSettings'
import { NotificationChannels } from './Settings/NotificationChannels'
import { ThemeEditor } from './Settings/ThemeEditor'
import { overheadsMonthly } from '@shared/pricing/priceBook'
import type { OverheadPeriood } from '@shared/pricing/priceBook'
import type { ThemeKey } from '../stores/useSettings'
import { usePipeline } from '../context/PipelineContext'
import { useAuth, fetchClinic, type Clinic } from '../context/AuthContext'
import { clinicCountry, hasEstonianTax, invoicesAvailable, fieldExamples, payrollTaxSystem } from '../lib/country'
import { latviaRulesFor } from '@shared/payroll/countryTax'
import { usePermissions } from '../hooks/usePermissions'
import { useClinicSyncState } from './ClinicSettingsSync'
import { WORK_TYPE_PALETTE, sortedTiers, type WorkType, type PriceMode, type WorkTypeCost } from '../config/workTypes'
import { workTypeImage, slugifyWorkType } from '../lib/workTypeImages'
import { pictureChoice, workType3dImage } from '../lib/workType3d'
import { teethKindOf } from '@shared/wizard/workTypeRules'
import { WorkTypePicturePicker } from './Settings/WorkTypePicturePicker'
import { WorkTypeArt } from './ui/WorkTypeArt'
import { OptionLibrarySection, TypeOptionGroups } from './Settings/WorkOptionsEditor'
import { WorkTypeCatalogue } from './Settings/WorkTypeCatalogue'
import { RepriceJobsSection } from './Settings/RepriceJobsSection'
import { supabase, updateProfile, displayIdentity } from '../lib/supabase'
import type { PipelineStage } from '../config/pipeline'
import { LicenseSection } from './Settings/LicenseSection'
import { UpdateSection } from './Settings/UpdateSection'
import { DatabaseUpdatesSection } from './Settings/DatabaseUpdatesSection'
import { PublicServicesSection } from './Settings/PublicServicesSection'
import { EmailSection } from './Settings/EmailSection'
import { slugify } from '@shared/portal/publicService'
import { MigrationStatus } from './Settings/MigrationStatus'
import { PartnershipsSection } from './Settings/PartnershipsSection'
import { AuditLogSection } from './Settings/AuditLogSection'
import { StageTransitionsSection } from './Settings/StageTransitionsSection'
import { WorkflowTemplatesSection } from './Settings/WorkflowTemplatesSection'
import { SoundSection } from './Settings/SoundSection'
import { SecuritySection } from './Settings/SecuritySection'
import { DeletedJobsSection } from './Settings/DeletedJobsSection'
import { DraftNumberInput, DraftTextInput } from './ui/DraftInput'
import { InfoButton } from './ui/InfoButton'
import { SectionCard } from './ui/SectionCard'
import { SettingsHome, countryName, COUNTRY_CHOICES, OTHER_COUNTRY } from './Settings/SettingsHome'
import type { ViewMode } from '../types/view'
import { wivoMailto } from '../config/contact'
import { t, lang, setLang, intlLocale, LANGUAGES, type Lang } from '../lib/i18n'

// Stage colour choices. Mid-tone on purpose: the pill tints the background to
// ~12% and uses the same hex for text, so very pale colours would be unreadable.
const STAGE_PALETTE = [
  '#6366F1', '#8B5CF6', '#A855F7', '#EC4899', '#F43F5E', '#EF4444',
  '#F97316', '#F59E0B', '#EAB308', '#84CC16', '#22C55E', '#10B981',
  '#14B8A6', '#06B6D4', '#0EA5E9', '#3B82F6', '#64748B', '#0E1116'
]

export type GroupKey = 'home' | 'maksud' | 'profiil' | 'turvalisus' | 'kliinik' | 'kasutajaliides' | 'etapid' | 'masinad' | 'hinnad' | 'kalender' | 'valikud' | 'litsents' | 'avalik' | 'epost' | 'andmebaas' | 'partnerlused' | 'auditilogi'

// Personal preferences vs clinic configuration.
//
// Profiil and Kasutajaliides are per-user, live in localStorage, and change
// nothing anyone else sees — so they must stay reachable by every worker.
// Text size in particular: it exists because the default is too small for some
// people, and gating it behind a clinic-settings permission would mean a worker
// who cannot read the price list also cannot make the app legible.
//
// Everything below the line is clinic configuration: shared, owner-controlled,
// and gated on settings.read (pipeline additionally on pipeline.write).
const PERSONAL_GROUPS: GroupKey[] = ['profiil', 'turvalisus', 'kasutajaliides']

// Only real, working groups are listed. The rest of a typical settings sidebar
// (team, notifications, templates, integrations) has nothing behind it yet.
const NAV_GROUPS: { title: string; items: { key: GroupKey; label: string; icon: typeof User }[] }[] = [
  {
    title: t('settingsPage.myPreferences'),
    items: [
      { key: 'profiil', label: t('settingsPage.profile'), icon: User },
      { key: 'turvalisus', label: t('security.title'), icon: ShieldCheck },
      { key: 'kasutajaliides', label: t('settingsPage.interface'), icon: Palette },
    ]
  },
  {
    title: t('settingsPage.clinic'),
    items: [
      { key: 'kliinik', label: t('settingsPage.clinic'), icon: Building2 },
      // Its own tab, NOT inside Hinnad. One list is what the lab charges the
      // clinic, the other is what the patient pays — the separation is the point.
      { key: 'avalik', label: t('settingsPage.patientPriceList'), icon: Globe },
      // Its own tab because the question it answers is not "how do we look" but
      // "what is this system allowed to do with our mailbox".
      { key: 'epost', label: t('settingsPage.email'), icon: Mail },
      { key: 'partnerlused', label: t('partners.partnerships'), icon: Handshake },
      { key: 'auditilogi', label: t('audit.auditLog'), icon: ScrollText },
      { key: 'litsents', label: t('settingsPage.licence'), icon: KeyRound },
      // Migrations are run by hand, so "did I run that one" is answered by
      // memory. Memory is wrong, and the way it is wrong is a feature that
      // quietly keeps its data on one computer.
      { key: 'andmebaas', label: t('settingsPage.database'), icon: Database },
    ]
  },
  {
    title: t('settingsPage.jobsAndProduction'),
    items: [
      { key: 'etapid', label: t('settingsPage.jobStages'), icon: Layers },
      { key: 'valikud', label: t('settingsPage.options'), icon: ListChecks },
      { key: 'masinad', label: t('settingsPage.machines'), icon: Cpu },
      { key: 'hinnad', label: t('settingsPage.prices'), icon: Pencil },
      { key: 'kalender', label: t('settingsPage.calendar'), icon: CalendarClock },
    ]
  }
]

// Small numeric field used by the calendar + pricing sections
function NumField({ label, hint, value, onChange, min, max, step = 1, suffix }: {
  label: string
  hint?: string
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  step?: number
  suffix?: string
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <div className="relative w-28">
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={e => {
            const n = parseFloat(e.target.value)
            if (!Number.isNaN(n)) onChange(Math.min(max, Math.max(min, n)))
          }}
          className="input py-1.5 pr-10 text-right text-sm"
        />
        {suffix && (
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-ink-faint pointer-events-none">
            {suffix}
          </span>
        )}
      </div>
      {hint && <p className="text-[10px] text-ink-faint mt-1 max-w-[280px] leading-relaxed">{hint}</p>}
    </div>
  )
}

// ─── Editable option list ─────────────────────────────────────────────────────
// One component for machines, materials and work types: the three lists differ
// only in their labels, and three near-identical editors would drift apart.
function OptionListEditor({
  items, placeholder, emptyHint, onAdd, onRemove, onRename, onReset,
}: {
  items: string[]
  placeholder: string
  emptyHint: string
  onAdd: (value: string) => void
  onRemove: (value: string) => void
  onRename: (from: string, to: string) => void
  onReset: () => void
}) {
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')

  const duplicate = items.some(x => x.toLowerCase() === draft.trim().toLowerCase())

  const commitAdd = () => {
    if (!draft.trim() || duplicate) return
    onAdd(draft)
    setDraft('')
  }

  const commitRename = () => {
    if (editing) onRename(editing, editDraft)
    setEditing(null)
  }

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {items.length === 0 && (
          <p className="text-xs text-ink-faint">{emptyHint}</p>
        )}
        {items.map(item =>
          editing === item ? (
            <input
              key={item}
              autoFocus
              value={editDraft}
              onChange={e => setEditDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={e => {
                if (e.key === 'Enter') commitRename()
                if (e.key === 'Escape') setEditing(null)
              }}
              className="input py-1 text-sm w-40"
            />
          ) : (
            <span
              key={item}
              className="group inline-flex items-center gap-1.5 pl-3 pr-1.5 py-1.5 rounded-lg
                bg-bg-sidebar border border-ink-faint/25 text-sm text-ink"
            >
              {/* Click to rename — a typo'd entry is far more common than a
                  wrong one, and delete-and-retype loses the row's position. */}
              <button
                type="button"
                onClick={() => { setEditing(item); setEditDraft(item) }}
                className="hover:text-accent transition-colors"
                title={t('settingsPage.clickToRename')}
              >
                {item}
              </button>
              <button
                type="button"
                onClick={() => onRemove(item)}
                className="text-ink-faint hover:text-red-500 transition-colors p-0.5 rounded"
                title={t('settingsPage.remove')}
              >
                <Trash2 size={11} />
              </button>
            </span>
          )
        )}
      </div>

      <div className="flex items-center gap-2">
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commitAdd() } }}
          placeholder={placeholder}
          className="input py-1.5 text-sm w-52"
        />
        <button
          type="button"
          onClick={commitAdd}
          disabled={!draft.trim() || duplicate}
          className="btn-ghost border border-ink-faint/25 disabled:opacity-40"
        >
          <Plus size={13} /> {t('settingsPage.add')}
        </button>
        <button
          type="button"
          onClick={onReset}
          className="flex items-center gap-1.5 text-xs text-ink-faint hover:text-red-500 transition-colors ml-auto"
        >
          <RotateCcw size={11} /> {t('settingsPage.reset')}
        </button>
      </div>
      {duplicate && draft.trim() && (
        <p className="text-[10px] text-orange-500 mt-1.5">{t('settingsPage.isAlreadyInTheList', { draft: draft.trim() })}</p>
      )}
    </div>
  )
}

function PriceInput({
  value,
  onChange,
}: {
  value: number
  onChange: (v: number) => void
}) {
  return (
    <div className="relative w-24">
      <input
        type="number"
        min="0"
        step="0.5"
        value={value || ''}
        placeholder="15"
        onChange={e => onChange(parseFloat(e.target.value) || 0)}
        className="input py-1.5 pr-7 text-right text-sm w-full"
      />
      <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-ink-faint pointer-events-none">€</span>
    </div>
  )
}

// ─── Pipeline stage row ───────────────────────────────────────────────────────
function StageRow({
  stage, isFirst, isLast, canRemove,
  onRename, onRecolor, onRemove, onMove,
}: {
  stage: PipelineStage
  isFirst: boolean
  isLast: boolean
  canRemove: boolean
  onRename: (key: string, label: string) => void
  onRecolor: (key: string, hex: string) => void
  onRemove: (key: string) => void
  onMove: (key: string, dir: 'up' | 'down') => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(stage.label)
  const [picking, setPicking] = useState(false)

  const commit = () => {
    if (draft.trim() && draft.trim() !== stage.label) onRename(stage.key, draft.trim())
    else setDraft(stage.label)
    setEditing(false)
  }

  return (
    <div className="relative flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-bg-sidebar group">
      {/* Colour swatch doubles as the picker trigger */}
      <button
        type="button"
        onClick={() => setPicking(v => !v)}
        title={t('settingsPage.changeColour')}
        className="w-3.5 h-3.5 rounded-full flex-shrink-0 ring-1 ring-inset ring-black/10 hover:scale-110 transition-transform"
        style={{ backgroundColor: stage.hex }}
      />

      {picking && (
        <>
          {/* Click-away layer — cheaper than a document listener for a popover
              that only exists while open */}
          <span className="fixed inset-0 z-10" onClick={() => setPicking(false)} />
          <div className="absolute left-0 top-7 z-20 card p-2 w-[188px] space-y-2">
            <div className="grid grid-cols-6 gap-1.5">
              {STAGE_PALETTE.map(hex => (
                <button
                  key={hex}
                  type="button"
                  onClick={() => { onRecolor(stage.key, hex); setPicking(false) }}
                  className={`w-6 h-6 rounded-md ring-1 ring-inset ring-black/10 transition-transform hover:scale-110 ${
                    hex.toLowerCase() === stage.hex.toLowerCase() ? 'ring-2 ring-accent' : ''
                  }`}
                  style={{ backgroundColor: hex }}
                  title={hex}
                />
              ))}
            </div>
            <label className="flex items-center gap-2 text-[11px] text-ink-muted">
              <input
                type="color"
                value={stage.hex}
                onChange={e => onRecolor(stage.key, e.target.value)}
                className="w-6 h-6 rounded cursor-pointer bg-transparent border-0 p-0"
              />
              {t('settingsPage.customColour')}
            </label>
          </div>
        </>
      )}

      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') { setDraft(stage.label); setEditing(false) }
          }}
          className="flex-1 text-sm text-ink bg-transparent border-b border-accent outline-none py-0.5"
        />
      ) : (
        <span className="flex-1 text-sm text-ink">{stage.label}</span>
      )}

      <div className="flex items-center gap-0.5 opacity-70 group-hover:opacity-100 transition-opacity">
        <button
          type="button"
          onClick={() => { setDraft(stage.label); setEditing(true) }}
          className="p-1 rounded hover:bg-bg-card text-ink-faint hover:text-ink transition-colors"
          title={t('settingsPage.rename')}
        >
          <Pencil size={11} />
        </button>
        <button
          type="button"
          onClick={() => onMove(stage.key, 'up')}
          disabled={isFirst}
          className="p-1 rounded hover:bg-bg-card text-ink-faint hover:text-ink transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ChevronUp size={11} />
        </button>
        <button
          type="button"
          onClick={() => onMove(stage.key, 'down')}
          disabled={isLast}
          className="p-1 rounded hover:bg-bg-card text-ink-faint hover:text-ink transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ChevronDown size={11} />
        </button>
        <button
          type="button"
          onClick={() => (!isLast && canRemove) && onRemove(stage.key)}
          disabled={isLast || !canRemove}
          className="p-1 rounded hover:bg-bg-card text-ink-faint hover:text-red-500 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          title={isLast ? t('settingsPage.theLastStageCanTBe') : undefined}
        >
          <Trash2 size={11} />
        </button>
      </div>
    </div>
  )
}

// ─── Work-type row ────────────────────────────────────────────────────────────
// Same shape as StageRow on purpose: both are an ordered, recolourable list, and
// a user who has learned one should not have to learn the other. Kept separate
// rather than generalised because the two disagree on what may be deleted — a
// pipeline needs its last stage, a work-type list can legitimately be empty.
function WorkTypeRow({
  type, isFirst, isLast, onRename, onRecolor, onRemove, onMove,
}: {
  type: WorkType
  isFirst: boolean
  isLast: boolean
  onRename: (nimi: string) => void
  onRecolor: (hex: string) => void
  onRemove: () => void
  onMove: (dir: 'up' | 'down') => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(type.nimi)
  const [picking, setPicking] = useState(false)

  const commit = () => {
    if (draft.trim() && draft.trim() !== type.nimi) onRename(draft.trim())
    else setDraft(type.nimi)
    setEditing(false)
  }

  return (
    <div className="relative flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-bg-sidebar group">
      <button
        type="button"
        onClick={() => setPicking(v => !v)}
        title={t('settingsPage.changeColour')}
        className="w-3.5 h-3.5 rounded-full flex-shrink-0 ring-1 ring-inset ring-black/10 hover:scale-110 transition-transform"
        style={{ backgroundColor: type.hex }}
      />

      {picking && (
        <>
          <span className="fixed inset-0 z-10" onClick={() => setPicking(false)} />
          <div className="absolute left-0 top-7 z-20 card p-2 w-[188px] space-y-2">
            <div className="grid grid-cols-6 gap-1.5">
              {WORK_TYPE_PALETTE.map(hex => (
                <button
                  key={hex}
                  type="button"
                  onClick={() => { onRecolor(hex); setPicking(false) }}
                  className={`w-6 h-6 rounded-md ring-1 ring-inset ring-black/10 transition-transform hover:scale-110 ${
                    hex.toLowerCase() === type.hex.toLowerCase() ? 'ring-2 ring-accent' : ''
                  }`}
                  style={{ backgroundColor: hex }}
                  title={hex}
                />
              ))}
            </div>
            <label className="flex items-center gap-2 text-[11px] text-ink-muted">
              <input
                type="color"
                value={type.hex}
                onChange={e => onRecolor(e.target.value)}
                className="w-6 h-6 rounded cursor-pointer bg-transparent border-0 p-0"
              />
              {t('settingsPage.customColour')}
            </label>
          </div>
        </>
      )}

      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') { setDraft(type.nimi); setEditing(false) }
          }}
          className="flex-1 text-sm text-ink bg-transparent border-b border-accent outline-none py-0.5"
        />
      ) : (
        <span className="flex-1 text-sm text-ink flex items-center gap-2">
          {type.nimi}
          {/* Synonyms are what make "Abutmendile kroon" resolve to Implantkroon;
              showing them stops a renamed built-in from looking broken. */}
          {(type.match?.length ?? 0) > 0 && (
            <span className="text-[10px] text-ink-faint truncate">
              {t('settingsPage.also')} {type.match!.join(', ')}
            </span>
          )}
          {/* Read-only here: priced in Hinnad, shown here so the type list is a
              complete picture of a type rather than half of one. */}
          {type.hind != null && (
            <span className="text-[10px] font-semibold text-accent ml-auto flex-shrink-0">
              {type.hind.toFixed(2)} {t('settingsPage.job')}
            </span>
          )}
        </span>
      )}

      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          type="button"
          onClick={() => { setDraft(type.nimi); setEditing(true) }}
          className="p-1 rounded hover:bg-bg-card text-ink-faint hover:text-ink transition-colors"
          title={t('settingsPage.rename')}
        >
          <Pencil size={11} />
        </button>
        <button
          type="button"
          onClick={() => onMove('up')}
          disabled={isFirst}
          className="p-1 rounded hover:bg-bg-card text-ink-faint hover:text-ink transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          title={t('settingsPage.moveUpMatchedEarlier')}
        >
          <ChevronUp size={11} />
        </button>
        <button
          type="button"
          onClick={() => onMove('down')}
          disabled={isLast}
          className="p-1 rounded hover:bg-bg-card text-ink-faint hover:text-ink transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          title={t('settingsPage.moveDown')}
        >
          <ChevronDown size={11} />
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="p-1 rounded hover:bg-bg-card text-ink-faint hover:text-red-500 transition-colors"
          title={t('settingsPage.remove')}
        >
          <Trash2 size={11} />
        </button>
      </div>
    </div>
  )
}

function AddWorkTypeRow({ onAdd }: { onAdd: (nimi: string, hex: string) => void }) {
  const [nimi, setNimi] = useState('')
  const [hex, setHex] = useState(WORK_TYPE_PALETTE[0])

  const commit = () => {
    if (!nimi.trim()) return
    onAdd(nimi.trim(), hex)
    setNimi('')
    // Step through the palette so two types added in a row are not the same
    // colour — which would defeat the point of colouring them at all.
    setHex(h => WORK_TYPE_PALETTE[(WORK_TYPE_PALETTE.indexOf(h) + 1) % WORK_TYPE_PALETTE.length])
  }

  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={hex}
        onChange={e => setHex(e.target.value)}
        className="w-7 h-7 rounded cursor-pointer bg-transparent border-0 p-0 flex-shrink-0"
        title={t('settingsPage.colourForTheNewType')}
      />
      <input
        value={nimi}
        onChange={e => setNimi(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit() } }}
        placeholder={t('settingsPage.eGImplantBridge')}
        className="input py-1.5 text-sm w-52"
      />
      <button
        type="button"
        onClick={commit}
        disabled={!nimi.trim()}
        className="btn-ghost border border-ink-faint/25 disabled:opacity-40"
      >
        <Plus size={13} /> {t('settingsPage.add')}
      </button>
    </div>
  )
}

function AddStageRow({ onAdd }: { onAdd: (label: string) => void }) {
  const [label, setLabel] = useState('')
  const submit = () => {
    if (label.trim()) { onAdd(label.trim()); setLabel('') }
  }
  return (
    <div className="flex items-center gap-2 mt-2">
      <input
        value={label}
        onChange={e => setLabel(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') submit() }}
        placeholder={t('settingsPage.newStage')}
        className="input flex-1 text-sm py-1.5"
      />
      <button
        type="button"
        onClick={submit}
        disabled={!label.trim()}
        className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-semibold bg-accent text-white disabled:opacity-40 hover:opacity-90 transition-opacity"
      >
        <Plus size={13} /> {t('settingsPage.add')}
      </button>
    </div>
  )
}

// ─── Material cost tabs (per machine) ─────────────────────────────────────────

function MaterialCostTabs({ materjalid, masinad, materialPrices, materialCosts, setMaterialPrice, setMaterialCost }: {
  materjalid: string[]
  masinad: string[]
  materialPrices: Record<string, import('../stores/useSettings').MaterialPricing>
  materialCosts: Record<string, import('../stores/useSettings').MaterialPricing>
  setMaterialPrice: (material: string, size: 'small' | 'large', value: number) => void
  setMaterialCost: (material: string, size: 'small' | 'large', value: number) => void
}) {
  const [costTab, setCostTab] = useState<string>('base')
  const tabs = ['base', ...masinad]

  // Cost key: "material" for base, "material|machine" for machine-specific
  const costKey = (material: string) =>
    costTab === 'base' ? material : `${material}|${costTab}`

  return (
    <>
      {/* Sell price header + rows (same for all machines) */}
      <div className="overflow-x-auto">
        <div className="grid grid-cols-[minmax(140px,1fr)_80px_80px] gap-x-2 mb-2 px-1 min-w-[340px]">
          <span className="text-[10px] font-semibold text-ink-muted uppercase tracking-wide">{t('settingsPage.material')}</span>
          <span className="text-[10px] font-semibold text-ink-muted uppercase tracking-wide text-center">{t('settingsPage.priceSmall')}</span>
          <span className="text-[10px] font-semibold text-ink-muted uppercase tracking-wide text-center">{t('settingsPage.priceLarge')}</span>
        </div>
        <div className="space-y-1.5 mb-4">
          {materjalid.length === 0 && (
            <p className="text-xs text-ink-faint">{t('settingsPage.noMaterialsAddThemUnderSettings')}</p>
          )}
          {materjalid.map(material => {
            const p = materialPrices[material] ?? { small: 0, large: 0 }
            return (
              <div key={material} className="grid grid-cols-[minmax(140px,1fr)_80px_80px] gap-x-2 items-center px-1 py-0.5 min-w-[340px]">
                <span className="text-sm text-ink truncate" title={material}>{material}</span>
                <PriceInput value={p.small} onChange={v => setMaterialPrice(material, 'small', v)} />
                <PriceInput value={p.large} onChange={v => setMaterialPrice(material, 'large', v)} />
              </div>
            )
          })}
        </div>
      </div>

      {/* Cost section with machine tabs */}
      <div className="border-t border-ink-faint/15 pt-3">
        <p className="text-[10px] font-semibold text-accent uppercase tracking-wide mb-2">
          {t('settingsPage.costMaterialCost')}
        </p>
        {masinad.length > 0 && (
          <div className="flex items-center gap-1 mb-3">
            {tabs.map(tab => (
              <button
                key={tab}
                type="button"
                onClick={() => setCostTab(tab)}
                className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-colors ${
                  costTab === tab
                    ? 'bg-accent text-white'
                    : 'bg-bg-sidebar text-ink-muted hover:text-ink'
                }`}
              >
                {tab === 'base' ? t('settingsPage.default') : tab}
              </button>
            ))}
          </div>
        )}
        {costTab !== 'base' && (
          <p className="text-[10px] text-ink-faint mb-2">
            {t('settingsPage.costOnMachine')} <strong>{costTab}</strong>.{' '}
            {t('settingsPage.ifEmptyTheDefaultPriceIs')}
          </p>
        )}
        <div className="overflow-x-auto">
          <div className="grid grid-cols-[minmax(140px,1fr)_80px_80px] gap-x-2 mb-2 px-1 min-w-[340px]">
            <span className="text-[10px] font-semibold text-accent uppercase tracking-wide">{t('settingsPage.material')}</span>
            <span className="text-[10px] font-semibold text-accent uppercase tracking-wide text-center">{t('settingsPage.costSmall')}</span>
            <span className="text-[10px] font-semibold text-accent uppercase tracking-wide text-center">{t('settingsPage.costLarge')}</span>
          </div>
          <div className="space-y-1.5">
            {materjalid.map(material => {
              const key = costKey(material)
              return (
                <div key={material} className="px-1 py-0.5 min-w-[340px]">
                  <div className="grid grid-cols-[minmax(140px,1fr)_80px_80px] gap-x-2 items-center">
                    <span className="text-sm text-ink truncate" title={material}>{material}</span>
                    <PriceInput
                      value={materialCosts[key]?.small ?? 0}
                      onChange={v => setMaterialCost(key, 'small', v)}
                    />
                    <PriceInput
                      value={materialCosts[key]?.large ?? 0}
                      onChange={v => setMaterialCost(key, 'large', v)}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </>
  )
}

// ─── Profile settings sub-component ───────────────────────────────────────────

function ProfileSection({ auth }: { auth: ReturnType<typeof useAuth> }) {
  const [name, setName] = useState(auth.profile?.full_name ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const dirty = name.trim() !== (auth.profile?.full_name ?? '')

  async function handleSave() {
    if (!auth.user || !dirty) return
    setSaving(true)
    try {
      await updateProfile(auth.user.id, { full_name: name.trim() })
      await auth.refreshProfile()
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <User size={14} className="text-accent" />
        <h3 className="text-sm font-semibold text-ink">{t('settingsPage.yourProfile')}</h3>
        {saved && <span className="text-[10px] text-emerald-600 font-medium">{t('settingsPage.saved')}</span>}
      </div>
      <label className="label" htmlFor="kasutaja-nimi">{t('settingsPage.nameShownAsNoteAuthor')}</label>
      <input
        id="kasutaja-nimi"
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder={t('settingsPage.eGKevinTreial')}
        className="input py-1.5 text-sm max-w-xs"
      />
      <p className="text-xs text-ink-faint mt-2 leading-relaxed">
        {t('settingsPage.addedAsTheAuthorOfEvery')}
      </p>
      {auth.user?.email && (
        <p className="text-xs text-ink-muted mt-1">
          {/* Never show the synthetic @wivo.invalid address — it is an
              implementation detail and looks like a broken account. */}
          {auth.profile?.username ? t('settingsPage.username') : t('settingsPage.email')}:{' '}
          {displayIdentity(auth.user.email, auth.profile?.username)}
          {' · '}{t('settingsPage.role')}: {auth.profile?.role ?? '—'}
        </p>
      )}
      {dirty && (
        <button
          onClick={handleSave}
          disabled={saving}
          className="btn-primary mt-3 disabled:opacity-50"
        >
          {saving ? t('settingsPage.saving') : t('settingsPage.save')}
        </button>
      )}
      <div className="mt-4"><NotificationChannels /></div>
    </section>
  )
}

// ─── Work type price card ─────────────────────────────────────────────────────
// docs/design prices.html: the picture and name small at the top with the
// "per job / per tooth" switch, then three plain blocks — the price for the
// client, the volume price, our cost. Big price fields; the explanations are
// behind the page's "i". Every field keeps its text locally and saves on blur
// or Enter (DraftInput), so typing never loses the focus.
//
// The picture: the one the owner chose (`pildiValik`: a 3D picture or a line
// icon; click the picture or "Change picture") first; then a file pinned on
// the type (`pilt`), then the type's 3D illustration (lib/workType3dMap.ts) in
// a larger box, then the photo found by its name, then the line icon.
function WorkTypePriceCard({ type, onPatch, focused = false }: {
  type: WorkType
  onPatch: (patch: Partial<WorkType>) => void
  /** Opened from the new job's "Not a bridge? Change type": shown and marked. */
  focused?: boolean
}) {
  const [picking, setPicking] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (focused) cardRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [focused])
  const kind = teethKindOf(type)
  const chosen = pictureChoice(type.pildiValik)
  const pinned = !chosen && type.pilt?.trim() ? workTypeImage(type.nimi, type.pilt) : null
  const art3d = pinned ? null : workType3dImage(type)
  const img = pinned ?? (art3d || chosen ? null : workTypeImage(type.nimi))
  const mode: PriceMode = type.hinnaTyyp ?? 'too'
  const unit = mode === 'hammas' ? t('settingsPage.tooth') : t('settingsPage.job')

  const kulud = type.kulud ?? []
  const patchCost = (i: number, patch: Partial<WorkTypeCost>) =>
    onPatch({ kulud: kulud.map((k, n) => (n === i ? { ...k, ...patch } : k)) })
  const removeCost = (i: number) => onPatch({ kulud: kulud.filter((_, n) => n !== i) })
  const addCost = () => onPatch({ kulud: [...kulud, { nimi: '', summa: 0, tyyp: 'too' }] })

  const addTier = () => {
    // Seeded FROM the cleaned view so the suggestion is sensible, but written
    // onto the raw array so nothing already typed is lost; above the last one
    // so two rows never share a quantity.
    const rows = sortedTiers(type)
    const raw = type.astmed ?? []
    const nextFrom = rows.length > 0 ? rows[rows.length - 1].alates + 1 : 3
    const from = rows.length > 0 ? rows[rows.length - 1].hind : (type.hind ?? 0)
    onPatch({ astmed: [...raw, { alates: nextFrom, hind: from }] })
  }

  const bigField = 'w-full h-[52px] rounded-xl border border-ink-faint/40 bg-bg-card pl-3.5 pr-20 text-xl font-semibold text-ink text-right outline-none focus-visible:ring-2 focus-visible:ring-accent'
  const blockTitle = 'text-base font-bold text-ink'

  return (
    <div ref={cardRef} className={`card p-5 flex flex-col gap-5 ${focused ? 'ring-2 ring-accent' : ''}`}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3.5 min-w-0">
          <button
            type="button"
            onClick={() => setPicking(true)}
            aria-label={t('picturePicker.change')}
            title={t('picturePicker.change')}
            className={`${art3d ? 'w-24 h-24 bg-white border border-ink-faint/20' : 'w-14 h-14'} rounded-2xl flex items-center justify-center overflow-hidden flex-shrink-0 hover:ring-2 hover:ring-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent`}
            style={art3d ? undefined : { backgroundColor: `${type.hex}1f` }}
          >
            {art3d
              ? <img src={art3d} alt="" className="h-full w-full object-contain" />
              : img
              ? <img src={img} alt="" className="h-full w-full object-cover" />
              : <WorkTypeArt type={type} size={36} />}
          </button>
          <div className="min-w-0">
            <h3 className="text-lg font-bold text-ink truncate" title={type.nimi}>{type.nimi}</h3>
            {type.hind == null
              ? <p className="text-sm font-semibold text-amber-600">{t('settingsPage.priceNotSet')}</p>
              : <p className="text-sm font-semibold text-accent tabular-nums">{type.hind.toFixed(2)} {unit}</p>}
            <button type="button" onClick={() => setPicking(true)}
              className="mt-0.5 text-sm font-medium text-accent hover:underline min-h-[32px]">
              {t('picturePicker.change')}
            </button>
          </div>
        </div>
        {picking && (
          <WorkTypePicturePicker type={type} onClose={() => setPicking(false)}
            onChoose={value => onPatch({ pildiValik: value })} />
        )}
        <div role="group" aria-label={t('settingsPage.pricingUnit')} className="flex bg-bg-sidebar rounded-xl p-1">
          {([
            { key: 'too', label: t('settingsPage.perJob') },
            { key: 'hammas', label: t('settingsPage.perTooth') },
          ] as const).map(m => (
            <button
              key={m.key}
              type="button"
              aria-pressed={mode === m.key}
              onClick={() => mode !== m.key && onPatch({ hinnaTyyp: m.key })}
              className={`min-h-[40px] px-3.5 rounded-lg text-sm transition-colors ${
                mode === m.key ? 'bg-accent text-white font-bold' : 'text-ink-soft hover:text-ink'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* What the work is on the teeth: the type's own setting (2.2.2), not
          read from its name. Shown as the form reads it today until chosen. */}
      <div className="flex flex-col gap-2.5 border-t border-ink-faint/15 pt-4">
        <div>
          <h4 className={blockTitle}>{t('settingsPage.teethKind')}</h4>
          <p className="text-sm text-ink-muted">{t('settingsPage.teethKindSub')}</p>
        </div>
        <div role="group" aria-label={t('settingsPage.teethKind')} className="grid grid-cols-2 gap-2">
          {([
            { key: 'single', label: t('settingsPage.kindSingle') },
            { key: 'bridge', label: t('settingsPage.kindBridge') },
            { key: 'arch', label: t('settingsPage.kindArch') },
            { key: 'none', label: t('settingsPage.kindNone') },
          ] as const).map(k => (
            <button
              key={k.key}
              type="button"
              aria-pressed={kind === k.key}
              onClick={() => type.liik !== k.key && onPatch({ liik: k.key })}
              className={`min-h-[44px] px-3 rounded-xl text-sm border transition-colors ${
                kind === k.key ? 'bg-accent text-white font-bold border-accent' : 'border-ink-faint/40 text-ink-soft hover:text-ink hover:border-accent'
              }`}
            >
              {k.label}
            </button>
          ))}
        </div>
      </div>

      {/* Two kinds of number on one card, and the costs below are NOT added to
          these: 400 € billed next to a 300 € abutment is 400 € billed. */}
      <div className="flex flex-col gap-2.5 border-t border-ink-faint/15 pt-4">
        <h4 className={blockTitle}>{t('settingsPage.priceForClient')}</h4>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5 text-sm font-semibold text-ink-soft">
            {t('settingsPage.fullPrice')}
            <span className="relative">
              <DraftNumberInput allowEmpty value={type.hind} placeholder="0.00"
                onCommit={v => onPatch({ hind: v })} className={bigField} />
              <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-sm text-ink-faint pointer-events-none">{unit}</span>
            </span>
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-semibold text-ink-soft">
            {t('settingsPage.discountPrice')}
            <span className="relative">
              <DraftNumberInput allowEmpty value={type.soodushind} placeholder="—"
                onCommit={v => onPatch({ soodushind: v })} className={bigField} />
              <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-sm text-ink-faint pointer-events-none">{unit}</span>
            </span>
          </label>
        </div>
      </div>

      {/* Edited against the RAW array, never the sorted-and-cleaned one: a
          cleared field must not delete its own row mid-typing. */}
      <div className="flex flex-col gap-2.5 border-t border-ink-faint/15 pt-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h4 className={blockTitle}>{t('settingsPage.volumePrice')}</h4>
            <p className="text-sm text-ink-muted">{t('settingsPage.volumePriceSub')}</p>
          </div>
          <button type="button" onClick={addTier}
            className="min-h-[44px] px-3.5 rounded-xl border border-ink-faint/40 bg-bg-card text-sm font-medium text-ink hover:border-accent flex items-center gap-1.5">
            <Plus size={15} /> {t('settingsPage.add2')}
          </button>
        </div>
        {(type.astmed ?? []).map((tier, i) => (
          // Keyed by position, never by a value being typed.
          <div key={i} className="flex items-center gap-2">
            <span className="text-sm text-ink-muted flex-shrink-0">{t('settingsPage.from')}</span>
            <DraftNumberInput
              value={tier.alates}
              onCommit={v => onPatch({
                astmed: (type.astmed ?? []).map((x, j) => j === i ? { ...x, alates: Math.max(1, Math.round(v ?? 1) || 1) } : x),
              })}
              className="input h-11 w-16 text-base text-right"
            />
            <span className="text-sm text-ink-muted flex-shrink-0">{t('settingsPage.teethOrMore')}</span>
            <span className="relative flex-1 min-w-0">
              <DraftNumberInput
                value={tier.hind}
                onCommit={v => onPatch({
                  astmed: (type.astmed ?? []).map((x, j) => j === i ? { ...x, hind: v ?? 0 } : x),
                })}
                className="input h-11 pr-16 text-base text-right w-full"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink-faint pointer-events-none">{unit}</span>
            </span>
            <button type="button" aria-label={t('settingsPage.removeTier')} title={t('settingsPage.removeTier')}
              onClick={() => onPatch({ astmed: (type.astmed ?? []).filter((_, j) => j !== i) })}
              className="w-11 h-11 rounded-xl border border-ink-faint/25 flex items-center justify-center text-ink-faint hover:text-red-500 flex-shrink-0">
              <X size={16} />
            </button>
          </div>
        ))}
      </div>

      {/* Consumables — a cost, not a price. Never reaches an invoice. */}
      <div className="flex flex-col gap-2.5 border-t border-ink-faint/15 pt-4">
        <h4 className={blockTitle}>{t('settingsPage.ourCost')}</h4>
        {kulud.length === 0 && <p className="text-sm text-ink-muted">{t('settingsPage.noCostsYet')}</p>}
        {kulud.map((k, i) => (
          // Keyed by position: a key built from the name remounted the row on
          // every letter typed into it, and the field lost the focus.
          <div key={i} className="grid grid-cols-[minmax(0,1fr)_110px_auto_44px] gap-2 items-center">
            <DraftTextInput
              value={k.nimi}
              onCommit={v => patchCost(i, { nimi: v })}
              placeholder={t('settingsPage.screw')}
              className="input h-11 text-base"
            />
            <span className="relative">
              <DraftNumberInput value={k.summa} onCommit={v => patchCost(i, { summa: v ?? 0 })}
                className="input h-11 pr-7 text-base text-right w-full" />
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-ink-faint pointer-events-none">€</span>
            </span>
            <button type="button"
              onClick={() => patchCost(i, { tyyp: k.tyyp === 'hammas' ? 'too' : 'hammas' })}
              title={t('settingsPage.perJobPerTooth')}
              className="h-11 px-3 rounded-xl bg-bg-sidebar text-sm text-ink-soft hover:text-accent">
              {k.tyyp === 'hammas' ? t('settingsPage.tooth3') : t('settingsPage.job3')}
            </button>
            <button type="button" aria-label={t('settingsPage.removeCost')} title={t('settingsPage.removeCost')}
              onClick={() => removeCost(i)}
              className="w-11 h-11 rounded-xl border border-ink-faint/25 flex items-center justify-center text-ink-faint hover:text-red-500">
              <X size={16} />
            </button>
          </div>
        ))}
        <button type="button" onClick={addCost}
          className="self-start min-h-[44px] px-3.5 rounded-xl border border-dashed border-ink-faint/60 bg-bg-card text-sm text-ink hover:border-accent">
          {t('settingsPage.addCost')}
        </button>
      </div>

      {/* The choices this work comes with (Framework: Metal bar · Titanium
          mesh), from the option library below the cards. */}
      <TypeOptionGroups type={type} onPatch={onPatch} />
    </div>
  )
}

// ─── Clinic sync banner ───────────────────────────────────────────────────────
// These settings are shared by the whole clinic, and until 1.7.15 they were not
// — they were per-machine. The banner says which of the two is true right now,
// because "my prices look wrong" is impossible to diagnose otherwise.
function ClinicSyncBanner({ canEdit }: { canEdit: boolean }) {
  const sync = useClinicSyncState()
  const auth = useAuth()

  // Three different situations used to collapse into one "Kliinik puudub":
  // no clinic at all, a clinic whose details failed to load, and a clinic that
  // is fine. They need different actions, so they get different messages.
  if (!auth.clinicId) {
    return (
      <div className="flex items-start gap-2 text-xs rounded-xl border border-orange-200 bg-orange-50 text-orange-800 px-3 py-2">
        <Building2 size={13} className="flex-shrink-0 mt-0.5" />
        <p className="leading-relaxed">
          <strong>{t('settingsPage.yourAccountHasNoClinic')}</strong>{' '}
          {t('settingsPage.untilItDoesSettingsApplyOnly')}
          {auth.role === 'owner'
            ? t('settingsPage.signOutAndBackInThe')
            : t('settingsPage.askTheOwnerToAddYou')}
        </p>
      </div>
    )
  }

  if (!auth.clinic) {
    return (
      <div className="flex items-start gap-2 text-xs rounded-xl border border-orange-200 bg-orange-50 text-orange-800 px-3 py-2">
        <Building2 size={13} className="flex-shrink-0 mt-0.5" />
        <p className="leading-relaxed">
          {t('settingsPage.theClinicExistsButItsDetails')}
        </p>
      </div>
    )
  }

  const [tone, text] = ((): [string, string] => {
    if (sync.status === 'loading') {
      return ['text-ink-muted bg-bg-sidebar border-ink-faint/20', t('settingsPage.loadingClinicSettings')]
    }
    if (sync.status === 'local') {
      return [
        'text-orange-700 bg-orange-50 border-orange-200',
        `${t('settingsPage.changesStayOnThisComputerOnly', { reason: sync.reason })} ${t('app.contactSupport')}`,
      ]
    }
    if (sync.status === 'synced') {
      const when = sync.at ? new Date(sync.at).toLocaleString(intlLocale) : null
      return [
        'text-emerald-700 bg-emerald-50 border-emerald-200',
        canEdit
          ? t('settingsPage.theseSettingsApplyToTheWhole', { when })
          : t('settingsPage.theseAreTheClinicSShared', { when })
      ]
    }
    return ['text-ink-muted bg-bg-sidebar border-ink-faint/20', t('settingsPage.noClinicSettingsApplyOnlyOn')]
  })()

  return (
    <div className={`flex items-start gap-2 text-xs rounded-xl border px-3 py-2 ${tone}`}>
      <Building2 size={13} className="flex-shrink-0 mt-0.5" />
      <p className="leading-relaxed">{text}</p>
    </div>
  )
}

// ─── Clinic settings sub-component ────────────────────────────────────────────

function ClinicSettingsSection({ clinic, onUpdate, isOwner }: {
  clinic: Clinic; onUpdate: () => Promise<void>; isOwner: boolean
}) {
  const [form, setForm] = useState({
    name: clinic.name ?? '',
    address: clinic.address ?? '',
    city: clinic.city ?? '',
    postal_code: clinic.postal_code ?? '',
    phone: clinic.phone ?? '',
    email: clinic.email ?? '',
    reg_code: clinic.reg_code ?? '',
    vat_number: clinic.vat_number ?? '',
    bank_name: clinic.bank_name ?? '',
    bank_account: clinic.bank_account ?? '',
    public_slug: clinic.public_slug ?? '',
  })
  // The country (clinics.country, sql/070) is a code and never empty, so it is
  // kept apart from the text fields, which save an empty field as null.
  const savedCountry = clinicCountry(clinic)
  const [country, setCountry] = useState(savedCountry)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dirty = country !== savedCountry
    || Object.entries(form).some(([k, v]) => v !== (clinic[k as keyof Clinic] ?? ''))
  // "Other" keeps a code that is already there (one not in the list); chosen
  // anew it stores OTHER_COUNTRY.
  const otherValue = (COUNTRY_CHOICES as readonly string[]).includes(savedCountry) ? OTHER_COUNTRY : savedCountry

  async function handleSave() {
    if (!isOwner || !dirty) return
    setSaving(true)
    setError(null)
    try {
      const updates: Record<string, string | null> = {}
      for (const [k, v] of Object.entries(form)) {
        updates[k] = v.trim() || null
      }
      updates.country = country
      updates.updated_at = new Date().toISOString()
      const { error: err } = await supabase.from('clinics').update(updates).eq('id', clinic.id)
      if (err) throw err
      await onUpdate()
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err: unknown) {
      setError((err as Error)?.message ?? t('settingsPage.savingFailed'))
    } finally {
      setSaving(false)
    }
  }

  const set = (key: string, value: string) => setForm(f => ({ ...f, [key]: value }))
  // Sample text in the clinic's own country: no Tallinn or +372 in Riga.
  const ex = fieldExamples(country)

  // A render helper, called as a function — NOT a component. Declared as
  // `<Field/>` inside this body it was a new component type on every render,
  // so React remounted each input after every letter and the focus was lost.
  const field = ({ label, field, placeholder, colSpan }: {
    label: string; field: string; placeholder: string; colSpan?: boolean
  }) => (
    <div className={colSpan ? 'col-span-2' : ''}>
      <label className="label">{label}</label>
      <input
        value={form[field as keyof typeof form]}
        onChange={e => set(field, e.target.value)}
        placeholder={placeholder}
        className="input py-1.5 text-sm"
        disabled={!isOwner}
      />
    </div>
  )

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2 mb-1">
        <Building2 size={14} className="text-accent" />
        <h3 className="text-sm font-semibold text-ink">{t('settingsPage.clinicDetails')}</h3>
        {saved && <span className="text-[10px] text-emerald-600 font-medium">{t('settingsPage.saved')}</span>}
      </div>
      {!isOwner && (
        <p className="text-xs text-ink-faint">{t('settingsPage.onlyTheClinicOwnerCanChange')}</p>
      )}
      <div className="grid grid-cols-2 gap-3 max-w-lg">
        {field({ label: t('settingsPage.clinicName'), field: 'name', placeholder: t('settingsPage.name'), colSpan: true })}
        <div className="col-span-2">
          <label className="label" htmlFor="clinic-country">{t('settingsPage.country')}</label>
          <select
            id="clinic-country"
            value={country}
            onChange={e => setCountry(e.target.value)}
            className="input py-1.5 text-sm w-56"
            disabled={!isOwner}
          >
            {COUNTRY_CHOICES.map(code => <option key={code} value={code}>{countryName(code)}</option>)}
            <option value={otherValue}>{t('country.other')}</option>
          </select>
          <p className="text-[11px] text-ink-faint mt-1">{t('settingsPage.countryHelp')}</p>
        </div>
        {field({ label: t('settingsPage.address'), field: 'address', placeholder: t('settingsPage.streetNumber'), colSpan: true })}
        {field({ label: t('settingsPage.city'), field: 'city', placeholder: ex.city })}
        {field({ label: t('settingsPage.postcode'), field: 'postal_code', placeholder: ex.postcode })}
        {field({ label: t('settingsPage.phone'), field: 'phone', placeholder: ex.phone })}
        {field({ label: t('settingsPage.email'), field: 'email', placeholder: t('settingsPage.infoClinicCom') })}
        {field({ label: t('settingsPage.registryCode'), field: 'reg_code', placeholder: "12345678" })}
        {field({ label: t('settingsPage.vATNumber'), field: 'vat_number', placeholder: ex.vat })}
        {field({ label: t('settingsPage.bank'), field: 'bank_name', placeholder: ex.bank })}
        {field({ label: 'IBAN', field: 'bank_account', placeholder: ex.iban })}
      </div>

      {/* The public site's URL key. Its own block because it is the one field
          here that is not a company detail — it decides whether the clinic has
          a public booking page at all. */}
      <div className="max-w-lg pt-3 border-t border-ink-faint/15">
        <label className="label flex items-center gap-1.5">
          <Globe size={11} /> {t('settingsPage.websiteID')}
        </label>
        <input
          value={form.public_slug}
          onChange={e => set('public_slug', e.target.value)}
          onBlur={e => set('public_slug', slugify(e.target.value))}
          placeholder="fullgevity"
          className="input py-1.5 text-sm font-mono"
          disabled={!isOwner}
        />
        <p className="text-[11px] text-ink-faint mt-1 leading-relaxed">
          {t('settingsPage.aShortNameTheWebsiteUses')}
        </p>
      </div>
      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
      )}
      {isOwner && dirty && (
        <button
          onClick={handleSave}
          disabled={saving}
          className="btn-primary disabled:opacity-50"
        >
          {saving ? t('settingsPage.saving') : t('settingsPage.save')}
        </button>
      )}
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Each language is named IN ITSELF, never translated: someone who landed in
 * the wrong one is looking for the word they can read.
 */
function LanguageSection() {
  const auth = useAuth()
  const isAdmin = auth.profile?.role === 'owner' || auth.profile?.org_role === 'admin'
  const [orgLang, setOrgLang] = useState<Lang | undefined>(auth.clinic?.default_language)

  // Saved to the PROFILE first, so the choice follows the person to any
  // computer (LanguageSync applies it at sign-in); then this window reloads.
  async function choose(next: Lang) {
    if (auth.user) await supabase.from('profiles').update({ language: next }).eq('id', auth.user.id)
    setLang(next)
  }

  return (
    <section>
      <div className="flex items-center gap-2 mb-1">
        <Languages size={14} className="text-accent" />
        {/* Both words, whichever is active — this heading is the signpost. */}
        <h3 className="text-sm font-semibold text-ink">Keel · Language</h3>
      </div>
      <p className="text-xs text-ink-faint mb-3">
        {t('settingsPage.yourOwnLanguage')}
      </p>
      <div className="flex flex-wrap gap-2">
        {LANGUAGES.map(l => (
          <button
            key={l.key}
            type="button"
            onClick={() => void choose(l.key)}
            aria-pressed={lang === l.key}
            className={`px-3 py-2 rounded-xl border-2 text-sm font-semibold transition-all duration-100 ${
              lang === l.key
                ? 'bg-accent text-white border-accent'
                : 'bg-bg-sidebar text-ink-muted border-ink-faint/30 hover:border-accent/40'
            }`}
          >
            {l.label}
          </button>
        ))}
      </div>
      {isAdmin && auth.clinic && (
        <label className="mt-4 block text-xs text-ink-muted max-w-md">
          {t('settingsPage.organisationDefaultLanguage')}
          <select className="input mt-1 w-48" value={orgLang ?? 'et'}
            onChange={async e => {
              const next = e.target.value as Lang
              setOrgLang(next)
              const { error } = await supabase.from('clinics').update({ default_language: next }).eq('id', auth.clinic!.id)
              if (error) setOrgLang(auth.clinic?.default_language)
            }}>
            {LANGUAGES.map(l => <option key={l.key} value={l.key}>{l.label}</option>)}
          </select>
          <span className="block mt-1">{t('settingsPage.organisationDefaultHelp')}</span>
        </label>
      )}
    </section>
  )
}

/** `initialGroup`: where to open (a security notification opens Security). */
export function SettingsPage({ initialGroup = 'home', initialWorkType, onOpenPatient, onOpenView }: {
  initialGroup?: GroupKey
  /** The Prices card to show and mark (the new job's "Not a bridge? Change type"). */
  initialWorkType?: string
  onOpenPatient?: (patientId: string) => void
  /** For the home page's tiles that open another page (Team, Payroll). */
  onOpenView?: (v: ViewMode) => void
} = {}) {
  const {
    settings, setMaterialPrice, setMaterialCost, setDesignFee, setDefaultMachine, setTeema, setNumber, setFlag, setYldkulud, setKapslimasinad,
    setTekstiSuurus, setFixedCosts, setLisateenused, setPaneeliSuund, addOption, removeOption, renameOption, resetOptions,
    addWorkType, removeWorkType, updateWorkType, moveWorkType, resetWorkTypes,
    addVisitType, removeVisitType, updateVisitType, moveVisitType, resetVisitTypes,
  } = useSettings()
  const { stages, addStage, removeStage, renameStage, recolorStage, moveStage, setStageNotify, resetToDefaults } = usePipeline()
  const auth = useAuth()
  // Estonian tax only in an Estonian clinic (lib/country): elsewhere the employee's
  // side is the accountant's, and the employer's share is called contributions.
  const estonianTax = hasEstonianTax(clinicCountry(auth.clinic))
  const latviaTax = payrollTaxSystem(clinicCountry(auth.clinic)) === 'LV'
  const lvRules = latviaRulesFor(new Date().getFullYear())
  const { can, moduleOn } = usePermissions()

  const [group, setGroup] = useState<GroupKey>(initialGroup)
  // Prices page (docs/design prices.html): search, the add row, the folded rest.
  const [priceSearch, setPriceSearch] = useState('')
  const [addingType, setAddingType] = useState(false)
  // Settings → Prices → Add from catalogue (and the setup list's "Work types & prices").
  const [catalogueOpen, setCatalogueOpen] = useState(false)
  const [morePrices, setMorePrices] = useState(false)
  const [partnerMovesOpen, setPartnerMovesOpen] = useState(false)

  // A group whose licence module (or mode) is off is not listed: a menu item
  // that leads to a page this clinic cannot use is dead UI.
  const groupInLicence = (k: GroupKey): boolean => {
    switch (k) {
      case 'avalik': return settings.kliinilineRezhiim && moduleOn('patients')
      // The e-mail here sends invoices only, and invoices are Estonian documents.
      case 'epost': return moduleOn('invoices') && invoicesAvailable(clinicCountry(auth.clinic))
      case 'partnerlused': return moduleOn('partners')
      case 'etapid': case 'valikud': case 'masinad': return moduleOn('jobs')
      // Payroll taxes: only where payroll is in the licence.
      case 'maksud': return moduleOn('payroll')
      default: return true
    }
  }

  // Töö etapid is the one clinic group that is not merely readable — every
  // control on it writes — so it takes pipeline.write rather than settings.read.
  const groupAllowed = (k: GroupKey): boolean =>
    k === 'home' ? true
      : !groupInLicence(k) ? false
      : PERSONAL_GROUPS.includes(k) ? true
      : k === 'etapid' ? can('pipeline.write')
        : can('settings.read')

  /** The heading of an open group: the menu's name for it. */
  const groupLabel = (k: GroupKey): string =>
    k === 'maksud' ? t('settingsHome.taxes')
      : k === 'hinnad' ? t('settingsPage.workTypesAndPrices')
      : NAV_GROUPS.flatMap(sec => sec.items).find(i => i.key === k)?.label ?? t('settingsPage.settings')

  // A worker without the permission would otherwise be left staring at a group
  // that renders nothing at all.
  const activeGroup: GroupKey = groupAllowed(group) ? group : 'home'

  const isClinicGroup = activeGroup !== 'home' && !PERSONAL_GROUPS.includes(activeGroup)
  const canEditClinic = auth.role === 'owner'

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-6 py-6 space-y-5">
        {/* docs/design setup-and-settings.html: Settings opens on its home page
            of tiles; a group has a way back instead of a side menu. */}
        {activeGroup === 'home' ? (
          <SettingsHome allowed={groupAllowed} onOpenGroup={setGroup} onOpenView={onOpenView}
            onOpenCatalogue={() => { setGroup('hinnad'); setCatalogueOpen(true) }} />
        ) : (
          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={() => setGroup('home')}
              className="min-h-[44px] px-3 -ml-3 rounded-xl text-base font-semibold text-accent hover:bg-accent/10 flex items-center gap-1"
            >
              <ChevronLeft size={18} /> {t('settingsPage.settings')}
            </button>
            <h1 className="text-2xl font-bold text-page-ink">{groupLabel(activeGroup)}</h1>
          </div>
        )}

        <div className="flex items-start gap-5">

          {/* Cards for the active group. Two columns where there is room —
              the settings body is short items, not long forms. */}
          <div className="flex-1 min-w-0 space-y-3">
          {isClinicGroup && <ClinicSyncBanner canEdit={canEditClinic} />}
          {/* Read-only for everyone but the owner. Not merely cosmetic: without
              it a worker's edit would save to their own machine and never reach
              the clinic, which is the exact per-machine drift this page moved to
              the database to end. The RLS policy is the real enforcement. */}
          <div
            className={`grid grid-cols-1 2xl:grid-cols-2 gap-4 items-start [&>section]:card [&>section]:p-4 ${
              isClinicGroup && !canEditClinic ? 'pointer-events-none opacity-60 select-none' : ''
            }`}
          >

        {/* Kalender */}
        {activeGroup === 'kalender' && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <CalendarClock size={14} className="text-accent" />
              <h3 className="text-sm font-semibold text-ink">{t('settingsPage.workingDayAndTimelines')}</h3>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <NumField
                label={t('settingsPage.weekViewStart')} suffix="h" min={0} max={23}
                value={settings.nadalAlgus}
                onChange={v => setNumber('nadalAlgus', v)}
                hint={t('settingsPage.theFirstHourOfTheVertical')}
              />
              <NumField
                label={t('settingsPage.weekViewEnd')} suffix="h" min={1} max={24}
                value={settings.nadalLopp}
                onChange={v => setNumber('nadalLopp', v)}
                hint={t('settingsPage.visitsOutsideTheRangeArePushed')}
              />
              <NumField
                label={t('settingsPage.timelineStart')} suffix="h" min={0} max={23}
                value={settings.ajajoonAlgus}
                onChange={v => setNumber('ajajoonAlgus', v)}
                hint={t('settingsPage.theHorizontalTrackInOverviewAnd')}
              />
              <NumField
                label={t('settingsPage.timelineEnd')} suffix="h" min={1} max={24}
                value={settings.ajajoonLopp}
                onChange={v => setNumber('ajajoonLopp', v)}
              />
              <NumField
                label={t('settingsPage.dragStep')} suffix="min" min={5} max={60} step={5}
                value={settings.ajaSamm}
                onChange={v => setNumber('ajaSamm', v)}
                hint={t('settingsPage.whenYouDragAVisitIn')}
              />
              {settings.kliinilineRezhiim && (
                <NumField
                  label={t('settingsPage.defaultVisitLength')} suffix="min" min={5} max={600} step={5}
                  value={settings.visiidiKestus}
                  onChange={v => setNumber('visiidiKestus', v)}
                />
              )}
            </div>

            {/* The switch that decides which product this is. Placed here
                rather than hidden in an advanced pane: someone who wants the
                patient record back must be able to find it. */}
            <div className="mt-6 pt-5 border-t border-ink-faint/15">
              <h4 className="text-sm font-semibold text-ink mb-1">{t('settingsPage.mode')}</h4>
              <p className="text-xs text-ink-muted leading-relaxed mb-3 max-w-xl">
                {t('settingsPage.whichSideOfTheAppIs')}
                <br />
                <strong>{t('settingsPage.theClinicalSide')}</strong>{' '}
                {t('settingsPage.patientRecordTreatmentChartVisitsIs')}
              </p>
              {/* Three buttons, not two checkboxes: two checkboxes can both be
                  unticked, and an app with neither half is a blank window. */}
              <div className="flex items-center gap-1 bg-bg-sidebar rounded-lg p-0.5 w-fit">
                {([
                  { key: 'lab',    label: 'WivoLab',    lab: true,  clin: false },
                  { key: 'dental', label: 'WivoDental', lab: false, clin: true  },
                  { key: 'x',      label: 'WivoX',      lab: true,  clin: true  },
                ]).map(o => {
                  const active = settings.laboriRezhiim === o.lab
                    && settings.kliinilineRezhiim === o.clin
                  return (
                    <button
                      key={o.key}
                      type="button"
                      onClick={() => {
                        setFlag('laboriRezhiim', o.lab)
                        setFlag('kliinilineRezhiim', o.clin)
                      }}
                      className={`text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${
                        active ? 'chip-active' : 'text-ink-muted hover:text-ink'
                      }`}
                    >
                      {o.label}
                    </button>
                  )
                })}
              </div>
              <p className="text-[11px] text-ink-faint mt-2 max-w-xl leading-relaxed">
                <strong>WivoLab</strong> — {t('settingsPage.labJobsBoardClientsInvoices')}{' '}
                <strong>WivoDental</strong> — {t('settingsPage.clinicPatientsVisitsInvoices')}{' '}
                <strong>WivoX</strong> — {t('settingsPage.bothAClinicWithItsOwn')}
              </p>
            </div>
          </section>
        )}

          {/* Taxes (Settings home > Money > Taxes): the clinic's country picks the
              payroll rules (shared/payroll/countryTax). The owner changes the
              country under Clinic details. */}
          {activeGroup === 'maksud' && (
          <section className="2xl:col-span-2">
            <div className="flex items-center gap-2 mb-1">
              <Euro size={16} className="text-accent" />
              <h3 className="text-lg font-bold text-ink">{t('settingsHome.taxes')}</h3>
              <InfoButton label={t('settingsHome.taxes')} text={t('settingsHome.countryInfo')} />
            </div>
            <p className="text-base text-ink-muted mb-4">
              {t('settingsHome.countryIs', { country: countryName(clinicCountry(auth.clinic)) })}
              {auth.role === 'owner' && (
                <>
                  {' '}
                  <button
                    type="button"
                    onClick={() => setGroup('kliinik')}
                    className="text-accent font-semibold hover:underline"
                  >
                    {t('settingsHome.changeCountry')}
                  </button>
                </>
              )}
            </p>
            <div className="grid grid-cols-2 gap-4 max-w-3xl">
              {/* Latvia's rates are the law's (shared/payroll/countryTax): shown,
                  not typed. Every other country keeps its own employer rate. */}
              {latviaTax ? (
                <div className="col-span-2 rounded-xl bg-bg-sidebar/60 px-3 py-2.5">
                  <p className="text-sm font-semibold text-ink">{t('settingsPage.lvTaxTitle', { year: lvRules.year })}</p>
                  <p className="text-xs text-ink-muted leading-relaxed mt-1">
                    {t('settingsPage.lvTaxRules', {
                      employee: lvRules.employeeSocialPct, employer: lvRules.employerSocialPct,
                      pEmployee: lvRules.pensionerEmployeeSocialPct, pEmployer: lvRules.pensionerEmployerSocialPct,
                      income: lvRules.incomeTaxPct, minimum: lvRules.nonTaxableMinimum,
                      dependent: lvRules.dependentAllowance, minWage: lvRules.minimumWage,
                    })}
                  </p>
                </div>
              ) : (
              <NumField
                label={estonianTax ? t('settingsPage.employerTaxes') : t('settingsPage.employerContributions')} suffix="%" min={0} max={100} step={0.1}
                value={settings.tooandjaMaksudProtsent}
                onChange={v => setNumber('tooandjaMaksudProtsent', v)}
                hint={estonianTax ? t('settingsPage.addedToGrossPayToShow') : t('settingsPage.employerContributionsHint')}
              />
              )}
              {/* The employee side. Needed only when someone's pay is entered
                  NET — then bruto, and with it the clinic's real cost, has to
                  be computed backwards from take-home pay. Left at 0 they do
                  nothing, and Töötasud says so rather than quietly showing a
                  gross equal to the net. Estonian only. */}
              {estonianTax && (<>
              <NumField
                label={t('settingsPage.incomeTax')} suffix="%" min={0} max={100} step={0.1}
                value={settings.tulumaksProtsent}
                onChange={v => setNumber('tulumaksProtsent', v)}
                hint={t('settingsPage.incomeTaxWithheldFromTheEmployee')}
              />
              <NumField
                label={t('settingsPage.taxFreeAllowance')} suffix={t('settingsPage.month')} min={0} max={5000} step={10}
                value={settings.maksuvabaTuluKuus}
                onChange={v => setNumber('maksuvabaTuluKuus', v)}
                hint={t('settingsPage.theClinicDefaultItCanBe')}
              />
              <NumField
                label={t('settingsPage.employeeUnemploymentInsurance')} suffix="%" min={0} max={10} step={0.1}
                value={settings.tootajaTootuskindlustusProtsent}
                onChange={v => setNumber('tootajaTootuskindlustusProtsent', v)}
                hint={t('settingsPage.theShareWithheldFromGrossPay')}
              />
              <NumField
                label={t('settingsPage.fundedPensionIIPillar')} suffix="%" min={0} max={20} step={1}
                value={settings.kogumispensionProtsent}
                onChange={v => setNumber('kogumispensionProtsent', v)}
                hint={t('settingsPage.theDefaultRateItIsEach')}
              />
              </>)}
            </div>
          </section>
          )}

        {activeGroup === 'partnerlused' && <PartnershipsSection />}
        {activeGroup === 'auditilogi' && <AuditLogSection onOpenPatient={onOpenPatient} />}
        {activeGroup === 'auditilogi' && <DeletedJobsSection />}

        {activeGroup === 'litsents' && <LicenseSection />}
        {activeGroup === 'litsents' && <UpdateSection />}
        {activeGroup === 'litsents' && <DatabaseUpdatesSection />}

        {activeGroup === 'andmebaas' && <MigrationStatus />}

        {activeGroup === 'epost' && <EmailSection />}

        {/* Only where a public site exists at all. */}
        {activeGroup === 'avalik' && settings.kliinilineRezhiim && <PublicServicesSection />}
        {activeGroup === 'avalik' && !settings.kliinilineRezhiim && (
          <section>
            <p className="text-sm text-ink-muted max-w-xl leading-relaxed">
              {t('settingsPage.thePatientPriceListIsFor')}
            </p>
          </section>
        )}

        {/* Language. First in the tab because it is the one setting someone
            who cannot read the rest of the page has to be able to find. */}
        {activeGroup === 'kasutajaliides' && <LanguageSection />}

        {activeGroup === 'kasutajaliides' && <SoundSection />}

        {/* Teema */}
        {activeGroup === 'kasutajaliides' && (
          <section>
          <div className="flex items-center gap-2 mb-3">
            <Palette size={14} className="text-accent" />
            <h3 className="text-sm font-semibold text-ink">{t('settingsPage.theme')}</h3>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {THEMES.map(theme => {
              // The custom tile shows the person's OWN colours. A fixed swatch
              // on this one would be the only tile in the row that lies about
              // what picking it does.
              const preview = theme.key === 'oma' && settings.omaTeema
                ? {
                  bg: settings.omaTeema['app-bg'] ?? theme.preview.bg,
                  card: settings.omaTeema['bg-card'] ?? theme.preview.card,
                }
                : theme.preview
              return (
              <button
                key={theme.key}
                type="button"
                onClick={() => setTeema(theme.key)}
                className={`text-left rounded-xl border-2 overflow-hidden transition-all ${
                  settings.teema === theme.key
                    ? 'border-accent shadow-card'
                    : 'border-ink-faint/25 hover:border-accent/40'
                }`}
              >
                {/* Live-ish preview: page background with a card floating on it */}
                <span className="block h-16 relative" style={{ background: preview.bg }}>
                  <span
                    className="absolute left-2 top-2 right-6 bottom-5 rounded-md"
                    style={{ background: preview.card, boxShadow: '0 1px 4px rgba(0,0,0,.18)' }}
                  />
                </span>
                <span className="block px-2.5 py-2">
                  <span className="block text-xs font-semibold text-ink">{theme.label}</span>
                  <span className="block text-[10px] text-ink-muted leading-tight">{theme.hint}</span>
                </span>
              </button>
              )
            })}
          </div>
        </section>
          )}

          {/* The editor for the last of those tiles. Its own section rather
              than a popup inside the tile: picking colours means looking at the
              app while you do it, and a dialog covering the app defeats that. */}
          {activeGroup === 'kasutajaliides' && <ThemeEditor />}

          {/* Text size */}
          {activeGroup === 'kasutajaliides' && (
          <section>
            <div className="flex items-center gap-2 mb-1">
              <Type size={14} className="text-accent" />
              <h3 className="text-sm font-semibold text-ink">{t('settingsPage.textSize')}</h3>
            </div>
            <p className="text-xs text-ink-faint mb-3">
              {t('settingsPage.scalesTheWholeInterfaceEvenlyText')}
            </p>

            <div className="flex flex-wrap gap-2">
              {TEXT_SIZES.map(size => {
                const active = Math.abs(settings.tekstiSuurus - size.value) < 0.001
                return (
                  <button
                    key={size.key}
                    type="button"
                    onClick={() => setTekstiSuurus(size.value)}
                    className={`px-3 py-2 rounded-xl border-2 transition-all duration-100 text-left ${
                      active
                        ? 'bg-accent text-white border-accent'
                        : 'bg-bg-sidebar text-ink-muted border-ink-faint/30 hover:border-accent/40'
                    }`}
                  >
                    {/* The label previews its own scale — 90% vs 110% is hard to
                        judge from a number alone. */}
                    <span
                      className="block font-semibold leading-tight"
                      style={{ fontSize: `${13 * size.value}px` }}
                    >
                      {size.label}
                    </span>
                    <span className={`block text-[10px] ${active ? 'text-white/70' : 'text-ink-faint'}`}>
                      {size.hint}
                    </span>
                  </button>
                )
              })}
            </div>

            <div className="mt-4 flex items-center gap-3">
              <input
                type="range"
                min={0.8}
                max={1.6}
                step={0.05}
                value={settings.tekstiSuurus}
                onChange={e => setTekstiSuurus(parseFloat(e.target.value))}
                className="flex-1 accent-accent"
              />
              <span className="text-xs font-semibold text-ink tabular-nums w-12 text-right">
                {Math.round(settings.tekstiSuurus * 100)}%
              </span>
              <button
                type="button"
                onClick={() => setTekstiSuurus(1)}
                className="flex items-center gap-1.5 text-xs text-ink-faint hover:text-red-500 transition-colors"
              >
                <RotateCcw size={11} /> 100%
              </button>
            </div>
          </section>
          )}

          {activeGroup === 'kasutajaliides' && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Layers size={14} className="text-accent" />
              <h3 className="text-sm font-semibold text-ink">{t('settingsPage.panelDirection')}</h3>
            </div>
            <p className="text-xs text-ink-faint mb-3">
              {t('settingsPage.howTheJobAndVisitDetail')}
            </p>
            <div className="flex gap-2">
              {([
                { key: 'fullscreen' as const, label: t('settingsPage.fullScreen'), desc: t('settingsPage.toothChartInTheMiddleDetails') },
                { key: 'side' as const, label: t('settingsPage.sidePanel'), desc: t('settingsPage.opensFromTheRight') },
                { key: 'bottom' as const, label: t('settingsPage.bottomPanel'), desc: t('settingsPage.opensFromTheBottom') },
              ]).map(opt => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setPaneeliSuund(opt.key)}
                  className={`flex-1 text-left rounded-xl border-2 p-3 transition-all ${
                    settings.paneeliSuund === opt.key
                      ? 'border-accent bg-accent/5'
                      : 'border-ink-faint/25 hover:border-accent/40'
                  }`}
                >
                  <p className={`text-sm font-medium ${settings.paneeliSuund === opt.key ? 'text-accent' : 'text-ink'}`}>
                    {opt.label}
                  </p>
                  <p className="text-[11px] text-ink-muted">{opt.desc}</p>
                </button>
              ))}
            </div>
          </section>
          )}

          {/* Your name — stamped as the author on every patient note */}
          {activeGroup === 'profiil' && <ProfileSection auth={auth} />}

          {/* Authenticators, phones, sign out elsewhere (sql/097). */}
          {activeGroup === 'turvalisus' && <section className="2xl:col-span-2"><SecuritySection /></section>}

          {/* Clinic settings — owner only */}
          {activeGroup === 'kliinik' && (
            auth.clinic ? (
              <ClinicSettingsSection
                clinic={auth.clinic}
                // The clinic itself is read again: refreshProfile reloads it only
                // when the person moves to another clinic, so a new country (and
                // with it the payroll rules) would otherwise wait for a restart.
                onUpdate={async () => {
                  await auth.refreshProfile()
                  const fresh = await fetchClinic(auth.clinic!.id)
                  if (fresh) auth.setClinic(fresh)
                }}
                isOwner={auth.role === 'owner'}
              />
            ) : (
              // Previously this rendered NOTHING when the clinic was missing,
              // which is how a broken clinic looked identical to an empty page.
              <section>
                <div className="flex items-center gap-2 mb-2">
                  <Building2 size={14} className="text-accent" />
                  <h3 className="text-sm font-semibold text-ink">{t('settingsPage.clinic')}</h3>
                </div>
                <p className="text-xs text-ink-muted leading-relaxed">
                  {t('settingsPage.theClinicSDetailsHaveNot')}
                </p>
              </section>
            )
          )}

          {/* Clinic details › Advanced: the rarely needed groups that used to sit
              in the side menu (audit log, database, partnerships). */}
          {activeGroup === 'kliinik' && (['partnerlused', 'auditilogi', 'andmebaas'] as GroupKey[]).some(groupAllowed) && (
            <section>
              <h3 className="text-lg font-bold text-ink">{t('settingsHome.advanced')}</h3>
              <p className="text-sm text-ink-muted mb-3">{t('settingsHome.advancedSub')}</p>
              <div className="flex flex-wrap gap-2">
                {(['partnerlused', 'auditilogi', 'andmebaas'] as GroupKey[]).filter(groupAllowed).map(k => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setGroup(k)}
                    className="min-h-[44px] px-4 rounded-xl border border-ink-faint/30 bg-bg-card text-base text-ink hover:border-accent"
                  >
                    {groupLabel(k)}
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Machine default */}
          {activeGroup === 'masinad' && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Cpu size={14} className="text-accent" />
              <h3 className="text-sm font-semibold text-ink">{t('settingsPage.defaultMachine')}</h3>
            </div>
            <div className="flex gap-2 items-center flex-wrap">
              {settings.masinad.length === 0 && (
                <p className="text-xs text-ink-faint">{t('settingsPage.noMachinesAdded')}</p>
              )}
              {settings.masinad.map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setDefaultMachine(settings.defaultMachine === m ? '' : m)}
                  className={`px-4 py-2 rounded-xl text-sm font-semibold border-2 transition-all duration-100 ${
                    settings.defaultMachine === m
                      ? 'bg-accent text-white border-accent'
                      : 'bg-bg-sidebar text-ink-muted border-ink-faint/30 hover:border-accent/40'
                  }`}
                >
                  {m}
                </button>
              ))}
              {settings.defaultMachine && (
                <button
                  type="button"
                  onClick={() => setDefaultMachine('')}
                  className="text-xs text-ink-faint hover:text-red-500 transition-colors px-2"
                >
                  {t('settingsPage.clear')}
                </button>
              )}
            </div>
          </section>
          )}

          {/* Machine list */}
          {activeGroup === 'masinad' && (
          <section>
            <div className="flex items-center gap-2 mb-1">
              <Cpu size={14} className="text-accent" />
              <h3 className="text-sm font-semibold text-ink">{t('settingsPage.machines')}</h3>
            </div>
            <p className="text-xs text-ink-faint mb-3">
              {t('settingsPage.theseButtonsSitUnderTheMachine')}
            </p>
            <OptionListEditor
              items={settings.masinad}
              placeholder={t('settingsPage.eGPro95S')}
              emptyHint={t('settingsPage.noMachinesTheJobFormShows')}
              onAdd={v => addOption('masinad', v)}
              onRemove={v => removeOption('masinad', v)}
              onRename={(a, b) => renameOption('masinad', a, b)}
              onReset={() => resetOptions('masinad')}
            />
          </section>
          )}

          {/* Which printers work from capsules. A property of the MACHINE, not
              of the material: the same resin is a cartridge on one and a bottle
              on the next, and keying it off the material made the job form
              demand a capsule count on a Pro2 and refuse to save. */}
          {activeGroup === 'masinad' && settings.masinad.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-1">
              <Cpu size={14} className="text-accent" />
              <h3 className="text-sm font-semibold text-ink">{t('settingsPage.capsuleMachines')}</h3>
            </div>
            <p className="text-xs text-ink-faint mb-3 max-w-xl leading-relaxed">
              {t('settingsPage.markTheMachinesThatPrintFrom')}
            </p>
            <div className="flex gap-2 items-center flex-wrap">
              {settings.masinad.map(m => {
                const on = settings.kapslimasinad.includes(m)
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setKapslimasinad(
                      on ? settings.kapslimasinad.filter(x => x !== m) : [...settings.kapslimasinad, m]
                    )}
                    className={`px-4 py-2 rounded-xl text-sm font-semibold border-2 transition-all duration-100 ${
                      on
                        ? 'bg-accent text-white border-accent'
                        : 'bg-bg-sidebar text-ink-muted border-ink-faint/30 hover:border-accent/40'
                    }`}
                  >
                    {m}
                  </button>
                )
              })}
            </div>
            {settings.kapslimasinad.length === 0 && (
              <p className="text-[11px] text-ink-faint mt-2">
                {t('settingsPage.noneMarkedTheCapsuleCountIs')}
              </p>
            )}
          </section>
          )}

          {/* Materials */}
          {activeGroup === 'valikud' && (
          <section>
            <div className="flex items-center gap-2 mb-1">
              <ListChecks size={14} className="text-accent" />
              <h3 className="text-sm font-semibold text-ink">{t('settingsPage.materials')}</h3>
            </div>
            <p className="text-xs text-ink-faint mb-3">
              {t('settingsPage.buttonsOnTheJobAndRevision')}
            </p>
            <OptionListEditor
              items={settings.materjalid}
              placeholder={t('settingsPage.eGZirconiaA2')}
              emptyHint={t('settingsPage.noMaterialsYouCanStillType')}
              onAdd={v => addOption('materjalid', v)}
              onRemove={v => removeOption('materjalid', v)}
              onRename={(a, b) => renameOption('materjalid', a, b)}
              onReset={() => resetOptions('materjalid')}
            />
          </section>
          )}

          {/* Work types */}
          {activeGroup === 'valikud' && (
          <section>
            <div className="flex items-center gap-2 mb-1">
              <Layers size={14} className="text-accent" />
              <h3 className="text-sm font-semibold text-ink">{t('settingsPage.workTypes')}</h3>
            </div>
            <p className="text-xs text-ink-faint mb-1">
              {t('settingsPage.suggestionsUnderTheJobFieldOn')}
            </p>
            <p className="text-xs text-ink-faint mb-3">
              <strong className="text-ink-muted">{t('settingsPage.colour')}</strong>{' '}
              {t('settingsPage.isTheOneTheCalendarUses')}
            </p>

            <div className="space-y-0.5 mb-3">
              {settings.tooTuubid.length === 0 && (
                <p className="text-xs text-ink-faint">
                  {t('settingsPage.noWorkTypesAllJobsAre')}
                </p>
              )}
              {settings.tooTuubid.map((workType, idx) => (
                <WorkTypeRow
                  key={workType.nimi}
                  type={workType}
                  isFirst={idx === 0}
                  isLast={idx === settings.tooTuubid.length - 1}
                  onRename={nimi => updateWorkType(workType.nimi, { nimi })}
                  onRecolor={hex => updateWorkType(workType.nimi, { hex })}
                  onRemove={() => removeWorkType(workType.nimi)}
                  onMove={dir => moveWorkType(workType.nimi, dir)}
                />
              ))}
            </div>

            <AddWorkTypeRow onAdd={addWorkType} />

            {/* Visit types — only in a mode that books patients. */}
            {settings.kliinilineRezhiim && (
              <div className="mt-8 pt-5 border-t border-ink-faint/15">
                <div className="flex items-center gap-2 mb-1">
                  <CalendarDays size={14} className="text-accent" />
                  <h3 className="text-sm font-semibold text-ink">{t('settingsPage.visitTypes')}</h3>
                </div>
                <p className="text-xs text-ink-faint mb-1">
                  {t('settingsPage.whyThePatientIsComingCheck')}
                </p>
                <p className="text-xs text-ink-faint mb-3">
                  <strong className="text-ink-muted">{t('settingsPage.colour')}</strong>{' '}
                  {t('settingsPage.fillsTheVisitCardInThe')}{' '}
                  <em>{t('settingsPage.status')}</em>{' '}
                  {t('settingsPage.plannedArrivedCancelledColoursTheCard')}
                </p>

                <div className="space-y-0.5 mb-3">
                  {settings.visiidiTyybid.length === 0 && (
                    <p className="text-xs text-ink-faint">
                      {t('settingsPage.noVisitTypesAllVisitsAre')}
                    </p>
                  )}
                  {settings.visiidiTyybid.map((visitType, idx) => (
                    <WorkTypeRow
                      key={visitType.nimi}
                      type={visitType}
                      isFirst={idx === 0}
                      isLast={idx === settings.visiidiTyybid.length - 1}
                      onRename={nimi => updateVisitType(visitType.nimi, { nimi })}
                      onRecolor={hex => updateVisitType(visitType.nimi, { hex })}
                      onRemove={() => removeVisitType(visitType.nimi)}
                      onMove={dir => moveVisitType(visitType.nimi, dir)}
                    />
                  ))}
                </div>

                <AddWorkTypeRow onAdd={addVisitType} />

                <button
                  type="button"
                  onClick={resetVisitTypes}
                  className="mt-3 text-xs text-ink-muted hover:text-ink underline"
                >
                  {t('settingsPage.restoreDefaultTypes')}
                </button>
                <p className="text-[11px] text-ink-faint mt-2 max-w-xl leading-relaxed">
                  {t('settingsPage.renamingATypeDoesnTChange')}
                </p>
              </div>
            )}

            <button
              type="button"
              onClick={resetWorkTypes}
              className="mt-3 flex items-center gap-1.5 text-xs text-ink-faint hover:text-red-500 transition-colors"
            >
              <RotateCcw size={11} /> {t('settingsPage.resetToDefaults')}
            </button>
          </section>
          )}





          {/* Hinnad is laid out by hand rather than flowing through the generic
              grid: the price list is the work, and the rest is reference. Two
              columns keep the reprice tool and the type cards together on the
              left instead of scattering five cards across the width. */}
          {activeGroup === 'hinnad' && (
            <div className="col-span-full space-y-6">
              {/* docs/design prices.html: the work types and their prices first,
                  big and two to a row; everything else folded under "More". */}
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="text-base text-ink-muted">{t('settingsPage.workTypesAndPricesSub')}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <InfoButton
                    align="right"
                    label={t('settingsPage.workTypesAndPrices')}
                    text={[
                      `${t('settingsPage.eachWorkTypeIsPricedEither')} ${t('settingsPage.perJob2')} ${t('settingsPage.or')} ${t('settingsPage.perTooth2')} ${t('settingsPage.bridgesAndDesignArePerTooth')}`,
                      `${t('settingsPage.fromThisNumberOfTeethOn', { mode: '' })} ${t('settingsPage.toTheWholeJob')}${t('settingsPage.notJustTheTeethAboveIt')}`,
                      `${t('settingsPage.suppliesThisJobAlwaysNeeds')} ${t('settingsPage.notAddedToTheClientPrice')} ${t('settingsPage.takenOffTheMargin')}`,
                    ].join(' ')}
                  />
                  <input
                    type="search"
                    value={priceSearch}
                    onChange={e => setPriceSearch(e.target.value)}
                    placeholder={t('settingsPage.findWorkType')}
                    aria-label={t('settingsPage.findWorkType')}
                    className="input h-12 w-60 text-base"
                  />
                  {canEditClinic && (
                    <button
                      type="button"
                      onClick={() => setCatalogueOpen(true)}
                      className="min-h-[48px] px-5 rounded-xl border-2 border-accent text-accent text-base font-bold flex items-center gap-1.5 hover:bg-accent/10"
                    >
                      <Plus size={18} /> {t('catalogue.open')}
                    </button>
                  )}
                  {canEditClinic && (
                    <button
                      type="button"
                      onClick={() => setAddingType(v => !v)}
                      aria-expanded={addingType}
                      className="min-h-[48px] px-5 rounded-xl bg-accent text-white text-base font-bold flex items-center gap-1.5 hover:opacity-90"
                    >
                      <Plus size={18} /> {t('settingsPage.newWorkType')}
                    </button>
                  )}
                  {canEditClinic && catalogueOpen && <WorkTypeCatalogue onClose={() => setCatalogueOpen(false)} />}
                </div>
              </div>

              {addingType && (
                <div className="card p-4">
                  <AddWorkTypeRow onAdd={(nimi, hex) => { addWorkType(nimi, hex); setAddingType(false); setPriceSearch('') }} />
                </div>
              )}

              {settings.tooTuubid.length === 0 ? (
                <div className="card p-8 flex flex-col items-center gap-3 text-center">
                  <WorkTypeArt kind="crown" size={96} iconSize={56} />
                  <p className="text-sm text-ink-muted">{t('settingsPage.noWorkTypesAddThemUnder')}</p>
                </div>
              ) : (() => {
                const q = priceSearch.trim().toLowerCase()
                const shown = q ? settings.tooTuubid.filter(w => w.nimi.toLowerCase().includes(q)) : settings.tooTuubid
                return shown.length === 0
                  ? (
                    <div className="card p-8 flex flex-col items-center gap-3 text-center">
                      <WorkTypeArt kind="crown" size={96} iconSize={56} />
                      <p className="text-sm text-ink-muted">{t('settingsPage.noWorkTypeFound')}</p>
                    </div>
                  )
                  : (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
                      {shown.map(workType => (
                        <WorkTypePriceCard
                          key={workType.nimi}
                          type={workType}
                          focused={workType.nimi === initialWorkType}
                          onPatch={patch => updateWorkType(workType.nimi, patch)}
                        />
                      ))}
                    </div>
                  )
              })()}

              {/* Work type options, each defined once (shared/pricing/workOptions). */}
              <OptionLibrarySection />

              <div className="card px-5 py-4 flex flex-wrap items-center justify-between gap-3">
                <span className="text-base text-ink-soft">{t('settingsPage.pricesSaveOnLeave')}</span>
                {wivoMailto(t('settingsPage.askWivoPictureSubject')) && (
                  <a
                    href={wivoMailto(t('settingsPage.askWivoPictureSubject'), auth.clinic?.name ?? '') ?? undefined}
                    className="text-base font-semibold text-accent hover:underline flex items-center gap-1"
                  >
                    {t('settingsPage.askWivoPicture')} <ArrowRight size={16} />
                  </a>
                )}
              </div>

              <section className="card px-5 py-1">
                <button
                  type="button"
                  aria-expanded={morePrices}
                  onClick={() => setMorePrices(o => !o)}
                  className="w-full min-h-[60px] flex items-center justify-between gap-3 text-left"
                >
                  <span>
                    <span className="block text-base font-bold text-ink">{t('settingsPage.morePriceSettings')}</span>
                    <span className="block text-sm text-ink-muted">{t('settingsPage.morePriceSettingsSub')}</span>
                  </span>
                  {morePrices ? <ChevronUp size={18} className="text-ink-muted" /> : <ChevronDown size={18} className="text-ink-muted" />}
                </button>
              </section>

              {morePrices && (
              <div className="space-y-8">
              {/* Two groups, because this tab holds two kinds of number: what the
                  client pays, and what the work costs us. */}
              <div>
                <h2 className="text-base font-semibold text-ink mb-1">{t('settingsPage.clientPrices')}</h2>
                <p className="text-xs text-ink-faint mb-3 max-w-2xl leading-relaxed">
                  {t('settingsPage.whatTheClientPaysTheWork')}
                </p>
            <div className="grid grid-cols-1 gap-4 items-start [&_section]:card [&_section]:p-4">
              <div className="space-y-4 min-w-0">
          {/* Bulk reprice — owner only: it rewrites financial fields on rows that
              already exist, and only the owner can change the price list it
              reads from in the first place. */}
          {canEditClinic && <RepriceJobsSection />}
              </div>
              <div className="space-y-4 min-w-0">
          {/* Design fee */}
                    <section>
            <div className="flex items-center gap-2 mb-3">
              <Euro size={14} className="text-accent" />
              <h3 className="text-sm font-semibold text-ink">{t('settingsPage.automaticPricing')}</h3>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <NumField
                label={t('settingsPage.defaultPricePerTooth')} suffix="€" min={0} max={500} step={0.5}
                value={settings.hambaHind}
                onChange={v => setNumber('hambaHind', v)}
                hint={t('settingsPage.usedWhenTheMaterialHasNo')}
              />
              <NumField
                label={t('settingsPage.revisionPricePerTooth')} suffix="€" min={0} max={500} step={0.5}
                value={settings.muudatusHambaHind}
                onChange={v => setNumber('muudatusHambaHind', v)}
                hint={t('settingsPage.aNewRevisionIsPricedFrom')}
              />
              <NumField
                label={t('settingsPage.rushMultiplier')} suffix="×" min={1} max={5} step={0.1}
                value={settings.kiirtooKordaja}
                onChange={v => setNumber('kiirtooKordaja', v)}
                hint={t('settingsPage.forARushJobTheCalculated')}
              />
              <NumField
                label={t('settingsPage.modelPrice')} suffix="€" min={0} max={500} step={5}
                value={settings.mudeliHind}
                onChange={v => setNumber('mudeliHind', v)}
                hint={t('settingsPage.addedToThePriceWhenModel')}
              />
              <NumField
                label={t('settingsPage.vATRate')} suffix="%" min={0} max={30} step={0.5}
                value={settings.kmMaar}
                onChange={v => setNumber('kmMaar', v)}
                hint={t('settingsPage.theDefaultRateForANew')}
              />
              <NumField
                label={t('settingsPage.paymentTerms')} suffix={t('settingsPage.d')} min={0} max={180}
                value={settings.makseTahtaegPaevades}
                onChange={v => setNumber('makseTahtaegPaevades', v)}
                hint={t('settingsPage.daysFromTheInvoiceDateTo')}
              />
            </div>
          </section>
                  <section>
            <div className="flex items-center gap-2 mb-3">
              <Pencil size={14} className="text-accent" />
              <h3 className="text-sm font-semibold text-ink">{t('settingsPage.designPriceJob')}</h3>
            </div>
            <div className="flex items-center gap-3">
              <PriceInput
                value={settings.designFee}
                onChange={setDesignFee}
              />
              <p className="text-xs text-ink-faint leading-relaxed">
                {t('settingsPage.addToAJobWhenThe')}
              </p>
            </div>
          </section>
          {/* Per-material pricing table */}
                    <section>
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-sm font-semibold text-ink">{t('settingsPage.priceByMaterial')}</h3>
            </div>
            <p className="text-xs text-ink-faint mb-4">
              {t('settingsPage.smallToothPositions15Incisors')}<br />
              {t('settingsPage.largeToothPositions68Molars')}<br />
              <strong className="text-ink-muted">{t('settingsPage.cost')}</strong>{' '}
              {t('settingsPage.isWhatTheMaterialCostsYou')}
            </p>

            {/* Machine tab for cost pricing */}
            <MaterialCostTabs
              materjalid={settings.materjalid}
              masinad={settings.masinad}
              materialPrices={settings.materialPrices}
              materialCosts={settings.materialCosts}
              setMaterialPrice={setMaterialPrice}
              setMaterialCost={setMaterialCost}
            />



          {/* Extra services price list */}
          <section>
            <div className="flex items-center gap-2 mb-1">
              <Euro size={14} className="text-accent" />
              <h3 className="text-sm font-semibold text-ink">{t('settingsPage.extraServicesPriceListOptions')}</h3>
            </div>
            <p className="text-xs text-ink-faint mb-3">
              {t('settingsPage.servicesThatCanBeAddedTo')}
            </p>
            <div className="space-y-1.5 mb-2">
              {settings.lisateenused.map((svc, idx) => (
                <div key={svc.id} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={svc.nimi}
                    onChange={e => {
                      const next = settings.lisateenused.map((s, i) => i === idx ? { ...s, nimi: e.target.value } : s)
                      setLisateenused(next)
                    }}
                    placeholder={t('settingsPage.serviceName')}
                    className="input py-1.5 text-sm flex-1"
                  />
                  <div className="relative w-24">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={svc.hind}
                      onChange={e => {
                        const next = settings.lisateenused.map((s, i) => i === idx ? { ...s, hind: parseFloat(e.target.value) || 0 } : s)
                        setLisateenused(next)
                      }}
                      className="input py-1.5 text-sm pr-7 text-right"
                    />
                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-ink-faint">€</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setLisateenused(settings.lisateenused.filter((_, i) => i !== idx))}
                    className="p-1 text-ink-faint hover:text-red-500 transition-colors"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setLisateenused([...settings.lisateenused, { id: crypto.randomUUID(), nimi: '', hind: 0 }])}
              className="text-xs text-accent font-medium hover:underline"
            >
              {t('settingsPage.addService')}
            </button>
          </section>

          {/* Example */}
          <div className="p-3 bg-bg-sidebar rounded-xl text-xs text-ink-muted leading-relaxed">
            <span className="font-semibold text-ink block mb-1">{t('settingsPage.automaticPricingExample')}</span>
            {t('settingsPage.onXTough2Small45Large')}<br />
            = 3×45 + 1×60 + 20 = <span className="font-semibold text-ink">215.00 €</span>
          </div>
          </section>
              </div>
            </div>
              </div>

              <div>
                <h2 className="text-base font-semibold text-ink mb-1">{t('settingsPage.clinicCosts')}</h2>
                <p className="text-xs text-ink-faint mb-3 max-w-2xl leading-relaxed">
                  {t('settingsPage.whatTheWorkCostsUsNone')}
                </p>
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start [&_section]:card [&_section]:p-4">
          {/* Monthly overheads — what makes the margin a profit */}
          <section>
            <div className="flex items-center gap-2 mb-1">
              <Euro size={14} className="text-accent" />
              <h3 className="text-sm font-semibold text-ink">{t('settingsPage.overheads')}</h3>
            </div>
            <p className="text-xs text-ink-faint mb-3 max-w-xl leading-relaxed">
              {t('settingsPage.rentLeasesSoftwarePhoneFoodCosts')}
            </p>
            <div className="space-y-1.5 mb-2">
              {settings.yldkulud.map((o, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={o.nimi}
                    onChange={e => {
                      const next = [...settings.yldkulud]
                      next[idx] = { ...next[idx], nimi: e.target.value }
                      setYldkulud(next)
                    }}
                    placeholder={t('settingsPage.eGRent')}
                    className="input py-1.5 text-sm flex-1"
                  />
                  <div className="relative w-28">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={o.summa}
                      onChange={e => {
                        const next = [...settings.yldkulud]
                        next[idx] = { ...next[idx], summa: parseFloat(e.target.value) || 0 }
                        setYldkulud(next)
                      }}
                      className="input py-1.5 text-sm pr-7 text-right"
                    />
                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-ink-faint">€</span>
                  </div>
                  {/* How often it falls due. Everything is converted to a
                      month before it reaches Rahandus — this only says how it
                      was TYPED, which is how the person actually knows it. */}
                  <select
                    value={o.periood ?? 'kuu'}
                    onChange={e => {
                      const next = [...settings.yldkulud]
                      next[idx] = { ...next[idx], periood: e.target.value as OverheadPeriood }
                      setYldkulud(next)
                    }}
                    className="input py-1.5 text-xs w-24"
                  >
                    <option value="paev">{t('settingsPage.workingDay')}</option>
                    <option value="nadal">{t('settingsPage.week')}</option>
                    <option value="kuu">{t('settingsPage.month2')}</option>
                    <option value="aasta">{t('settingsPage.year')}</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => setYldkulud(settings.yldkulud.filter((_, i) => i !== idx))}
                    className="p-1 text-ink-faint hover:text-red-500 transition-colors"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
            {/* Only asked for once a per-day cost exists. A lab entering rent
                and nothing else never needs to answer it, and an unexplained
                number in a costs card is a number people distrust. */}
            {settings.yldkulud.some(o => o.periood === 'paev') && (
              <div className="flex items-center gap-2 mb-2 rounded-lg bg-bg-sidebar/60 px-2.5 py-2">
                <span className="text-xs text-ink-muted">{t('settingsPage.workingDaysPerWeek')}</span>
                <input
                  type="number" min={1} max={7} step={1}
                  value={settings.toopaevadNadalas}
                  onChange={e => setNumber('toopaevadNadalas',
                    Math.min(7, Math.max(1, parseInt(e.target.value, 10) || 5)))}
                  className="input py-1 text-sm w-16 text-right"
                />
                <span className="text-[11px] text-ink-faint">
                  {t('settingsPage.onlyForWorkingDayRowsDays', { value: (52 / 12 * settings.toopaevadNadalas).toFixed(1) })}
                </span>
              </div>
            )}
            <button
              type="button"
              onClick={() => setYldkulud([...settings.yldkulud, { nimi: '', summa: 0, periood: 'kuu' }])}
              className="btn-ghost text-xs border border-ink-faint/25"
            >
              <Plus size={12} /> {t('settingsPage.addOverhead')}
            </button>
            {settings.yldkulud.length > 0 && (
              <p className="text-xs text-ink-muted mt-2">
                {t('settingsPage.total')}{' '}
                <strong className="text-ink tabular-nums">
                  {/* The SAME function Rahandus uses. A total computed
                      separately here would be a second implementation of the
                      conversion, and the two would drift. */}
                  {overheadsMonthly(settings.yldkulud, settings.toopaevadNadalas).toFixed(2)} €
                </strong>{' '}
                {t('settingsPage.aMonth')}
                {settings.yldkulud.some(o => (o.periood ?? 'kuu') !== 'kuu') && (
                  <span className="text-ink-faint">{t('settingsPage.allConvertedToAMonth')}</span>
                )}
              </p>
            )}
          </section>

          {/* Fixed costs per job */}
          <section>
            <div className="flex items-center gap-2 mb-1">
              <Euro size={14} className="text-accent" />
              <h3 className="text-sm font-semibold text-ink">{t('settingsPage.fixedCostsPerJob')}</h3>
            </div>
            <p className="text-xs text-ink-faint mb-3">
              {t('settingsPage.addedAutomaticallyToEveryJobS')}
            </p>
            <div className="space-y-1.5 mb-2">
              {settings.fixedCostsPerJob.map((cost, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={cost.nimi}
                    onChange={e => {
                      const next = [...settings.fixedCostsPerJob]
                      next[idx] = { ...next[idx], nimi: e.target.value }
                      setFixedCosts(next)
                    }}
                    placeholder={t('settingsPage.costName')}
                    className="input py-1.5 text-sm flex-1"
                  />
                  <div className="relative w-24">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={cost.summa}
                      onChange={e => {
                        const next = [...settings.fixedCostsPerJob]
                        next[idx] = { ...next[idx], summa: parseFloat(e.target.value) || 0 }
                        setFixedCosts(next)
                      }}
                      className="input py-1.5 text-sm pr-7 text-right"
                    />
                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-ink-faint">€</span>
                  </div>
                  <span className="text-xs text-ink-faint">{t('settingsPage.job3')}</span>
                  <button
                    type="button"
                    onClick={() => {
                      const next = settings.fixedCostsPerJob.filter((_, i) => i !== idx)
                      setFixedCosts(next)
                    }}
                    className="p-1 text-ink-faint hover:text-red-500 transition-colors"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => {
                const next = [...settings.fixedCostsPerJob, { nimi: '', summa: 0 }]
                setFixedCosts(next)
              }}
              className="text-xs text-accent font-medium hover:underline"
            >
              {t('settingsPage.addCost')}
            </button>
            {settings.fixedCostsPerJob.length > 0 && (
              <p className="text-xs text-ink-muted mt-2">
                {t('settingsPage.total2')} <strong className="tabular-nums">{settings.fixedCostsPerJob.reduce((s, c) => s + c.summa, 0).toFixed(2)} €</strong> {t('settingsPage.job4')}
              </p>
            )}
          </section>
                </div>
              </div>
              </div>
              )}
            </div>
          )}

          {/* Job stages (docs/design stages.html): worked top to bottom, one
              numbered card per question, each with one sentence of what is done
              there. In a wrapper so the cards are not the grid's sections. */}
          {activeGroup === 'etapid' && (
          <div className="col-span-full space-y-5 max-w-5xl">
            <SectionCard
              step={1}
              title={t('settingsPage.stagesStepTitle')}
              subtitle={t('settingsPage.stagesStepSub')}
              info={t('settingsPage.addRemoveOrRenamePipelineStages')}
            >
              <div className="space-y-0.5">
                {stages.map((stage, idx) => (
                  <StageRow
                    key={stage.key}
                    stage={stage}
                    isFirst={idx === 0}
                    isLast={idx === stages.length - 1}
                    canRemove={stages.length > 2}
                    onRename={renameStage}
                    onRecolor={recolorStage}
                    onRemove={removeStage}
                    onMove={moveStage}
                  />
                ))}
              </div>
              <AddStageRow onAdd={addStage} />
              <button
                type="button"
                onClick={resetToDefaults}
                className="self-start flex items-center gap-1.5 text-sm text-ink-faint hover:text-red-500 transition-colors"
              >
                <RotateCcw size={13} /> {t('settingsPage.resetToDefaults')}
              </button>
            </SectionCard>

            <SectionCard
              step={2}
              title={t('workflow.templatesTitle')}
              subtitle={t('settingsPage.templatesStepSub')}
              info={t('workflow.templatesHelp')}
            >
              <WorkflowTemplatesSection part="templates" />
            </SectionCard>

            <SectionCard
              step={3}
              title={t('workflow.defaultsTitle')}
              subtitle={t('settingsPage.defaultsStepSub')}
              info={t('workflow.defaultsHelp')}
            >
              <WorkflowTemplatesSection part="defaults" />
            </SectionCard>

            <SectionCard
              step={4}
              title={t('settingsPage.stageNotifications')}
              subtitle={t('settingsPage.notificationsStepSub')}
              info={t('settingsPage.stageNotificationsHelp')}
            >
              <table className="text-base">
                <thead className="text-left text-sm text-ink-muted">
                  <tr>
                    <th className="py-2 pr-8 font-semibold">{t('settingsPage.stage')}</th>
                    <th className="py-2 pr-8 text-center font-semibold">{t('settingsPage.notifyTechnician')}</th>
                    <th className="py-2 text-center font-semibold">{t('settingsPage.notifyDesigner')}</th>
                  </tr>
                </thead>
                <tbody>
                  {stages.map(stage => (
                    <tr key={stage.key} className="border-t border-ink-faint/15">
                      <td className="py-2 pr-8">
                        <span className="inline-block w-3 h-3 rounded-full mr-2 align-middle" style={{ backgroundColor: stage.hex }} />
                        {stage.label}
                      </td>
                      {(['notifyTechnician', 'notifyDesigner'] as const).map(who => (
                        <td key={who} className="py-2 pr-8 text-center">
                          <input type="checkbox" className="w-5 h-5 accent-accent" checked={stage[who] !== false}
                            aria-label={`${stage.label}: ${who === 'notifyTechnician' ? t('settingsPage.notifyTechnician') : t('settingsPage.notifyDesigner')}`}
                            onChange={e => setStageNotify(stage.key, who, e.target.checked)} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </SectionCard>

            {/* Advanced and rarely changed: only with partnerships, folded. */}
            {moduleOn('partners') && (
              <section className="card px-5 py-1">
                <button
                  type="button"
                  aria-expanded={partnerMovesOpen}
                  onClick={() => setPartnerMovesOpen(o => !o)}
                  className="w-full min-h-[60px] flex items-center justify-between gap-3 text-left"
                >
                  <span className="flex items-center gap-3">
                    <span className="w-8 h-8 rounded-full bg-bg-sidebar text-ink-soft flex items-center justify-center font-bold">5</span>
                    <span>
                      <span className="block text-base font-bold text-ink">{t('stageRules.partnerMoves')}</span>
                      <span className="block text-sm text-ink-muted">{t('settingsPage.partnerMovesSub')}</span>
                    </span>
                  </span>
                  {partnerMovesOpen ? <ChevronUp size={18} className="text-ink-muted" /> : <ChevronDown size={18} className="text-ink-muted" />}
                </button>
                {partnerMovesOpen && (
                  <div className="border-t border-ink-faint/15 pt-4 pb-5">
                    <StageTransitionsSection bare />
                  </div>
                )}
              </section>
            )}
          </div>
          )}

          </div>
          </div>
        </div>
      </div>
    </div>
  )
}
