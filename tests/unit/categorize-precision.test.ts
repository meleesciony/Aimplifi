/**
 * #163 categorization-quality pass — regression locks.
 *
 * Locks the behaviors that closed the gap to Mint/Simplifi:
 *  1. Leaf-precision defaults (Starbucks→coffee, McDonald's→fast-food,
 *     CVS→pharmacy, Home Depot→home-improvement, Xfinity→internet,
 *     GEICO *AUTO→auto-insurance, payroll→paycheck, Delta→air-travel).
 *  2. Bank-side channel prefixes stripped before merchant matching
 *     ("PURCHASE AUTHORIZED ON 06/12 …", "POS DEBIT", "CHECKCARD 0612",
 *     "WEB PMT", card masks).
 *  3. Vertical processor priors: TST* (Toast) → dining, PADDLE.NET → software,
 *     both in the AI-badge band (auto-filed, never silent).
 *  4. New aggregates (Cash App / Apple Cash / PayPal transfer) route to review
 *     and never auto-file.
 *  5. Issuer card-payment ACH forms are transfers, and 'GEICO AUTOPAY' stays
 *     generic insurance (the AUTOPAY token is a channel, not a product line).
 *  6. Income split into precise leaves + backfill's sign guard accepting any
 *     Income-GROUP category.
 */
import { describe, expect, it } from 'vitest';

import { planBackfill } from '@/lib/engine/categorize/backfill';
import { categorize } from '@/lib/engine/categorize/pipeline';
import {
  normalizeMerchant,
  stripBankNoise,
  TOAST_PRIOR_CONFIDENCE_BPS,
} from '@/lib/engine/categorize/normalize';

const txn = (rawDescriptor: string, amountCents = -1234) =>
  ({ rawDescriptor, amountCents, date: '2026-06-10', accountId: 'a' });

describe('leaf-precision defaults (#163)', () => {
  const cases: [string, string][] = [
    ['STARBUCKS STORE 08321 ATLANTA', 'coffee'],
    ["MCDONALD'S F32814 SEATTLE WA", 'fast-food'],
    ['CHICK-FIL-A #01776 ATLANTA', 'fast-food'],
    ['CVS/PHARMACY #08123', 'pharmacy'],
    ['WALGREENS #6332', 'pharmacy'],
    ['THE HOME DEPOT #4712 SEATTLE', 'home-improvement'],
    ['COMCAST / XFINITY 800266278', 'internet'],
    ['GEICO *AUTO 800-841-3000', 'auto-insurance'],
    ['DELTA AIR 0062341022334', 'air-travel'],
    ['GUSTO PAYROLL 9X8Y7Z DIRECT DEP', 'paycheck'],
    ['INTEREST EARNED', 'interest-income'],
    ['STATE OF CA EDD UI DEPOSIT PPD', 'govt-benefits'],
    ['FRANCHISE TAX BD CASTTAXRFD', 'tax-refund'],
  ];
  for (const [raw, want] of cases) {
    it(`${raw} → ${want}`, () => {
      expect(normalizeMerchant(raw).categoryId).toBe(want);
    });
  }

  it("'GEICO AUTOPAY' is the payment CHANNEL, not the auto product — stays generic insurance", () => {
    expect(normalizeMerchant('GEICO AUTOPAY 800-841-3000').categoryId).toBe('insurance');
  });
});

describe('bank-side channel prefixes (#163)', () => {
  it('strips Wells-Fargo-style PURCHASE AUTHORIZED ON prefixes', () => {
    expect(stripBankNoise('PURCHASE AUTHORIZED ON 06/12 STARBUCKS STORE 123 GA')).toBe(
      'STARBUCKS STORE 123 GA',
    );
  });

  it('a prefixed known brand still resolves to the brand', () => {
    const m = normalizeMerchant('PURCHASE AUTHORIZED ON 06/12 STARBUCKS STORE 123 GA');
    expect(m.canonical).toBe('Starbucks');
    expect(m.categoryId).toBe('coffee');
  });

  it('CHECKCARD and POS DEBIT prefixes unwrap too', () => {
    expect(normalizeMerchant('CHECKCARD 0601 STARBUCKS 800-782-7282 WA').canonical).toBe('Starbucks');
    expect(normalizeMerchant('POS DEBIT - NETFLIX.COM 866-579-7172').canonical).toBe('Netflix');
  });

  it('a bare channel phrase is NOT stripped to nothing — stays reviewable', () => {
    expect(stripBankNoise('POS DEBIT')).toBe('POS DEBIT');
  });

  it('WEB PMT unwraps so the payee resolves (auto lender example)', () => {
    expect(normalizeMerchant('WEB PMT TOYOTA FINANCIAL SVC').categoryId).toBe('auto-loan');
  });

  it('REFUND: prefix files back to the payee (returns offset the original category)', () => {
    expect(normalizeMerchant('REFUND: DELTA AIR 0062341234567').categoryId).toBe('air-travel');
  });
});

