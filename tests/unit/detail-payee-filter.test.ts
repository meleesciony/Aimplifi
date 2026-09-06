/**
 * Detail payee rename keeps the merchant filter link (DECISIONS #677).
 *
 * #662/#675/#676: PayeeNameControl owns the name; sibling Filter keeps Merchant
 * Pattern Lens. Detail mounted PayeeNameControl in the h1 alone (bottom "Every
 * … transaction" remains; the heading also needs the lens entry).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Detail payee rename keeps Filter link', () => {
  it('test_regression__household_can_rename_a_detail_payee_and_still_open_merchant_filter', () => {
    const src = readFileSync(resolve('src/components/finance/transaction-detail-view.tsx'), 'utf8');
    expect(src).toContain('PayeeNameControl');
    expect(src).toContain('merchantRegisterHref');
    expect(src).toContain('detail-payee-merchant-filter');
    expect(src).toContain('Filter');

    const jsx = src.indexOf('data-testid="detail-payee"');
    expect(jsx).toBeGreaterThan(-1);
    const around = src.slice(jsx, jsx + 900);
    expect(around).toContain('<PayeeNameControl');
    expect(around).toContain('detail-payee-merchant-filter');
    expect(around).toContain('merchantRegisterHref(row.merchantName)');
  });
});
