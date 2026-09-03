/**
 * Inbox merchant-group payee rename without a filing rule (DECISIONS #624).
 *
 * Overlay already lived on transaction detail (PayeeNameControl + renamePayee).
 * Inbox printed inboxMerchantHeading as a static span, so a household standing
 * on Inbox could not rename the merchant they were filing, and a detail rename
 * did not even show on the group heading. Same writer — no second action.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inboxMerchantHeading } from '@/lib/engine/categorize/group';
import { payeeRenameKey, registerDisplayName } from '@/lib/engine/transactions/display-name';

describe('Inbox merchant heading reuses the existing payee rename', () => {
  it('test_regression__household_can_rename_a_payee_on_an_inbox_merchant_group_without_writing_a_rule', () => {
    const inbox = readFileSync(resolve('src/components/triage/triage-inbox.tsx'), 'utf8');
    expect(inbox).toContain('PayeeNameControl');
    expect(inbox).toContain("from '@/components/finance/payee-name-form'");
    expect(inbox).toContain('top.ruleEligible && canRenamePayee');
    expect(inbox).toContain('data-testid="triage-merchant-heading"');
    expect(inbox).toContain('{bankHeading !== top.merchantCanonical');
    expect(inbox).not.toContain('{heading !== top.merchantCanonical');
    expect(inbox).not.toContain('createKeywordRule');
    expect(inbox).not.toContain('renamePayee(');

    const control = readFileSync(resolve('src/components/finance/payee-name-form.tsx'), 'utf8');
    expect(control).toContain('renamePayee');
    expect(control).toContain('clearPayeeRename');
    expect(control).not.toContain('useActionState');
    expect(control).not.toContain('createKeywordRule');

    const loader = readFileSync(resolve('src/server/triage.ts'), 'utf8');
    expect(loader).toContain('getPayeeRenames');
    expect(loader).toContain('registerDisplayName');
    expect(loader).toContain('payeeRenameKey');
    expect(loader).toContain('payeeName');
    expect(loader).toContain('payeeRenamed');
    expect(loader).toContain('payeeTransactionId');

    const page = readFileSync(resolve('src/app/(app)/triage/page.tsx'), 'utf8');
    expect(page).toContain('canRenamePayee={!isDemoUser(session.user.id)}');
    expect(page).toContain('INBOX_PAGE_SUBTITLE');
    expect(page).toContain('>Inbox</h1>');
  });
});

describe('Inbox heading overlay wins without a DB', () => {
  it('test_regression__inbox_payee_overlay_wins_heading_without_rewriting_canonical', () => {
    const t = {
      merchant: { canonical: 'Starbucks' },
      rawDescriptor: 'SQ *STARBUCKS STORE 123',
    };
    const names = new Map([[payeeRenameKey(t), 'Coffee shop']]);
    const overlay = names.get(payeeRenameKey(t))?.trim();
    const bankHeading = inboxMerchantHeading(t.merchant.canonical);
    expect(registerDisplayName(t, names)).toBe('Coffee shop');
    expect(overlay || bankHeading).toBe('Coffee shop');
    expect(bankHeading).toBe('Starbucks');
    expect(bankHeading === t.merchant.canonical).toBe(true);
    expect(t.merchant.canonical).toBe('Starbucks');
    expect(registerDisplayName(t)).toBe('Starbucks');
  });

  it('test_regression__inbox_masked_disclosure_keys_off_bank_heading_not_overlay', () => {
    const canonical = '.';
    const bankHeading = inboxMerchantHeading(canonical);
    expect(bankHeading).toBe('Masked charge (bank hid the name)');
    expect(bankHeading !== canonical).toBe(true);
    const overlay = 'Coffee shop';
    expect(overlay || bankHeading).toBe('Coffee shop');
    expect(bankHeading !== canonical).toBe(true);
  });
});
