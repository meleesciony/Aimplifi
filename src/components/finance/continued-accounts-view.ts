/**
 * The "Combined accounts" card's render contract (#297).
 *
 * Owner-reported 2026-07-24 (STATUS §Combined-accounts): the card listed
 * "Venture (Plaid ····6271)" TWICE, identically — same mask, same "history kept through
 * 2026-07-18" — with two byte-identical "Undo" buttons. `AccountReconciliation.successorAccountId`
 * is deliberately NOT unique (prisma/schema.prisma:193 — "one live account may supersede more than
 * one old row"), so two predecessors folding into one live account is VALID data; the card simply
 * rendered one flat row per link and never rendered the one field that differs — the predecessor's
 * own NAME. It showed `providerMask(predecessor)`, which for two SimpleFIN rows (no mask column) is
 * the constant string "SimpleFIN".
 *
 * This is #296's defect one card lower, so it takes #296's cure: compute EVERY entry together and
 * make distinctness an invariant of construction rather than a property of the data. Concretely:
 *   1. Group by successor — one block per live account, listing each old account folded into it.
 *   2. Name the PREDECESSOR (the differing fact), plus an "old account N of M" ordinal.
 *   3. Guarantee no two Undo controls can tie, for ANY input, by the argument in
 *      `numberEveryControl` below — NOT by hoping the data differs.
 *
 * Pure and framework-free so the node unit suite can lock every rendered string: accounts-list.tsx
 * is 'use client' and imports server actions at module scope, so it cannot be imported in a test.
 *
 * ── What this card may and may not CLAIM (critic cycle 1, three fresh-context critics) ──
 * `ReconciledPairView` carries no successor-liveness flag and no claim span, so the module must not
 * assert either. Two states make the obvious sentence false:
 *   (a) CHAINS. `getFinanceSnapshot` emits one row per link using its DIRECT successor
 *       (transactions.ts:525) and the boundary zeroes EVERY predecessor's balance
 *       (reconcile-boundary.ts:419). In a chain Q -> P -> S, P heads its own block while
 *       contributing $0 — so "balance counted on the live connection" would be false OF THE
 *       BLOCK HEADER.
 *   (b) A successor whose bank is later disconnected keeps its last balance and stops being live;
 *       liveness is re-checked nowhere after confirm time.
 * The cure is to state only what is true in EVERY state: a fact about the PREDECESSOR (its balance
 * no longer counts on its own — the boundary zeroes it unconditionally), never a claim about where
 * the money went. Chains additionally get an explicit note, since the block header would otherwise
 * imply a live account. See STATUS §Combined-accounts for the two residuals left open.
 *
 * Deliberately NOT asserted: that the links are CORRECT. Whether a second predecessor was matched
 * to the right live account is owner-only knowledge (rule 0). The card's job is to make that
 * question answerable and each link separately reversible — never to claim an answer.
 */
import type { ReconciledPairView } from '@/server/transactions';

import { providerMask } from './duplicate-card-view';

export const CONTINUED_CARD_TESTID = 'reconcile-combined';
export const CONTINUED_ACCOUNT_TESTID = 'reconcile-combined-account';
/** Kept from the pre-#297 markup: one element per SOURCE (old account folded in). */
export const CONTINUED_SOURCE_TESTID = 'reconcile-combined-pair';
export const CONTINUED_COMBINES_TESTID = 'reconcile-combines-note';
export const CONTINUED_CHAINED_TESTID = 'reconcile-chained-note';
export const CONTINUED_UNDO_TESTID = 'reconcile-undo';
export const CONTINUED_AUDIT_TESTID = 'reconcile-audit-flag';

/**
 * The name sanitizer now lives in the engine tree (TASKS L.15): the duplicate-disclosure copy
 * module moved there when the reminder/digest/notify engines became its consumers, and
 * `src/lib/**` must not import from `src/components/**`. Re-exported here, unchanged, so every
 * existing importer of this module keeps working and there is still exactly ONE sanitizer.
 */
import { renderSafe, UNNAMED_ACCOUNT } from '@/lib/engine/account/render-safe';

export { renderSafe, UNNAMED_ACCOUNT };