describe('vertical processor priors (#163)', () => {
  it('TST* (Toast = restaurant POS) files an unknown local as dining with the AI badge', () => {
    const r = categorize(txn('TST* THAI TOM UNIVERSITY'));
    expect(r.categoryId).toBe('dining');
    expect(r.confidenceBps).toBe(TOAST_PRIOR_CONFIDENCE_BPS);
    expect(r.needsReview).toBe(false);
    expect(r.aiBadge).toBe(true); // never silent
  });

  it('the UNIVERSITY location word no longer misfiles a Toast restaurant as education', () => {
    expect(categorize(txn('TST* THAI TOM UNIVERSITY')).categoryId).not.toBe('education');
  });

  it('PADDLE.NET (software-only processor) files the product as software', () => {
    const r = categorize(txn('PADDLE.NET* OBSIDIAN'));
    expect(r.categoryId).toBe('software');
    expect(r.aiBadge).toBe(true);
  });

  it('a bare TST* with no surviving name stays in review', () => {
    expect(categorize(txn('TST*')).needsReview).toBe(true);
  });

  it('vocab beats the prior: a Toast descriptor with an explicit category word keeps it', () => {
    // GOLF is in the category vocabulary; the prior must not override it.
    expect(categorize(txn('TST* GOLF')).categoryId).toBe('entertainment');
  });
});

describe('new aggregates route to review (#163)', () => {
  for (const raw of [
    'CASH APP*JORDAN B 8774174551 CA',
    'APPLE CASH SENT 1INFINITELOOP CA',
    'PAYPAL INST XFER 402-935-7733',
    'CHECK PAID #883',
    'CHECK 2210',
  ]) {
    it(`${raw} → review, aggregate (no durable rules offered)`, () => {
      const m = normalizeMerchant(raw);
      expect(m.aggregate).toBe(true);
      expect(categorize(txn(raw)).needsReview).toBe(true);
    });
  }
});

describe('issuer card-payment ACH forms are transfers (#163)', () => {
  for (const raw of [
    'CHASE CREDIT CRD AUTOPAY PPD ID: 4760039224',
    'CAPITAL ONE CRCARDPMT 0482 WEB',
    'DISCOVER E-PAYMENT 8003472683 DE',
  ]) {
    it(`${raw} → transfer`, () => {
      const r = categorize(txn(raw));
      expect(r.categoryId).toBe('transfer');
      expect(r.needsReview).toBe(false);
    });
  }

  it('real spending with issuer-like words is NOT swallowed (F4 lesson holds)', () => {
    // A retail purchase that merely mentions a card brand word must stay spend.
    expect(categorize(txn('DISCOUNT TIRE #482 MESA AZ')).categoryId).toBe('auto-maintenance');
  });
});

