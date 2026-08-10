/**
 * Income-Pause Radar — lapsed recurring income detection (#251, AI plan §Later
 * #20's one groundable signature).
 *
 * Every expected value is hand-verified in docs/EDGE_CASES.md §Income-Pause
 * Radar (P1–P10). Abstention cases are the MAJORITY on purpose (the
 * context-carrying lesson, same stance as the anomaly radar tests): the radar's
 * honesty lives in what it does NOT flag — grace-window jitter, thin history,
 * small deposits, expense series, annual bonuses, aggregate pseudo-merchants,
 * and stale lapses that are history rather than news.
 *
 * P10 is the production-shaped locking fixture (verbatim-value lesson, #250
 * intake side): raw transaction rows through the REAL detectRecurring, not a
 * hand-assembled series object.
 */
import { describe, expect, it } from 'vitest';
import { isoDate, type ISODate } from '@/lib/dates';
import { buildSeedData } from '@/lib/seed/build';
import {
  detectRecurring,
  type RecurringSeriesResult,
  type RecurringTxn,
} from '@/lib/engine/recurring/detect';
import { NO_RECURRING_OVERRIDES } from '@/lib/engine/recurring/override';
import {
  MIN_AMOUNT_CENTS,
  MIN_OCCURRENCES,
  PAUSE_GRACE_DAYS,
  STALE_DAYS,
  confirmedPauseState,
  detectIncomePauses,
  incomePausesForFeed,
  lapsedIncomeSeries,
  missedSinceOf,
} from '@/lib/engine/income/pause';

/** A hand-assembled series row (defaults = the seed side-gig, EDGE_CASES P1). */
function series(overrides: Partial<RecurringSeriesResult> = {}): RecurringSeriesResult {
  return {
    merchantCanonical: 'Stripe Payout',
    categoryId: 'side-income',
    cadence: 'MONTHLY',
    typicalAmountCents: 38000,
    lastAmountCents: 38000,
    previousAmountCents: null,
    priceChangedAt: null,
    lastSeenAt: isoDate('2026-04-10'),
    // NB: detect.ts forward-steps this to ≥ today, which is exactly why the
    // engine must NOT read it — the value here is deliberately arbitrary.
    nextExpectedAt: isoDate('2026-06-10'),
    occurrences: 4,
    occurrenceRows: [], // evidence rows are out of scope here — the pause state is what is under test
    isSubscription: false,
    isIncome: true,
    possiblyUnused: false,
    accountId: 'acct-savings',
    declaredByUser: false,
    ...overrides,
  };
}

describe('detectIncomePauses — flags (hand-verified)', () => {
  it('P1: monthly ×4 last seen 2026-04-10, today 2026-06-10 → one pause, missedSince 2026-05-10, daysLate 31', () => {
    const out = detectIncomePauses([series()], isoDate('2026-06-10'));
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      merchantCanonical: 'Stripe Payout',
      accountId: 'acct-savings',
      cadence: 'MONTHLY',
      typicalAmountCents: 38000, // verbatim
      lastSeenAt: '2026-04-10',
      missedSince: '2026-05-10', // addMonthsClamped(2026-04-10, 1)
      daysLate: 31, // daysBetween(2026-05-10, 2026-06-10) = 21 (May) + 10 (June)
      occurrences: 4, // verbatim
    });
  });

  it('P2: MONTHLY grace boundary — daysLate 9 silent, 10 flags', () => {
    // missedSince 2026-05-10; grace MONTHLY = 10.
    expect(detectIncomePauses([series()], isoDate('2026-05-19'))).toHaveLength(0); // 9 late
    expect(detectIncomePauses([series()], isoDate('2026-05-20'))).toHaveLength(1); // 10 late
    expect(PAUSE_GRACE_DAYS.MONTHLY).toBe(10);
  });

  it('P3: BIWEEKLY grace boundary — daysLate 6 silent, 7 flags', () => {
    // last 2026-05-29 → missedSince 2026-06-12; grace BIWEEKLY = 7.
    const s = series({ cadence: 'BIWEEKLY', lastSeenAt: isoDate('2026-05-29'), typicalAmountCents: 245000 });
    expect(detectIncomePauses([s], isoDate('2026-06-18'))).toHaveLength(0); // 6 late
    const out = detectIncomePauses([s], isoDate('2026-06-19')); // 7 late
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ missedSince: '2026-06-12', daysLate: 7 });
    expect(PAUSE_GRACE_DAYS.BIWEEKLY).toBe(7);
  });

  it('P4: WEEKLY grace boundary — daysLate 4 silent, 5 flags', () => {
    // last 2026-06-01 → missedSince 2026-06-08; grace WEEKLY = 5.
    const s = series({ cadence: 'WEEKLY', lastSeenAt: isoDate('2026-06-01') });
    expect(detectIncomePauses([s], isoDate('2026-06-12'))).toHaveLength(0); // 4 late
    const out = detectIncomePauses([s], isoDate('2026-06-13')); // 5 late
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ missedSince: '2026-06-08', daysLate: 5 });
    expect(PAUSE_GRACE_DAYS.WEEKLY).toBe(5);
  });

  it('P5: staleness — daysLate 60 is news, 61 is history (nudge only; the exclusion predicate keeps it)', () => {
    // missedSince 2026-05-10 → daysLate 60 on 2026-07-09, 61 on 2026-07-10.
    expect(detectIncomePauses([series()], isoDate('2026-07-09'))).toHaveLength(1);
    expect(detectIncomePauses([series()], isoDate('2026-07-10'))).toHaveLength(0);
    // The projection-exclusion predicate has NO staleness cap — a confirmed pause
    // must never silently re-enter projections on day 61.
    const lapsed = lapsedIncomeSeries([series()], isoDate('2026-07-10'));
    expect(lapsed).toHaveLength(1);
    expect(lapsed[0]).toMatchObject({ missedSince: '2026-05-10', daysLate: 61 });
    expect(STALE_DAYS).toBe(60);
  });
});

