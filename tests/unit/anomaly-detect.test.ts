/**
 * Unusual Charge Radar v1 — per-merchant median+MAD detector (#249).
 *
 * Every expected number is hand-verified in docs/EDGE_CASES.md §Unusual Charge
 * Radar (F1–F12). Abstention cases are the MAJORITY on purpose (the
 * context-carrying lesson): the detector's honesty lives in what it does NOT
 * flag — thin history, boundary deviations, small charges, stale outliers,
 * pending/transfer/refund/split rows, aggregate pseudo-merchants, subscriptions
 * whose price merely rose.
 */
import { describe, expect, it } from 'vitest';
import { isoDate } from '@/lib/dates';
import { buildSeedData } from '@/lib/seed/build';
import {
  ANOMALY_FLOOR_CENTS,
  ANOMALY_K_MAD,
  ANOMALY_MAX_RESULTS,
  ANOMALY_MIN_SAMPLE,
  ANOMALY_RECENT_WINDOW_DAYS,
  detectUnusualCharges,
  type AnomalyTxn,
} from '@/lib/engine/anomaly/detect';

const TODAY = isoDate('2026-06-10');

let seq = 0;
function txn(overrides: Partial<AnomalyTxn> & { amountCents: number }): AnomalyTxn {
  return {
    id: `t-${String(++seq).padStart(3, '0')}`,
    date: '2026-05-20',
    rawDescriptor: 'SQ *BLUE BOTTLE 0042 OAK',
    isTransfer: false,
    status: 'POSTED',
    ...overrides,
  };
}

/** n charges of the given magnitudes (cents, positive) at one merchant, spread over past dates. */
function charges(magnitudes: number[], raw = 'SQ *BLUE BOTTLE 0042 OAK'): AnomalyTxn[] {
  return magnitudes.map((m, i) =>
    txn({ amountCents: -m, rawDescriptor: raw, date: `2026-05-${String(2 + i).padStart(2, '0')}` }),
  );
}

