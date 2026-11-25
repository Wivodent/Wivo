/**
 * The large picture of a work type: its 3D illustration when one is in
 * assets/worktypes/3d/, otherwise the line icon. For the big places only
 * (the cards of the new-job form's first step, the Prices cards, empty
 * pages); small places keep the line icon or the photo they always had.
 *
 * Give `type` for a work type, or `kind` for a page that shows a kind of work
 * rather than a lab's type (an empty list).
 *
 * The pictures are drawn on white (scripts/optimize-worktype-images.py says
 * why), so they sit on a white rounded plate.
 */
import type { WorkType } from '@shared/pricing/workTypes'
import { WorkKindIcon } from '../NewJobWizard/jobtype/WorkKindIcon'
import type { WorkKind } from '../NewJobWizard/jobtype/workKindShapes'
import { kind3dImage, workType3dImage, workTypeKind } from '../../lib/workType3d'

export type WorkTypeArtProps = {
  /** Pixel size of the square box. */
  size: number
  /** Size of the line icon inside the box when there is no picture. Defaults to the box. */
  iconSize?: number
  className?: string
} & ({ type: Pick<WorkType, 'nimi' | 'match' | 'katalog' | 'pildiValik'>; kind?: never } | { kind: WorkKind; type?: never })

export function WorkTypeArt({ size, iconSize, className = '', ...which }: WorkTypeArtProps): JSX.Element {
  // The owner's choice (work_types[].pildiValik) holds here too: a picture, or a line icon.
  const kind = which.kind ?? workTypeKind(which.type!)
  const src = which.type ? workType3dImage(which.type) : kind3dImage(kind)
  if (src) {
    return (
      <img
        src={src}
        alt=""
        aria-hidden="true"
        width={size}
        height={size}
        className={`object-contain flex-shrink-0 rounded-2xl bg-white ${className}`}
        style={{ width: size, height: size }}
        draggable={false}
      />
    )
  }
  return <WorkKindIcon kind={kind} size={iconSize ?? size} className={className} />
}

/** Whether a type has a 3D picture, for a box that grows to show it. */
export const hasWorkType3d = (type: Pick<WorkType, 'nimi' | 'match' | 'katalog' | 'pildiValik'>): boolean => workType3dImage(type) != null
