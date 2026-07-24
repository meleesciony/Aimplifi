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

/** Shown when a name sanitizes away to nothing — never an empty control face. */
export const UNNAMED_ACCOUNT = 'Unnamed account';

/**
 * Bidi overrides, zero-width and other default-ignorable characters, plus C0/C1 controls.
 *
 * Account names arrive from a bank feed unmodified (`simplefin.ts:475`, `plaid.ts:344` write the
 * provider's name straight through) and manual names are only `trim()`-ed. Two critic findings turn
 * on this: U+202E reverses the rest of a button face at render time, and U+200B / doubled spaces
 * make two byte-DIFFERENT labels paint IDENTICALLY — defeating any collision check that compares
 * raw strings. Sanitizing once, at construction, makes the rendered string equal the compared
 * string, which is what lets the uniqueness argument below hold on screen and not just in memory.
 */
const INVISIBLE =
  /[\u0000-\u001F\u007F-\u009F\u00AD\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;

export function renderSafe(raw: string): string {
  const cleaned = raw.normalize('NFC').replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();
  return cleaned === '' ? UNNAMED_ACCOUNT : cleaned;
}

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

interface Draft {
  view: ContinuedSourceView;
  /** What the Undo reverses, in words — appended after the face is final. */
  ariaTail: string;
  cutoverDate: string;
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
    };
    g.sources.push(view);
    drafts.push({
      view,
      // States a fact about the PREDECESSOR — true in every state, including chains and a
      // disconnected successor. Never claims where the balance went.
      ariaTail: `separate ${view.name} (${view.providerMask}) from ${g.name} (${g.providerMask}); that old account counts on its own again`,
      cutoverDate: r.cutoverDate,
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
    s.identityLine = `${who} — history kept through ${d.cutoverDate}; this old account's balance no longer counts on its own.`;
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
