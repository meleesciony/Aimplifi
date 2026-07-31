/**
 * O.13f / O.15 slice 4 — the reader's own verdict on what is a bill.
 *
 * Two levers, and the tests are written around what each one is allowed to do to
 * MONEY: a declaration may add exactly one claim (the rhythm) and must read every
 * cent and date off charges that really happened; a demotion must remove the series
 * from the projection entirely, because it is the only recourse against a false
 * detection. Everything else — the amount, the anchor, the next date, the category,
 * the sign — comes from the same code path detection uses, and the last group of
 * tests is the one that proves it: with no instructions, this file's fixtures detect
 * exactly as they did before the feature existed.
 */
import { describe, expect, it } from 'vitest';
import { isoDate } from '@/lib/dates';
import {
  type RecurringTxn,
  detectRecurring,
  isSeriesActive,
  toScheduledTransactions,
} from '@/lib/engine/recurring/detect';
import { summarizeRecurring } from '@/lib/engine/recurring/summary';
import {
  DECLARABLE_CADENCES,
  NO_RECURRING_OVERRIDES,
  type RecurringOverrideInput,
  buildOverrideMap,
  isDeclarableCadence,
  overrideKey,
  parseRecurringOverride,
  verdictEffect,
} from '@/lib/engine/recurring/override';

const TODAY = isoDate('2026-06-10');
const CHECKING = 'acct-checking';

/** Canonical names, verified against `normalizeMerchant` rather than assumed:
 *  'LAKESIDE PROPERTY MGMT RENT' → 'Lakeside Property Mgmt Rent' (category `rent`),
 *  'SUPERCUTS 4412' → 'Supercuts' (category `personal-care`). */
const RENT_DESC = 'LAKESIDE PROPERTY MGMT RENT';
const RENT_CANONICAL = 'Lakeside Property Mgmt Rent';
const HAIRCUT_DESC = 'SUPERCUTS 4412';
const HAIRCUT_CANONICAL = 'Supercuts';

const txn = (date: string, amountCents: number, rawDescriptor: string): RecurringTxn => ({
  id: `${rawDescriptor}-${date}`,
  accountId: CHECKING,
  date,
  amountCents,
  rawDescriptor,
});

const bill = (
  merchantCanonical: string,
  cadence: RecurringOverrideInput['cadence'],
  declaredSign: RecurringOverrideInput['declaredSign'] = 'OUT',
): RecurringOverrideInput => ({
  merchantCanonical,
  decision: 'BILL',
  cadence,
  declaredSign,
});
const notABill = (merchantCanonical: string): RecurringOverrideInput => ({
  merchantCanonical,
  decision: 'NOT_BILL',
  cadence: null,
  declaredSign: null,
});

/** One rent charge. The whole point of a declaration: detection needs three. */
const ONE_RENT = [txn('2026-05-15', -125000, RENT_DESC)];

/** Three haircuts 84 and 98 days apart — the L.24 money critic's counterexample,
 *  which is IRREGULAR by the spread rule and so detects as nothing. */
const THREE_HAIRCUTS = [
  txn('2025-12-08', -4500, HAIRCUT_DESC),
  txn('2026-03-02', -4500, HAIRCUT_DESC),
  txn('2026-06-08', -4500, HAIRCUT_DESC),
];

/** A genuinely detected monthly subscription, for the "detection already agrees" case. */
const THREE_MONTHLY_RENTS = [
  txn('2026-03-15', -125000, RENT_DESC),
  txn('2026-04-15', -125000, RENT_DESC),
  txn('2026-05-15', -125000, RENT_DESC),
];

