/**
 * Inbox charge amount write without opening detail (DECISIONS #641).
 *
 * Amount write already lived on detail and Home (TxnAmountControl +
 * updateTransactionAmount; rematch #620). Inbox printed formatCents as
 * static text on single-txn group cards and one-by-one rows. Same writer —
 * no second action. Multi-txn group totals stay display-only (sum).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Inbox reuses TxnAmountControl on single charges', () => {
  it('test_regression__household_can_change_an_inbox_charge_amount_without_opening_detail', () => {
    const inbox = readFileSync(resolve('src/components/triage/triage-inbox.tsx'), 'utf8');
    expect(inbox).toContain('TxnAmountControl');
    expect(inbox).toContain("from '@/components/finance/txn-amount-form'");
    expect(inbox).toContain('canRenamePayee');
    expect(inbox).toContain('triggerTestId="inbox-amount"');
    expect(inbox).toContain('triggerTestId="inbox-single-amount"');

    // Singles map mounts TxnAmountControl on each row when canRenamePayee.
    const singlesStart = inbox.indexOf("mode === 'singles'");
    expect(singlesStart).toBeGreaterThan(-1);
    const singlesBlock = inbox.slice(singlesStart);
    const singlesMap = singlesBlock.indexOf('top.rows.map');
    expect(singlesMap).toBeGreaterThan(-1);
    const singlesMapBlock = singlesBlock.slice(singlesMap, singlesMap + 1200);
    expect(singlesMapBlock).toContain('<TxnAmountControl');
    expect(singlesMapBlock).toContain('canRenamePayee');
    expect(singlesMapBlock).toContain('r.amountCents');

    // Single-txn group header uses TxnAmountControl; multi path keeps formatCents(top.totalCents).
    expect(inbox).toContain('one && canRenamePayee');
    expect(inbox).toContain('formatCents(cents(top.totalCents)');
    const headerStart = inbox.indexOf('data-testid="triage-merchant-heading"');
    expect(headerStart).toBeGreaterThan(-1);
    const headerRegion = inbox.slice(headerStart, headerStart + 1600);
    expect(headerRegion).toContain('one && canRenamePayee');
    expect(headerRegion).toContain('<TxnAmountControl');
    expect(headerRegion).toContain('anchorRow.id');
    expect(headerRegion).toContain('formatCents(cents(top.totalCents)');
    expect(headerRegion).toContain('triggerTestId="inbox-amount"');

    const form = readFileSync(resolve('src/components/finance/txn-amount-form.tsx'), 'utf8');
    expect(form).toContain('updateTransactionAmount');
    expect(form).not.toContain('useActionState');

    const actions = readFileSync(resolve('src/server/transaction-amount-actions.ts'), 'utf8');
    expect(actions).toContain('updateTransactionAmount');
    expect(actions).toContain('rematchAfterTxnWrite');
    expect(actions).toContain('isDemoUser');
    expect(actions).toContain('DEMO_ENTRY_BLOCKED');
  });
});