describe('detectUnusualCharges — flags (hand-verified)', () => {
  it('F1: even-n baseline — $214.36 coffee against [5,6,7,8,9]$ history flags with exact stats', () => {
    const txns = [...charges([500, 600, 700, 800, 900]), txn({ amountCents: -21436, date: '2026-06-02', id: 'anom' })];
    const out = detectUnusualCharges(txns, TODAY);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      txnId: 'anom',
      merchantCanonical: 'Blue Bottle Coffee',
      date: '2026-06-02',
      amountCents: 21436,
      typicalCents: 750, // floor((700+800)/2)
      madCents: 150, // deviations sorted [50,50,150,150,250,20686] → floor((150+150)/2)
      sampleCount: 6,
      deviationCents: 20686, // 21436 − 750
    });
  });

  it('F7: odd-n baseline — median is the middle element, MAD the middle deviation', () => {
    const txns = [
      ...charges([500, 700, 900, 1100, 1300, 1500]),
      txn({ amountCents: -21436, date: '2026-06-01', id: 'anom7' }),
    ];
    const out = detectUnusualCharges(txns, TODAY);
    expect(out).toHaveLength(1);
    // sorted magnitudes [500,700,900,1100,1300,1500,21436]: median 1100;
    // deviations sorted [0,200,200,400,400,600,20336]: MAD 400; threshold 4·400+4000=5600.
    expect(out[0]).toMatchObject({ typicalCents: 1100, madCents: 400, sampleCount: 7, deviationCents: 20336 });
  });

  it('F10: constant-price subscription (MAD=0) — a real spike flags via the additive floor', () => {
    const txns = [
      ...charges([1549, 1549, 1549, 1549, 1799], 'NETFLIX.COM 866-579-7172'),
      txn({ amountCents: -20000, rawDescriptor: 'NETFLIX.COM 866-579-7172', date: '2026-06-03', id: 'spike' }),
    ];
    const out = detectUnusualCharges(txns, TODAY);
    // median floor((1549+1549)/2)=1549, MAD 0, threshold 4000 < deviation 18451.
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ txnId: 'spike', typicalCents: 1549, madCents: 0, deviationCents: 18451 });
  });

  it('F8a: at most one flag per merchant — the larger deviation wins', () => {
    const txns = [
      ...charges([500, 600, 700, 800]),
      txn({ amountCents: -15000, date: '2026-06-05', id: 'smaller' }),
      txn({ amountCents: -21436, date: '2026-06-02', id: 'larger' }),
    ];
    const out = detectUnusualCharges(txns, TODAY);
    expect(out).toHaveLength(1);
    expect(out[0].txnId).toBe('larger');
  });

  it('F8b: equal deviations at one merchant — the later date wins', () => {
    const txns = [
      ...charges([500, 600, 700, 800]),
      txn({ amountCents: -21436, date: '2026-06-02', id: 'earlier' }),
      txn({ amountCents: -21436, date: '2026-06-05', id: 'later' }),
    ];
    const out = detectUnusualCharges(txns, TODAY);
    expect(out).toHaveLength(1);
    expect(out[0].txnId).toBe('later');
  });

  it('F9: overall cap — top ANOMALY_MAX_RESULTS by deviation, ordered descending', () => {
    // Four merchants, engineered deviations 20686 > 18686 > 16686 > 14686.
    const mk = (raw: string, spike: number, id: string) => [
      ...charges([500, 600, 700, 800, 900], raw),
      txn({ amountCents: -spike, rawDescriptor: raw, date: '2026-06-02', id }),
    ];
    const txns = [
      ...mk('SQ *BLUE BOTTLE 0042 OAK', 21436, 'a'),
      ...mk('SQ *PONCE CITY DONUTS ATL', 19436, 'b'),
      ...mk('CHICK-FIL-A #02034', 17436, 'c'),
      ...mk("MCDONALD'S F13339", 15436, 'd'),
    ];
    const out = detectUnusualCharges(txns, TODAY);
    expect(out).toHaveLength(ANOMALY_MAX_RESULTS);
    expect(out.map((o) => o.txnId)).toEqual(['a', 'b', 'c']);
    expect(out[0].deviationCents).toBeGreaterThan(out[1].deviationCents);
    expect(out[1].deviationCents).toBeGreaterThan(out[2].deviationCents);
  });

  it('F12: equal deviations across merchants order by canonical name ascending', () => {
    const mk = (raw: string, id: string) => [
      ...charges([500, 600, 700, 800, 900], raw),
      txn({ amountCents: -21436, rawDescriptor: raw, date: '2026-06-02', id }),
    ];
    const txns = [...mk('SQ *PONCE CITY DONUTS ATL', 'p'), ...mk('SQ *BLUE BOTTLE 0042 OAK', 'b')];
    const out = detectUnusualCharges(txns, TODAY);
    expect(out.map((o) => o.merchantCanonical)).toEqual(['Blue Bottle Coffee', 'Ponce City Donuts']);
  });

  it('F11: deterministic — identical input yields deep-equal output', () => {
    const txns = [...charges([500, 600, 700, 800, 900]), txn({ amountCents: -21436, date: '2026-06-02', id: 'anom' })];
    expect(detectUnusualCharges(txns, TODAY)).toEqual(detectUnusualCharges(txns, TODAY));
  });
});