describe('the leaf: closed sets, the stored-row parser, and the match key', () => {
  it('only the six PROJECTED cadences may be declared — IRREGULAR is not offered', () => {
    expect([...DECLARABLE_CADENCES]).toEqual([
      'WEEKLY',
      'BIWEEKLY',
      'MONTHLY',
      'QUARTERLY',
      'SEMIANNUAL',
      'ANNUAL',
    ]);
    expect(isDeclarableCadence('IRREGULAR')).toBe(false);
    expect(isDeclarableCadence('MONTHLY')).toBe(true);
    expect(isDeclarableCadence('monthly')).toBe(false); // stored values are the union's spelling
    expect(isDeclarableCadence(null)).toBe(false);
  });

  it('an unreadable stored row is NO instruction, never a guess', () => {
    // The safe direction in both possible ways of being wrong: a guessed BILL
    // invents a projected obligation, a guessed NOT_BILL deletes a real one.
    expect(parseRecurringOverride({ merchantCanonical: 'X', decision: 'MAYBE', cadence: null })).toBeNull();
    expect(parseRecurringOverride({ merchantCanonical: '', decision: 'NOT_BILL', cadence: null })).toBeNull();
    expect(parseRecurringOverride({ merchantCanonical: '   ', decision: 'NOT_BILL', cadence: null })).toBeNull();
    // A BILL with no readable rhythm is nothing to honour: the cadence IS the
    // instruction — it decides the dated outflow and the monthly rate.
    expect(parseRecurringOverride({ merchantCanonical: 'X', decision: 'BILL', cadence: null })).toBeNull();
    expect(parseRecurringOverride({ merchantCanonical: 'X', decision: 'BILL', cadence: 'FORTNIGHTLY' })).toBeNull();
    expect(parseRecurringOverride({ merchantCanonical: 'X', decision: 'BILL', cadence: 'IRREGULAR' })).toBeNull();
    // …and the two readable shapes come back exactly, with NOT_BILL's cadence
    // normalized to null whatever the column happens to hold.
    expect(
      parseRecurringOverride({ merchantCanonical: 'X', decision: 'BILL', cadence: 'ANNUAL', declaredSign: 'OUT' }),
    ).toEqual({ merchantCanonical: 'X', decision: 'BILL', cadence: 'ANNUAL', declaredSign: 'OUT' });
    expect(parseRecurringOverride({ merchantCanonical: 'X', decision: 'NOT_BILL', cadence: 'ANNUAL' })).toEqual({
      merchantCanonical: 'X',
      decision: 'NOT_BILL',
      cadence: null,
      declaredSign: null,
    });
    // An unreadable direction is "he did not say" — never a guessed sign.
    expect(
      parseRecurringOverride({ merchantCanonical: 'X', decision: 'BILL', cadence: 'ANNUAL', declaredSign: 'sideways' }),
    ).toMatchObject({ declaredSign: null });
  });

  it('the match key folds case, width and Unicode form — two payees that LOOK identical are one', () => {
    // `Merchant.canonical` can hold both `costco` and `Costco` (the recorded O.13c
    // residual). They render identically, so an instruction about one is an
    // instruction about both.
    expect(overrideKey('Costco')).toBe(overrideKey('costco'));
    expect(overrideKey('  Costco  ')).toBe('costco');
    expect(overrideKey('Café Moka')).toBe(overrideKey('Café Moka'));
    // …but it is not a substring or a fuzzy match: different payees stay different.
    expect(overrideKey('Costco Whse')).not.toBe(overrideKey('Costco'));
  });

  it('a duplicate key keeps the first row, deterministically', () => {
    const map = buildOverrideMap([bill('Costco', 'MONTHLY'), notABill('costco')]);
    expect(map.size).toBe(1);
    expect(map.get('costco')?.decision).toBe('BILL');
  });
});

