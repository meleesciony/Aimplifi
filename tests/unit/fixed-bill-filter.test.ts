/**
 * Spending plan Fixed bill rename keeps the merchant filter link (DECISIONS #678).
 *
 * Recurring Coming up (#672) keeps sibling Filter beside BillNameControl.
 * Fixed mounted BillNameControl alone for named recurring bills.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Fixed bill rename keeps Filter link', () => {
  it('test_regression__household_can_rename_a_fixed_bill_and_still_open_merchant_filter', () => {
    const src = readFileSync(resolve('src/components/settings/fixed-costs-card.tsx'), 'utf8');
    expect(src).toContain('BillNameControl');
    expect(src).toContain('merchantRegisterHref');
    expect(src).toContain('fixed-costs-basis-merchant-filter');
    expect(src).toContain('Filter');

    const jsx = src.indexOf('<BillNameControl');
    expect(jsx).toBeGreaterThan(-1);
    const around = src.slice(jsx, jsx + 1200);
    expect(around).toContain('fixed-costs-basis-merchant-filter');
    expect(around).toContain('merchantRegisterHref(l.merchantCanonical)');
  });
});
