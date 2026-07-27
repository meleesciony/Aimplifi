/**
 * Tax-year export engine — known-answer tests (owner request 2026-07-27: notes +
 * tax-relevant fields + "easy to export that data during tax time"; class set and
 * the business box chosen by the owner the same day).
 *
 * Every expected figure below is hand-computed in the comment beside it. The four
 * money decisions this engine makes are each locked in BOTH directions, because
 * every one of them is a claim on a figure that may reach a tax return:
 * a refund subtracts, a pending charge is excluded and REPORTED, a transfer is
 * excluded and REPORTED, and the year is the transaction's own calendar date.
 */
import { describe, expect, it } from 'vitest';
import { buildTaxExport, taxYearsWithTags, type TaxExportRow } from '@/lib/engine/tax/export';
import { TAX_CLASSES, TAX_CLASS_LABELS, isTaxClass, taxClassLabel } from '@/lib/engine/tax/classes';

const row = (over: Partial<TaxExportRow> & Pick<TaxExportRow, 'date' | 'amountCents'>): TaxExportRow => ({
  description: 'Test Merchant',
  status: 'POSTED',
  isTransfer: false,
  isSplitParent: false,
  taxClass: 'medical',
  note: null,
  ...over,
});

describe('the class set', () => {
  it('is closed, ordered, and every member has exactly one label', () => {
    // The business box the owner asked for is present and LAST — it is a
    // different kind of claim from the six personal itemized drawers.
    expect(TAX_CLASSES).toEqual([
      'medical',
      'dependent-care',
      'charitable',
      'mortgage-interest',
      'state-local-tax',
      'education',
      'business',
    ]);
    expect(Object.keys(TAX_CLASS_LABELS).sort()).toEqual([...TAX_CLASSES].sort());
    // One author for the label, so a picker, a row and an export heading cannot
    // become three names for one drawer (the L.29 drift).
    expect(new Set(Object.values(TAX_CLASS_LABELS)).size).toBe(TAX_CLASSES.length);
    expect(taxClassLabel('business')).toBe('Business expense');
  });

  it('reads an unrecognized stored value as UNTAGGED, never as a class', () => {
    // The column is a free string, so a value from a future version or a hand
    // edit must not crash a report or, worse, land in the wrong drawer's total.
    for (const bad of [null, undefined, '', 'MEDICAL', 'medical ', 'groceries', 'tax']) {
      expect(isTaxClass(bad)).toBe(false);
      expect(taxClassLabel(bad)).toBeNull();
    }
    expect(isTaxClass('medical')).toBe(true);
  });
});

