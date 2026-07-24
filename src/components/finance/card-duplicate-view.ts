/**
 * card-duplicate-view.ts — the /cards duplicate DISCLOSURE (TASKS L.6, second half).
 *
 * The defect (owner-reported 2026-07-24, from a live /cards screenshot): one real card arriving
 * through TWO live connections emitted TWO full obligations, so the "Do this first" instruction and
 * every card total on the page included it twice — +$6,679.68 of phantom cash-needed against a
 * visible $25,258.27 — and the page said nothing at all. `cashNeededFromSnapshot` de-duplicates
 * only the RECONCILED kind (it strips `supersededAccountIds`); a both-live pair has no
 * reconciliation link, so nothing removed it. Meanwhile the personal duplicate detector
 * (`SuspectedDuplicatePair`) rendered only inside `accounts-list.tsx` — detection was already
 * correct, so this is a MISSING SURFACE, not a missing engine.
 *
 * DISCLOSE, NEVER SILENTLY ADJUST (decided in DECISIONS #289, from #192 and #221). Subtracting a
 * suspected duplicate from a money headline would assert that two rows are one card — a claim only
 * the user can confirm — and #192's detector is advisory by design: it never merges and never
 * deletes. So every figure on /cards is left exactly as the engine computed it, and this module says
 * so out loud rather than quietly moving a number the reader is about to act on.
 *
 * PURE and framework-free (the repo's vitest env is 'node'), and it owns every string the
 * disclosure renders — the `duplicate-card-view.ts` / `continued-accounts-view.ts` precedent.
 *
 * Labels arrive already painted. The caller passes the exact heading text it renders for each card,
 * so this module can never name a card differently from the page naming it — the #297/#298 class of
 * "the check compared a private key while the browser painted something else". The positional
 * breaker below is a net for a caller that does not supply distinct labels; with
 * `cardIdentityLabels` computed over the whole displayed list it cannot fire.
 */
import { renderSafe } from './continued-accounts-view';
import { cents, formatCents } from '@/lib/money';

export const CARD_DUPLICATE_TESTID = 'cards-duplicate';
export const CARD_DUPLICATE_PAIR_TESTID = 'cards-duplicate-pair';

export const CARD_DUPLICATE_TITLE = 'One card may be listed twice';

/**
 * Always rendered. States the two things the reader cannot see for themselves: that nothing was
 * adjusted, and where the fix lives. Deliberately NOT an instruction to delete — #192's stance is
 * that a suspected duplicate is a question for the user, and two same-named cards really can be two
 * different cards (the reason /accounts carries a "not duplicates" dismissal at all).
 */
export const CARD_DUPLICATE_HOWTO =
  'No figure above has been adjusted — only you can confirm whether two rows are one card. Accounts lists this pair with the choices that fit it, including marking them as not duplicates. If a copy’s bank is still connected, removing it takes two steps there — disconnect, then delete — and its balance keeps counting until it is deleted.';

export interface CardDuplicatePairInput {
  aId: string;
  bId: string;
  /** #192's own strength for this pair. Rendered, never hidden: /accounts shows it and the reasons
   *  beside every warning, and a heuristic printed as a flat assertion directly above a payment
   *  instruction is the coaching guardrail's "state your assumptions inline" violation. A
   *  'medium' pair really can be two different cards — one Plaid row with a last-4 and one
   *  SimpleFIN row without pair on a shared name token alone (`duplicates.ts` masksDiffer). */
  confidence: 'high' | 'medium';
  /** The signals that fired, e.g. `same last-4 (0977)` — the basis, in the detector's own words. */
  reasons: readonly string[];
}

/**
 * Why a displayed row contributes nothing to the figures above. The three cases are genuinely
 * different facts and the reader acts on them differently, so they never share a sentence.
 */
export type UncountedReason =
  /** No statement and no cycle dates — the "No due date yet" panel. */
  | 'no-statement'
  /** An ESTIMATED next-cycle obligation, excluded from this cycle's total the moment any card has
   *  a real statement (`cash-needed/engine.ts:214-223`). It is painted in the grid with its own
   *  "Cash required" line, which is exactly why it is so easy to call it counted when it is not. */
  | 'next-cycle'
  /** Dated and in this cycle, but needs no cash — a $0 or credit-balance card. `engine.ts:220`
   *  filters `cashRequiredCents > 0` out of the total. */
  | 'nothing-due';

/** What a row does to the money on this page: a figure, or a reason there is no figure. */
export type CardMoneyRole =
  | { counted: true; cents: number }
  | { counted: false; reason: UncountedReason };

/** One card as /cards actually renders it, in paint order. */
export interface DisplayedCardForDuplicates {
  cardId: string;
  /** The heading text painted for this card — its name plus whatever identity line it carries. */
  label: string;
  /**
   * Whether this row is in `headline.requiredCents`, and if so for how much.
   *
   * The first cut of this module used `cashRequiredCents` for every row in `result.cards` and
   * claimed "every figure that adds cards together includes both". A hostile critic falsified it by
   * running the engine: `requiredCents` sums only `cycleObligations` — the ESTIMATED obligations
   * are dropped wholesale as soon as any one card has a real statement — and then only those with
   * `cashRequiredCents > 0` (`engine.ts:214-223`). So a duplicated pair that is merely estimated,
   * or paid off, is painted in the grid with a real-looking figure while contributing NOTHING to
   * the total. Telling that reader their headline is inflated by two $6,679.68 rows, when the
   * headline is $217.99 and includes neither, is the false money claim this whole disclosure exists
   * to prevent — and it could send them to move cash they do not need to move.
   */
  role: CardMoneyRole;
}

