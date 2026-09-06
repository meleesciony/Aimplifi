/**
 * Inbox charge in/out write without opening detail (DECISIONS #643).
 *
 * Direction flip already lived on detail and Home (TxnDirectionControl +
 * flipTransactionDirection; rematch #619). Inbox printed amounts without an
 * in/out control on single-txn group cards and one-by-one rows. Same writer —
 * no second action. Multi-txn group sums stay without a flip.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Inbox reuses TxnDirectionControl on single charges', () => {
  it('test_regression__household_can_flip_an_inbox_charge_in_or_out_without_opening_detail', () => {
    const inbox = readFileSync(resolve('src/components/triage/triage-inbox.tsx'), 'utf8');
    expect(inbox).toContain('TxnDirectionControl');
    expect(inbox).toContain("from '@/components/finance/txn-direction-form'");
    expect(inbox).toContain('compact');
    expect(inbox).toContain('canRenamePayee');
    expect(inbox).toContain('flipTestId="inbox-direction"');
    expect(inbox).toContain('flipTestId="inbox-single-direction"');

    // Singles map mounts TxnDirectionControl on each row when canRenamePayee.
    const singlesStart = inbox.indexOf("mode === 'singles'");
    expect(singlesStart).toBeGreaterThan(-1);
    const singlesBlock = inbox.slice(singlesStart);
    const singlesMap = singlesBlock.indexOf('top.rows.map');
    expect(singlesMap).toBeGreaterThan(-1);
    const singlesMapBlock = singlesBlock.slice(singlesMap, singlesMap + 4500);
    expect(singlesMapBlock).toContain('<TxnDirectionControl');
    expect(singlesMapBlock).toContain('canRenamePayee');
    expect(singlesMapBlock).toContain('r.amountCents');
    expect(singlesMapBlock).toContain('flipTestId="inbox-single-direction"');

    // Single-txn group header uses TxnDirectionControl; multi path keeps formatCents sum.
    expect(inbox).toContain('one && canRenamePayee');
    expect(inbox).toContain('formatCents(cents(top.totalCents)');
    const headerStart = inbox.indexOf('data-testid="triage-merchant-heading"');
    expect(headerStart).toBeGreaterThan(-1);
    const headerRegion = inbox.slice(headerStart, headerStart + 2000);
    expect(headerRegion).toContain('one && canRenamePayee');
    expect(headerRegion).toContain('<TxnDirectionControl');
    expect(headerRegion).toContain('anchorRow.id');
    expect(headerRegion).toContain('anchorRow.amountCents');
    expect(headerRegion).toContain('flipTestId="inbox-direction"');
    expect(headerRegion).toContain('formatCents(cents(top.totalCents)');

    const form = readFileSync(resolve('src/components/finance/txn-direction-form.tsx'), 'utf8');
    expect(form).toContain('flipTransactionDirection');
    expect(form).toContain('compact');
    expect(form).not.toContain('useActionState');

    const actions = readFileSync(resolve('src/server/transaction-amount-actions.ts'), 'utf8');
    expect(actions).toContain('flipTransactionDirection');
    expect(actions).toContain('rematchAfterTxnWrite');
    expect(actions).toContain('isDemoUser');
    expect(actions).toContain('DEMO_ENTRY_BLOCKED');
  });
});
