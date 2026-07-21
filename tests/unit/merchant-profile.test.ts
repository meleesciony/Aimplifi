/**
 * Merchant Pattern Lens engine — hand-verified expected values from
 * docs/EDGE_CASES.md §Merchant Pattern Lens (L-numbers match). DECISIONS #250.
 */
import { describe, expect, it } from 'vitest';
import { isoDate } from '@/lib/dates';
import {
  LENS_MIN_PATTERN_SAMPLE,
  type LensTxn,
  buildMerchantProfile,
} from '@/lib/engine/merchant/profile';

const TODAY = isoDate('2026-06-10');

function txn(overrides: Partial<LensTxn> & { amountCents: number; date: string }): LensTxn {
  return {
    merchant: 'Cafe Nine',
    status: 'POSTED',
    isTransfer: false,
    ...overrides,
  };
}

/** The L1 fixture: 8 qualifying charges + rows that must change nothing. */
const L1: LensTxn[] = [
  txn({ date: '2025-11-14', amountCents: -1000 }),
  txn({ date: '2025-12-05', amountCents: -800 }),
  txn({ date: '2026-01-10', amountCents: -900 }),
  txn({ date: '2026-02-20', amountCents: -700 }),
  txn({ date: '2026-03-08', amountCents: -1100 }),
  txn({ date: '2026-04-12', amountCents: -600 }),
  txn({ date: '2026-05-25', amountCents: -1200 }),
  txn({ date: '2026-06-03', amountCents: -500 }),
  // Excluded rows (EDGE_CASES L1/L4/L5): refund, pending, transfer, future, other merchant.
  txn({ date: '2026-05-02', amountCents: 1500 }), // refund: positive
  txn({ date: '2026-06-05', amountCents: -999, status: 'PENDING' }),
  txn({ date: '2026-04-01', amountCents: -5000, isTransfer: true }),
  txn({ date: '2026-06-15', amountCents: -777 }), // future vs TODAY
  txn({ date: '2026-03-03', amountCents: -12345, merchant: 'Elsewhere Mart' }),
];

describe('buildMerchantProfile — rich history (L1)', () => {
  it('L1: counts, total, even-n median, first/last seen, both windows — hand-verified', () => {
    const p = buildMerchantProfile(L1, 'cafe nine', TODAY);
    expect(p).not.toBeNull();
    expect(p!.merchant).toBe('Cafe Nine'); // row casing, not the query's
    expect(p!.chargeCount).toBe(8);
    expect(p!.totalCents).toBe(6800);
    expect(p!.firstSeen).toBe('2025-11-14');
    expect(p!.lastSeen).toBe('2026-06-03');
    expect(p!.typicalCents).toBe(850); // floor((800+900)/2)
    expect(p!.hasPattern).toBe(true);
    expect(p!.recentWindow).toEqual({
      fromYm: '2026-03',
      toYm: '2026-05',
      chargeCount: 3,
      totalCents: 2900,
      avgPerMonthCents: 967, // round(2900/3 = 966.67)
    });
    expect(p!.priorWindow).toEqual({
      fromYm: '2025-12',
      toYm: '2026-02',
      chargeCount: 3,
      totalCents: 2400,
      avgPerMonthCents: 800,
    });
  });

  it('L1 exclusions: dropping the non-qualifying rows changes nothing', () => {
    const onlyQualifying = L1.slice(0, 8);
    expect(buildMerchantProfile(onlyQualifying, 'Cafe Nine', TODAY)).toEqual(
      buildMerchantProfile(L1, 'Cafe Nine', TODAY),
    );
  });

  it('exact-match only: "Cafe" or a superstring never matches "Cafe Nine"', () => {
    expect(buildMerchantProfile(L1, 'Cafe', TODAY)).toBeNull();
    expect(buildMerchantProfile(L1, 'Cafe Nine Deluxe', TODAY)).toBeNull();
  });
});

