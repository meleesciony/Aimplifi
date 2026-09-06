/**
 * Activity register payee rename without opening detail (DECISIONS #657).
 *
 * Overlay already lived on transaction detail, Inbox, and Home
 * (PayeeNameControl + renamePayee). Activity printed merchantName inside a
 * merchant-filter Link, so a household standing on Activity could not rename
 * a payee they were looking at. Same writer — no second action. Demo fenced
 * via canEditSpendClass. When the household can edit, the name control
 * replaces the filter Link (demo keeps the Link).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { payeeRenameKey, registerDisplayName } from '@/lib/engine/transactions/display-name';

describe('Activity register reuses the existing payee rename', () => {
  it('test_regression__household_can_rename_a_payee_on_activity_without_opening_detail', () => {
    const list = readFileSync(resolve('src/components/finance/transaction-list.tsx'), 'utf8');
    expect(list).toContain('PayeeNameControl');
    expect(list).toContain("from '@/components/finance/payee-name-form'");
    expect(list).toContain('canEditSpendClass');
    expect(list).toContain('hasOverlay={t.payeeRenamed}');
    expect(list).toContain('transactionId={t.id}');
    // #662 — rename does not kill the merchant-filter lens entry.
    expect(list).toContain('data-testid="txn-merchant-link"');
    expect(list).toContain('See all charges for');
    expect(list).toMatch(/>\s*Filter\s*<\/Link>/);
    expect(list).not.toContain('createKeywordRule');
    expect(list).not.toContain('renamePayee(');

    const control = readFileSync(resolve('src/components/finance/payee-name-form.tsx'), 'utf8');
    expect(control).toContain('renamePayee');
    expect(control).toContain('clearPayeeRename');
    expect(control).not.toContain('useActionState');
    expect(control).not.toContain('createKeywordRule');

    const query = readFileSync(resolve('src/lib/engine/transactions/query.ts'), 'utf8');
    expect(query).toContain('payeeRenamed: boolean');

    const loader = readFileSync(resolve('src/server/transactions.ts'), 'utf8');
    expect(loader).toContain('payeeRenameKey');
    expect(loader).toContain('payeeRenamed');
    expect(loader).toContain('getPayeeRenames');
    expect(loader).toContain('registerDisplayName');

    const page = readFileSync(resolve('src/app/(app)/transactions/page.tsx'), 'utf8');
    expect(page).toContain('canEditSpendClass={!isDemoUser(session.user.id)}');
  });
});

describe('Activity register overlay wins without a DB', () => {
  it('test_regression__activity_payee_overlay_wins_without_rewriting_canonical', () => {
    const t = {
      merchant: { canonical: 'Starbucks' },
      rawDescriptor: 'SQ *STARBUCKS STORE 123',
    };
    const names = new Map([[payeeRenameKey(t), 'Coffee shop']]);
    expect(registerDisplayName(t, names)).toBe('Coffee shop');
    expect(registerDisplayName(t)).toBe('Starbucks');
    expect(t.merchant.canonical).toBe('Starbucks');
  });
});
