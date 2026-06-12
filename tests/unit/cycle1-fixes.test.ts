/**
 * Regressions for adversarial-review CYCLE 1 fixes (docs/REVIEW_CYCLES.md):
 *  C2 — rules loop: DB rule rows map to RuleLike and steer categorize()
 *  H5 — aggregate merchants (Zelle/checks/ATM) are never rule-eligible
 */
import { describe, expect, it } from 'vitest';
import { toRuleLike } from '@/server/rules';
import { categorize } from '@/lib/engine/categorize/pipeline';
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';

describe('C2 — the rule loader bridges merchantId → canonical', () => {
  const canonicalById = new Map([['merch-starbucks', 'Starbucks']]);
  const row = {
    id: 'rule-1',
    merchantId: 'merch-starbucks',
    minAmountCents: null,
    maxAmountCents: null,
    weekendOnly: null,
    weekdayOnly: null,
    accountId: null,
    categoryId: 'entertainment',
    priority: 100,
  };

  it('maps a DB rule row to a pipeline RuleLike', () => {
    expect(toRuleLike(row, canonicalById)).toMatchObject({
      id: 'rule-1',
      merchantCanonical: 'Starbucks',
      categoryId: 'entertainment',
      priority: 100,
    });
  });

  it('an orphaned merchantId yields NO rule (null = any-merchant would match everything)', () => {
    expect(toRuleLike({ ...row, merchantId: 'merch-gone' }, canonicalById)).toBeNull();
  });

  it('the loaded rule actually changes the next matching suggestion (the loop is closed)', () => {
    const out = categorize(
      { rawDescriptor: 'STARBUCKS 800-782-7282', amountCents: -500, date: '2026-06-08', accountId: 'a' },
      [toRuleLike(row, canonicalById)],
    );
    expect(out.categoryId).toBe('entertainment');
    expect(out.source).toBe('user-rule');
  });
});

describe('H5 — aggregate pseudo-merchants are never rule-eligible', () => {
  it.each([
    'ZELLE PAYMENT TO J. PARK',
    'CHECK #1042',
    'ATM WITHDRAWAL 00482 PEACHTREE ST',
    '   ',
  ])('"%s" is aggregate', (raw) => {
    expect(normalizeMerchant(raw).aggregate).toBe(true);
  });

  it.each([
    'STARBUCKS 800-782-7282',
    'STORE CARD PURCHASE 0064 ATL',
    'SQ *SOME LOCAL CAFE 0042',
  ])('"%s" is a real merchant — rules allowed', (raw) => {
    expect(normalizeMerchant(raw).aggregate).toBe(false);
  });
});
