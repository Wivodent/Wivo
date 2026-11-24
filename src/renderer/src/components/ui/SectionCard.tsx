/**
 * One section of a page: a card with its heading, one short line under it, an
 * optional "i" for the long explanation, and an optional action on the right.
 *
 * The pages built from Kevin's designs (docs/design, 2026-11) are a column of
 * these: one clear thing at a time, little text on screen, the reasons behind
 * the "i".
 */
import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { InfoButton } from './InfoButton'

export function SectionCard({
  title, subtitle, info, infoLabel, icon: Icon, iconTint, step, action, children, className = '', id,
}: {
  title: string
  /** One short line under the heading. */
  subtitle?: string
  /** The long explanation, behind the "i". */
  info?: string
  /** The "i" button's accessible name; defaults to the title. */
  infoLabel?: string
  icon?: LucideIcon
  /** Tailwind classes for the icon tile, e.g. 'bg-violet-100 text-violet-700'. */
  iconTint?: string
  /** A number in a circle before the heading (a page worked top to bottom). */
  step?: number
  action?: ReactNode
  children?: ReactNode
  className?: string
  id?: string
}) {
  return (
    <section id={id} className={`card p-5 flex flex-col gap-4 ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {step != null && (
            <span className="w-8 h-8 rounded-full bg-accent text-white flex items-center justify-center font-bold flex-shrink-0">
              {step}
            </span>
          )}
          {Icon && (
            <span className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${iconTint ?? 'bg-accent/10 text-accent'}`}>
              <Icon size={20} aria-hidden="true" />
            </span>
          )}
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-ink leading-tight">{title}</h2>
            {subtitle && <p className="text-sm text-ink-muted mt-0.5">{subtitle}</p>}
          </div>
          {info && <InfoButton label={infoLabel ?? title} text={info} />}
        </div>
        {action && <div className="flex-shrink-0">{action}</div>}
      </div>
      {children}
    </section>
  )
}
