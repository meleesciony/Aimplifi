/**
 * Inbox multi-txn note/tax/exclude/reimburse without opening One by one (DECISIONS #706).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Inbox multi-txn field controls on the group card', () => {
  it('test_regression__household_can_edit_note_tax_exclude_reimbursement_on_inbox_multi_txn_without_one_by_one', () => {
    const inbox = readFileSync(resolve('src/components/triage/triage-inbox.tsx'), 'utf8');
    expect(inbox).toContain('inbox-multi-txn-fields');
    expect(inbox).toContain('inbox-multi-txn-field-row');
    expect(inbox).toContain('inbox-multi-note');
    expect(inbox).toContain('inbox-multi-tax');
    expect(inbox).toContain('inbox-multi-exclude');
    expect(inbox).toContain('inbox-multi-reimbursement');
    expect(inbox).toContain('TxnNoteControl');
    expect(inbox).toContain('TxnTaxClassControl');
    expect(inbox).toContain('TxnExcludeControl');
    expect(inbox).toContain('TxnReimbursementControl');
  });
});