describe('"this IS a bill" — a declaration adds the rhythm and nothing else', () => {
  it('one charge becomes a projected series, with every figure read off that charge', () => {
    expect(detectRecurring(ONE_RENT, TODAY, NO_RECURRING_OVERRIDES)).toEqual([]); // detection alone: nothing

    const [s] = detectRecurring(ONE_RENT, TODAY, [bill(RENT_CANONICAL, 'MONTHLY')]);
    expect(s).toBeDefined();
    expect(s.merchantCanonical).toBe(RENT_CANONICAL);
    expect(s.cadence).toBe('MONTHLY');
    // Hand-verified: the amount and the anchor are the reader's real charge, and
    // 2026-05-15 + 1 month = 2026-06-15, which is already ≥ today (2026-06-10).
    expect(s.typicalAmountCents).toBe(-125000);
    expect(s.lastAmountCents).toBe(-125000);
    expect(s.lastSeenAt).toBe('2026-05-15');
    expect(s.nextExpectedAt).toBe('2026-06-15');
    expect(s.occurrences).toBe(1);
    expect(s.accountId).toBe(CHECKING);
    expect(s.categoryId).toBe('rent');
    expect(s.isIncome).toBe(false);
    // The one claim that is his and not the evidence's, marked as such — so no
    // surface can render this as a pattern the app observed.
    expect(s.declaredByUser).toBe(true);
  });

  it('never a price-change claim, however the charges happen to differ', () => {
    // Two sightings at two amounts is exactly the shape the two-plateau rule would
    // read as a price rise — with three sightings. From two it would be the app
    // originating a fact, so a declaration makes no such claim at all.
    const rising = [txn('2026-04-15', -120000, RENT_DESC), txn('2026-05-15', -125000, RENT_DESC)];
    const [s] = detectRecurring(rising, TODAY, [bill(RENT_CANONICAL, 'MONTHLY')]);
    expect(s.previousAmountCents).toBeNull();
    expect(s.priceChangedAt).toBeNull();
    expect(s.typicalAmountCents).toBe(-125000); // the most recent charge, as detection does
  });

  it('the declared rhythm steps past today, at each cadence — hand-verified', () => {
    const from = (cadence: 'WEEKLY' | 'MONTHLY' | 'ANNUAL') =>
      detectRecurring([txn('2026-01-15', -1000, RENT_DESC)], TODAY, [bill(RENT_CANONICAL, cadence)])[0]
        .nextExpectedAt;
    // 2026-01-15 stepped forward until ≥ 2026-06-10:
    expect(from('WEEKLY')).toBe('2026-06-11'); // …05-28, 06-04, 06-11
    expect(from('MONTHLY')).toBe('2026-06-15'); // …05-15, 06-15
    expect(from('ANNUAL')).toBe('2027-01-15'); // one step, already ahead
  });

  it('reaches the MONEY: a declared bill becomes a dated projected outflow', () => {
    const series = detectRecurring(ONE_RENT, TODAY, [bill(RENT_CANONICAL, 'MONTHLY')]);
    expect(
      toScheduledTransactions(
        series,
        { paymentAccountId: CHECKING, cashAccountIds: new Set([CHECKING]) },
        TODAY,
      ),
    ).toEqual([
      {
        accountId: CHECKING,
        description: RENT_CANONICAL,
        amountCents: -125000,
        nextDate: '2026-06-15',
        cadence: 'MONTHLY',
        source: 'recurring',
      },
    ]);
  });

  it('a declaration about a payee with no charges invents nothing', () => {
    // The instruction is stored and the reader is told on /recurring that nothing
    // matched it; what must never happen is a projected bill with no charge behind
    // it — there would be no amount to state and no date to anchor.
    expect(detectRecurring(ONE_RENT, TODAY, [bill('Some Payee He Never Paid', 'MONTHLY')])).toEqual([]);
    expect(detectRecurring([], TODAY, [bill(RENT_CANONICAL, 'MONTHLY')])).toEqual([]);
    // …while a real payee in the same rows is untouched by that dangling instruction.
    expect(
      detectRecurring(THREE_MONTHLY_RENTS, TODAY, [bill('Some Payee He Never Paid', 'MONTHLY')]),
    ).toHaveLength(1);
  });

  it('when detection ALREADY agrees, the evidence wins the details', () => {
    // He declares QUARTERLY; the charges say MONTHLY and detection can prove it.
    // The declaration is redundant rather than wrong, and the series stays marked
    // as detected — /recurring says so beside the instruction.
    const [s] = detectRecurring(THREE_MONTHLY_RENTS, TODAY, [bill(RENT_CANONICAL, 'QUARTERLY')]);
    expect(s.cadence).toBe('MONTHLY');
    expect(s.occurrences).toBe(3);
    expect(s.declaredByUser).toBe(false);
  });

  it('the case-folded key is what a declaration is matched on', () => {
    const [s] = detectRecurring(ONE_RENT, TODAY, [bill(RENT_CANONICAL.toUpperCase(), 'MONTHLY')]);
    expect(s?.merchantCanonical).toBe(RENT_CANONICAL);
  });
});