describe('buildMerchantProfile — abstentions', () => {
  it('L2: thin history (2 charges) keeps facts, makes no pattern claims', () => {
    const rows = [
      txn({ date: '2026-05-01', amountCents: -400 }),
      txn({ date: '2026-06-01', amountCents: -600 }),
    ];
    const p = buildMerchantProfile(rows, 'Cafe Nine', TODAY)!;
    expect(p.chargeCount).toBe(2);
    expect(p.chargeCount).toBeLessThan(LENS_MIN_PATTERN_SAMPLE);
    expect(p.totalCents).toBe(1000);
    expect(p.firstSeen).toBe('2026-05-01');
    expect(p.lastSeen).toBe('2026-06-01');
    expect(p.hasPattern).toBe(false);
    expect(p.typicalCents).toBeNull();
    expect(p.recentWindow).toBeNull();
    expect(p.priorWindow).toBeNull();
  });

  it('L3: aggregate pseudo-merchant → null (many payees ≠ one relationship)', () => {
    const rows = [
      txn({ date: '2026-04-01', amountCents: -1000, merchant: 'Zelle Payment' }),
      txn({ date: '2026-05-01', amountCents: -2000, merchant: 'Zelle Payment' }),
      txn({ date: '2026-05-15', amountCents: -3000, merchant: 'Zelle Payment' }),
    ];
    expect(buildMerchantProfile(rows, 'Zelle Payment', TODAY)).toBeNull();
  });

  it('L3b (#250 critic F3): the aggregate guard is case-insensitive — a stale-cased row cannot fabricate a relationship', () => {
    const rows = [
      txn({ date: '2026-04-01', amountCents: -1000, merchant: 'ZELLE PAYMENT' }),
      txn({ date: '2026-05-01', amountCents: -2000, merchant: 'ZELLE PAYMENT' }),
      txn({ date: '2026-05-15', amountCents: -3000, merchant: 'ZELLE PAYMENT' }),
    ];
    expect(buildMerchantProfile(rows, 'zelle payment', TODAY)).toBeNull();
    expect(buildMerchantProfile(rows, 'ZELLE PAYMENT', TODAY)).toBeNull();
  });

  it('L4: zero qualifying charges → null (refund/pending/transfer/future only)', () => {
    const rows = [
      txn({ date: '2026-05-02', amountCents: 1500 }),
      txn({ date: '2026-06-05', amountCents: -999, status: 'PENDING' }),
      txn({ date: '2026-04-01', amountCents: -5000, isTransfer: true }),
      txn({ date: '2026-06-15', amountCents: -777 }),
    ];
    expect(buildMerchantProfile(rows, 'Cafe Nine', TODAY)).toBeNull();
    expect(buildMerchantProfile(rows, 'Nowhere Shop', TODAY)).toBeNull();
    expect(buildMerchantProfile(rows, '  ', TODAY)).toBeNull();
  });
});

