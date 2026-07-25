/**
 * The /cards duplicate disclosure (TASKS L.6) — the lock on the owner-reported defect of
 * 2026-07-24.
 *
 * His live /cards screen listed one real Chase card twice (two live Plaid connections): two entries
 * both named `CREDIT CARD`, both $6,679.68 due, both $66.00 minimum, both Aug 5 — byte-identical.
 * Both emitted a full obligation, so the "Do this first" instruction and every card total included
 * +$6,679.68 of phantom cash-needed, and the page said nothing at all.
 *
 * FAIL-OLD: before this module the page rendered no disclosure of any kind, so every assertion here
 * fails against the old build by construction.
 *
 * THE CRITIC CASES. A fresh-context hostile critic ran the engine and falsified the first cut of
 * this module, which called every row in `result.cards` "counted": `headline.requiredCents` sums
 * only `cycleObligations` with `cashRequiredCents > 0`, and ESTIMATED obligations are dropped
 * wholesale as soon as any one card has a real statement (`cash-needed/engine.ts:214-223`). A
 * duplicated pair that is merely estimated — or paid off — is painted in the grid with a
 * real-looking figure while contributing nothing. The old copy told that reader a $217.99 headline
 * was inflated by two $6,679.68 rows it did not contain. Those cases are the `next-cycle` and
 * `nothing-due` tests below and they are the reason `role` is a discriminated union rather than a
 * nullable number.
 *
 * Hand-verified expectations; the amounts are his real screenshot figures.
 */
import { describe, expect, it } from 'vitest';

import {
  CARD_DUPLICATE_HOWTO,
  CARD_DUPLICATE_HOWTO_LIST,
  CARD_DUPLICATE_TITLE,
  type CardDuplicatePairInput,
  type CardMoneyRole,
  type DisplayedCardForDuplicates,
  type UncountedReason,
  cardDuplicateBalanceView,
  cardDuplicateListView,
  cardDuplicateView,
} from '@/lib/engine/account/card-duplicate-view';

const counted = (cardId: string, label: string, cents: number): DisplayedCardForDuplicates => ({
  cardId,
  label,
  role: { counted: true, cents },
});
const uncounted = (
  cardId: string,
  label: string,
  reason: UncountedReason,
): DisplayedCardForDuplicates => ({ cardId, label, role: { counted: false, reason } });

/** #192's own output for the reported pair: same last-4, identical balance ⇒ 'high'. */
const pair = (aId: string, bId: string, over: Partial<CardDuplicatePairInput> = {}): CardDuplicatePairInput => ({
  aId,
  bId,
  confidence: 'high',
  reasons: ['same last-4 (0977)'],
  ...over,
});

/** The reported pair: one real card, two live connections, both genuinely in this cycle's total. */
const chase = [
  counted('a', 'CREDIT CARD ····0977', 667_968),
  counted('b', 'CREDIT CARD ····0977', 667_968),
];

describe('cardDuplicateView — the reported both-live, both-counted pair', () => {
  it('discloses the pair, names BOTH sides, and says this cycle counts both', () => {
    const view = cardDuplicateView([pair('a', 'b')], chase);
    expect(view).not.toBeNull();
    expect(view!.title).toBe(CARD_DUPLICATE_TITLE);
    expect(view!.howTo).toBe(CARD_DUPLICATE_HOWTO);
    expect(view!.pairs).toHaveLength(1);
    expect(view!.pairs[0].impact).toContain('$6,679.68');
    expect(view!.pairs[0].impact).toContain("this cycle's figures include both");
    expect(view!.pairs[0].impact).toContain('you owe it once');
  });

  it('never asserts the two rows ARE one card — the detector is a heuristic, not a verdict', () => {
    const view = cardDuplicateView([pair('a', 'b')], chase);
    expect(view!.pairs[0].sentence).toContain('look like');
    expect(view!.pairs[0].sentence).not.toMatch(/\bis the same card\b/);
  });

  it('states that no figure was adjusted — DISCLOSE, never silently subtract (DECISIONS #289)', () => {
    expect(CARD_DUPLICATE_HOWTO).toContain('No figure above has been adjusted');
    expect(CARD_DUPLICATE_HOWTO).toContain('not duplicates');
  });

  it('promises no control it cannot guarantee, and tells the truth about a still-connected copy', () => {
    // Critic P1: the first cut said "you can combine the pair, delete a copy, or mark them as not
    // duplicates". For a BOTH-LIVE pair — the only kind this surface now shows — no combine
    // candidate is ever proposed (duplicates.ts:384 needs the sides to differ in liveness), and a
    // live Plaid row offers Disconnect, not Delete. `duplicate-card-view.ts`'s DUPLICATE_HOWTO
    // exists precisely to stop that trap being re-created.
    expect(CARD_DUPLICATE_HOWTO).not.toContain('combine the pair');
    expect(CARD_DUPLICATE_HOWTO).toContain('two steps');
    expect(CARD_DUPLICATE_HOWTO).toContain('keeps counting');
  });
});