describe('hostile-critic cycle-1 locks (#163 P1/P2 findings)', () => {
  // P1-1: an OUTFLOW must never auto-file into an Income-group leaf via the
  // merchant-default path — a Stripe balance debit, a tenant PAYING rent
  // through Buildium, or a Gusto/ADP fee is spend (or ambiguous), never income.
  const outflowIncomeCases = [
    'STRIPE TRANSFER ST-X8B2L',
    'BUILDIUM PAYMENT',
    'CONCUR TECHNOLOGIES INC',
    'DASHER DIRECT TRANSFER',
    'GUSTO FEE 123456',
    'ADP PAYROLL FEES ADP - FEES',
    'INTEREST EARNED REVERSAL',
  ];
  for (const raw of outflowIncomeCases) {
    it(`OUTFLOW '${raw}' → review, never silent income`, () => {
      const r = categorize(txn(raw, -12000));
      expect(r.needsReview).toBe(true);
      expect(r.categoryId).toBe('uncategorized');
    });
  }

  it('the INFLOW direction still files (Stripe payout → side-income)', () => {
    const r = categorize(txn('STRIPE TRANSFER ST-X8B2L', 42250));
    expect(r.categoryId).toBe('side-income');
    expect(r.needsReview).toBe(false);
  });

  // P1-3 / P2-4: location/name-word collisions must not auto-file wrong.
  const collisionCases: [string, string][] = [
    ['LOS BRAVOS JIMMY CARTER BLVD', 'kids'],
    ['CARTER BANK & TRUST FEE', 'kids'],
    ['CARTERS LAKE MARINA', 'kids'],
    ['CAVA FALLS CHURCH VA', 'charity'],
    ['SWEETGREEN FALLS CHURCH', 'charity'],
    ['PHO HOA #12', 'hoa'],
    ['HOA BINH MARKET', 'hoa'],
    ['FIDELITY NATIONAL TITLE', 'investment'],
    ['PROGRESSIVE LEASING 877-898-1970', 'auto-insurance'],
  ];
  for (const [raw, wrongLeaf] of collisionCases) {
    it(`'${raw}' never auto-files as ${wrongLeaf}`, () => {
      expect(categorize(txn(raw)).categoryId).not.toBe(wrongLeaf);
    });
  }

  it('the qualified forms still resolve (the guards did not lose coverage)', () => {
    expect(normalizeMerchant("CARTER'S #0812 ATLANTA GA").categoryId).toBe('kids');
    expect(normalizeMerchant('FIRST BAPTIST CHURCH TITHE').categoryId).toBe('charity');
    expect(normalizeMerchant('OAKWOOD MEADOWS HOA DUES ACH').categoryId).toBe('hoa');
    expect(normalizeMerchant('FIDELITY INVESTMENTS 800-343-3548').categoryId).toBe('investment');
    expect(normalizeMerchant('PROGRESSIVE *INSURANCE 800-776-4737 OH').categoryId).toBe('auto-insurance');
  });

  // P2-7: Goodwill REGISTER forms are retail; a bare GOODWILL is a donation.
  it('GOODWILL INDUSTRIES #12 → clothing; GOODWILL DONATION → charity', () => {
    expect(normalizeMerchant('GOODWILL INDUSTRIES #12 AKRON OH').categoryId).toBe('clothing');
    expect(normalizeMerchant('GOODWILL DONATION CENTER').categoryId).toBe('charity');
  });

  // P3-8: CARDMEMBER SERV needs a payment token — an INTEREST CHARGE is a fee,
  // never an erased transfer.
  it('CARDMEMBER SERV payment vs interest charge', () => {
    expect(normalizeMerchant('CARDMEMBER SERV WEB PYMT').categoryId).toBe('transfer');
    expect(normalizeMerchant('CARDMEMBER SERVICES INTEREST CHARGE').categoryId).not.toBe('transfer');
  });
});

describe('backfill sign guard accepts any Income-GROUP leaf (#163)', () => {
  const row = (over: Partial<Parameters<typeof planBackfill>[0][number]>) => ({
    id: 'r1',
    rawDescriptor: 'X',
    amountCents: -1000,
    date: '2026-06-10',
    accountId: 'a',
    categoryId: 'uncategorized',
    needsReview: true,
    ...over,
  });

  it('a paycheck inflow refiles (paycheck is Income group, not the literal income id)', () => {
    const plan = planBackfill([
      row({ id: 'pay', rawDescriptor: 'GUSTO PAYROLL 9X8Y7Z DIRECT DEP', amountCents: 500000 }),
    ]);
    expect(plan.refiles.map((r) => r.id)).toContain('pay');
    expect(plan.refiles[0].toCategoryId).toBe('paycheck');
  });

  it('an inflow resolving to a spend leaf is still blocked', () => {
    const plan = planBackfill([
      row({ id: 'bad', rawDescriptor: 'STARBUCKS 800-782-7282', amountCents: 700 }),
    ]);
    expect(plan.refiles).toHaveLength(0);
    expect(plan.stillUnsure).toBe(1);
  });
});
