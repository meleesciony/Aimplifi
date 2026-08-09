/**
 * Merchant Pattern Lens narration — rendered-copy locks (EDGE_CASES §Merchant
 * Pattern Lens C-cases; DECISIONS #250). Copy is pinned VERBATIM: the lens is
 * a money surface, so wording drift is a correctness bug (the #221/#249
 * rendered-copy lesson), and the guardrail scan enforces the §Later #19
 * verdict's hard exclusion — no time-of-day / day-of-week pattern vocabulary.
 */
import { describe, expect, it } from 'vitest';
import { isoDate } from '@/lib/dates';
import { type LensTxn, type MerchantProfile, buildMerchantProfile } from '@/lib/engine/merchant/profile';
import {
  LENS_SCOPE_NOTE,
  type LensCadence,
  merchantLensCopy,
  thinHistoryNote,
} from '@/lib/engine/merchant/lens-copy';

const TODAY = isoDate('2026-06-10');

function txn(overrides: Partial<LensTxn> & { amountCents: number; date: string }): LensTxn {
  return { merchant: 'Cafe Nine', status: 'POSTED', isTransfer: false, ...overrides };
}

function l1Profile(): MerchantProfile {
  const rows = [
    txn({ date: '2025-11-14', amountCents: -1000 }),
    txn({ date: '2025-12-05', amountCents: -800 }),
    txn({ date: '2026-01-10', amountCents: -900 }),
    txn({ date: '2026-02-20', amountCents: -700 }),
    txn({ date: '2026-03-08', amountCents: -1100 }),
    txn({ date: '2026-04-12', amountCents: -600 }),
    txn({ date: '2026-05-25', amountCents: -1200 }),
    txn({ date: '2026-06-03', amountCents: -500 }),
  ];
  return buildMerchantProfile(rows, 'Cafe Nine', TODAY)!;
}

describe('merchantLensCopy — pinned rendering', () => {
  it('C1: rich history renders every line verbatim (L1 figures)', () => {
    const c = merchantLensCopy(l1Profile());
    expect(c.heading).toBe('Your pattern at Cafe Nine');
    expect(c.factsLine).toBe(
      '8 charges since Nov 2025 — $68.00 in all; the last was Wed, Jun 3, 2026.',
    );
    expect(c.typicalLine).toBe('Typically $8.50 a charge (median of 8 posted charges).');
    expect(c.trendLine).toBe(
      'Mar 2026–May 2026: 3 charges, about $9.67/mo — vs about $8.00/mo in Dec 2025–Feb 2026.',
    );
    expect(c.windowNote).toBe(
      "Averages use full calendar months; the current month isn't counted.",
    );
    expect(c.cadenceLine).toBeNull();
  });

  it('C2: single charge — singular facts, no pattern lines, thin-history note', () => {
    const p = buildMerchantProfile(
      [txn({ date: '2026-06-01', amountCents: -400 })],
      'Cafe Nine',
      TODAY,
    )!;
    const c = merchantLensCopy(p);
    expect(c.factsLine).toBe('1 charge, $4.00, on Mon, Jun 1, 2026.');
    expect(c.typicalLine).toBeNull();
    expect(c.trendLine).toBeNull();
    expect(c.windowNote).toBeNull();
    expect(thinHistoryNote(p.chargeCount)).toBe(
      'Not enough history for a pattern — figures appear after 3 posted charges.',
    );
    expect(thinHistoryNote(3)).toBeNull();
  });

  it('C3: quiet windows (L6) — "No charges", no empty-vs-empty comparison', () => {
    const p = buildMerchantProfile(
      [
        txn({ date: '2025-10-05', amountCents: -4000 }),
        txn({ date: '2025-10-12', amountCents: -4000 }),
        txn({ date: '2025-10-19', amountCents: -4000 }),
      ],
      'Cafe Nine',
      TODAY,
    )!;
    const c = merchantLensCopy(p);
    expect(c.trendLine).toBe('No charges in Mar 2026–May 2026.');
    expect(c.windowNote).not.toBeNull();
  });

  it('C4: no prior window (L8) — trend without the vs clause', () => {
    const p = buildMerchantProfile(
      [
        txn({ date: '2026-03-05', amountCents: -500 }),
        txn({ date: '2026-04-05', amountCents: -700 }),
        txn({ date: '2026-05-05', amountCents: -900 }),
      ],
      'Cafe Nine',
      TODAY,
    )!;
    expect(merchantLensCopy(p).trendLine).toBe(
      'Mar 2026–May 2026: 3 charges, about $7.00/mo.',
    );
  });

  it('C5: cadence line only from an ACTIVE non-IRREGULAR series, "around" hedge', () => {
    const p = l1Profile();
    // PRODUCTION sign (#250 critic F1): detectRecurring emits SIGNED amounts —
    // negative for expense series. The line must render the magnitude; a
    // "typically −$17.99" against the positive typical line two rows up was
    // the critic's demo-reachable P1.
    const monthly: LensCadence = {
      cadence: 'MONTHLY',
      typicalAmountCents: -1799,
      nextExpectedAt: '2026-07-28',
      active: true,
    };
    expect(merchantLensCopy(p, monthly).cadenceLine).toBe(
      'Looks recurring: monthly, typically $17.99, next expected around Tue, Jul 28, 2026.',
    );
    // Sign-independent: a positive input renders the identical line.
    expect(merchantLensCopy(p, { ...monthly, typicalAmountCents: 1799 }).cadenceLine).toBe(
      merchantLensCopy(p, monthly).cadenceLine,
    );
    expect(merchantLensCopy(p, monthly).cadenceLine).not.toContain('-$');
    expect(merchantLensCopy(p, { ...monthly, active: false }).cadenceLine).toBeNull();
    expect(merchantLensCopy(p, { ...monthly, cadence: 'IRREGULAR' }).cadenceLine).toBeNull();
    expect(merchantLensCopy(p, null).cadenceLine).toBeNull();
  });

  it('C6: tapered-off merchant — "No charges … vs" comparison DOES render', () => {
    const p: MerchantProfile = {
      ...l1Profile(),
      recentWindow: { fromYm: '2026-03', toYm: '2026-05', chargeCount: 0, totalCents: 0, avgPerMonthCents: 0 },
      priorWindow: { fromYm: '2025-12', toYm: '2026-02', chargeCount: 3, totalCents: 7500, avgPerMonthCents: 2500 },
    } as MerchantProfile;
    expect(merchantLensCopy(p).trendLine).toBe(
      'No charges in Mar 2026–May 2026 — vs about $25.00/mo in Dec 2025–Feb 2026.',
    );
  });

  it('C8 (audit P2): the scope note states the GROSS-POSTED basis and names the register summary as the different set', () => {
    // Three figures, one merchant, one screen: the lens total is gross posted
    // charges (refunds never netted, nothing pending) while the register
    // summary below nets refunds and includes pending. The note must say both
    // bases so the figures can be reconciled — byte-locked here.
    expect(LENS_SCOPE_NOTE).toBe(
      'Covers every posted charge at this merchant across your history — gross, refunds not netted, nothing pending. The summary below nets refunds and includes pending; the list may show only a slice.',
    );
  });
});