describe('cardDuplicateView — "counted" means IN THE TOTAL, not merely on the page', () => {
  it('does NOT claim inflation for an estimated next-cycle pair (the critic case)', () => {
    // Both painted in the grid with a $6,679.68 "Cash required" line; both excluded from
    // headline.requiredCents because a sibling card has a real statement.
    const view = cardDuplicateView(
      [pair('a', 'b')],
      [uncounted('a', '1. CREDIT CARD', 'next-cycle'), uncounted('b', '2. CREDIT CARD', 'next-cycle')],
    );
    expect(view!.pairs[0].impact).toContain('Neither is in the total above');
    expect(view!.pairs[0].impact).toContain('is an estimate for next cycle, not this one');
    expect(view!.pairs[0].impact).toContain('Nothing above is inflated by this pair');
    expect(view!.pairs[0].impact).not.toContain('include both');
    expect(view!.pairs[0].impact).not.toContain('you owe it once');
  });

  it('does NOT claim inflation for a PAID-OFF duplicated card', () => {
    // engine.ts:220 filters cashRequiredCents > 0 out of the total, so a $0/credit-balance card
    // contributes nothing. The first cut printed "$0.00 … so every figure includes both".
    const view = cardDuplicateView(
      [pair('a', 'b')],
      [uncounted('a', '1. Venture', 'nothing-due'), uncounted('b', '2. Venture', 'nothing-due')],
    );
    expect(view!.pairs[0].impact).toContain('needs no cash this cycle');
    expect(view!.pairs[0].impact).not.toContain('include both');
    expect(view!.pairs[0].impact).not.toContain('$0.00');
  });

  it('handles the ASYMMETRIC case — one real statement, one still an estimate', () => {
    const view = cardDuplicateView(
      [pair('a', 'b')],
      [counted('a', '1. CREDIT CARD', 667_968), uncounted('b', '2. CREDIT CARD', 'next-cycle')],
    );
    expect(view!.pairs[0].impact).toContain('Only “1. CREDIT CARD” is in the total above');
    expect(view!.pairs[0].impact).toContain('is an estimate for next cycle');
    expect(view!.pairs[0].impact).toContain('The total is not inflated');
  });

  it('names the COUNTED side correctly when the uncounted one is listed first', () => {
    const view = cardDuplicateView(
      [pair('a', 'b')],
      [uncounted('a', '1. Venture', 'no-statement'), counted('b', '2. Venture', 925_093)],
    );
    expect(view!.pairs[0].impact).toContain('Only “2. Venture” is in the total above');
    expect(view!.pairs[0].impact).toContain('“1. Venture” has no statement yet');
  });

  it('gives each uncounted side its OWN reason — they are different facts', () => {
    const view = cardDuplicateView(
      [pair('a', 'b')],
      [uncounted('a', '1. Venture', 'no-statement'), uncounted('b', '2. Venture', 'nothing-due')],
    );
    expect(view!.pairs[0].impact).toContain('“1. Venture” has no statement yet');
    expect(view!.pairs[0].impact).toContain('“2. Venture” needs no cash this cycle');
  });
});

