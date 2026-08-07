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
 * "the check compared a private key while the browser painted something else".
 *
 * The positional breaker below is a net for a caller that does not supply distinct labels, and it is
 * available ONLY to surfaces that pass `numbersRows: true` — /cards, the hero and the reminders card,
 * which paint `cardIdentityLabels`' ordinals into the heading itself. TASKS L.15 learned why that
 * has to be explicit: when the same net ran unconditionally on the email, the push notification and
 * the Ask answer — none of which number anything, and one of which paints no card names at all — it
 * quoted “1. CREDIT CARD” / “2. CREDIT CARD” at readers who could find neither, on the DEFAULT
 * reported shape, since two connections to one real card return one provider name. A surface that
 * cannot renumber gets `sameLabel` instead, and every sentence has a form for it.
 */
import { ACCOUNT_CLEANUP_HEADING } from './account-cleanup';
import { renderSafe } from './render-safe';
import type { CashNeededResult, CardObligation } from '@/lib/engine/cash-needed/types';
import { undatedCardsWithBalance } from '@/lib/engine/cash-needed/types';
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
  `No figure above has been adjusted — only you can confirm whether two rows are one card. Accounts lists this pair in its ${ACCOUNT_CLEANUP_HEADING} section, with the choices that fit it, including marking them as not duplicates. If a copy’s bank is still connected, removing it takes two steps there — disconnect, then delete — and its balance keeps counting until it is deleted.`;

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

/** One row on a surface that names cards but attaches no per-card money role (TASKS L.8). */
export interface DisplayedCardRow {
  cardId: string;
  label: string;
}

/** A pair whose two cards are both on THIS surface, named exactly as it paints them. */
interface ResolvedPair<T> {
  key: string;
  /** Paint order: `first` is the one that appears higher on the surface. */
  first: T;
  second: T;
  nameA: string;
  nameB: string;
  /**
   * The two cards paint the SAME string and the surface does not number its rows, so there is no
   * label that tells them apart (TASKS L.15, critic F1). Every sentence must then describe the pair
   * without pretending to point at one of them.
   */
  sameLabel: boolean;
  confidence: 'high' | 'medium';
  reasons: readonly string[];
}

/**
 * The one place a pair is matched to what a surface actually paints — shared by every builder
 * below so they can never disagree about which pairs are disclosable or what the two cards are
 * called. Only the IMPACT sentence differs per surface, because only the money claim differs.
 *
 * A pair is dropped unless both of its cards are displayed here. A duplicate whose other side is a
 * checking account, a withheld non-USD row, a $0 card this surface does not paint, or anything else
 * the surface does not list cannot be described truthfully on it — the reader would be sent looking
 * for a second entry that is not there — and it is disclosed on /accounts, which does list it.
 */
function resolvePairs<T extends DisplayedCardRow>(
  pairs: readonly CardDuplicatePairInput[],
  cards: readonly T[],
  /**
   * Whether the SURFACE numbers its own rows — a fact about the surface, never about the labels
   * (TASKS L.15, critic F1, the sharpest finding of that slice).
   *
   * /cards and the dashboard hero pass already-numbered headings from `cardIdentityLabels`, which
   * renders `1.` / `2.` INTO the heading the reader sees, so a positional prefix invented here names
   * something on screen. None of the L.15 channels number anything: an email prints bullets, a push
   * notification has no list at all, and the Ask answer paints no card names whatsoever. There the
   * old unconditional fallback quoted “1. CREDIT CARD” and “2. CREDIT CARD” — two labels that appear
   * NOWHERE — and it fired on the DEFAULT reported shape, because two connections to one real card
   * return the same provider name. That is the exact #297/#298 failure this module claims immunity
   * from ("the check compared a private key while the browser painted something else"), so the
   * fallback is now something a surface must earn rather than something it silently receives.
   */
  numbersRows: boolean,
): ResolvedPair<T>[] {
  const byId = new Map<string, { index: number; label: string; card: T }>();
  cards.forEach((c, index) => {
    if (!byId.has(c.cardId)) byId.set(c.cardId, { index, label: renderSafe(c.label), card: c });
  });

  const seen = new Set<string>();
  const out: ResolvedPair<T>[] = [];
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
    const numbered = collide && numbersRows;
    out.push({
      key,
      first: first.card,
      second: second.card,
      nameA: numbered ? `${first.index + 1}. ${first.label}` : first.label,
      nameB: numbered ? `${second.index + 1}. ${second.label}` : second.label,
      // Collided AND the surface cannot renumber: the two rows are indistinguishable to the reader,
      // and every sentence has to say so instead of quoting a label that identifies neither.
      sameLabel: collide && !numbersRows,
      confidence: p.confidence,
      reasons: p.reasons,
    });
  }
  return out;
}

