/**
 * `paintedHeroCards` against the REAL cash-needed engine (TASKS L.8).
 *
 * WHY THIS FILE EXISTS. This is the computation that produced #299's P0: the first cut of the
 * /cards disclosure called every row in `result.cards` "counted", when `headline.requiredCents`
 * sums only `cycleObligations` filtered to `cashRequiredCents > 0`, and ESTIMATED obligations are
 * dropped wholesale as soon as any one card has a real statement (`engine.ts:214-223`). The result
 * was copy telling a reader with a $217.99 headline that it was inflated by two $6,679.68 rows it
 * did not contain — which could send them to move cash they do not owe.
 *
 * L.8 repeated that computation on the dashboard hero, and a fresh-context critic pointed out it
 * lived INLINE IN A REACT COMPONENT, so its only coverage was a Playwright spec — and
 * `scripts/verify.sh` skips Playwright unless `VERIFY_E2E=1`. The one piece of the slice with a
 * proven history of being wrong had no coverage in the gate that actually runs. So it was extracted
 * to a pure function and is driven here, by the engine itself rather than by hand-written rows.
 *
 * THE INVARIANT, asserted in every scenario: the rows marked `counted` sum EXACTLY to
 * `headline.requiredCents`. Not "looks about right" — equal, in integer cents. Everything else in
 * the disclosure is downstream of that one fact being true.
 */
import { describe, expect, it } from 'vitest';

import { paintedHeroCards } from '@/components/finance/card-duplicate-view';
import { computeCashNeeded } from '@/lib/engine/cash-needed/engine';
import type { CashNeededInput, CardSnapshot } from '@/lib/engine/cash-needed/types';
import { isoDate } from '@/lib/dates';
import { cents } from '@/lib/money';

const TODAY = isoDate('2026-07-24');

/** A card with a REAL generated statement — the "this cycle" kind. */
function dated(id: string, name: string, statementCents: number, dueDate: string): CardSnapshot {
  return {
    id,
    name,
    aprBps: 0,
    autopay: null,
    statement: {
      statementBalanceCents: cents(statementCents),
      minimumPaymentCents: cents(Math.round(statementCents / 100)),
      dueDate: isoDate(dueDate),
      cycleEnd: isoDate('2026-07-08'),
    },
    currentBalanceCents: cents(statementCents),
    paymentsAppliedCents: cents(0),
  };
}

/** No statement, but both cycle days — the engine ESTIMATES a next-cycle obligation. */
function estimated(id: string, name: string, balanceCents: number): CardSnapshot {
  return {
    id,
    name,
    aprBps: 0,
    autopay: null,
    statement: null,
    currentBalanceCents: cents(balanceCents),
    nextCycleCloseDate: isoDate('2026-08-08'),
    nextDueDate: isoDate('2026-09-05'),
    paymentsAppliedCents: cents(0),
  };
}

/** No statement and no cycle days — undatable. Lands in `unknownDueDateCards`. */
function undatable(id: string, name: string, balanceCents: number): CardSnapshot {
  return {
    id,
    name,
    aprBps: 0,
    autopay: null,
    statement: null,
    currentBalanceCents: cents(balanceCents),
    paymentsAppliedCents: cents(0),
  };
}

function run(cards: CardSnapshot[]): ReturnType<typeof computeCashNeeded> {
  const input: CashNeededInput = {
    today: TODAY,
    scenario: 'PAY_IN_FULL',
    paymentAccount: { name: 'Everyday Checking', balanceCents: cents(5_000_000), pending: [] },
    cards,
    scheduled: [],
    holidayTable: [],
  };
  return computeCashNeeded(input);
}

/** THE invariant: what the hero calls counted is exactly what the headline contains. */
function assertCountedSumsToHeadline(result: ReturnType<typeof computeCashNeeded>): void {
  const counted = paintedHeroCards(result).filter((r) => r.role.counted);
  const sum = counted.reduce((s, r) => s + (r.role.counted ? r.role.cents : 0), 0);
  expect(sum).toBe(result.headline.requiredCents);
}