describe('cardDuplicateView — the basis is always shown', () => {
  it('renders the detector strength and its reasons', () => {
    const view = cardDuplicateView([pair('a', 'b')], chase);
    expect(view!.pairs[0].basis).toBe('Likely — matched on same last-4 (0977).');
  });

  it('marks a MEDIUM pair as merely possible — it can be two different cards', () => {
    // Reachable: a SimpleFIN row with no mask beside a Plaid row with one cannot disagree on mask,
    // so a shared name token alone can pair two genuinely different cards.
    const view = cardDuplicateView(
      [pair('a', 'b', { confidence: 'medium', reasons: ['shared name (chase)'] })],
      chase,
    );
    expect(view!.pairs[0].basis).toBe('Possible — matched on shared name (chase).');
  });

  it('still states the strength when the detector gave no reasons', () => {
    const view = cardDuplicateView([pair('a', 'b', { reasons: [] })], chase);
    expect(view!.pairs[0].basis).toBe('Likely match.');
  });
});

describe('cardDuplicateView — nothing honest to say ⇒ nothing rendered', () => {
  it('returns null with no pairs', () => {
    expect(cardDuplicateView([], chase)).toBeNull();
  });

  it('drops a pair whose other side is NOT on this page — the reader would hunt for a second entry that is not there', () => {
    expect(
      cardDuplicateView([pair('a', 'checking-1')], [counted('a', 'CREDIT CARD ····0977', 667_968)]),
    ).toBeNull();
  });

  it('drops a self-pair rather than naming one card twice', () => {
    expect(cardDuplicateView([pair('a', 'a')], chase)).toBeNull();
  });

  it('renders one entry for a pair emitted in both orders', () => {
    const view = cardDuplicateView([pair('a', 'b'), pair('b', 'a')], chase);
    expect(view!.pairs).toHaveLength(1);
  });

  it('renders BOTH pairs when a third copy exists', () => {
    const view = cardDuplicateView(
      [pair('a', 'b'), pair('b', 'c')],
      [...chase, counted('c', 'CREDIT CARD 3. ····0977', 667_968)],
    );
    expect(view!.pairs).toHaveLength(2);
    expect(new Set(view!.pairs.map((p) => p.key)).size).toBe(2);
  });
});

describe('cardDuplicateView — the two sides can never be named identically', () => {
  it('reads down the page: the earlier-painted card is named first', () => {
    const view = cardDuplicateView(
      [pair('b', 'a')],
      [counted('a', 'Venture ····6271', 100), counted('b', 'Venture ····9999', 200)],
    );
    expect(view!.pairs[0].sentence).toBe(
      '“Venture ····6271” and “Venture ····9999” look like the same card reaching Aimplifi twice.',
    );
  });

  it('falls back to a positional prefix if a caller hands it two identical labels', () => {
    // The net for the #297/#298 class. With `cardIdentityLabels` computed over the whole displayed
    // list this cannot happen — but a disclosure that named the same string twice would be useless
    // on the one page that issues payment instructions, so it is guaranteed here too.
    const view = cardDuplicateView(
      [pair('a', 'b')],
      [counted('a', 'CREDIT CARD', 100), counted('b', 'CREDIT CARD', 200)],
    );
    expect(view!.pairs[0].sentence).toBe(
      '“1. CREDIT CARD” and “2. CREDIT CARD” look like the same card reaching Aimplifi twice.',
    );
  });

  it('compares the PAINTED string: an invisible character cannot smuggle two identical labels through', () => {
    // U+200B paints as nothing, so these two labels are byte-different and pixel-identical. Raw
    // comparison would call them distinct and skip the breaker (#297: the check must compare what
    // the browser paints).
    const view = cardDuplicateView(
      [pair('a', 'b')],
      [counted('a', 'CREDIT​ CARD', 100), counted('b', 'CREDIT CARD', 200)],
    );
    expect(view!.pairs[0].sentence).toBe(
      '“1. CREDIT CARD” and “2. CREDIT CARD” look like the same card reaching Aimplifi twice.',
    );
  });

  it('breaks a tie in the IMPACT sentence too, not just the headline sentence', () => {
    const roles: CardMoneyRole[] = [{ counted: true, cents: 100 }, { counted: false, reason: 'no-statement' }];
    const view = cardDuplicateView(
      [pair('a', 'b')],
      [
        { cardId: 'a', label: 'CREDIT CARD', role: roles[0] },
        { cardId: 'b', label: 'CREDIT CARD', role: roles[1] },
      ],
    );
    expect(view!.pairs[0].impact).toContain('Only “1. CREDIT CARD”');
    expect(view!.pairs[0].impact).toContain('“2. CREDIT CARD” has no statement yet');
  });
});