/** One old account folded into a live one. `id` is the AccountReconciliation id — the Undo target. */
export interface ContinuedSourceView {
  id: string;
  /** Unique per rendered control — safe as a React key even if two payload rows shared an id. */
  key: string;
  /** 1-based position within its own account block. Positional over the payload order. */
  n: number;
  /** The predecessor's own name, sanitized — the field the pre-#297 card never rendered. */
  name: string;
  providerMask: string;
  /** The full identity + history sentence rendered under the account title. */
  identityLine: string;
  /** Button face. Names its object whenever the card carries more than one Undo. */
  undoLabel: string;
  /** Accessible name — always starts with the visible face (WCAG 2.5.3), always unique card-wide. */
  undoAriaLabel: string;
  /**
   * U.15 — set ONLY when today's checks would not propose this pair, and then it is a sentence
   * about THE APP ("we wouldn't suggest this now"), never about the accounts. The module's
   * standing rule is that whether a match is correct is owner-only knowledge; this does not
   * overturn it. It reports what the app's own checks now say and hands the reader the Undo that
   * was already there, which is the difference between making the question answerable and
   * answering it. `null` for every other verdict — an abstention and a still-supported link look
   * identical here on purpose, because neither is a reason to act.
   */
  auditLine: string | null;
}

/** One live account, with every old account that was combined into it. */
export interface ContinuedAccountView {
  successorId: string;
  name: string;
  providerMask: string;
  /** Rendered only when >1 old account folds in — the fact the flat list hid. */
  combinesLine: string | null;
  /** Rendered only when this "live" account was ITSELF later combined into another one. */
  chainedLine: string | null;
  sources: ContinuedSourceView[];
}

/**
 * The audit sentence, or null.
 *
 * Only `unsupported` speaks. The other three verdicts are silent BY DESIGN and the distinction is
 * the whole point: `not-checkable` is the detector abstaining on a shape it does not judge, and
 * rendering an abstention as a warning would flag every same-connection link in the app; `inert`
 * already has no effect on any figure; `still-supported` is the ordinary case.
 *
 * The sentence names the APP as its subject ("we wouldn't suggest") and then reports the evidence
 * as fact. It deliberately does not say the accounts are different, does not tell the reader to
 * undo, and does not call the earlier decision a mistake — the reader confirmed this pair and may
 * know something no feed carries. Compare `chainedLine` above, which likewise states a mechanism
 * and leaves the judgement alone.
 */
function auditLineFor(r: ReconciledPairView): string | null {
  if (r.auditVerdict !== 'unsupported') return null;
  const why = r.auditEvidence.filter((e) => e.trim().length > 0);
  // States the FACT, not a recommendation and not a verdict on the accounts. An earlier draft
  // opened "we wouldn't suggest combining these two", which is a claim about what the detector
  // would do — and after U.14 was reverted the detector often WOULD still suggest it, so the
  // sentence would have been false exactly where it mattered most.
  const because = why.length > 0 ? ` ${why.join('; ')}.` : '';
  return `Worth a look:${because} If these aren’t the same account, undo below — nothing else about them changes.`;
}

interface Draft {
  view: ContinuedSourceView;
  /** What the Undo reverses, in words — appended after the face is final. */
  ariaTail: string;
  /** How many old accounts its own block folds in. */
  siblings: number;
  /** Card-wide 0-based position. The only tiebreaker that cannot be forged by a name. */
  i: number;
}

/**
 * Card-wide view. Groups by successor in first-appearance order; sources keep payload order.
 *
 * Known limitation (same class as #296's connection ordinals): "old account N of M" is POSITIONAL
 * over the payload, so two links created in the same database second have an unspecified order, and
 * undoing one RENUMBERS the survivors. The numbers are therefore a within-render index, not a
 * durable name — which is why no copy claims a date order, a link order, or that the number is
 * stable, and why the Undo's accessible name always carries the account NAME as well.
 */
