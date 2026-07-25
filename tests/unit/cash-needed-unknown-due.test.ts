/**
 * test_regression__card_with_no_statement_is_not_reported_as_nothing_due
 * (owner-reported 2026-07-23, real Chase/Capital One cards linked via Plaid).
 *
 * The dashboard said "No card payments are due this cycle." while the owner had
 * card balances, and /cards listed NO cards at all. Root cause in the engine:
 * `buildObligation` returns null for a card with no generated statement AND no
 * cycle days ("nothing knowable about this card"), and the caller dropped that
 * null on the floor — so a card whose issuer never sent liabilities became
 * indistinguishable from a paid-off card, and the empty set was rendered as the
 * positive money claim "nothing is due".
 *
 * A Plaid card hits this by construction: the liabilities sync writes a Statement
 * or nothing, and the only writer of `cycleCloseDayOfMonth` is the user's own card
 * settings form — so the "estimate path" fallback can never fire for a linked card
 * whose bank returned no statement.
 *
 * The engine now carries those cards out in `unknownDueDateCards`, still excluded
 * from every total (we must not invent a figure), so each surface can say the true
 * thing: we don't know when this is due.
 */
import { describe, expect, it } from 'vitest';
import { computeCashNeeded } from '@/lib/engine/cash-needed/engine';
import {
  undatedCardsWithBalance,
  type CardSnapshot,
  type CashNeededInput,
  type CashNeededResult,
} from '@/lib/engine/cash-needed/types';
import { holidayTable, isoDate } from '@/lib/dates';
import { assembleCashNeededInput } from '@/lib/engine/cash-needed/assemble';
import { cents } from '@/lib/money';

const TODAY = isoDate('2026-07-23');

function input(cards: CardSnapshot[]): CashNeededInput {
  return {
    today: TODAY,
    paymentAccount: { name: 'Everyday Checking', balanceCents: cents(250000), pending: [], frozenSince: null },
    cards,
    scheduled: [],
    scenario: 'PAY_IN_FULL',
    holidayTable: [],
  };
}

/** A linked card with a balance, no statement, and no cycle days — the owner's case. */
function undatableCard(over: Partial<CardSnapshot> = {}): CardSnapshot {
  return {
    id: 'card-chase',
    name: 'Chase Sapphire',
    aprBps: 2499,
    autopay: null,
    statement: null,
    currentBalanceCents: cents(184267),
    paymentsAppliedCents: cents(0),
    ...over,
  };
}

/** A normal card with a generated statement. */
function datedCard(over: Partial<CardSnapshot> = {}): CardSnapshot {
  return {
    id: 'card-amex',
    name: 'Amex Gold',
    aprBps: 2199,
    autopay: null,
    statement: {
      statementBalanceCents: cents(50000),
      minimumPaymentCents: cents(3500),
      dueDate: isoDate('2026-08-05'),
      cycleEnd: isoDate('2026-07-10'),
    },
    currentBalanceCents: cents(50000),
    paymentsAppliedCents: cents(0),
    ...over,
  };
}

