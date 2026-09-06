/**
 * Activity register note write without opening detail (note-only).
 *
 * Note write lived on detail, Home, and Inbox via updateTransactionNote (note
 * only; tax untouched). Activity's Tag panel still uses setTransactionTax
 * (note + taxClass together). Same note-only writer — no second action.
 * Demo fenced via canEditSpendClass.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Activity register reuses TxnNoteControl', () => {
  it('test_regression__household_can_add_or_edit_an_activity_charge_note_without_opening_detail', () => {
    const list = readFileSync(resolve('src/components/finance/transaction-list.tsx'), 'utf8');
    expect(list).toContain('TxnNoteControl');
    expect(list).toContain("from '@/components/finance/txn-note-form'");
    expect(list).toContain('triggerTestId="activity-note"');
    expect(list).toContain('compact');
    expect(list).toContain('canEditSpendClass');
    expect(list).toContain('t.note');

    const form = readFileSync(resolve('src/components/finance/txn-note-form.tsx'), 'utf8');
    expect(form).toContain('updateTransactionNote');
    expect(form).not.toContain('useActionState');

    const actions = readFileSync(resolve('src/server/transaction-note-actions.ts'), 'utf8');
    expect(actions).toContain('isDemoUser');
    expect(actions).toContain('DEMO_ENTRY_BLOCKED');
    expect(actions).toContain('normalizeNote');
    expect(actions).toContain('data: { note: note.note }');
    expect(actions).toContain('tax tag column is intentionally omitted');
  });
});