/**
 * TASKS L.8 — the same pair on the two DASHBOARD surfaces.
 *
 * #299 shipped the /cards half and recorded this as the open one: the dashboard reads the very
 * obligations /cards reads, so the cash-needed hero is inflated by the same duplicate and the
 * reminders list asks for the same payment twice — and neither said a word, while /cards did.
 *
 * FAIL-OLD: neither builder existed, so this whole block fails to compile against the old source.
 *
 * What is locked here is NOT "a banner appears". It is that each surface makes only the money claim
 * that is TRUE THERE. The hero's undated branch adds up BALANCES; the reminders list states no
 * total at all. Reusing the cycle-total sentences on either would describe a figure the reader
 * cannot see — the #299 P0 in a new place, which is why these are separate builders and why the
 * negative assertions below matter at least as much as the positive ones.
 */
describe('cardDuplicateBalanceView — the hero branch that sums BALANCES (TASKS L.8)', () => {
  const row = (cardId: string, label: string) => ({ cardId, label });

  it('says the total counts it twice — that balance sum really is inflated', () => {
    const view = cardDuplicateBalanceView(
      [pair('a', 'b')],
      [row('a', 'CREDIT CARD ····0977'), row('b', 'CREDIT CARD ····0977 (2)')],
      true,
    );
    expect(view!.pairs).toHaveLength(1);
    expect(view!.pairs[0].sentence).toBe(
      '“CREDIT CARD ····0977” and “CREDIT CARD ····0977 (2)” look like the same card reaching Aimplifi twice.',
    );
    expect(view!.pairs[0].impact).toBe(
      'Both are inside the combined balance stated above, so if these are one card that figure counts it twice.',
    );
    // Never a bare "the total": this branch's description names TWO — this cycle's total, which
    // these cards are explicitly NOT in, and the balance sum, which they are.
    expect(view!.pairs[0].impact).not.toContain('the total above');
  });

  it('claims NO total when the branch printed none — mixed signs print no summable figure', () => {
    // The branch says "A balance on one of these is not an amount we can say is due" when the set
    // mixes a balance owed with a credit. Telling that reader a total is inflated would send them
    // looking for a number that is not on screen.
    const view = cardDuplicateBalanceView(
      [pair('a', 'b')],
      [row('a', 'CREDIT CARD'), row('b', 'Venture')],
      false,
    );
    expect(view!.pairs[0].impact).toBe(
      'No combined balance is stated above, but these are still two rows for what may be one card.',
    );
    expect(view!.pairs[0].impact).not.toContain('counts it twice');
  });

  it('never borrows the cycle-total wording — this branch states no cash-required figure', () => {
    for (const stated of [true, false]) {
      const view = cardDuplicateBalanceView(
        [pair('a', 'b')],
        [row('a', 'CREDIT CARD'), row('b', 'Venture')],
        stated,
      );
      expect(view!.pairs[0].impact).not.toContain('cash required');
      expect(view!.pairs[0].impact).not.toContain('this cycle');
    }
  });

  it('states its basis, like every other surface that prints this heuristic', () => {
    const view = cardDuplicateBalanceView(
      [pair('a', 'b', { confidence: 'medium', reasons: ['shared name: "credit"'] })],
      [row('a', 'CREDIT CARD'), row('b', 'CREDIT CARD (2)')],
      true,
    );
    expect(view!.pairs[0].basis).toBe('Possible — matched on shared name: "credit".');
  });

  it('numbers two rows that paint identically, so the sentence cannot name one card twice', () => {
    const view = cardDuplicateBalanceView(
      [pair('a', 'b')],
      [row('a', 'CREDIT CARD'), row('b', 'CREDIT CARD')],
      true,
    );
    expect(view!.pairs[0].sentence).toBe(
      '“1. CREDIT CARD” and “2. CREDIT CARD” look like the same card reaching Aimplifi twice.',
    );
  });

  it('says nothing when only one side is on this branch — the reader would hunt for a row that is not there', () => {
    // The common real shape: one copy carries a balance and is undated, the other is dated and so
    // is painted by the other branch entirely.
    expect(cardDuplicateBalanceView([pair('a', 'b')], [row('a', 'CREDIT CARD')], true)).toBeNull();
    expect(cardDuplicateBalanceView([pair('a', 'b')], [], true)).toBeNull();
  });

  it('carries the how-to that points at the page which owns the decision', () => {
    const view = cardDuplicateBalanceView([pair('a', 'b')], [row('a', 'A'), row('b', 'B')], true);
    expect(view!.title).toBe(CARD_DUPLICATE_TITLE);
    expect(view!.howTo).toBe(CARD_DUPLICATE_HOWTO);
  });
});

