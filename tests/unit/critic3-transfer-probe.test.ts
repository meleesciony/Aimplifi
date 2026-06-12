/**
 * HOSTILE CRITIC scratch probe (Phase 2 cycle 2 — F4 re-verification).
 * Feeds adversarial descriptors through BOTH categorize() and detectTransfers()
 * and asserts (a) the two modules agree, (b) real spending is never silently
 * erased as a "transfer". Logs every verdict for the critic report.
 */
import { describe, expect, it } from 'vitest';
import { categorize } from '@/lib/engine/categorize/pipeline';
import { detectTransfers } from '@/lib/engine/categorize/transfers';

const probe = (raw: string) => {
  const cat = categorize({ rawDescriptor: raw, amountCents: -4200, date: '2026-06-08', accountId: 'a1' });
  const ids = detectTransfers([
    { id: 'x', accountId: 'a1', date: '2026-06-08', amountCents: -4200, rawDescriptor: raw },
  ]);
  return { raw, categoryId: cat.categoryId, merchant: cat.merchantCanonical, needsReview: cat.needsReview, isTransfer: ids.has('x') };
};

describe('critic cycle-2 F4 probe: categorize() and detectTransfers() must agree', () => {
  const mandated = [
    'T-MOBILE PREPAY REFILL',
    'GIFT CARD PAYMENT - STARBUCKS.COM',
    'GEICO AUTOPAY',
    'NETFLIX EPAY',
    'CHASE EPAY SAPPHIRE',
    'AUTOPAY PAYMENT - THANK YOU',
    // critic-invented, cycle 2:
    'EPAYROLL DEPOSIT ACME ANALYTICS', // \bEPAY must NOT fire inside EPAYROLL
    'PREPAYMENT PENALTY WELLS FARGO', // PR|EPAYMENT — no word boundary, must not fire
    'HOMEPAYMENT THANK YOU LLC 770-555-0100', // "PAYMENT THANK YOU" not at ^
  ];

  it.each(mandated)('"%s": modules agree', (raw) => {
    const r = probe(raw);
     
    console.log(JSON.stringify(r));
    expect(r.isTransfer).toBe(r.categoryId === 'transfer');
  });

  it('real spending is not erased: T-MOBILE / GIFT CARD / GEICO / EPAYROLL / PREPAYMENT / HOMEPAYMENT are NOT transfers', () => {
    for (const raw of [
      'T-MOBILE PREPAY REFILL',
      'GIFT CARD PAYMENT - STARBUCKS.COM',
      'GEICO AUTOPAY',
      'EPAYROLL DEPOSIT ACME ANALYTICS',
      'PREPAYMENT PENALTY WELLS FARGO',
      'HOMEPAYMENT THANK YOU LLC 770-555-0100',
    ]) {
      expect(probe(raw).isTransfer).toBe(false);
    }
  });

  it('true card payments ARE transfers: CHASE EPAY / AUTOPAY PAYMENT', () => {
    expect(probe('CHASE EPAY SAPPHIRE').isTransfer).toBe(true);
    expect(probe('AUTOPAY PAYMENT - THANK YOU').isTransfer).toBe(true);
  });

  it('DOCUMENTED HAZARD (not a failure assertion): a biller named "* EPAY" is classified transfer by the descriptor heuristic', () => {
    const r = probe('DUKE ENERGY EPAY 800-777-9898');
     
    console.log('hazard:', JSON.stringify(r));
    expect(r.isTransfer).toBe(r.categoryId === 'transfer'); // agreement still holds
  });
});