describe('buildTaxExport — grouping and the year boundary', () => {
  it('groups by class, sorts each group by date, and totals to the cent', () => {
    const out = buildTaxExport(
      [
        row({ date: '2025-03-14', amountCents: -12550, description: 'City Pharmacy', note: 'prescription' }),
        row({ date: '2025-01-09', amountCents: -8000, description: 'Dental Group' }),
        row({ date: '2025-06-01', amountCents: -140000, taxClass: 'dependent-care', description: 'Bright Days' }),
        row({ date: '2025-11-02', amountCents: -25000, taxClass: 'charitable', description: 'Food Bank' }),
        row({ date: '2025-04-04', amountCents: -60000, taxClass: 'business', description: 'Ink & Toner Co' }),
      ],
      2025,
    );
    // Groups appear in the module's fixed order, and ONLY the tagged ones.
    expect(out.groups.map((g) => g.taxClass)).toEqual(['medical', 'dependent-care', 'charitable', 'business']);
    expect(out.groups.map((g) => g.label)).toEqual([
      'Medical & dental',
      'Child & dependent care',
      'Charitable donations',
      'Business expense',
    ]);
    // medical: $80.00 + $125.50 = $205.50, oldest first
    expect(out.groups[0].lines.map((l) => l.date)).toEqual(['2025-01-09', '2025-03-14']);
    expect(out.groups[0].paidCents).toBe(20550);
    expect(out.groups[1].paidCents).toBe(140000); // $1,400.00
    expect(out.groups[2].paidCents).toBe(25000); // $250.00
    expect(out.groups[3].paidCents).toBe(60000); // $600.00
    // 20550 + 140000 + 25000 + 60000 = 245550 → $2,455.50
    expect(out.totalPaidCents).toBe(245550);
    expect(out.totalPaidCents).toBe(out.groups.reduce((s, g) => s + g.paidCents, 0));
    // The reader's note rides along verbatim and is never parsed or summed.
    expect(out.groups[0].lines[1].note).toBe('prescription');
    expect(out.year).toBe(2025);
  });

  it('the year is the transaction date, inclusive at BOTH ends', () => {
    const rows = [
      row({ date: '2024-12-31', amountCents: -10000 }),
      row({ date: '2025-01-01', amountCents: -20000 }),
      row({ date: '2025-12-31', amountCents: -30000 }),
      row({ date: '2026-01-01', amountCents: -40000 }),
    ];
    const out = buildTaxExport(rows, 2025);
    // Both edges IN, both neighbours OUT: 20000 + 30000 = 50000
    expect(out.groups[0].lines.map((l) => l.date)).toEqual(['2025-01-01', '2025-12-31']);
    expect(out.totalPaidCents).toBe(50000);
    // …and the excluded neighbours are not reported as pending or transfers —
    // being in another year is not an exclusion the reader needs explained.
    expect(out.excludedPending).toBe(0);
    expect(out.excludedTransfers).toBe(0);
    // The same rows read for the adjacent years, so nothing is lost, only moved.
    expect(buildTaxExport(rows, 2024).totalPaidCents).toBe(10000);
    expect(buildTaxExport(rows, 2026).totalPaidCents).toBe(40000);
  });

  it('an untagged row never enters a total, however large', () => {
    const out = buildTaxExport(
      [
        row({ date: '2025-05-05', amountCents: -500000, taxClass: null }),
        row({ date: '2025-05-06', amountCents: -1000, taxClass: 'medical' }),
      ],
      2025,
    );
    expect(out.totalPaidCents).toBe(1000);
    expect(out.groups).toHaveLength(1);
  });
});