describe('paintedHeroCards — counted means IN the headline, in every engine state (TASKS L.8)', () => {
  it('all-estimated: the duplicated pair IS the cycle, so both are counted', () => {
    // No card has a real statement, so `cycleObligations = estimated` and `upcoming` is empty.
    // This is the owner's reported shape and the one the e2e drives.
    const result = run([estimated('a', 'CREDIT CARD', 667_968), estimated('b', 'CREDIT CARD', 667_968)]);
    const rows = paintedHeroCards(result);
    expect(rows.filter((r) => r.role.counted)).toHaveLength(2);
    assertCountedSumsToHeadline(result);
  });

  it('mixed real + estimated: the estimated pair is NOT counted — #299 P0 exactly', () => {
    // One real statement flips `upcoming` on, and the estimated pair leaves the total entirely.
    // The old /cards copy claimed a $217.99 headline was inflated by two $6,679.68 rows.
    const result = run([
      dated('z', 'Bonvoy', 21_799, '2026-07-31'),
      estimated('a', 'CREDIT CARD', 667_968),
      estimated('b', 'CREDIT CARD', 667_968),
    ]);
    const rows = paintedHeroCards(result);
    expect(result.headline.requiredCents).toBe(21_799);
    expect(rows.filter((r) => r.role.counted).map((r) => r.cardId)).toEqual(['z']);
    for (const id of ['a', 'b']) {
      const row = rows.find((r) => r.cardId === id)!;
      expect(row.role).toEqual({ counted: false, reason: 'next-cycle' });
    }
    assertCountedSumsToHeadline(result);
  });

  it('a $0 dated card is painted NOWHERE — it is in no total and no list', () => {
    // `engine.ts:220` filters `cashRequiredCents > 0` out of `due`, so it never reaches
    // `perDueDate`. Naming it would send the reader hunting for a row that is not on screen.
    const result = run([dated('z', 'Bonvoy', 21_799, '2026-07-31'), dated('paid', 'Paid Off', 0, '2026-07-31')]);
    expect(paintedHeroCards(result).map((r) => r.cardId)).toEqual(['z']);
    assertCountedSumsToHeadline(result);
  });

  it('undatable cards carrying a balance are painted, and counted by nothing', () => {
    const result = run([
      dated('z', 'Bonvoy', 21_799, '2026-07-31'),
      undatable('a', 'CREDIT CARD', 667_968),
      undatable('b', 'CREDIT CARD', 667_968),
    ]);
    const rows = paintedHeroCards(result);
    for (const id of ['a', 'b']) {
      expect(rows.find((r) => r.cardId === id)!.role).toEqual({ counted: false, reason: 'no-statement' });
    }
    // Paint order: the "Not included" note comes first on the card, so it comes first here.
    expect(rows.map((r) => r.cardId)).toEqual(['a', 'b', 'z']);
    assertCountedSumsToHeadline(result);
  });

  it('a $0 UNDATABLE card is not painted either — it owes nothing, so it is no withheld obligation', () => {
    // `undatedCardsWithBalance` is the shared fence (#277 / L.4): a paid-off undatable card is not
    // "money we are leaving out", and five surfaces once disagreed about that on one dashboard.
    const result = run([dated('z', 'Bonvoy', 21_799, '2026-07-31'), undatable('paid', 'Closed Card', 0)]);
    expect(paintedHeroCards(result).map((r) => r.cardId)).toEqual(['z']);
  });

  it('every counted row carries the SAME cents the hero prints beside that card', () => {
    const result = run([
      dated('z', 'Bonvoy', 21_799, '2026-07-31'),
      dated('v', 'Venture', 925_093, '2026-08-05'),
    ]);
    const rows = paintedHeroCards(result);
    for (const point of result.perDueDate) {
      for (const c of point.cards) {
        expect(rows.find((r) => r.cardId === c.cardId)!.role).toEqual({
          counted: true,
          cents: c.amountCents,
        });
      }
    }
    assertCountedSumsToHeadline(result);
  });

  it('an autopay-covered card is still counted — the cash must be PRESENT either way', () => {
    const card = dated('z', 'Bonvoy', 21_799, '2026-07-31');
    const result = run([{ ...card, autopay: { mode: 'STATEMENT_BALANCE' } }]);
    expect(paintedHeroCards(result).filter((r) => r.role.counted)).toHaveLength(1);
    assertCountedSumsToHeadline(result);
  });

  it('nothing at all: no cards painted, and the invariant still holds at zero', () => {
    const result = run([]);
    expect(paintedHeroCards(result)).toEqual([]);
    assertCountedSumsToHeadline(result);
  });
});