describe('cardDuplicateListView — the reminders list, which states no total (TASKS L.8)', () => {
  const row = (cardId: string, label: string) => ({ cardId, label });

  it('names the duplicated INSTRUCTION, not an inflated figure', () => {
    const view = cardDuplicateListView(
      [pair('a', 'b')],
      [row('a', 'CREDIT CARD ····0977'), row('b', 'CREDIT CARD ····0977 (2)')],
    );
    expect(view!.pairs).toHaveLength(1);
    expect(view!.pairs[0].impact).toBe(
      'Both are listed below with their own amount, so what may be one card is asking to be paid twice. If they are one card, you owe it once.',
    );
  });

  it('never claims a CYCLE — this list carries next-cycle estimates too', () => {
    // A critic ran the engine on the mixed state (one card with a real statement, the duplicated
    // pair with none) and found `selectPaymentReminders` lists both estimated copies while the hero,
    // reading the same pair's roles, calls them next-cycle estimates. The old wording said "this
    // cycle shows two payments", so one dashboard printed two contradictory sentences under one
    // title. What is true here in every state is only that it is being asked for twice.
    const view = cardDuplicateListView([pair('a', 'b')], [row('a', 'A'), row('b', 'B')]);
    expect(view!.pairs[0].impact).not.toContain('cycle');
  });

  it('makes NO claim about any total — this card has none to be right or wrong about', () => {
    const view = cardDuplicateListView([pair('a', 'b')], [row('a', 'A'), row('b', 'B')]);
    expect(view!.pairs[0].impact).not.toContain('total');
    expect(view!.howTo).not.toContain('above');
  });

  it('points DOWN the page, because that is where its rows are', () => {
    const view = cardDuplicateListView([pair('a', 'b')], [row('a', 'A'), row('b', 'B')]);
    expect(view!.howTo).toBe(CARD_DUPLICATE_HOWTO_LIST);
    expect(view!.howTo).toContain('No amount below has been adjusted');
    // The way out still exists and is still named — it just lives on /accounts (one dismiss
    // control, honoured server-side before any of these surfaces render).
    expect(view!.howTo).toContain('not duplicates');
  });

  it('says nothing when only one copy is on the list — a $0 twin earns no reminder row', () => {
    // `selectPaymentReminders` drops obligations with nothing due, so the pair can be real while
    // only one side is listed. Nothing is duplicated on this surface, so nothing is claimed.
    expect(cardDuplicateListView([pair('a', 'b')], [row('a', 'CREDIT CARD')])).toBeNull();
  });

  it('emits one row per pair even if the detector hands it over twice', () => {
    const view = cardDuplicateListView(
      [pair('a', 'b'), pair('b', 'a')],
      [row('a', 'A'), row('b', 'B')],
    );
    expect(view!.pairs).toHaveLength(1);
  });

  it('numbers rows that paint identically, and states its basis', () => {
    const view = cardDuplicateListView(
      [pair('a', 'b', { confidence: 'high', reasons: ['same last-4 (0977)', 'identical balance'] })],
      [row('a', 'CREDIT CARD'), row('b', 'CREDIT CARD')],
    );
    expect(view!.pairs[0].sentence).toBe(
      '“1. CREDIT CARD” and “2. CREDIT CARD” look like the same card reaching Aimplifi twice.',
    );
    expect(view!.pairs[0].basis).toBe('Likely — matched on same last-4 (0977), identical balance.');
  });
});