describe('the four money decisions, each locked in both directions', () => {
  it('1. a refund SUBTRACTS from its own class, and is reported beside the net', () => {
    // $400.00 of medical, $150.00 reimbursed → net paid $250.00.
    // Summing magnitudes would report $550.00 — money the reader never spent, in
    // the overstating direction, on a figure that may reach a return.
    const out = buildTaxExport(
      [
        row({ date: '2025-02-01', amountCents: -40000, description: 'Clinic' }),
        row({ date: '2025-03-01', amountCents: 15000, description: 'Insurance reimbursement' }),
      ],
      2025,
    );
    expect(out.groups[0].paidCents).toBe(25000);
    expect(out.groups[0].refundedCents).toBe(15000);
    expect(out.totalPaidCents).toBe(25000);
    expect(out.totalRefundedCents).toBe(15000);
    // FAIL-OLD: the magnitude sum this rejects.
    expect(out.groups[0].paidCents).not.toBe(55000);
    // The netting is disclosed, or a netted total reads as a raw one.
    expect(out.disclosures.join(' ')).toMatch(/subtracted from its own group/i);
    // A refund only ever affects ITS OWN class.
    const cross = buildTaxExport(
      [
        row({ date: '2025-02-01', amountCents: -40000 }),
        row({ date: '2025-03-01', amountCents: 15000, taxClass: 'charitable' }),
      ],
      2025,
    );
    expect(cross.groups.find((g) => g.taxClass === 'medical')!.paidCents).toBe(40000);
    expect(cross.groups.find((g) => g.taxClass === 'charitable')!.paidCents).toBe(-15000);
  });

  it('1b. a class refunded to below zero reports the NEGATIVE, never a clamp', () => {
    // Reimbursed in a later year than the charge, or refunded twice: the total
    // goes below zero and saying so is the point. Clamping to $0.00 would hide
    // exactly the case a reader needs to look at.
    const out = buildTaxExport(
      [
        row({ date: '2025-02-01', amountCents: -10000 }),
        row({ date: '2025-06-01', amountCents: 30000, description: 'Refund' }),
      ],
      2025,
    );
    expect(out.groups[0].paidCents).toBe(-20000);
    expect(out.totalPaidCents).toBe(-20000);
  });

  it('2. a PENDING charge is excluded AND counted, never silently dropped', () => {
    const out = buildTaxExport(
      [
        row({ date: '2025-12-30', amountCents: -20000, status: 'PENDING' }),
        row({ date: '2025-12-31', amountCents: -5000 }),
      ],
      2025,
    );
    expect(out.totalPaidCents).toBe(5000); // the pending $200.00 is out
    expect(out.excludedPending).toBe(1);
    // Reported in words, singular, so a short total is explainable to a reader
    // tagging in early January.
    expect(out.disclosures.join(' ')).toMatch(/1 tagged charge has not posted yet/i);
    expect(out.disclosures.join(' ')).not.toMatch(/charges have not posted/i);
    // Nothing pending → no sentence at all (a $0 disclosure names a mechanism
    // that did not act).
    const clean = buildTaxExport([row({ date: '2025-12-31', amountCents: -5000 })], 2025);
    expect(clean.excludedPending).toBe(0);
    expect(clean.disclosures.join(' ')).not.toMatch(/posted yet/i);
  });

  it('3. a tagged TRANSFER is excluded AND counted — it pays nobody', () => {
    // The commonest case is a credit-card payment: the deductible charge is the
    // purchase on the card, so counting the payment too would double it.
    const out = buildTaxExport(
      [
        row({ date: '2025-07-01', amountCents: -90000, isTransfer: true, description: 'Payment to Visa' }),
        row({ date: '2025-07-02', amountCents: -4500, description: 'Pharmacy' }),
      ],
      2025,
    );
    expect(out.totalPaidCents).toBe(4500);
    expect(out.excludedTransfers).toBe(1);
    expect(out.disclosures.join(' ')).toMatch(/transfer pays nobody/i);
    // A transfer is counted out BEFORE the status gate, so it is reported as a
    // transfer rather than as pending — one row, one reason.
    const pendingTransfer = buildTaxExport(
      [row({ date: '2025-07-01', amountCents: -90000, isTransfer: true, status: 'PENDING' })],
      2025,
    );
    expect(pendingTransfer.excludedTransfers).toBe(1);
    expect(pendingTransfer.excludedPending).toBe(0);
  });

  it('4. an empty class is OMITTED, not printed at $0.00', () => {
    const out = buildTaxExport([row({ date: '2025-01-01', amountCents: -1000 })], 2025);
    expect(out.groups.map((g) => g.taxClass)).toEqual(['medical']);
    // …and the omission is disclosed, so a missing drawer reads as "you tagged
    // nothing here" rather than "nothing qualified" (the L.29 rule).
    expect(out.disclosures.join(' ')).toMatch(/means nothing was tagged to it, not that nothing qualified/i);
  });
});

describe('what the export refuses to claim', () => {
  it('always says it is not tax advice and computes no entitlement', () => {
    const out = buildTaxExport([row({ date: '2025-01-01', amountCents: -1000 })], 2025);
    // Unconditional: the first disclosure is true for every reader and every year,
    // and a total that travels without it reads as a computed entitlement.
    expect(out.disclosures[0]).toMatch(/not tax advice/i);
    expect(out.disclosures[0]).toMatch(/what you tagged, added up/i);
    // No LABEL or line may assert deductibility. Checked over everything except
    // `disclosures`, because the disclaimer legitimately uses the word in order to
    // deny it — the first cut of this assertion scanned the whole object and was
    // failed by the very sentence it exists to protect, which is the difference
    // between a claim and a denial of one.
    const { disclosures, ...figures } = out;
    expect(JSON.stringify(figures).toLowerCase()).not.toMatch(
      /deductible|you can claim|entitled|refund due|write ?off/,
    );
    // And the disclaimer's own wording is a DENIAL, never an assertion.
    expect(disclosures[0]).toMatch(/does not decide what is deductible/i);
  });

  it('an empty year is an empty report with its disclosure intact, not a zero claim', () => {
    const out = buildTaxExport([], 2025);
    expect(out.groups).toEqual([]);
    expect(out.totalPaidCents).toBe(0);
    expect(out.excludedPending).toBe(0);
    expect(out.disclosures[0]).toMatch(/not tax advice/i);
  });
});