export interface CardDuplicatePairView {
  key: string;
  /** Names both sides. Hedged by construction: the detector is a heuristic, never a verdict. */
  sentence: string;
  /** What the pair does — or does not do — to the figures on this page. */
  impact: string;
  /** Why the detector paired them, in its own words, plus how strongly. Always rendered. */
  basis: string;
}

export interface CardDuplicateView {
  title: string;
  howTo: string;
  pairs: CardDuplicatePairView[];
}

/**
 * The disclosure, or `null` when there is nothing honest to say (no pairs, or no pair whose BOTH
 * sides are actually on this page).
 *
 * A pair is dropped unless both of its cards are displayed here. A duplicate whose other side is a
 * checking account, a withheld non-USD row, or anything else /cards does not list cannot be
 * described truthfully on this page — the reader would be sent looking for a second entry that is
 * not there — and it is disclosed on /accounts, which does list it.
 */
export function cardDuplicateView(
  pairs: readonly CardDuplicatePairInput[],
  cards: readonly DisplayedCardForDuplicates[],
): CardDuplicateView | null {
  const byId = new Map<string, { index: number; label: string; role: CardMoneyRole }>();
  cards.forEach((c, index) => {
    if (!byId.has(c.cardId)) byId.set(c.cardId, { index, label: renderSafe(c.label), role: c.role });
  });

  const seen = new Set<string>();
  const out: CardDuplicatePairView[] = [];
  for (const p of pairs) {
    if (p.aId === p.bId) continue;
    const key = p.aId < p.bId ? `${p.aId}|${p.bId}` : `${p.bId}|${p.aId}`;
    if (seen.has(key)) continue;
    const a = byId.get(p.aId);
    const b = byId.get(p.bId);
    if (!a || !b) continue;
    seen.add(key);

    // Paint order, so the sentence reads down the page rather than in whatever order the detector
    // happened to emit the pair.
    const [first, second] = a.index <= b.index ? [a, b] : [b, a];
    // Net only. Two cards painted identically would make this sentence useless — it would name the
    // same string twice — so fall back to the position each card occupies in the displayed list.
    // A 1-based ordinal prefix cannot be forged by an account name (#297): for i != j the decimals
    // differ at some digit, or the shorter is followed by '.' where the longer has a digit.
    const collide = first.label === second.label;
    const nameA = collide ? `${first.index + 1}. ${first.label}` : first.label;
    const nameB = collide ? `${second.index + 1}. ${second.label}` : second.label;

    out.push({
      key,
      sentence: `“${nameA}” and “${nameB}” look like the same card reaching Aimplifi twice.`,
      impact: impactOf(first.role, second.role, nameA, nameB),
      basis: basisOf(p.confidence, p.reasons),
    });
  }
  if (out.length === 0) return null;
  return { title: CARD_DUPLICATE_TITLE, howTo: CARD_DUPLICATE_HOWTO, pairs: out };
}

/**
 * The money sentence. "Counted twice" is claimed ONLY when both rows are genuinely inside
 * `headline.requiredCents`; every other state says plainly that the totals are not inflated. Each
 * uncounted row names its OWN reason, because "no statement yet", "an estimate for next cycle", and
 * "needs no cash" are three different facts and the reader does different things about them.
 *
 * The counted case names no single aggregate — the page carries several and the toggle swaps them.
 * It quotes each row's cash-required figure, the same number printed on that card's tile, so the
 * claim is checkable on screen rather than asserted.
 */
function impactOf(a: CardMoneyRole, b: CardMoneyRole, nameA: string, nameB: string): string {
  if (a.counted && b.counted) {
    return `Both are counted in the total above — ${formatCents(cents(a.cents))} of cash required for the first and ${formatCents(cents(b.cents))} for the second — so this cycle's figures include both. If they are one card, you owe it once.`;
  }
  if (!a.counted && !b.counted) {
    return `Neither is in the total above: “${nameA}” ${REASON_CLAUSE[a.reason]}, and “${nameB}” ${REASON_CLAUSE[b.reason]}. Nothing above is inflated by this pair.`;
  }
  const counted = a.counted ? nameA : nameB;
  const uncounted = a.counted ? nameB : nameA;
  const reason = a.counted ? (b as { reason: UncountedReason }).reason : (a as { reason: UncountedReason }).reason;
  return `Only “${counted}” is in the total above; “${uncounted}” ${REASON_CLAUSE[reason]}, so it adds nothing to it. The total is not inflated — but these are still two rows for what may be one card.`;
}

/** Completes "<card name> …". Each states a fact about THIS page's totals, never a bank's behaviour. */
const REASON_CLAUSE: Record<UncountedReason, string> = {
  'no-statement': 'has no statement yet',
  'next-cycle': 'is an estimate for next cycle, not this one',
  'nothing-due': 'needs no cash this cycle',
};

/**
 * The basis, always shown. /accounts renders the confidence chip and the reasons beside every
 * warning; printing the bare claim here — directly above the payment instruction, on the page with
 * no dismiss control — would be strictly less honest than the quieter surface.
 */
function basisOf(confidence: 'high' | 'medium', reasons: readonly string[]): string {
  const strength = confidence === 'high' ? 'Likely' : 'Possible';
  const cleaned = reasons.map((r) => renderSafe(r)).filter((r) => r !== '');
  return cleaned.length > 0 ? `${strength} — matched on ${cleaned.join(', ')}.` : `${strength} match.`;
}
