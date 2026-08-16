/**
 * C.22 — radar committed-merchant detection after a payment-account re-link.
 *
 * The income remap concatenates two feeds into one detectRecurring call.
 * Detection groups by canonical and refuses >2 amounts / irregular gaps,
 * so the old feed's messy history of the same merchant kills a clean
 * monthly series the new feed had alone. Locked here: per-account union
 * keeps the series; concatenate does not.
 */
import { describe, expect, it } from 'vitest';
import { isoDate } from '@/lib/dates';
import { handoverKey } from '@/lib/engine/account/reconcile-boundary';
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';
import {
  committedMerchantCanonicals,
  remappedPaymentRows,
} from '@/lib/engine/radar/committed';
import { detectRecurring, type RecurringTxn } from '@/lib/engine/recurring/detect';
import { NO_RECURRING_OVERRIDES } from '@/lib/engine/recurring/override';
import {
  discretionaryDailyOutflows,
  paymentAccountHistoryDays,
} from '@/lib/engine/radar/burn';
import type { TransactionLike } from '@/lib/engine/cash-needed/assemble';

const TODAY = isoDate('2026-09-20');
const PRED = 'acct-old-checking';
const PAY = 'acct-new-checking';
const CARD_OLD = 'acct-old-card';
const CARD_NEW = 'acct-new-card';
const NETFLIX = normalizeMerchant('NETFLIX.COM').canonical;
const TERMINAL = new Map<string, string>([
  [PRED, PAY],
  [CARD_OLD, CARD_NEW],
]);

function R(
  accountId: string,
  date: string,
  amountCents: number,
  rawDescriptor: string,
  id: string,
): RecurringTxn {
  return { id, accountId, date, amountCents, rawDescriptor, isTransfer: false };
}

/**
 * Predecessor: same canonical, irregular dates AND three amounts — enough
 * to fail detectSeries on its own, and to poison a concatenated call.
 * Monthly detection is median-only, so a single 0-day gap is not enough.
 */
const PRED_NETFLIX: RecurringTxn[] = [
  R(PRED, '2026-01-03', -1299, 'NETFLIX.COM', 'p1'),
  R(PRED, '2026-02-20', -1899, 'NETFLIX.COM', 'p2'),
  R(PRED, '2026-04-01', -1599, 'NETFLIX.COM', 'p3'),
];
/** Successor: 3 clean monthly Netflix charges. */
const SUCC_NETFLIX: RecurringTxn[] = [
  R(PAY, '2026-07-15', -1599, 'NETFLIX.COM', 's1'),
  R(PAY, '2026-08-15', -1599, 'NETFLIX.COM', 's2'),
  R(PAY, '2026-09-15', -1599, 'NETFLIX.COM', 's3'),
];

describe('committedMerchantCanonicals — C.22 per-account union', () => {
  it('test_regression__c22_per_account_union_keeps_series_concatenate_destroys', () => {
    const rows = [...PRED_NETFLIX, ...SUCC_NETFLIX];
    // The old feed is not a series. The new feed is.
    expect(detectRecurring(PRED_NETFLIX, TODAY, NO_RECURRING_OVERRIDES)).toEqual([]);
    expect(detectRecurring(SUCC_NETFLIX, TODAY, NO_RECURRING_OVERRIDES).map((s) => s.merchantCanonical)).toEqual([
      NETFLIX,
    ]);
    // The income remap concatenates them: three amounts → detectSeries
    // refuses. This is the probe's 9 → 4 in miniature.
    const concatenated = rows.map((t) => ({ ...t, accountId: PAY }));
    expect(detectRecurring(concatenated, TODAY, NO_RECURRING_OVERRIDES)).toEqual([]);
    // Per-account union keeps the canonical. Neither descriptor wins.
    expect(committedMerchantCanonicals(rows, PAY, TODAY, NO_RECURRING_OVERRIDES, TERMINAL)).toEqual(
      new Set([NETFLIX]),
    );
  });

  it('test_regression__c22_successor_only_still_detects_without_links', () => {
    expect(
      committedMerchantCanonicals(SUCC_NETFLIX, PAY, TODAY, NO_RECURRING_OVERRIDES, new Map()),
    ).toEqual(new Set([NETFLIX]));
  });

  it('test_regression__c22_card_predecessor_is_not_the_payment_component', () => {
    const gym = [
      R(CARD_OLD, '2026-01-01', -4000, 'PLANET FITNESS', 'g1'),
      R(CARD_OLD, '2026-02-01', -4000, 'PLANET FITNESS', 'g2'),
      R(CARD_OLD, '2026-03-01', -4000, 'PLANET FITNESS', 'g3'),
    ];
    expect(
      committedMerchantCanonicals([...SUCC_NETFLIX, ...gym], PAY, TODAY, NO_RECURRING_OVERRIDES, TERMINAL),
    ).toEqual(new Set([NETFLIX]));
  });
});

describe('remappedPaymentRows — C.22 burn scope', () => {
  const today = isoDate('2026-08-15');
  const handover = new Set([handoverKey(PRED, '2026-07-21'), handoverKey(PAY, '2026-07-21')]);

  function T(over: Partial<TransactionLike> & { date: string; amountCents: number; accountId: string }): TransactionLike {
    return {
      rawDescriptor: 'SQ *CORNER CAFE',
      status: 'POSTED',
      isTransfer: false,
      ...over,
    };
  }

  it('test_regression__c22_history_days_read_the_predecessor_tail', () => {
    const rows = [
      T({ accountId: PRED, date: '2026-05-01', amountCents: -100 }),
      T({ accountId: PAY, date: '2026-08-01', amountCents: -100 }),
    ];
    expect(paymentAccountHistoryDays(rows, PAY, today)).toBe(14); // successor only
    const remapped = remappedPaymentRows(rows, PAY, TERMINAL, new Set());
    expect(paymentAccountHistoryDays(remapped, PAY, today)).toBe(106); // 05-01 → 08-15
  });

  it('test_regression__c22_handover_day_is_not_double_counted_in_burn', () => {
    const rows = [
      T({ accountId: PRED, date: '2026-07-21', amountCents: -5000 }),
      T({ accountId: PAY, date: '2026-07-21', amountCents: -5000 }),
    ];
    const remapped = remappedPaymentRows(rows, PAY, TERMINAL, handover);
    const dailies = discretionaryDailyOutflows(remapped, {
      paymentAccountId: PAY,
      excludedCanonicals: new Set(),
      today,
    });
    expect(dailies.reduce((a, b) => a + b, 0)).toBe(5000);
  });
});