describe('detectIncomePauses — abstentions (the majority)', () => {
  const TODAY = isoDate('2026-06-10');

  it('P6a: 3 occurrences is thin history — silent (floor is 4)', () => {
    expect(detectIncomePauses([series({ occurrences: 3 })], TODAY)).toHaveLength(0);
    expect(MIN_OCCURRENCES).toBe(4);
  });

  it('P6b: $99.99 typical is below the amount floor — silent; $100.00 flags', () => {
    expect(detectIncomePauses([series({ typicalAmountCents: 9999 })], TODAY)).toHaveLength(0);
    expect(detectIncomePauses([series({ typicalAmountCents: 10000 })], TODAY)).toHaveLength(1);
    expect(MIN_AMOUNT_CENTS).toBe(10000);
  });

  it('P6c: an expense series never flags, even lapsed', () => {
    const s = series({ isIncome: false, typicalAmountCents: -38000, lastAmountCents: -38000 });
    expect(detectIncomePauses([s], TODAY)).toHaveLength(0);
  });

  it('P6d: ANNUAL income (a yearly bonus) never flags — one miss is not a pause', () => {
    const s = series({ cadence: 'ANNUAL', lastSeenAt: isoDate('2025-03-15'), occurrences: 4 });
    expect(detectIncomePauses([s], TODAY)).toHaveLength(0);
  });

  it('P6e: aggregate pseudo-merchants never flag (case-insensitive shared guard)', () => {
    expect(detectIncomePauses([series({ merchantCanonical: 'ATM Withdrawal' })], TODAY)).toHaveLength(0);
    expect(detectIncomePauses([series({ merchantCanonical: 'atm withdrawal' })], TODAY)).toHaveLength(0);
  });

  it('P7: nothing missed yet — expected date today or in the future is silent', () => {
    // last 2026-05-10 → missedSince 2026-06-10 (== today): not yet a miss.
    expect(detectIncomePauses([series({ lastSeenAt: isoDate('2026-05-10') })], TODAY)).toHaveLength(0);
    // last 2026-06-01 → missedSince 2026-07-01 (future).
    expect(detectIncomePauses([series({ lastSeenAt: isoDate('2026-06-01') })], TODAY)).toHaveLength(0);
  });

  it('P8: a current series alongside a lapsed one — only the lapsed one flags', () => {
    const current = series({ merchantCanonical: 'Acme Analytics (Payroll)', cadence: 'BIWEEKLY', lastSeenAt: isoDate('2026-06-05'), typicalAmountCents: 245000, occurrences: 30, accountId: 'acct-checking' });
    const out = detectIncomePauses([current, series()], TODAY);
    expect(out).toHaveLength(1);
    expect(out[0].merchantCanonical).toBe('Stripe Payout');
  });
});

describe('ordering (deterministic total order)', () => {
  it('P9: largest typical first, then merchant ascending (locale-free)', () => {
    const a = series({ merchantCanonical: 'Alpha Pay', typicalAmountCents: 38000 });
    const b = series({ merchantCanonical: 'Beta Pay', typicalAmountCents: 245000, cadence: 'BIWEEKLY', lastSeenAt: isoDate('2026-04-24') });
    const c = series({ merchantCanonical: 'Aardvark Pay', typicalAmountCents: 38000 });
    const out = detectIncomePauses([a, b, c], isoDate('2026-06-10'));
    expect(out.map((p) => p.merchantCanonical)).toEqual(['Beta Pay', 'Aardvark Pay', 'Alpha Pay']);
  });
});

