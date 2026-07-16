/**
 * Presentation layer for a category-provenance verdict (Why-This-Category §3.1,
 * slice 2). PURE and framework-free so it is unit-testable in the node env.
 *
 * The origin decision belongs entirely to `describeProvenance` (the engine); this
 * module only decides how the ALREADY-computed verdict is shown — its badge text
 * (copied verbatim from the verdict), its visual tone, and whether the row offers
 * the "confirm this AI guess" control. It never re-derives an origin, so the badge
 * can never disagree with the resolver. The component renders exactly this view;
 * the render test pins the mapping.
 */
import type { ProvenanceVerdict } from '@/lib/engine/categorize/provenance';

export const PROVENANCE_BADGE_TESTID = 'txn-provenance';
export const PROVENANCE_CONFIRM_TESTID = 'provenance-confirm';

export interface ProvenanceBadgeView {
  /** The badge copy — the verdict's own label, never re-authored here. */
  label: string;
  /**
   * `attention` for the one kind that needs the user's OK (an AI guess); `muted`
   * for every settled/informational origin. Kept a function of `needsConfirm`
   * alone so a new attention state can never appear without the confirm control.
   */
  tone: 'attention' | 'muted';
  /** True iff the row shows the confirm affordance — exactly the `ai-guess` kind. */
  showConfirm: boolean;
  kind: ProvenanceVerdict['kind'];
}

export function provenanceBadgeView(v: ProvenanceVerdict): ProvenanceBadgeView {
  return {
    label: v.label,
    tone: v.needsConfirm ? 'attention' : 'muted',
    showConfirm: v.needsConfirm,
    kind: v.kind,
  };
}
