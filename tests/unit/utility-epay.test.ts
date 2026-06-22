/**
 * Regression: utility e-payments are SPEND, not transfers (surfaced by the
 * adversarial categorization eval, scripts/categorize-eval.ts; resolves STATUS #11).
 * "DUKE ENERGY EPAY" used to hit the generic \bEPAY\b transfer pattern and get
 * dropped from spend. A utility-token + biller-payment-token pattern now wins
 * first — WITHOUT touching real card payments ("CHASE EPAY", "AMEX EPAYMENT").
 */
import { describe, expect, it } from 'vitest';
import { categorize } from '@/lib/engine/categorize/pipeline';
import { detectTransfers } from '@/lib/engine/categorize/transfers';

function isFlaggedTransfer(rawDescriptor: string): boolean {
  return detectTransfers([{ id: 't', accountId: 'a', date: '2026-06-10', amountCents: -12500, rawDescriptor }]).has('t');
}

describe('utility e-payments count as spend (eval finding, STATUS #11 fixed)', () => {
  it('DUKE ENERGY EPAY → utilities, auto-filed, NOT a transfer', () => {
    const out = categorize({ rawDescriptor: 'DUKE ENERGY EPAY 800-777-9898', amountCents: -12500, date: '2026-06-10', accountId: 'a' });
    expect(out.categoryId).toBe('utilities');
    expect(out.needsReview).toBe(false);
    expect(isFlaggedTransfer('DUKE ENERGY EPAY 800-777-9898')).toBe(false);
  });

  it('GEORGIA POWER BILLMATRIX → utilities', () => {
    expect(categorize({ rawDescriptor: 'GEORGIA POWER BILLMATRIX', amountCents: -9000, date: '2026-06-10', accountId: 'a' }).categoryId).toBe('utilities');
  });

  it('does NOT regress card payments — CHASE/AMEX EPAY stay transfers', () => {
    for (const d of ['CHASE EPAY SAPPHIRE', 'AMEX EPAYMENT PLATINUM', 'CHASE EPAY FREEDOM']) {
      expect(categorize({ rawDescriptor: d, amountCents: -50000, date: '2026-06-10', accountId: 'a' }).categoryId).toBe('transfer');
      expect(isFlaggedTransfer(d)).toBe(true);
    }
  });
});