describe('cash-needed: a card with nothing knowable is reported, not silently dropped', () => {
  it('does NOT claim nothing is due when the only card has no statement and no cycle days', () => {
    const result = computeCashNeeded(input([undatableCard()]));

    // The pre-fix behaviour that produced the false claim: no obligations at all.
    expect(result.headline.byDate).toBeNull();
    expect(result.cards).toHaveLength(0);

    // The fix: the card is carried out so no surface can render silence as
    // "nothing is due".
    expect(result.unknownDueDateCards).toEqual([
      {
        cardId: 'card-chase',
        cardName: 'Chase Sapphire',
        currentBalanceCents: cents(184267),
        // TASKS L.18: the flag rides out with the card, so the surfaces that print this balance
        // can say when it stopped moving. Null here — this card is undatable, not unshared.
        frozenSince: null,
      },
    ]);
  });

  it('never folds an undatable balance into any figure (no invented due amount)', () => {
    const result = computeCashNeeded(input([undatableCard()]));
    expect(result.headline.requiredCents).toBe(cents(0));
    expect(result.headline.cardsDueCount).toBe(0);
    expect(result.headline.shortfallCents).toBe(cents(0));
    expect(result.perDueDate).toHaveLength(0);
    expect(result.upcoming).toHaveLength(0);
  });

  it('reports the undatable card alongside a normal one without disturbing it', () => {
    const result = computeCashNeeded(input([datedCard(), undatableCard()]));

    // The datable card still answers exactly as before.
    expect(result.headline.byDate).toBe(isoDate('2026-08-05'));
    expect(result.headline.requiredCents).toBe(cents(50000));
    expect(result.cards.map((c) => c.cardId)).toEqual(['card-amex']);

    // …and the undatable one is still surfaced rather than hidden behind it.
    expect(result.unknownDueDateCards.map((c) => c.cardId)).toEqual(['card-chase']);
  });

  it('lists every undatable card, in input order', () => {
    const result = computeCashNeeded(
      input([
        undatableCard(),
        undatableCard({ id: 'card-cap1', name: 'Capital One Venture', currentBalanceCents: cents(90050) }),
      ]),
    );
    expect(result.unknownDueDateCards.map((c) => c.cardName)).toEqual([
      'Chase Sapphire',
      'Capital One Venture',
    ]);
    expect(result.unknownDueDateCards[1]!.currentBalanceCents).toBe(cents(90050));
  });

  it('is EMPTY for a card on the estimate path (cycle days known) — that card is datable', () => {
    const result = computeCashNeeded(
      input([
        undatableCard({
          nextCycleCloseDate: isoDate('2026-08-02'),
          nextDueDate: isoDate('2026-08-27'),
        }),
      ]),
    );
    expect(result.unknownDueDateCards).toEqual([]);
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]!.isEstimated).toBe(true);
  });

  it('is EMPTY when there are genuinely no cards (the real "nothing due" case)', () => {
    const result = computeCashNeeded(input([]));
    expect(result.headline.byDate).toBeNull();
    expect(result.unknownDueDateCards).toEqual([]);
  });

  it('is EMPTY for a fully paid card — paid off is not the same as unknown', () => {
    const result = computeCashNeeded(
      input([
        datedCard({
          statement: {
            statementBalanceCents: cents(50000),
            minimumPaymentCents: cents(3500),
            dueDate: isoDate('2026-08-05'),
            cycleEnd: isoDate('2026-07-10'),
          },
          paymentsAppliedCents: cents(50000),
        }),
      ]),
    );
    expect(result.headline.byDate).toBeNull(); // nothing to pay
    expect(result.unknownDueDateCards).toEqual([]); // …and nothing unknown
    expect(result.cards).toHaveLength(1); // the card itself still shows
  });
});

/**
 * critic cycle 2, P0-1 — the counter-lock. An earlier attempt at F-7 relaxed the
 * estimate path to fire on a due day ALONE. The critic executed the repro: with no
 * close day and dueDay 25 on 2026-07-23 the engine dated the card 2026-07-24 (a
 * month early), invented an $842.67 shortfall, and told the user to move $850 into
 * checking that day — while disclosing the guessed date as the issuer's. Reverted.
 * A card we cannot anchor stays undatable and says so.
 */