describe('detectUnusualCharges — abstentions (the majority)', () => {
  it('F2: deviation exactly at K·MAD+FLOOR does NOT flag (strictly-greater rule); one cent above does', () => {
    // [1000×5, x]: median 1000, MAD 0, threshold exactly ANOMALY_FLOOR_CENTS.
    const at = [...charges([1000, 1000, 1000, 1000, 1000]), txn({ amountCents: -5000, date: '2026-06-02' })];
    expect(detectUnusualCharges(at, TODAY)).toEqual([]);
    const above = [...charges([1000, 1000, 1000, 1000, 1000]), txn({ amountCents: -5001, date: '2026-06-02' })];
    expect(detectUnusualCharges(above, TODAY)).toHaveLength(1);
  });

  it('F3: below MIN_SAMPLE never flags, however extreme the charge', () => {
    const txns = [...charges([500, 600, 700, 800]), txn({ amountCents: -999999, date: '2026-06-02' })];
    expect(txns).toHaveLength(ANOMALY_MIN_SAMPLE - 1);
    expect(detectUnusualCharges(txns, TODAY)).toEqual([]);
  });

  it('F4: an unusually SMALL charge never flags (above-median only)', () => {
    const txns = [...charges([8000, 8000, 8000, 8000, 8000]), txn({ amountCents: -100, date: '2026-06-02' })];
    expect(detectUnusualCharges(txns, TODAY)).toEqual([]);
  });

  it('F5: an outlier older than the recent window is baseline-only, never news', () => {
    const stale = txn({ amountCents: -21436, date: '2026-04-01' }); // 70 days ago ≥ 45
    const txns = [...charges([500, 600, 700, 800]), txn({ amountCents: -900, date: '2026-06-02' }), stale];
    expect(detectUnusualCharges(txns, TODAY)).toEqual([]);
  });

  it('F5b: window boundary — exactly RECENT_WINDOW_DAYS old cannot flag; one day younger can', () => {
    const base = charges([500, 600, 700, 800, 900]);
    const atBoundary = txn({ amountCents: -21436, date: '2026-04-26' }); // 45 days before 06-10
    expect(detectUnusualCharges([...base, atBoundary], TODAY)).toEqual([]);
    const inside = txn({ amountCents: -21436, date: '2026-04-27' }); // 44 days
    expect(detectUnusualCharges([...base, inside], TODAY)).toHaveLength(1);
    expect(ANOMALY_RECENT_WINDOW_DAYS).toBe(45);
  });

  it('F6: PENDING, transfer, refund (positive), and split-parent rows are excluded', () => {
    const base = charges([500, 600, 700, 800, 900]);
    for (const bad of [
      txn({ amountCents: -21436, date: '2026-06-02', status: 'PENDING' }),
      txn({ amountCents: -21436, date: '2026-06-02', isTransfer: true }),
      txn({ amountCents: 21436, date: '2026-06-02' }), // refund/inflow
      txn({ amountCents: -21436, date: '2026-06-02', isSplitParent: true }),
    ]) {
      expect(detectUnusualCharges([...base, bad], TODAY)).toEqual([]);
    }
  });

  it('F6b: a future-dated charge neither flags nor joins the baseline', () => {
    const future = txn({ amountCents: -21436, date: '2026-06-11' });
    const txns = [...charges([500, 600, 700, 800, 900]), future];
    expect(detectUnusualCharges(txns, TODAY)).toEqual([]);
  });

  it('F6c: aggregate pseudo-merchants (ATM) never flag — heterogeneous payees are not one history', () => {
    const txns = [
      ...charges([4000, 5000, 6000, 7000, 8000], 'ATM WITHDRAWAL 00482 PEACHTREE ST'),
      txn({ amountCents: -99999, rawDescriptor: 'ATM WITHDRAWAL 00482 PEACHTREE ST', date: '2026-06-02' }),
    ];
    expect(detectUnusualCharges(txns, TODAY)).toEqual([]);
  });

  it('F10b: a subscription price increase ($15.49 → $17.99) never flags — that is price-increase’s job', () => {
    const txns = charges([1549, 1549, 1549, 1549, 1799, 1799], 'NETFLIX.COM 866-579-7172').map((t, i) =>
      i >= 4 ? { ...t, date: `2026-06-0${i - 3}` } : t,
    );
    expect(detectUnusualCharges(txns, TODAY)).toEqual([]);
  });

  it('empty input and no-merchant-with-history inputs return []', () => {
    expect(detectUnusualCharges([], TODAY)).toEqual([]);
    expect(detectUnusualCharges(charges([500]), TODAY)).toEqual([]);
  });

  it('SEED LOCK (demo-first): the demo dataset flags EXACTLY the engineered $214.36 coffee', () => {
    const seed = buildSeedData('2026-06-10');
    const out = detectUnusualCharges(seed.transactions, isoDate('2026-06-10'));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      merchantCanonical: 'Blue Bottle Coffee',
      date: '2026-06-02',
      amountCents: 21436,
    });
    // Baseline sanity: the engineered outlier rides on a real organic history.
    expect(out[0].sampleCount).toBeGreaterThanOrEqual(ANOMALY_MIN_SAMPLE);
    expect(out[0].typicalCents).toBeLessThan(3000); // a coffee-sized typical, not a guess
  });

  it('constants under test are the documented ones (EDGE_CASES §Unusual Charge Radar)', () => {
    expect(ANOMALY_MIN_SAMPLE).toBe(6);
    expect(ANOMALY_K_MAD).toBe(4);
    expect(ANOMALY_FLOOR_CENTS).toBe(4000);
    expect(ANOMALY_MAX_RESULTS).toBe(3);
  });
});