/**
 * Completes both halves of every disclosure: who, and on what evidence.
 *
 * The `sameLabel` branch is the L.15 critic-F1 fix. When a surface paints both rows with one string
 * and cannot number them, "“X” and “Y”" has no honest filling — the old code invented ordinals the
 * reader could not find. Naming the shared string once and saying there are two of it is the most
 * that is true, and it is still enough to act on: the reader goes to Accounts, which DOES tell them
 * apart (that is the whole point of #298's identity line).
 */
function sentenceFor(p: ResolvedPair<DisplayedCardRow>): string {
  return p.sameLabel
    ? `Two entries are both named “${p.nameA}” and look like the same card reaching Aimplifi twice.`
    : `“${p.nameA}” and “${p.nameB}” look like the same card reaching Aimplifi twice.`;
}

/**
 * The disclosure for a surface whose total is THIS CYCLE'S CASH REQUIRED (/cards, and the dashboard
 * cash-needed hero) — or `null` when there is nothing honest to say.
 */
export function cardDuplicateView(
  pairs: readonly CardDuplicatePairInput[],
  cards: readonly DisplayedCardForDuplicates[],
): CardDuplicateView | null {
  // `true`: /cards and the hero pass headings already numbered by `cardIdentityLabels`, so a
  // positional prefix invented below names a string that is on screen.
  const out = resolvePairs(pairs, cards, true).map((p) => ({
    key: p.key,
    sentence: sentenceFor(p),
    impact: impactOf(p.first.role, p.second.role, p.nameA, p.nameB),
    basis: basisOf(p.confidence, p.reasons),
  }));
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

/* ─────────────────────────────────────────────────────────────────────────────
 * TASKS L.8 — the same pair, on the two DASHBOARD surfaces.
 *
 * The dashboard reads the very obligations /cards reads, so a both-live duplicate inflates the
 * cash-needed headline and appears twice in the reminders list — and until now neither said a word,
 * while /cards said it plainly. A reader who never opens /cards met the inflated number and nothing
 * else (recorded as the open half when #299 shipped).
 *
 * Why these are separate builders rather than one call with a flag: the only thing that differs
 * between the three surfaces is WHAT MONEY CLAIM IS TRUE THERE, and that is exactly the thing this
 * module exists to get right. `cardDuplicateView`'s impact sentences all speak about this cycle's
 * CASH REQUIRED; neither of the surfaces below states that number, so reusing those sentences would
 * have described a total the reader cannot see. Everything that is genuinely shared — which pairs
 * are disclosable, what each card is called, the basis — is shared, in `resolvePairs`.
 * ───────────────────────────────────────────────────────────────────────────── */

/** One card the cash-needed hero paints, with what it does to the figure above it. */
export interface PaintedHeroCard {
  cardId: string;
  /** The card's name as the hero prints it, BEFORE any identity line is appended. */
  cardName: string;
  role: CardMoneyRole;
}

/**
 * Every card the cash-needed hero's main branch paints, in PAINT ORDER, each carrying whether it is
 * inside `headline.requiredCents`.
 *
 * Pure, and exported, for one reason: this is the exact computation that produced #299's P0 — the
 * first cut called every row in `result.cards` "counted", when `requiredCents` sums only
 * `cycleObligations` filtered to `cashRequiredCents > 0` and ESTIMATED obligations are dropped
 * wholesale once any card has a real statement. Left inline in the component it would have been
 * reachable only through Playwright, which `scripts/verify.sh` skips unless `VERIFY_E2E=1` — so the
 * one piece of this slice with a proven history of being wrong would have had no coverage in the
 * gate that actually runs. `tests/unit/hero-duplicate-rows.test.ts` now drives it with REAL engine
 * output and asserts the counted rows sum to the headline, in every scenario.
 *
 * Paint order is the hero's own: the "Not included" note, then the due-date list, then the
 * estimated next-cycle rows.
 *
 * A dated card needing $0 is deliberately absent: the engine's `due` filter keeps it out of
 * `perDueDate`, so the hero paints it nowhere, and naming a row that is not on screen is the defect
 * this module exists to prevent. /cards lists it and discloses it there.
 */
export function paintedHeroCards(result: CashNeededResult): PaintedHeroCard[] {
  return [
    // Kept out of `cards`, every total and every projection by the engine itself.
    ...undatedCardsWithBalance(result).map((c) => ({
      cardId: c.cardId,
      cardName: c.cardName,
      role: { counted: false, reason: 'no-statement' } as CardMoneyRole,
    })),
    // `perDueDate` is built from `due` — `cycleObligations` filtered to `cashRequiredCents > 0`,
    // the exact rows summed into `headline.requiredCents` — and `amountCents` IS that card's
    // `cashRequiredCents`. The engine's own selection, read off its own output.
    ...result.perDueDate.flatMap((p) =>
      p.cards.map((c) => ({
        cardId: c.cardId,
        cardName: c.cardName,
        role: { counted: true, cents: c.amountCents } as CardMoneyRole,
      })),
    ),
    // Estimated, and dropped from this cycle's total the moment any card has a real statement.
    // Painted with a real-looking figure, which is precisely why it is so easy to call it counted.
    ...result.upcoming.map((u) => ({
      cardId: u.cardId,
      cardName: u.cardName,
      role: { counted: false, reason: 'next-cycle' } as CardMoneyRole,
    })),
  ];
}

/** Urgency order for the /cards grid: soonest effective due date, then largest manual action. */
export function compareCardUrgency(a: CardObligation, b: CardObligation): number {
  return (
    a.effectiveDueDate.localeCompare(b.effectiveDueDate) || b.userActionCents - a.userActionCents
  );
}

/**
 * The /cards "Do this first" gate (P1-17 / C.12). The banner is THE imperative on the
 * page, so the card it names must be inside the total printed beside it. Membership is
 * the engine's own — the same perDueDate selection paintedHeroCards exposes — so the
 * banner cannot drift from the hero: a next-cycle ESTIMATE lives in `upcoming`,
 * excluded from requiredCents the moment any card has a real statement, yet sorts into
 * the urgency list by date; promoting it instructed the reader to pay a figure no total
 * on the page contains. When NOTHING has a real statement the estimates ARE the cycle
 * (thisCycleIsKnown), they are counted, and the gate promotes them.
 *
 * `ordered` is the caller's own urgency sort, kept there so display order and selection
 * order cannot drift apart.
 */
export function firstCountedActionCard(
  result: CashNeededResult,
  ordered: readonly CardObligation[],
): CardObligation | null {
  const counted = new Set(
    paintedHeroCards(result)
      .filter((c) => c.role.counted)
      .map((c) => c.cardId),
  );
  return ordered.find((c) => c.userActionCents > 0 && counted.has(c.cardId)) ?? null;
}

/**
 * The hero's "Cards: due dates missing" branch adds up BALANCES, not cash required, and says so
 * ("that is a balance, not an amount we can say is due"). A duplicate lands in that sum twice, so
 * this is a real inflation of a real figure — but of a different figure, hence its own sentence.
 *
 * `totalStated` mirrors the branch's own condition: it prints a summed figure only when every
 * balance points the same way, and says nothing summable when the set mixes a balance owed with a
 * credit. Claiming "that total counts it twice" where no total was printed would send the reader
 * looking for a number that is not on screen.
 */
export function cardDuplicateBalanceView(
  pairs: readonly CardDuplicatePairInput[],
  cards: readonly DisplayedCardRow[],
  totalStated: boolean,
): CardDuplicateView | null {
  // `true`: the hero's undated panel names its cards through the same `cardIdentityLabels` pass.
  const out = resolvePairs(pairs, cards, true).map((p) => ({
    key: p.key,
    sentence: sentenceFor(p),
    // "the combined balance stated above", never "the total above": this branch's own description
    // names TWO totals — this cycle's total, which these cards are explicitly NOT in, and the sum
    // of their balances, which they are. A bare "the total" points at both.
    impact: totalStated
      ? 'Both are inside the combined balance stated above, so if these are one card that figure counts it twice.'
      : 'No combined balance is stated above, but these are still two rows for what may be one card.',
    basis: basisOf(p.confidence, p.reasons),
  }));
  if (out.length === 0) return null;
  return { title: CARD_DUPLICATE_TITLE, howTo: CARD_DUPLICATE_HOWTO, pairs: out };
}

/**
 * The payment-reminders list states no total at all — it is a list of what to pay and when. So the
 * harm there is not an inflated figure but a duplicated INSTRUCTION: the same card asking to be paid
 * twice, on the same day, for the same amount. That is what this sentence names, and it deliberately
 * makes no claim about any total, because this surface has none.
 */
export const CARD_DUPLICATE_HOWTO_LIST =
  `No amount below has been adjusted — only you can confirm whether two rows are one card. Accounts lists this pair in its ${ACCOUNT_CLEANUP_HEADING} section, with the choices that fit it, including marking them as not duplicates. If a copy’s bank is still connected, removing it takes two steps there — disconnect, then delete — and its balance keeps counting until it is deleted.`;

/* ─────────────────────────────────────────────────────────────────────────────
 * TASKS L.15 — the same pair, on the surfaces the reader meets AWAY from the app.
 *
 * The dashboard, /cards and the reminders list all disclose a both-live duplicate. Six surfaces
 * still did not, and the three sharpest are the ones with no banner anywhere near them: the reminder
 * email, the weekly digest, and a web push that INTERRUPTS the reader. Someone acting on an email at
 * their bank's website has no way to discover what /cards would have told them.
 *
 * Each builder below gets its own sentence for the same reason the three above do: the only thing
 * that differs between surfaces is WHAT MONEY CLAIM IS TRUE THERE. An email states no on-screen
 * total and can point at no control, so it may not say "the total above" or "the figure beside the
 * card" — it names the two rows exactly as the email itself prints them (the `resolvePairs`
 * guarantee) and names Accounts as a place to open. Everything genuinely shared — which pairs are
 * disclosable, what each card is called, the basis — still comes from `resolvePairs`.
 * ───────────────────────────────────────────────────────────────────────────── */

/**
 * The disclosure for the cash-flow calendar (TASKS L.15 (a)) — where one obligation becomes one
 * event, so a duplicated card puts two events on the grid and inflates BOTH figures the month
 * summary prints: the money going out, and the count of payments due.
 *
 * `cards` must be built from the events THIS MONTH actually holds (`CalendarEvent.accountId`), never
 * from the obligation list: an obligation due outside the displayed month emits no event, and
 * naming a card the reader cannot find on the grid in front of them is the failure this module
 * exists to prevent.
 *
 * Makes no claim about the two events sharing a DATE. They usually will — it is one real card — but
 * two providers can report different due dates for it, and this sentence has to stay true when they
 * do.
 */
export function cardDuplicateCalendarView(
  pairs: readonly CardDuplicatePairInput[],
  cards: readonly DisplayedCardRow[],
): CardDuplicateView | null {
  // `false`: the grid paints one label per event and numbers nothing.
  const out = resolvePairs(pairs, cards, false).map((p) => ({
    key: p.key,
    sentence: sentenceFor(p),
    impact:
      'Both are on the calendar with their own amount, so the money-out total and the count of payments due above include what may be one payment twice. If they are one card, you owe it once.',
    basis: basisOf(p.confidence, p.reasons),
  }));
  if (out.length === 0) return null;
  return { title: CARD_DUPLICATE_TITLE, howTo: CARD_DUPLICATE_HOWTO_LIST, pairs: out };
}

/**
 * The email how-to. Differs from the two in-app variants in exactly two ways, both forced by the
 * channel: "in this email" instead of "above"/"below" (an email has no scroll position the writer
 * controls, and the digest interleaves this with several other sections), and "Open Accounts in
 * Aimplifi" instead of naming a page the reader is already on.
 */
export const CARD_DUPLICATE_HOWTO_EMAIL =
  `No amount in this email has been adjusted — only you can confirm whether two rows are one card. Open Accounts in Aimplifi and open its ${ACCOUNT_CLEANUP_HEADING} section to see this pair with the choices that fit it, including marking them as not duplicates. If a copy’s bank is still connected, removing it takes two steps there — disconnect, then delete — and its balance keeps counting until it is deleted.`;

/**
 * The disclosure as plain-text lines for an email body — the reminder email and the weekly digest
 * (TASKS L.15 (b) and (c)). Empty array when there is nothing honest to say, so a caller can splice
 * it in unconditionally.
 *
 * `cards` must be the dues this email actually prints, labelled as it prints them. A pair whose
 * other side is not in the email is dropped by `resolvePairs` — the reader would be sent hunting for
 * a second bullet that is not there.
 */
export function cardDuplicateEmailLines(
  pairs: readonly CardDuplicatePairInput[],
  cards: readonly DisplayedCardRow[],
): string[] {
  // `false`: an email prints bullets, not numbered rows.
  const resolved = resolvePairs(pairs, cards, false);
  if (resolved.length === 0) return [];
  const out: string[] = [CARD_DUPLICATE_TITLE];
  for (const p of resolved) {
    out.push(sentenceFor(p));
    // No direction word and no total: this email states neither.
    //
    // And no "asking to be paid" either (L.15 critic P2-4, executed against the real engine): where
    // BOTH sides are autopay-covered, every bullet above reads "autopay will handle it — just keep
    // the funds in your account", and a sentence saying the card is asking to be paid twice
    // contradicts the two lines directly above it. The harm in that state is real but different —
    // holding, or letting autopay draft, double what is owed. What is true in EVERY state is that
    // the card appears twice and only one of the two amounts is a real obligation, which is also
    // the sentence that tells an autopay reader what to actually do.
    out.push(
      'Both are listed in this email with their own amount, so what may be one card appears here twice. If they are one card, you owe it once — only one of these amounts needs to be covered.',
    );
    out.push(basisOf(p.confidence, p.reasons));
  }
  out.push(CARD_DUPLICATE_HOWTO_EMAIL);
  return out;
}

/**
 * The sentence a single web-push notification must carry (TASKS L.15 (d)), keyed by the card that
 * notification is about. Absent from the map ⇒ nothing to disclose for that card.
 *
 * DECIDED: push DISCLOSES, it does not SUPPRESS the second notification. Suppression is an
 * ADJUSTMENT, and every prior decision on this pair refused adjustment (DECISIONS #289, from #192
 * and #221) — but here the failure DIRECTION settles it on its own. Dropping one of two
 * notifications asserts the two rows are one card, which only the user can confirm; when that guess
 * is wrong the reader is never told a genuinely separate card is due, and the cost is a missed
 * payment. Disclosing when the guess is wrong costs one redundant notification. The cheap failure is
 * the one to take (`docs/lessons/precision-fix-that-fabricates-is-worse-than-a-safe-superset.md`).
 *
 * Deliberately makes NO claim about how many notifications will arrive. A pair is disclosable
 * because both cards are in the reminders list, but `selectNotifications` then filters each one
 * independently — autopay-covered, outside the window, or already delivered — so "you will get two"
 * would be false whenever only one side survives those filters.
 *
 * The strength word is kept even though the body is short: the module's rule is that the basis is
 * always rendered, and an unhedged "this is a duplicate" on an interruption the reader did not ask
 * for is the loudest possible place to state a heuristic as a fact.
 */
export function cardDuplicatePushNotes(
  pairs: readonly CardDuplicatePairInput[],
  cards: readonly DisplayedCardRow[],
): Map<string, string> {
  const out = new Map<string, string>();
  // `false`: a push notification has no list at all, so there is no row for an ordinal to point at.
  for (const p of resolvePairs(pairs, cards, false)) {
    const strength = p.confidence === 'high' ? 'Likely' : 'Possible';
    // When both rows carry one name, naming "the other" would just repeat this notification's own
    // title — two pushes with identical titles, each telling the reader to compare against itself.
    const note = (other: string) =>
      p.sameLabel
        ? `${strength} duplicate: a second entry with this same name looks like the same card, so this may be one payment asked for twice. Accounts lists the choices in its ${ACCOUNT_CLEANUP_HEADING} section.`
        : `${strength} duplicate: “${other}” looks like the same card, so this may be one payment asked for twice. Accounts lists the choices in its ${ACCOUNT_CLEANUP_HEADING} section.`;
    // A card in two pairs keeps its FIRST note rather than concatenating: a push body is truncated
    // by the operating system, and two stacked sentences would push the actionable half off screen.
    if (!out.has(p.first.cardId)) out.set(p.first.cardId, note(p.nameB));
    if (!out.has(p.second.cardId)) out.set(p.second.cardId, note(p.nameA));
  }
  return out;
}

/**
 * A `basis` line for the Glass-Box trace behind the cash-needed headline (TASKS L.15 (f)) — the
 * tapped breakdown that lists both rows of the pair inside the very number the hero now qualifies.
 *
 * This is the one surface where the reader is deliberately auditing the number, so saying nothing is
 * at its worst here: they are looking straight at two rows and the trace reconciles to the penny,
 * which reads as confirmation that both belong.
 */
export function cardDuplicateTraceBasis(
  pairs: readonly CardDuplicatePairInput[],
  cards: readonly DisplayedCardRow[],
): string[] {
  // `false`: the trace lists rows under their own names and numbers nothing.
  return resolvePairs(pairs, cards, false).map((p) =>
    p.sameLabel
      ? `Two rows listed here are both named “${p.nameA}” and look like the same card reaching Aimplifi twice. ${basisOf(p.confidence, p.reasons)} Both are included in this number; nothing has been adjusted. Accounts lists the choices in its ${ACCOUNT_CLEANUP_HEADING} section.`
      : `Two rows listed here — “${p.nameA}” and “${p.nameB}” — look like the same card reaching Aimplifi twice. ${basisOf(p.confidence, p.reasons)} Both are included in this number; nothing has been adjusted. Accounts lists the choices in its ${ACCOUNT_CLEANUP_HEADING} section.`,
  );
}

/**
 * The caveat the Ask assistant's cash-needed answer must carry (TASKS L.15 (e)).
 *
 * That answer states a card COUNT and a cash figure and nothing else — so unlike /cards it prints no
 * per-card amount to quote, and unlike the reminders list it DOES state a total. Both of the things
 * a duplicate inflates are on screen, which is why this sentence names both of them.
 *
 * `cards` must be the counted rows — the obligations inside `headline.requiredCents` — so this can
 * never claim a pair inflates a figure it is not in.
 */
export function cardDuplicateAnswerNote(
  pairs: readonly CardDuplicatePairInput[],
  cards: readonly DisplayedCardRow[],
): string[] {
  // `false`: this answer paints no card list at all, so nothing here can be numbered.
  return resolvePairs(pairs, cards, false).map(
    (p) =>
      `${sentenceFor(p)} Both are inside the amount and the card count in this answer, so if they are one card, both figures include it twice. ${basisOf(p.confidence, p.reasons)} Nothing has been adjusted — Accounts lists the choices in its ${ACCOUNT_CLEANUP_HEADING} section.`,
  );
}

/**
 * The caveat for the Ask answer's ZERO-DUE branch (TASKS L.15, critic F4).
 *
 * That branch was scoped out of `cardDuplicateAnswerNote` on the grounds that an undated pair is in
 * neither the amount nor the card-due count — true, and it missed that the branch states a figure of
 * its own: "2 cards have no statement or due date yet", plus a fact line printing the same card name
 * twice with nothing to explain it. A count is a claim (`an-empty-set-is-not-a-fact-about-money`),
 * and this is the branch the module elsewhere calls the one that most often holds the thin rows a
 * duplicate arrives as.
 *
 * Says plainly that no AMOUNT is affected, because none is — the harm here is a miscount, and
 * telling this reader a total is inflated would be the false money claim in the other direction.
 */
export function cardDuplicateUndatedNote(
  pairs: readonly CardDuplicatePairInput[],
  cards: readonly DisplayedCardRow[],
): string[] {
  // `false`: this branch prints a comma-joined fact line, not a numbered list.
  return resolvePairs(pairs, cards, false).map(
    (p) =>
      `${sentenceFor(p)} If they are one card, the count in this answer is one higher than the number of real cards — no amount here is affected, since neither is in any total. ${basisOf(p.confidence, p.reasons)} Nothing has been adjusted — Accounts lists the choices in its ${ACCOUNT_CLEANUP_HEADING} section.`,
  );
}

/**
 * The Cash Flow Radar's assumption line (TASKS L.15, critic P1-2 — the SEVENTH surface, found only
 * because a critic swept beyond the six the task enumerated).
 *
 * The radar repeats every card obligation across a 90-day horizon, so a duplicate is double-counted
 * in EVERY projected cycle. Executed by the critic on the reported fixture: one connection projects
 * no alert at all; two connections manufacture a CRITICAL "checking may go negative" push four weeks
 * earlier and instruct the reader to move $33,100 instead of $13,050. That makes this the sharpest
 * surface in the system — it is the only one that states a move-this-much figure, it interrupts, and
 * the alert itself exists only because of the duplicate.
 *
 * Still DISCLOSE, never adjust: the projection is left exactly as computed and the radar says why it
 * may be pessimistic — the same shape as its existing loan-overlap assumption, which discloses an
 * accepted double-count rather than guessing it away.
 */
export function cardDuplicateRadarNote(
  pairs: readonly CardDuplicatePairInput[],
  cards: readonly DisplayedCardRow[],
): string[] {
  // `false`: the radar names colliding cards inline and numbers nothing.
  return resolvePairs(pairs, cards, false).map((p) => {
    const who = p.sameLabel
      ? `Two of the cards in this projection are both named “${p.nameA}” and look like the same card reaching Aimplifi twice.`
      : `“${p.nameA}” and “${p.nameB}” look like the same card reaching Aimplifi twice.`;
    return `${who} If they are one card, every cycle in this projection counts it twice, so the dip date may be earlier and the amount to move larger than you actually need. ${basisOf(p.confidence, p.reasons)} Nothing has been adjusted — Accounts lists the choices in its ${ACCOUNT_CLEANUP_HEADING} section.`;
  });
}

export function cardDuplicateListView(
  pairs: readonly CardDuplicatePairInput[],
  cards: readonly DisplayedCardRow[],
): CardDuplicateView | null {
  // `true`: the reminders card paints each row through the shared `cardIdentity` map too.
  const out = resolvePairs(pairs, cards, true).map((p) => ({
    key: p.key,
    sentence: sentenceFor(p),
    // Says nothing about WHICH CYCLE, deliberately. A critic ran the engine on the mixed state —
    // one card with a real statement, the duplicated pair with none — and found the reminders list
    // carries both estimated copies (`selectPaymentReminders` takes the complete obligation set and
    // drops only `cashRequiredCents <= 0`) while the hero, reading the same pair's roles, calls them
    // next-cycle estimates. The old wording said "this cycle shows two payments", so one dashboard
    // printed two contradictory sentences under one title. What is true on this surface in EVERY
    // state is simply that it is asking twice.
    impact:
      'Both are listed below with their own amount, so what may be one card is asking to be paid twice. If they are one card, you owe it once.',
    basis: basisOf(p.confidence, p.reasons),
  }));
  if (out.length === 0) return null;
  return { title: CARD_DUPLICATE_TITLE, howTo: CARD_DUPLICATE_HOWTO_LIST, pairs: out };
}