describe('buildMerchantProfile — trend windows', () => {
  it('L6: old merchant with quiet windows renders both as zeros', () => {
    const rows = [
      txn({ date: '2025-10-05', amountCents: -4000 }),
      txn({ date: '2025-10-12', amountCents: -4000 }),
      txn({ date: '2025-10-19', amountCents: -4000 }),
    ];
    const p = buildMerchantProfile(rows, 'Cafe Nine', TODAY)!;
    expect(p.typicalCents).toBe(4000);
    expect(p.recentWindow).toEqual({
      fromYm: '2026-03',
      toYm: '2026-05',
      chargeCount: 0,
      totalCents: 0,
      avgPerMonthCents: 0,
    });
    expect(p.priorWindow).toEqual({
      fromYm: '2025-12',
      toYm: '2026-02',
      chargeCount: 0,
      totalCents: 0,
      avgPerMonthCents: 0,
    });
  });

  it('L7: relationship younger than the recent window → BOTH windows null', () => {
    const rows = [
      txn({ date: '2026-04-02', amountCents: -2000 }),
      txn({ date: '2026-04-20', amountCents: -3000 }),
      txn({ date: '2026-05-10', amountCents: -2500 }),
      txn({ date: '2026-06-01', amountCents: -1800 }),
    ];
    const p = buildMerchantProfile(rows, 'Cafe Nine', TODAY)!;
    expect(p.chargeCount).toBe(4);
    expect(p.typicalCents).toBe(2250); // floor((2000+2500)/2)
    expect(p.hasPattern).toBe(true);
    expect(p.recentWindow).toBeNull();
    expect(p.priorWindow).toBeNull();
  });

  it('L8: odd-n median; firstYm == recentFromYm renders recent, prior null', () => {
    const rows = [
      txn({ date: '2026-03-05', amountCents: -500 }),
      txn({ date: '2026-04-05', amountCents: -700 }),
      txn({ date: '2026-05-05', amountCents: -900 }),
    ];
    const p = buildMerchantProfile(rows, 'Cafe Nine', TODAY)!;
    expect(p.typicalCents).toBe(700);
    expect(p.recentWindow).toEqual({
      fromYm: '2026-03',
      toYm: '2026-05',
      chargeCount: 3,
      totalCents: 2100,
      avgPerMonthCents: 700,
    });
    expect(p.priorWindow).toBeNull();
  });

  it('L9: window average rounding — 10001/3 → 3334, 10000/3 → 3333', () => {
    const mk = (a: number, b: number, c: number) => [
      // Anchor the relationship before the prior window so both windows render.
      txn({ date: '2025-11-01', amountCents: -1 }),
      txn({ date: '2026-03-05', amountCents: -a }),
      txn({ date: '2026-04-05', amountCents: -b }),
      txn({ date: '2026-05-05', amountCents: -c }),
    ];
    expect(
      buildMerchantProfile(mk(3334, 3333, 3334), 'Cafe Nine', TODAY)!.recentWindow!.avgPerMonthCents,
    ).toBe(3334);
    expect(
      buildMerchantProfile(mk(3334, 3333, 3333), 'Cafe Nine', TODAY)!.recentWindow!.avgPerMonthCents,
    ).toBe(3333);
  });

  it('L11: cross-year windows (today 2026-01-15)', () => {
    const jan15 = isoDate('2026-01-15');
    const rows = ['07', '08', '09', '10', '11', '12'].map((mm) =>
      txn({ date: `2025-${mm}-10`, amountCents: -1000 }),
    );
    const p = buildMerchantProfile(rows, 'Cafe Nine', jan15)!;
    expect(p.recentWindow).toEqual({
      fromYm: '2025-10',
      toYm: '2025-12',
      chargeCount: 3,
      totalCents: 3000,
      avgPerMonthCents: 1000,
    });
    expect(p.priorWindow).toEqual({
      fromYm: '2025-07',
      toYm: '2025-09',
      chargeCount: 3,
      totalCents: 3000,
      avgPerMonthCents: 1000,
    });
  });

  it('L12: a charge dated exactly today counts (count, total, lastSeen)', () => {
    const rows = [
      txn({ date: '2026-06-01', amountCents: -100 }),
      txn({ date: '2026-06-05', amountCents: -200 }),
      txn({ date: '2026-06-10', amountCents: -300 }), // == TODAY
    ];
    const p = buildMerchantProfile(rows, 'Cafe Nine', TODAY)!;
    expect(p.chargeCount).toBe(3);
    expect(p.totalCents).toBe(600);
    expect(p.lastSeen).toBe('2026-06-10');
  });
});

describe('seed lock — the lens and the Unusual Charge Radar agree by construction', () => {
  it('demo Blue Bottle: lens typical/count equal the radar baseline exactly', async () => {
    const { buildSeedData } = await import('@/lib/seed/build');
    const { detectUnusualCharges } = await import('@/lib/engine/anomaly/detect');
    const { normalizeMerchant } = await import('@/lib/engine/categorize/normalize');
    const seed = buildSeedData('2026-06-10');
    const today = isoDate('2026-06-10');

    const flag = detectUnusualCharges(seed.transactions, today)[0];
    expect(flag.merchantCanonical).toBe('Blue Bottle Coffee');

    const p = buildMerchantProfile(
      seed.transactions.map((t) => ({
        date: t.date,
        amountCents: t.amountCents,
        merchant: normalizeMerchant(t.rawDescriptor).canonical,
        status: t.status,
        isTransfer: t.isTransfer,
      })),
      'Blue Bottle Coffee',
      today,
    )!;
    // Same universe, same median convention → the two surfaces CANNOT disagree
    // about "typical". A drift here means one engine changed its inclusion rule
    // or median convention without the other (a false-money-copy incubator).
    expect(p.typicalCents).toBe(flag.typicalCents);
    expect(p.chargeCount).toBe(flag.sampleCount);
    // Hand-checked demo truths (asOf 2026-06-10) pinned for the e2e to reuse.
    expect(p.typicalCents).toBe(1156);
    expect(p.chargeCount).toBe(19);
    expect(p.totalCents).toBe(40901);
    expect(p.firstSeen).toBe('2025-01-06');
    expect(p.lastSeen).toBe('2026-06-09');
  });
});