describe('"this is NOT a bill" — the only recourse against a false detection', () => {
  const THREE_QUARTERLY_HAIRCUTS = [
    txn('2025-12-10', -4500, HAIRCUT_DESC),
    txn('2026-03-11', -4500, HAIRCUT_DESC),
    txn('2026-06-09', -4500, HAIRCUT_DESC),
  ];

  it('removes a detected series outright', () => {
    // Precondition: without the instruction this really is detected — otherwise
    // the test would pass on a series that never existed.
    const detected = detectRecurring(THREE_QUARTERLY_HAIRCUTS, TODAY, NO_RECURRING_OVERRIDES);
    expect(detected.map((s) => s.merchantCanonical)).toEqual([HAIRCUT_CANONICAL]);
    expect(detected[0].cadence).toBe('QUARTERLY');

    expect(detectRecurring(THREE_QUARTERLY_HAIRCUTS, TODAY, [notABill(HAIRCUT_CANONICAL)])).toEqual([]);
  });

  it('takes the projected outflow with it — the calendar row and the fixed-expense share', () => {
    const scope = { paymentAccountId: CHECKING, cashAccountIds: new Set([CHECKING]) };
    expect(
      toScheduledTransactions(
        detectRecurring(THREE_QUARTERLY_HAIRCUTS, TODAY, NO_RECURRING_OVERRIDES),
        scope,
        TODAY,
      ),
    ).toHaveLength(1);
    expect(
      toScheduledTransactions(
        detectRecurring(THREE_QUARTERLY_HAIRCUTS, TODAY, [notABill(HAIRCUT_CANONICAL)]),
        scope,
        TODAY,
      ),
    ).toEqual([]);
  });

  it('beats a BILL declaration about the same payee, and beats the evidence', () => {
    // One row per payee makes this unreachable through the UI; the engine still
    // has to be total, and the direction is the reader's stated "stop".
    expect(
      detectRecurring(THREE_QUARTERLY_HAIRCUTS, TODAY, [
        notABill(HAIRCUT_CANONICAL),
        bill(HAIRCUT_CANONICAL, 'MONTHLY'),
      ]),
    ).toEqual([]);
  });

  it('leaves every OTHER payee exactly as it was', () => {
    const both = [...THREE_QUARTERLY_HAIRCUTS, ...THREE_MONTHLY_RENTS];
    const before = detectRecurring(both, TODAY, NO_RECURRING_OVERRIDES);
    const after = detectRecurring(both, TODAY, [notABill(HAIRCUT_CANONICAL)]);
    // Sorted by canonical: 'Lakeside…' precedes 'Supercuts'.
    expect(before.map((s) => s.merchantCanonical)).toEqual([RENT_CANONICAL, HAIRCUT_CANONICAL]);
    expect(after).toEqual(before.filter((s) => s.merchantCanonical === RENT_CANONICAL));
  });
});

describe('with no instructions, detection is what it always was', () => {
  it('the irregular shapes stay irregular and the regular ones stay detected', () => {
    expect(detectRecurring(THREE_HAIRCUTS, TODAY, NO_RECURRING_OVERRIDES)).toEqual([]);
    expect(detectRecurring(ONE_RENT, TODAY, NO_RECURRING_OVERRIDES)).toEqual([]);
    const [s] = detectRecurring(THREE_MONTHLY_RENTS, TODAY, NO_RECURRING_OVERRIDES);
    expect(s.cadence).toBe('MONTHLY');
    expect(s.declaredByUser).toBe(false);
  });

  it('an instruction naming a payee that is not in the rows changes nothing', () => {
    expect(detectRecurring(THREE_MONTHLY_RENTS, TODAY, [notABill('Some Other Payee')])).toEqual(
      detectRecurring(THREE_MONTHLY_RENTS, TODAY, NO_RECURRING_OVERRIDES),
    );
  });
});

describe('what an instruction is actually DOING — the four named effects', () => {
  const declared = { merchantCanonical: RENT_CANONICAL, declaredByUser: true };
  const detected = { merchantCanonical: RENT_CANONICAL, declaredByUser: false };

  it('a demotion is always suppression — there is no series left to describe', () => {
    expect(verdictEffect('NOT_BILL', RENT_CANONICAL, [])).toBe('suppressed');
    expect(verdictEffect('NOT_BILL', RENT_CANONICAL, [detected])).toBe('suppressed');
  });

  it('a declaration that produced the series says so', () => {
    expect(verdictEffect('BILL', RENT_CANONICAL, [declared])).toBe('projected-as-declared');
  });

  it('a declaration detection has OVERTAKEN is named separately — the reader’s cadence is not the one running', () => {
    // This is the case that would otherwise print a false sentence about his own
    // money: "you marked this, every three months" beside a monthly projection.
    expect(verdictEffect('BILL', RENT_CANONICAL, [detected])).toBe('detected-anyway');
  });

  it('a declaration matching no charges is named rather than shown as if it were working', () => {
    expect(verdictEffect('BILL', RENT_CANONICAL, [])).toBe('no-charges');
    expect(verdictEffect('BILL', RENT_CANONICAL, [{ merchantCanonical: 'Someone Else', declaredByUser: true }])).toBe(
      'no-charges',
    );
  });

  it('matches on the same folded key the detector applies the instruction with', () => {
    expect(verdictEffect('BILL', RENT_CANONICAL.toUpperCase(), [declared])).toBe('projected-as-declared');
  });
});

