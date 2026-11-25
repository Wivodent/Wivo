/**
 * Pictures of work type options, from src/renderer/src/assets/worktypes/3d/options/:
 * the file is named after the option's id (metal-bar → metal-bar.webp). An
 * option without one shows its name only. Bundled at build time, like the
 * work type pictures (lib/workType3d.ts).
 */
import { OPTIONS } from '@shared/pricing/workTypeCatalogue'
import { kebab } from '@shared/pricing/workOptions'

const modules = import.meta.glob(
  '../assets/worktypes/3d/options/*.{webp,png,jpg,jpeg,svg}',
  { eager: true, query: '?url', import: 'default' }
) as Record<string, string>

const byId = new Map<string, string>(
  Object.entries(modules).map(([path, url]) => [(path.split('/').pop() ?? '').replace(/\.[^.]+$/, '').toLowerCase(), url])
)

/**
 * The picture of an option, or null: by its id, else by its name. An option
 * the clinic typed in its own words ("Metallraam", id metallraam) finds the
 * picture of the catalogue option of that name in any language, or of a file
 * named like it ("Metal bar" → metal-bar).
 */
export function workOptionImage(id: string, nimi?: string | null): string | null {
  const own = byId.get(id.toLowerCase())
  if (own) return own
  const name = nimi?.trim().toLowerCase()
  if (!name) return null
  const named = OPTIONS.find(o => Object.values(o.names).some(n => n.toLowerCase() === name))
  return (named && byId.get(named.id)) ?? byId.get(kebab(name)) ?? null
}

/** The ids that have a picture, for tests and the settings hint. */
export const workOptionImageIds = (): string[] => [...byId.keys()].sort()
