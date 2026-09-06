/**
 * Inbox charge bank-text write without opening detail (DECISIONS #645).
 *
 * Bank-text write already lived on detail and Home (TxnDescriptorControl +
 * updateTransactionDescriptor; rematch #618). Inbox printed rawDescriptor /
 * variants as text. Same writer — no second action. Multi-txn groups keep
 * variant list display-only.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Inbox reuses TxnDescriptorControl on single charges', () => {
  it('test_regression__household_can_change_the_bank_text_on_an_inbox_charge_without_opening_detail', () => {
    const inbox = readFileSync(resolve('src/components/triage/triage-inbox.tsx'), 'utf8');
    expect(inbox).toContain('TxnDescriptorControl');
    expect(inbox).toContain("from '@/components/finance/txn-descriptor-form'");
    expect(inbox).toContain('canRenamePayee');
    expect(inbox).toContain('triggerTestId="inbox-descriptor"');
    expect(inbox).toContain('triggerTestId="inbox-single-descriptor"');

    const singlesStart = inbox.indexOf("mode === 'singles'");
    expect(singlesStart).toBeGreaterThan(-1);
    const singlesBlock = inbox.slice(singlesStart);
    const singlesMap = singlesBlock.indexOf('top.rows.map');
    expect(singlesMap).toBeGreaterThan(-1);
    const singlesMapBlock = singlesBlock.slice(singlesMap, singlesMap + 4500);
    expect(singlesMapBlock).toContain('<TxnDescriptorControl');
    expect(singlesMapBlock).toContain('r.rawDescriptor');
    expect(singlesMapBlock).toContain('canRenamePayee');

    const form = readFileSync(resolve('src/components/finance/txn-descriptor-form.tsx'), 'utf8');
    expect(form).toContain('updateTransactionDescriptor');
    expect(form).not.toContain('useActionState');

    const actions = readFileSync(resolve('src/server/transaction-descriptor-actions.ts'), 'utf8');
    expect(actions).toContain('rematchAfterTxnWrite');
    expect(actions).toContain('isDemoUser');
    expect(actions).toContain('DEMO_ENTRY_BLOCKED');
  });
});
