/**
 * Inbox payee rename keeps the merchant filter link (DECISIONS #676).
 *
 * #662/#675: PayeeNameControl owns the name; sibling Filter keeps Merchant
 * Pattern Lens. Inbox mounted rename alone — same coexistence as Activity/Home.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Inbox payee rename keeps Filter link', () => {
  it('test_regression__household_can_rename_an_inbox_payee_and_still_open_merchant_filter', () => {
    const src = readFileSync(resolve('src/components/triage/triage-inbox.tsx'), 'utf8');
    expect(src).toContain('PayeeNameControl');
    expect(src).toContain('merchantRegisterHref');
    expect(src).toContain('inbox-merchant-filter');
    expect(src).toContain('canRenamePayee');
    expect(src).toContain('Filter');

    const jsx = src.indexOf('<PayeeNameControl');
    expect(jsx).toBeGreaterThan(-1);
    const around = src.slice(jsx, jsx + 1200);
    expect(around).toContain('inbox-merchant-filter');
    expect(around).toContain('merchantRegisterHref(bankHeading)');
  });
});
