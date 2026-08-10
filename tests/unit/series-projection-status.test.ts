/**
 * L.30 — every reason a repeating series is or is not projected, named.
 *
 * The defect this locks: `toScheduledTransactions` decided admission with two
 * `.filter`s and threw the REASON away, so "Fixed & recurring expenses — $0.00"
 * meant four different things and printed one line. That is how the L.26 defect
 * (every bill re-keyed onto a superseded predecessor the scope excludes) read
 * $0.00 through four sessions of the owner looking straight at it.
 *
 * The central invariant here is not any single label: it is that
 * `classifySeriesProjection` returning 'counted' and `toScheduledTransactions`
 * emitting a row are THE SAME DECISION. If they can ever disagree, the stored
 * reason becomes a second opinion about the money, which is worse than no reason
 * at all.
 */
import { describe, expect, it } from 'vitest';
import { isoDate } from '@/lib/dates';
import {
  type RecurringSeriesResult,
  classifySeriesProjection,
  toScheduledTransactions,
} from '@/lib/engine/recurring/detect';

const TODAY = isoDate('2026-07-27');
const CHECKING = 'acct-checking';
const SAVINGS = 'acct-savings';
const CARD = 'acct-card';
const GHOST = 'acct-superseded';

const scope = {
  paymentAccountId: CHECKING,
  cashAccountIds: new Set([CHECKING, SAVINGS]),
  creditAccountIds: new Set([CARD]),
};

const series = (over: Partial<RecurringSeriesResult> = {}): RecurringSeriesResult => ({
  merchantCanonical: 'principal insurance',
  categoryId: 'insurance',
  cadence: 'MONTHLY',
  typicalAmountCents: -14640,
  lastAmountCents: -14640,
  previousAmountCents: null,
  priceChangedAt: null,
  lastSeenAt: isoDate('2026-07-20'),
  nextExpectedAt: isoDate('2026-08-20'),
  occurrences: 6,
  occurrenceRows: [], // evidence rows are out of scope here — the projection status is what is under test
  isSubscription: false,
  isIncome: false,
  possiblyUnused: false,
  accountId: CHECKING,
  declaredByUser: false,
  ...over,
});

describe('classifySeriesProjection — the closed set of reasons', () => {
  it("'counted': an ordinary monthly bill on any cash account", () => {
    expect(classifySeriesProjection(series(), scope, TODAY)).toBe('counted');
    // The L.25 widening: expenses come from EVERY cash account, not just the
    // resolved payment account.
    expect(classifySeriesProjection(series({ accountId: SAVINGS }), scope, TODAY)).toBe('counted');
  });

  it("'on-card': a bill charged to a credit card is CORRECTLY absent", () => {
    // The card-payments term already holds it. This is the branch that lets the
    // label point at Spending for Fixed categories — not claim the card bill holds it.
    expect(classifySeriesProjection(series({ accountId: CARD }), scope, TODAY)).toBe('on-card');
  });

  it("'off-scope': the ALARM — a real bill on an account the projection cannot read", () => {
    // The L.26 signature: a re-link leaves the series keyed to the superseded
    // predecessor, which is in neither the cash set nor the credit set.
    expect(classifySeriesProjection(series({ accountId: GHOST }), scope, TODAY)).toBe('off-scope');
    // And the second mechanism that reaches the same alarm: an auto-loan ACH may
    // only be projected from the PAYMENT account (it does not widen), so on a
    // second checking it is dropped — and `SpendingPlanInput` has no loan term of
    // any kind, so nothing else in the plan holds it either.
    expect(
      classifySeriesProjection(series({ categoryId: 'auto-loan', accountId: SAVINGS }), scope, TODAY),
    ).toBe('off-scope');
    // Same series on the payment account IS counted — so the alarm is about
    // WHERE it charges, never about the category.
    expect(
      classifySeriesProjection(series({ categoryId: 'auto-loan', accountId: CHECKING }), scope, TODAY),
    ).toBe('counted');
  });

  it("'lapsed': a long-rhythm series that has stopped charging is CORRECTLY absent", () => {
    const annual = series({ cadence: 'ANNUAL', lastSeenAt: isoDate('2021-03-01') });
    expect(classifySeriesProjection(annual, scope, TODAY)).toBe('lapsed');
    // Still charging → counted, at the same cadence. The lapse gate is
    // `isSeriesActive`, shared with /recurring so the two cannot drift (L.23).
    expect(
      classifySeriesProjection(series({ cadence: 'ANNUAL', lastSeenAt: isoDate('2026-03-01') }), scope, TODAY),
    ).toBe('counted');
  });

  it('the CADENCE reason wins over the ACCOUNT reason, and can never mask the alarm', () => {
    // Both apply: a lapsed annual policy that also sits on a ghost account. The
    // honest reason is the lapse — a series that should not be counted at all
    // cannot be the victim of a scope defect, and calling it one is a false alarm
    // on a figure the reader may spend against.
    expect(
      classifySeriesProjection(
        series({ cadence: 'ANNUAL', lastSeenAt: isoDate('2021-03-01'), accountId: GHOST }),
        scope,
        TODAY,
      ),
    ).toBe('lapsed');
    // Safe ONLY because the lapse gate reaches the long cadences alone: a MONTHLY
    // bill on a ghost account, however stale, still raises the alarm. This is the
    // case the alarm exists for, so it is pinned rather than assumed.
    expect(
      classifySeriesProjection(
        series({ cadence: 'MONTHLY', lastSeenAt: isoDate('2019-01-01'), accountId: GHOST }),
        scope,
        TODAY,
      ),
    ).toBe('off-scope');
  });

  it("'long-cadence-income' and the income asymmetry are reasons, not silence", () => {
    const bonus = series({ isIncome: true, typicalAmountCents: 250000, cadence: 'ANNUAL' });
    expect(classifySeriesProjection(bonus, scope, TODAY)).toBe('long-cadence-income');
    // Income keeps the payment-account scope it always had (L.25): a deposit
    // landing in savings is a DELIBERATE absence. It reports 'off-scope' like the
    // alarm does — which is exactly why the census counts EXPENSES only, or a
    // correct income absence would read as a missing bill.
    expect(
      classifySeriesProjection(
        series({ isIncome: true, typicalAmountCents: 250000, accountId: SAVINGS }),
        scope,
        TODAY,
      ),
    ).toBe('off-scope');
  });
  it("'no-cash-account' is for a bill that WOULD have needed a cash account", () => {
    const noCash = { paymentAccountId: null, cashAccountIds: new Set<string>(), creditAccountIds: new Set([CARD]) };
    expect(classifySeriesProjection(series(), noCash, TODAY)).toBe('no-cash-account');

    // ...but NOT for a bill charged to a card, even with no cash account anywhere.
    // The first cut let 'no-cash-account' outrank everything, so a reader who had
    // linked only credit cards, with every bill charged to them, was told "no
    // checking or savings account linked" beside a control that provably cannot move
    // the figure: literally true, wrong mechanism, since the card-payment term is
    // what holds those bills (copy critic P2-1, executed).
    expect(classifySeriesProjection(series({ accountId: CARD }), noCash, TODAY)).toBe('on-card');

    // And a LAPSED card bill stays 'lapsed', not 'on-card': nothing is charging, so
    // no line holds it and 'on-card' would over-claim. That is why the cadence gate
    // still runs before the card check.
    expect(
      classifySeriesProjection(
        series({ accountId: CARD, cadence: 'ANNUAL', lastSeenAt: isoDate('2021-03-01') }),
        noCash,
        TODAY,
      ),
    ).toBe('lapsed');
  });

    it("'unrecognized-rhythm' exists so the function is total, and no stored row can carry it", () => {
    // `detectRecurring` drops IRREGULAR before this function ever sees one, which
    // is why no census field branches on it. Pinned so a future change that DOES
    // start storing irregular series fails here rather than silently landing in a
    // label that cannot describe it.
    expect(classifySeriesProjection(series({ cadence: 'IRREGULAR' }), scope, TODAY)).toBe(
      'unrecognized-rhythm',
    );
  });
});