/**
 * Added with the persistence half of the slice (O.1 part 2), when the export started
 * reading the real table instead of a hand-built fixture.
 */
describe('decision 4 — a split parent is a container, not a charge', () => {
  it('excludes the container and counts it, so the split is never double-counted', () => {
    // A $300 pharmacy charge the reader split into $200 medical + $100 household.
    // All three rows exist in the table; only the CHILD carries deductible money.
    const x = buildTaxExport(
      [
        row({ date: '2025-03-01', amountCents: -30_000, isSplitParent: true, description: 'Walgreens' }),
        row({ date: '2025-03-01', amountCents: -20_000, description: 'Walgreens' }),
      ],
      2025,
    );
    // $200.00 — the child alone. Counting the parent too would report $500.00.
    expect(x.groups).toHaveLength(1);
    expect(x.groups[0]?.paidCents).toBe(20_000);
    expect(x.totalPaidCents).toBe(20_000);
    expect(x.excludedSplitParents).toBe(1);
    // Excluded is never silent: the reader whose total looks short can read why.
    expect(x.disclosures.some((d) => d.includes('split into parts'))).toBe(true);
  });

  it('counts the container BEFORE the transfer and pending gates', () => {
    // A split parent that is also pending is reported once, as a split parent —
    // the reason a reader would act on ("tag the parts") is the useful one.
    const x = buildTaxExport(
      [row({ date: '2025-05-05', amountCents: -1_000, isSplitParent: true, status: 'PENDING' })],
      2025,
    );
    expect(x.excludedSplitParents).toBe(1);
    expect(x.excludedPending).toBe(0);
    expect(x.groups).toHaveLength(0);
  });
});

describe('taxYearsWithTags — the years worth offering', () => {
  it('lists only years that would actually produce a group, most recent first', () => {
    const years = taxYearsWithTags([
      row({ date: '2023-06-01', amountCents: -1_000 }), // real
      row({ date: '2025-01-02', amountCents: -2_500 }), // real
      row({ date: '2025-12-31', amountCents: -100 }), // same year again
      row({ date: '2024-04-04', amountCents: -900, status: 'PENDING' }), // nothing survives
      row({ date: '2022-04-04', amountCents: -900, isTransfer: true }), // nothing survives
      row({ date: '2021-04-04', amountCents: -900, isSplitParent: true }), // nothing survives
      row({ date: '2020-04-04', amountCents: -900, taxClass: null }), // untagged
      row({ date: '2019-04-04', amountCents: -900, taxClass: 'not-a-class' }), // unrecognized
    ]);
    expect(years).toEqual([2025, 2023]);
  });

  it('offers nothing when nothing is tagged, rather than the current year', () => {
    expect(taxYearsWithTags([row({ date: '2025-02-02', amountCents: -500, taxClass: null })])).toEqual([]);
  });

  it('agrees with buildTaxExport: every year it offers has at least one group', () => {
    // The contract that keeps a settings link from downloading an empty file.
    const rows = [
      row({ date: '2024-07-07', amountCents: -4_242 }),
      row({ date: '2025-08-08', amountCents: -100, status: 'PENDING' }),
    ];
    for (const y of taxYearsWithTags(rows)) {
      expect(buildTaxExport(rows, y).groups.length).toBeGreaterThan(0);
    }
    expect(taxYearsWithTags(rows)).toEqual([2024]);
  });
});