export function continuedAccountsView(
  rows: readonly ReconciledPairView[],
): ContinuedAccountView[] {
  const groups: ContinuedAccountView[] = [];
  const bySuccessor = new Map<string, ContinuedAccountView>();
  const drafts: Draft[] = [];
  // A "successor" that is itself some other link's predecessor is a mid-chain node, NOT a live
  // account — computed from the payload alone, so the module needs no extra input to stay honest.
  const supersededIds = new Set(rows.map((r) => r.predecessor.id));

  rows.forEach((r, i) => {
    let g = bySuccessor.get(r.successor.id);
    if (!g) {
      g = {
        successorId: r.successor.id,
        name: renderSafe(r.successor.name),
        providerMask: renderSafe(providerMask(r.successor)),
        combinesLine: null,
        chainedLine: supersededIds.has(r.successor.id)
          ? 'This account was itself later combined into another one, shown in its own block below. Its balance does not count here.'
          : null,
        sources: [],
      };
      bySuccessor.set(r.successor.id, g);
      groups.push(g);
    }
    const view: ContinuedSourceView = {
      id: r.id,
      key: `${r.id}#${i}`,
      n: g.sources.length + 1,
      name: renderSafe(r.predecessor.name),
      providerMask: renderSafe(providerMask(r.predecessor)),
      identityLine: '', // filled below, once the group's total is known
      undoLabel: '',
      undoAriaLabel: '',
      auditLine: auditLineFor(r),
    };
    g.sources.push(view);
    drafts.push({
      view,
      // States a fact about the PREDECESSOR — true in every state, including chains and a
      // disconnected successor. Never claims where the balance went.
      ariaTail: `separate ${view.name} (${view.providerMask}) from ${g.name} (${g.providerMask}); that old account counts on its own again`,
      siblings: 0, // set below
      i,
    });
  });

  for (const g of groups) {
    const m = g.sources.length;
    g.combinesLine =
      m > 1
        ? `Combines ${m} old accounts into this one. Each is listed below and can be undone on its own.`
        : null;
    for (const d of drafts) if (g.sources.includes(d.view)) d.siblings = m;
  }

  for (const d of drafts) {
    const s = d.view;
    const m = d.siblings;
    const who =
      m > 1
        ? `Old account ${s.n} of ${m}: ${s.name} (${s.providerMask})`
        : `Continued from your old account ${s.name} (${s.providerMask})`;
    // U.17: this module carries no claim span (see the file header). Any date
    // printed here is the stored cutover, which is not claimEnd when last <
    // cutover and is not last-used when cutover < last. The proveable money
    // fact is the zeroed balance. Distinctness is the predecessor name +
    // "Old account N of M", not a date this payload cannot interpret.
    s.identityLine = `${who} — this old account's balance no longer counts on its own.`;
    // A bare "Undo" is honest ONLY when it is the card's single Undo; otherwise the face must name
    // its object BEFORE the tap (#296). The ordinal is included only where the block actually
    // enumerates (m > 1), so no button claims an "old account 1" the block never numbered.
    s.undoLabel =
      drafts.length === 1
        ? 'Undo'
        : m > 1
          ? `Undo old account ${s.n}: ${s.name}`
          : `Undo: ${s.name}`;
  }

  numberEveryControl(drafts);
  for (const d of drafts) d.view.undoAriaLabel = `${d.view.undoLabel} — ${d.ariaTail}`;
  return groups;
}

/**
 * The uniqueness guarantee. The previous approach — append "(copy N)" to the tied labels — was
 * falsified by a critic with an executed repro: the rewrite writes INTO the same string space it
 * compares, so a predecessor literally named "Venture (copy 1)" ties with a rewritten "Venture"
 * (39/4000 random seeds over a 7-name alphabet). Appending can always be chased by a crafted name.
 *
 * So: if ANY two faces tie, number EVERY control by its card-wide position, as a PREFIX.
 *
 * Why that cannot be forged, for any input: each label becomes `${i}. ${label}` where `i` is a
 * distinct decimal. For i != j the strings decimal(i) and decimal(j) are either different at some
 * digit, or one is a strict prefix of the other — and in that case the shorter one is followed by
 * '.' while the longer has a DIGIT in that position. A digit is never '.', so the labels differ at
 * a fixed offset regardless of what follows. Names cannot reach that offset, so no name can create
 * a tie. One pass, no iteration, no fixed point to chase.
 *
 * The number is also prefixed onto `identityLine`, so the discriminator the user is asked to read
 * is anchored in the prose beside the button and not invented on the control alone (critic P2).
 */
function numberEveryControl(drafts: readonly Draft[]): void {
  const faces = drafts.map((d) => d.view.undoLabel);
  if (new Set(faces).size === faces.length) return;
  for (const d of drafts) {
    d.view.undoLabel = `${d.i + 1}. ${d.view.undoLabel}`;
    d.view.identityLine = `${d.i + 1}. ${d.view.identityLine}`;
  }
}