describe('CRITIC CYCLE 1 — the direction is the reader’s, not the majority’s (P1-3)', () => {
  /**
   * Executed by the money critic: a $49.99 purchase carrying two refunds has a
   * POSITIVE majority, so the dominant-sign rule turned "this charge repeats" into
   * recurring INCOME of $25.00 on the payment account — a sign and an amount the
   * reader never stated, in the direction that silences cash warnings. Detection
   * may take the majority because three sightings at a stable amount have already
   * settled the direction; a declaration has neither bar, so it carries the sign of
   * the charge he was standing on.
   */
  const REFUNDED = [
    txn('2026-05-01', -4999, HAIRCUT_DESC),
    txn('2026-05-20', 4999, HAIRCUT_DESC),
    txn('2026-06-01', 2500, HAIRCUT_DESC),
  ];

  it('declaring while standing on the CHARGE projects an expense, not income', () => {
    const [s] = detectRecurring(REFUNDED, TODAY, [bill(HAIRCUT_CANONICAL, 'MONTHLY', 'OUT')]);
    expect(s.isIncome).toBe(false);
    expect(s.typicalAmountCents).toBe(-4999);
    expect(
      toScheduledTransactions(
        [s],
        { paymentAccountId: CHECKING, cashAccountIds: new Set([CHECKING]) },
        TODAY,
      )[0],
    ).toMatchObject({ amountCents: -4999, source: 'recurring' });
  });

  it('declaring while standing on a DEPOSIT projects income — the lever works both ways', () => {
    const [s] = detectRecurring(REFUNDED, TODAY, [bill(HAIRCUT_CANONICAL, 'MONTHLY', 'IN')]);
    expect(s.isIncome).toBe(true);
    expect(s.typicalAmountCents).toBe(2500);
  });

  it('a row stored before the direction existed falls back to the majority, not to a guess', () => {
    const [s] = detectRecurring(REFUNDED, TODAY, [bill(HAIRCUT_CANONICAL, 'MONTHLY', null)]);
    // The old behaviour, unchanged and reachable only by a legacy row: the majority
    // here is the two inflows. Locked so the fallback cannot be mistaken for the
    // rule — the rule is the branch above.
    expect(s.isIncome).toBe(true);
  });

  it('a declaration whose direction has no charges produces nothing at all', () => {
    // Rather than silently falling back to the other sign, which would project the
    // opposite of what he said.
    expect(detectRecurring(ONE_RENT, TODAY, [bill(RENT_CANONICAL, 'MONTHLY', 'IN')])).toEqual([]);
  });
});

describe('CRITIC CYCLE 1 — a declared series is never "no longer charging" (P1-2)', () => {
  /**
   * Executed by the money critic: one charge on 2025-10-05 declared MONTHLY put
   * $0/month and "no longer charging" on /recurring while the plan and the calendar
   * carried the full −$1,250.00 — the same two-surface split both L.23 critics
   * rated P1. Silence is evidence of death only where the app INFERRED the rhythm.
   */
  const OLD_RENT = [txn('2025-10-05', -125000, RENT_DESC)];

  it('the lapse gate does not apply to a rhythm the reader declared', () => {
    const [declared] = detectRecurring(OLD_RENT, TODAY, [bill(RENT_CANONICAL, 'MONTHLY')]);
    expect(isSeriesActive(declared, TODAY)).toBe(true);
    // …while the same anchor, inferred, is lapsed at 8 months of silence.
    expect(isSeriesActive({ ...declared, declaredByUser: false }, TODAY)).toBe(false);
  });

  it('so the page and the projection agree — both carry it', () => {
    const series = detectRecurring(OLD_RENT, TODAY, [bill(RENT_CANONICAL, 'MONTHLY')]);
    expect(summarizeRecurring(series, TODAY).items[0]).toMatchObject({
      active: true,
      monthlyEquivalentCents: 125000,
    });
    expect(
      toScheduledTransactions(
        series,
        { paymentAccountId: CHECKING, cashAccountIds: new Set([CHECKING]) },
        TODAY,
      ),
    ).toHaveLength(1);
  });

  it('and a LONG-cadence declaration is projected too, where an inferred one would be dropped', () => {
    // classifySeriesProjection applies the same shared predicate, so the exemption
    // reaches both gates or the two surfaces split again in the other direction.
    const series = detectRecurring(OLD_RENT, TODAY, [bill(RENT_CANONICAL, 'ANNUAL')]);
    expect(
      toScheduledTransactions(
        series,
        { paymentAccountId: CHECKING, cashAccountIds: new Set([CHECKING]) },
        TODAY,
      ),
    ).toHaveLength(1);
  });
});
