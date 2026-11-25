/**
 * Wizard state → the shapes the rest of the app already understands: work items
 * for the odontogram, and the one QuoteInput everything prices from.
 *
 * This file is the only bridge between `NewJobState` (one entry per work TYPE)
 * and `WorkItem[]` (one row per piece of work). It is deliberately not unit
 * tested — it imports renderer types — so it holds no rules of its own: every
 * decision it makes comes from `@shared/wizard`.
 */
import type { WorkItem } from '@/types/job'
import type { QuoteInput } from '@shared/pricing/quote'
import type { WorkType } from '@shared/pricing/workTypes'
import type { NewJobState } from '@shared/wizard'
import {
  archesOf, teethForArch, teethToHambad, workTypeRules, baseTypeName,
  materialFor, materialsOf, machineFor,
} from '@shared/wizard'
import { cleanChoice } from '@shared/pricing/workOptions'

/**
 * ONE work item per selected type, in selection order.
 *
 * The id is `wiz:${nimi}` and NOT crypto.randomUUID(): this runs on every
 * render to feed the odontogram, and a fresh id per render would remount all
 * 32 teeth on every keystroke elsewhere in the wizard. The name is unique
 * within jobTypes, so it is a perfectly good key.
 */
export function wizardWorkItems(state: NewJobState, types: readonly WorkType[]): WorkItem[] {
  return state.jobTypes.flatMap(key => {
    const nimi = baseTypeName(key)
    const rules = workTypeRules(nimi, types)
    // What THIS work is made of. Carried onto the item so the crowns can be
    // Ceramic Crown while the bridges are OnX Tough 2 — both in the price and
    // on the Edit page afterwards.
    const materjal = materialFor(state, key)
    const mat = materjal ? { materjal } : {}

    // Which printer THIS work runs on. Carried onto the item for the same
    // reason as the material: the machine-specific material cost key
    // ("materjal|masin") is read per item, so a job split across two printers
    // only costs correctly if each item says which one it used.
    const masina = machineFor(state, key)
    const mach = masina ? { masina } : {}

    // The options chosen for this work, kept to what its type offers now.
    const valikud = cleanChoice(types.find(type => type.nimi === nimi)?.valikuGrupid, state.optionsByType?.[key])
    const opts = valikud ? { valikud } : {}

    // An arch type on BOTH jaws is two pieces of work, so it is two items — see
    // archesOf() for why that is a pricing rule and not a display one. As one
    // item it was a single row carrying 32 teeth, and a per-job-priced All-on-X
    // came out at the single-arch price whichever answer the user gave.
    if (rules.toothMode === 'arch') {
      if (!state.selectedArch) return [{ id: `wiz:${key}`, too: nimi, hambad: '', ...mat, ...mach, ...opts }]
      const arches = archesOf(state.selectedArch)
      // The arch answer fills the jaw; an explicit selection narrows it. An
      // All-on-4 that stops short of the last molar had no way to say so while
      // the arch buttons were the only control on the step.
      const custom = state.selectedTeeth[key]
      return arches.map(arch => {
        const teeth = teethForArch(arch, custom)
        // Where the implants of an All-on-4 are: marked tooth by tooth, like
        // any other work (2.2.0). Each jaw keeps the marks on its own teeth.
        const implants = implantsAmong(state, key, teeth)
        return {
          id: arches.length > 1 ? `wiz:${key}:${arch}` : `wiz:${key}`,
          too: nimi,
          hambad: teethToHambad(teeth),
          ...mat,
          ...mach,
          ...opts,
          ...abutmentsFor(state, key, implants),
          ...(implants.length > 0 ? { implantaadid: teethToHambad(implants) } : {}),
        }
      })
    }

    // An appliance owns no teeth at all. Only tooth-mode work reads the
    // per-type selection.
    const hambad =
      rules.toothMode === 'none' ? '' : teethToHambad(state.selectedTeeth[key] ?? [])

    // Which of those teeth sit on an implant. Any tooth of any tooth-level
    // work can (2.2.0: a "+ Implant" on every picked tooth), not only a type
    // named for implants. Filtered against the picked teeth rather than
    // trusted: deselecting a tooth must not leave an implant behind it,
    // priced into the screws and invisible on the chart.
    const picked = new Set(rules.toothMode === 'none' ? [] : (state.selectedTeeth[key] ?? []))
    const implants = implantsAmong(state, key, [...picked])

    // Which abutment each implant sits on, asked only once there is one. The
    // type-wide code is the item's `kruvi`; only implants that were given
    // something DIFFERENT are written into `kruvid`, so the common "all four
    // are MIS C1" case stores one string and the mixed case the exceptions.
    const abut = abutmentsFor(state, key, implants)

    // Which teeth the DESIGNER did. Stored only when it is a real subset:
    // "all of them" has to stay unsaid, or a tooth added later would arrive
    // already assigned to the technician.
    const designed = (state.designByType[key] ?? []).filter(t => picked.has(t))
    const partialDesign = designed.length > 0 && designed.length < picked.size

    return [{
      id: `wiz:${key}`,
      too: nimi,
      hambad,
      ...mat,
      ...mach,
      ...opts,
      ...abut,
      ...(implants.length > 0 ? { implantaadid: teethToHambad(implants) } : {}),
      ...(partialDesign ? { disain_hambad: teethToHambad(designed) } : {}),
      ...(rules.isBridge ? { bridge: true } : {}),
    }]
  })
}

/**
 * The single QuoteInput builder. Step 6's price summary and the save path MUST
 * both go through this — the number shown and the number written down cannot be
 * allowed to disagree, which is precisely the bug `shared/pricing` exists to
 * prevent.
 *
 * Omits disainHind and extras on purpose, exactly like JobDetailPanel's
 * auto-price: the design fee is added on top and is not a production cost, and
 * the wizard never offers extras.
 */
/**
 * The abutment fields for one work item, or nothing at all.
 *
 * Only the teeth whose code differs from the type-wide one are stored per
 * tooth. Writing every tooth would work, but it turns "these are all MIS C1"
 * into four rows that have to be edited four times when the system changes.
 */
function abutmentsFor(
  state: NewJobState, key: string, implants: readonly number[]
): { kruvi?: string; kruvid?: Record<string, string> } {
  if (implants.length === 0) return {}
  const all = (state.abutmentByType[key] ?? '').trim()
  const perTooth: Record<string, string> = {}
  for (const n of implants) {
    const tooth = String(n)
    const own = (state.abutmentByTooth[tooth] ?? '').trim()
    if (own && own !== all) perTooth[tooth] = own
  }
  return {
    ...(all ? { kruvi: all } : {}),
    ...(Object.keys(perTooth).length > 0 ? { kruvid: perTooth } : {}),
  }
}

/** The teeth of `teeth` marked as implants for this work type, in the teeth's order. */
function implantsAmong(state: NewJobState, key: string, teeth: readonly number[]): number[] {
  const marked = new Set(state.implantsByType[key] ?? [])
  return teeth.filter(t => marked.has(t))
}

export function wizardQuoteInput(state: NewJobState, types: readonly WorkType[]): QuoteInput {
  return {
    // materjal travels with the item: quoteJob prices each one by what it is
    // actually made of, and only falls back to the job-level material below.
    items: wizardWorkItems(state, types).map(i => ({
      too: i.too, hambad: i.hambad, materjal: i.materjal ?? null, valikud: i.valikud ?? null,
    })),
    materjal: materialsOf(state)[0] ?? null,
    kiirtoo: state.rush,
    mudel: state.model,
    useDiscount: state.pricing.useDiscount,
  }
}