describe('cash-needed: a due day ALONE never fabricates a date', () => {
  const HOLIDAYS = holidayTable(2026, 2027);

  function params(card: { dueDayOfMonth: number | null; cycleCloseDayOfMonth: number | null }) {
    return {
      today: TODAY,
      scenario: 'PAY_IN_FULL' as const,
      paymentAccountId: 'chk',
      accounts: [
        { id: 'chk', name: 'Checking', type: 'CHECKING', currentBalanceCents: 100000, aprBps: null, dueDayOfMonth: null, cycleCloseDayOfMonth: null },
        { id: 'cardA', name: 'Chase Sapphire', type: 'CREDIT', currentBalanceCents: 184267, aprBps: 2499, ...card },
      ],
      autopays: [],
      statements: [],
      cardPayments: [],
      transactions: [],
      scheduled: [],
      holidayTable: HOLIDAYS,
    };
  }

  it('stays undatable with a due day but no close day — no date, no shortfall, no advice', () => {
    const r = computeCashNeeded(
      assembleCashNeededInput(params({ dueDayOfMonth: 25, cycleCloseDayOfMonth: null })),
    );
    expect(r.cards).toEqual([]);
    expect(r.headline.byDate).toBeNull();
    expect(r.headline.shortfallCents).toBe(cents(0));
    expect(r.headline.recommendation).toBeNull();
    expect(r.unknownDueDateCards.map((c) => c.cardName)).toEqual(['Chase Sapphire']);
    // The guessed-date disclosure must not exist either.
    expect(r.assumptions.join(' ')).not.toContain('falls on a weekend');
  });

  it('dates it correctly once the close day is known (the anchored case)', () => {
    const r = computeCashNeeded(
      assembleCashNeededInput(params({ dueDayOfMonth: 25, cycleCloseDayOfMonth: 2 })),
    );
    // Next close 2026-08-02 → next 25th after 08-03 is 2026-08-25, NOT 2026-07-24.
    expect(r.cards[0]!.dueDate).toBe('2026-08-25');
    expect(r.unknownDueDateCards).toEqual([]);
  });

  it('remains undatable when the issuer reported neither day', () => {
    const r = computeCashNeeded(
      assembleCashNeededInput(params({ dueDayOfMonth: null, cycleCloseDayOfMonth: null })),
    );
    expect(r.cards).toEqual([]);
    expect(r.unknownDueDateCards.map((c) => c.cardName)).toEqual(['Chase Sapphire']);
  });
});

/**
 * #277-critic (TASKS L.4) — the shared "worth mentioning" fence.
 *
 * The engine carries EVERY undatable card in `unknownDueDateCards` (so /cards can
 * still list a $0 paid-off card — #277 made connected cards visible). But a
 * surface that frames an undatable card as a WITHHELD OBLIGATION must exclude a
 * $0 card: it owes nothing, so "we're leaving a card out of what you owe" is a
 * false alarm — the mirror of the false all-clear. `undatedCardsWithBalance` is
 * the ONE definition of that fence, shared by the hero, the number/mixed branch,
 * the nudge, the payment-reminders count and the weekly digest so they cannot
 * drift into contradicting each other on one screen (they had — three surfaces).
 */
describe('undatedCardsWithBalance — the shared withheld-obligation fence', () => {
  const card = (cardId: string, cardName: string, currentBalanceCents: number) => ({
    cardId,
    cardName,
    currentBalanceCents: cents(currentBalanceCents),
  });
  const resultWith = (cards: ReturnType<typeof card>[]): CashNeededResult =>
    ({ unknownDueDateCards: cards }) as unknown as CashNeededResult;

  it('drops a $0 paid-off undatable card', () => {
    const r = resultWith([card('a', 'Paid Off', 0), card('b', 'Sapphire', 184267)]);
    expect(undatedCardsWithBalance(r).map((c) => c.cardName)).toEqual(['Sapphire']);
  });

  it('keeps a positive balance (owed)', () => {
    const r = resultWith([card('a', 'Sapphire', 184267)]);
    expect(undatedCardsWithBalance(r)).toHaveLength(1);
  });

  it('keeps a negative balance (credit / overpaid) — still a real undatable card, matching the hero panel', () => {
    const r = resultWith([card('a', 'Overpaid', -5000)]);
    expect(undatedCardsWithBalance(r).map((c) => c.cardName)).toEqual(['Overpaid']);
  });

  it('is empty when every undatable card is $0 — no surface frames a withheld obligation', () => {
    const r = resultWith([card('a', 'Paid Off', 0), card('b', 'Closed', 0)]);
    expect(undatedCardsWithBalance(r)).toEqual([]);
  });
});