describe('merchantLensCopy — guardrails (C7)', () => {
  // The §Later #19 verdict's hard exclusion: Transaction.date is date-only, so
  // time-of-day / day-of-week PATTERN claims cannot be grounded. Full day names
  // are banned; abbreviated date STAMPS ("Wed, Jun 3, 2026") are facts, allowed.
  const PATTERN_VOCAB =
    /\b(morning|afternoon|evening|night|weekday|weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?\b/i;
  const SHAME_OR_ADVICE =
    /\b(should|must|stop|wasted?|wasting|guilty|guilt|shame|splurg\w*|overspen\w*|cut back|bad habit)\b/i;

  it('every rendered line is free of ungroundable pattern vocabulary and shame/advice', () => {
    const cadence: LensCadence = {
      cadence: 'WEEKLY',
      typicalAmountCents: 750,
      nextExpectedAt: '2026-06-17',
      active: true,
    };
    const profiles = [
      merchantLensCopy(l1Profile(), cadence),
      merchantLensCopy(
        buildMerchantProfile([txn({ date: '2026-06-01', amountCents: -400 })], 'Cafe Nine', TODAY)!,
      ),
      merchantLensCopy(
        buildMerchantProfile(
          [
            txn({ date: '2025-10-05', amountCents: -4000 }),
            txn({ date: '2025-10-12', amountCents: -4000 }),
            txn({ date: '2025-10-19', amountCents: -4000 }),
          ],
          'Cafe Nine',
          TODAY,
        )!,
      ),
    ];
    for (const c of profiles) {
      const lines = [c.heading, c.factsLine, c.typicalLine, c.trendLine, c.windowNote, c.cadenceLine]
        .filter((s): s is string => s !== null)
        .concat(thinHistoryNote(1) ?? [], LENS_SCOPE_NOTE);
      for (const line of lines) {
        expect(line).not.toMatch(PATTERN_VOCAB);
        expect(line).not.toMatch(SHAME_OR_ADVICE);
      }
    }
  });
});