describe("the reason and the row are ONE decision — 'counted' iff a row is emitted", () => {
  it('agrees with toScheduledTransactions across every reason, in both directions', () => {
    const population: RecurringSeriesResult[] = [
      series({ merchantCanonical: 'a-counted-checking' }),
      series({ merchantCanonical: 'b-counted-savings', accountId: SAVINGS }),
      series({ merchantCanonical: 'c-on-card', accountId: CARD }),
      series({ merchantCanonical: 'd-off-scope-ghost', accountId: GHOST }),
      series({ merchantCanonical: 'e-lapsed-annual', cadence: 'ANNUAL', lastSeenAt: isoDate('2021-03-01') }),
      series({ merchantCanonical: 'f-live-annual', cadence: 'ANNUAL', lastSeenAt: isoDate('2026-03-01') }),
      series({ merchantCanonical: 'g-irregular', cadence: 'IRREGULAR' }),
      series({ merchantCanonical: 'h-income-counted', isIncome: true, typicalAmountCents: 300000 }),
      series({ merchantCanonical: 'i-income-savings', isIncome: true, typicalAmountCents: 300000, accountId: SAVINGS }),
      series({ merchantCanonical: 'j-income-annual', isIncome: true, typicalAmountCents: 300000, cadence: 'ANNUAL' }),
      series({ merchantCanonical: 'k-auto-loan-savings', categoryId: 'auto-loan', accountId: SAVINGS }),
    ];
    const emitted = new Set(
      toScheduledTransactions(population, { paymentAccountId: CHECKING, cashAccountIds: scope.cashAccountIds }, TODAY).map(
        (r) => r.description,
      ),
    );
    const counted = new Set(
      population.filter((s) => classifySeriesProjection(s, scope, TODAY) === 'counted').map((s) => s.merchantCanonical),
    );
    // The set, spelled out rather than compared to itself: a test that derives
    // both sides from the same call cannot fail (the L.15 `f(x,[])` lesson).
    expect([...counted].sort()).toEqual([
      'a-counted-checking',
      'b-counted-savings',
      'f-live-annual',
      'h-income-counted',
    ]);
    expect([...emitted].sort()).toEqual([...counted].sort());
    // …and every series NOT emitted has a reason that is not 'counted'.
    for (const s of population) {
      const status = classifySeriesProjection(s, scope, TODAY);
      expect(emitted.has(s.merchantCanonical)).toBe(status === 'counted');
    }
  });

  it('an empty credit set changes only the NAME of an absence, never the rows', () => {
    // `toScheduledTransactions` passes an empty credit set on purpose, because it
    // reads no reason. This pins that the choice cannot move the money.
    const population = [series({ accountId: CARD }), series({ merchantCanonical: 'live', accountId: CHECKING })];
    const withCredit = toScheduledTransactions(population, { paymentAccountId: CHECKING, cashAccountIds: scope.cashAccountIds }, TODAY);
    expect(withCredit.map((r) => r.description)).toEqual(['live']);
    expect(classifySeriesProjection(population[0], scope, TODAY)).toBe('on-card');
    expect(
      classifySeriesProjection(population[0], { ...scope, creditAccountIds: new Set<string>() }, TODAY),
    ).toBe('off-scope');
  });
});
