/**
 * Inbox reimbursement tracking on a single charge without opening detail (DECISIONS #667).
 *
 * setReimbursement lived in Activity menu/detail and Home (#666). Inbox singles
 * had no reimbursement control. Same writer. Multi-txn groups stay without one.
 * Outflows only.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Inbox reuses TxnReimbursementControl on single charges', () => {
  it('test_regression__household_can_track_reimbursement_on_an_inbox_charge_without_opening_detail', () => {
    const inbox = readFileSync(resolve('src/components/triage/triage-inbox.tsx'), 'utf8');
    expect(inbox).toContain('TxnReimbursementControl');
    expect(inbox).toContain("from '@/components/finance/txn-reimbursement-form'");
    expect(inbox).toContain('canRenamePayee');
    expect(inbox).toContain('triggerTestId="inbox-reimbursement"');
    expect(inbox).toContain('triggerTestId="inbox-single-reimbursement"');
    expect(inbox).toContain('amountCents < 0');

    const singlesStart = inbox.indexOf("mode === 'singles'");
    expect(singlesStart).toBeGreaterThan(-1);
    const singlesBlock = inbox.slice(singlesStart);
    const singlesMap = singlesBlock.indexOf('top.rows.map');
    expect(singlesMap).toBeGreaterThan(-1);
    const singlesMapBlock = singlesBlock.slice(singlesMap, singlesMap + 7000);
    expect(singlesMapBlock).toContain('<TxnReimbursementControl');
    expect(singlesMapBlock).toContain('r.reimbursement');

    const form = readFileSync(resolve('src/components/finance/txn-reimbursement-form.tsx'), 'utf8');
    expect(form).toContain('setReimbursement');
    expect(form).not.toContain('useActionState');

    const actions = readFileSync(resolve('src/server/transaction-flags-actions.ts'), 'utf8');
    expect(actions).toContain('isDemoUser');
    expect(actions).toContain('DEMO_ENTRY_BLOCKED');
    expect(actions).toContain("revalidatePath('/triage')");
  });
});