describe('demo seed lock (#251) — the engineered pause is the demo’s ONLY one', () => {
  it('SEED: default asOf yields exactly one pause — Stripe Payout, verbatim engineered fields', () => {
    const seed = buildSeedData('2026-06-10');
    const today = isoDate('2026-06-10');
    // The coach input predicate, verbatim (POSTED, non-split — seed rows have no splits).
    const txns = seed.transactions.filter((t) => t.status === 'POSTED');
    const out = detectIncomePauses(detectRecurring(txns, today, NO_RECURRING_OVERRIDES), today);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      merchantCanonical: 'Stripe Payout',
      accountId: 'acct-savings',
      cadence: 'MONTHLY',
      typicalAmountCents: 38000,
      lastSeenAt: '2026-04-10',
      missedSince: '2026-05-10',
      daysLate: 31,
      occurrences: 4,
    });
    // Guard the by-construction claim: the paused series is NOT on the payment
    // account, so it can never reach toScheduledTransactions / cash-needed.
    expect(out[0].accountId).not.toBe(seed.user.paymentAccountId);
  });
});

describe('incomePausesForFeed — confirmation composition', () => {
  it('P11: unconfirmed rows carry confirmed=false and obey the staleness cap; confirmed rows have NO cap', () => {
    // daysLate 61 on 2026-07-10 — past STALE_DAYS.
    const stale = isoDate('2026-07-10');
    // Unconfirmed + stale → dropped (news has expired).
    expect(incomePausesForFeed([series()], stale, new Set())).toHaveLength(0);
    // Confirmed + stale → KEPT: while the projection exclusion is in force the feed
    // must disclose it and host the undo (a mutation may never outlive its visibility).
    const kept = incomePausesForFeed([series()], stale, new Set(['Stripe Payout']));
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ merchantCanonical: 'Stripe Payout', confirmed: true, daysLate: 61 });
    // Fresh + unconfirmed → present with confirmed=false.
    const fresh = incomePausesForFeed([series()], isoDate('2026-06-10'), new Set());
    expect(fresh).toHaveLength(1);
    expect(fresh[0].confirmed).toBe(false);
  });

  it('P12: a confirmation for a RESUMED series is inert — no row (lapse recomputed, never trusted)', () => {
    // lastSeenAt 2026-06-05 → missedSince 2026-07-05, today 2026-06-10: not lapsed.
    const resumed = series({ lastSeenAt: isoDate('2026-06-05') });
    expect(incomePausesForFeed([resumed], isoDate('2026-06-10'), new Set(['Stripe Payout']))).toHaveLength(0);
  });
});

describe('month-end paydays (#251 critic F7) — clamping must never shrink the grace', () => {
  it('P13: a MONTHLY series last seen on a month-END expects the END of the next month', () => {
    // A 31st payday whose last deposit clamped to Feb 28: expectation is Mar 31
    // (the real payday), NOT the clamped Mar 28 — otherwise the documented grace
    // of 10 silently becomes 7 for exactly the payroll shape most likely to jitter.
    expect(missedSinceOf(isoDate('2026-02-28'), 'MONTHLY')).toBe('2026-03-31');
    expect(missedSinceOf(isoDate('2026-01-31'), 'MONTHLY')).toBe('2026-02-28');
    // Mid-month paydays are untouched; non-monthly cadences are untouched.
    expect(missedSinceOf(isoDate('2026-04-10'), 'MONTHLY')).toBe('2026-05-10');
    expect(missedSinceOf(isoDate('2026-02-28'), 'BIWEEKLY')).toBe('2026-03-14');
    // Detection end-to-end: last seen 2026-02-28 → missedSince 2026-03-31; grace 10
    // ⇒ silent at daysLate 9 (2026-04-09), flags at 10 (2026-04-10).
    const s = series({ lastSeenAt: isoDate('2026-02-28') });
    expect(detectIncomePauses([s], isoDate('2026-04-09'))).toHaveLength(0);
    const out = detectIncomePauses([s], isoDate('2026-04-10'));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ missedSince: '2026-03-31', daysLate: 10 });
  });
});

