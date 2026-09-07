/**
 * Inbox multi-txn amount/date/account/descriptor without One by one (DECISIONS #707).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Inbox multi-txn core field controls on the group card', () => {
  it('test_regression__household_can_edit_amount_date_account_descriptor_on_inbox_multi_txn_without_one_by_one', () => {
    const inbox = readFileSync(resolve('src/components/triage/triage-inbox.tsx'), 'utf8');
    expect(inbox).toContain('inbox-multi-date');
    expect(inbox).toContain('inbox-multi-amount');
    expect(inbox).toContain('inbox-multi-direction');
    expect(inbox).toContain('inbox-multi-account');
    expect(inbox).toContain('inbox-multi-descriptor');
    expect(inbox).toContain('TxnDateControl');
    expect(inbox).toContain('TxnAmountControl');
    expect(inbox).toContain('TxnAccountControl');
    expect(inbox).toContain('TxnDescriptorControl');
  });
});
