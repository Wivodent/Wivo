/**
 * Pictures of work type options, from src/renderer/src/assets/worktypes/3d/options/:
 * the file is named after the option's id (metal-bar → metal-bar.webp). An
 * option without one shows its name only. Bundled at build time, like the
 * work type pictures (lib/workType3d.ts).
 */
const modules = import.meta.glob(
  '../assets/worktypes/3d/options/*.{webp,png,jpg,jpeg,svg}',
  { eager: true, query: '?url', import: 'default' }
) as Record<string, string>

const byId = new Map<string, string>(
  Object.entries(modules).map(([path, url]) => [(path.split('/').pop() ?? '').replace(/\.[^.]+$/, '').toLowerCase(), url])
)

/** The picture of an option, or null. */
export const workOptionImage = (id: string): string | null => byId.get(id.toLowerCase()) ?? null

/** The ids that have a picture, for tests and the settings hint. */
export const workOptionImageIds = (): string[] => [...byId.keys()].sort()