describe('confirmedPauseState (#251 critic F1) — only date-fresh evidence retires consent', () => {
  const TODAY = isoDate('2026-06-10');

  it('P14a: an ALARM-gate failure is NOT resumption — the state stays paused', () => {
    // The executed F1 repro shape: a provider row-removal drops occurrences 4→3
    // (below the alarm floor). No deposit ever arrived, so the exclusion and the
    // consent must both hold. Same for a sub-$100 typical and an aggregate name:
    // gates govern the alarm, never the standing consent.
    for (const s of [
      series({ occurrences: 3 }),
      series({ typicalAmountCents: 9999 }),
    ]) {
      const state = confirmedPauseState([s], TODAY, s.merchantCanonical);
      expect(state.status).toBe('paused');
      if (state.status === 'paused') {
        expect(state.pause).toMatchObject({ missedSince: '2026-05-10', daysLate: 31 });
      }
    }
  });

  it('P14b: a date-fresh deposit IS resumption', () => {
    // lastSeenAt 2026-06-05 → missedSince 2026-07-05 ≥ today: fresh.
    const s = series({ lastSeenAt: isoDate('2026-06-05') });
    expect(confirmedPauseState([s], TODAY, 'Stripe Payout').status).toBe('resumed');
  });

  it('P14c: a vanished or non-projectable series is INERT — consent kept, nothing excluded', () => {
    // No series at all under the canonical.
    expect(confirmedPauseState([], TODAY, 'Stripe Payout').status).toBe('inert');
    // Cadence drifted to ANNUAL: an annual INCOME series is not projected by
    // toScheduledTransactions — a DECISION since L.23, not a fact about the
    // cadence list (annual EXPENSES are projected) — so there is nothing to
    // exclude and no state row to render, but the consent is NOT deleted (absence
    // of evidence is not resumption). If a slice ever projects annual income,
    // this expectation and isPauseCadence both have to be revisited.
    const annual = series({ cadence: 'ANNUAL' });
    expect(confirmedPauseState([annual], TODAY, 'Stripe Payout').status).toBe('inert');
    // An expense series under the same canonical is not an income pause subject.
    const expense = series({ isIncome: false, typicalAmountCents: -38000 });
    expect(confirmedPauseState([expense], TODAY, 'Stripe Payout').status).toBe('inert');
  });

  it('P14d: the feed shows the confirmed state row through a gate failure (mutation never invisible)', () => {
    // occurrences 3 — below the alarm floor. Unconfirmed: no row (no alarm).
    const s = series({ occurrences: 3 });
    expect(incomePausesForFeed([s], TODAY, new Set())).toHaveLength(0);
    // Confirmed: the state row STAYS (it is the exclusion's disclosure + undo home).
    const kept = incomePausesForFeed([s], TODAY, new Set(['Stripe Payout']));
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ confirmed: true, occurrences: 3 });
  });
});

describe('production-shaped locking fixture (raw rows → detectRecurring → radar)', () => {
  let seq = 0;
  function txn(date: ISODate, amountCents: number, rawDescriptor: string, accountId = 'acct-savings'): RecurringTxn {
    return { id: `t-${String(++seq).padStart(3, '0')}`, accountId, date, amountCents, rawDescriptor };
  }

  it('P10: 4 monthly payouts + a current biweekly payroll → exactly the payout flags, verbatim fields', () => {
    const rows: RecurringTxn[] = [
      // Side gig: monthly +$380.00, 2026-01-10 .. 2026-04-10, then silence.
      txn(isoDate('2026-01-10'), 38000, 'STRIPE PAYOUT ETSY SHOP'),
      txn(isoDate('2026-02-10'), 38000, 'STRIPE PAYOUT ETSY SHOP'),
      txn(isoDate('2026-03-10'), 38000, 'STRIPE PAYOUT ETSY SHOP'),
      txn(isoDate('2026-04-10'), 38000, 'STRIPE PAYOUT ETSY SHOP'),
      // Payroll: biweekly +$2,450, still current at today.
      txn(isoDate('2026-05-01'), 245000, 'ACH DEPOSIT ACME ANALYTICS PAYROLL', 'acct-checking'),
      txn(isoDate('2026-05-15'), 245000, 'ACH DEPOSIT ACME ANALYTICS PAYROLL', 'acct-checking'),
      txn(isoDate('2026-05-29'), 245000, 'ACH DEPOSIT ACME ANALYTICS PAYROLL', 'acct-checking'),
      txn(isoDate('2026-06-12'), 245000, 'ACH DEPOSIT ACME ANALYTICS PAYROLL', 'acct-checking'),
    ];
    const today = isoDate('2026-06-14');
    const out = detectIncomePauses(detectRecurring(rows, today, NO_RECURRING_OVERRIDES), today);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      merchantCanonical: 'Stripe Payout',
      accountId: 'acct-savings',
      cadence: 'MONTHLY',
      typicalAmountCents: 38000,
      lastSeenAt: '2026-04-10',
      missedSince: '2026-05-10',
      daysLate: 35, // daysBetween(2026-05-10, 2026-06-14) = 21 + 14
      occurrences: 4,
    });
  });
});
