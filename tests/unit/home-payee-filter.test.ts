/**
 * Home payee rename keeps the merchant filter link (DECISIONS #675).
 *
 * #657/#662 on Activity: PayeeNameControl owns the name; a sibling Filter link
 * keeps Merchant Pattern Lens entry. Home mounted PayeeNameControl alone, so
 * renaming on Home dropped the merchant register entry. Same coexistence.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Home recent payee rename keeps Filter link', () => {
  it('test_regression__household_can_rename_a_home_payee_and_still_open_merchant_filter', () => {
    const card = readFileSync(resolve('src/components/dashboard/recent-transactions-card.tsx'), 'utf8');
    expect(card).toContain('PayeeNameControl');
    expect(card).toContain('merchantRegisterHref');
    expect(card).toContain('home-recent-merchant-filter');
    expect(card).toContain('canRenamePayee');
    expect(card).toContain('Filter');

    const jsx = card.indexOf('<PayeeNameControl');
    expect(jsx).toBeGreaterThan(-1);
    const around = card.slice(jsx, jsx + 1200);
    expect(around).toContain('home-recent-merchant-filter');
    expect(around).toContain('merchantRegisterHref(r.merchantName)');
  });
});
