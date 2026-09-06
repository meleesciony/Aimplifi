/**
 * Inbox charge note write without opening detail (DECISIONS #646).
 *
 * Note write lived on detail and Home via updateTransactionNote (note only;
 * tax untouched — #639). Inbox had no note field on ReviewRow and printed
 * nothing. Same writer — no second action. Multi-txn groups stay without a
 * note control.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Inbox reuses TxnNoteControl on single charges', () => {
  it('test_regression__household_can_add_or_edit_an_inbox_charge_note_without_opening_detail', () => {
    const inbox = readFileSync(resolve('src/components/triage/triage-inbox.tsx'), 'utf8');
    expect(inbox).toContain('TxnNoteControl');
    expect(inbox).toContain("from '@/components/finance/txn-note-form'");
    expect(inbox).toContain('canRenamePayee');
    expect(inbox).toContain('compact');
    expect(inbox).toContain('triggerTestId="inbox-note"');
    expect(inbox).toContain('triggerTestId="inbox-single-note"');

    const singlesStart = inbox.indexOf("mode === 'singles'");
    expect(singlesStart).toBeGreaterThan(-1);
    const singlesBlock = inbox.slice(singlesStart);
    const singlesMap = singlesBlock.indexOf('top.rows.map');
    expect(singlesMap).toBeGreaterThan(-1);
    const singlesMapBlock = singlesBlock.slice(singlesMap, singlesMap + 5000);
    expect(singlesMapBlock).toContain('<TxnNoteControl');
    expect(singlesMapBlock).toContain('r.note');
    expect(singlesMapBlock).toContain('canRenamePayee');

    const group = readFileSync(resolve('src/lib/engine/categorize/group.ts'), 'utf8');
    expect(group).toContain('note: string | null');
    expect(group).toContain('note: m.note');

    const triage = readFileSync(resolve('src/server/triage.ts'), 'utf8');
    expect(triage).toContain('note: t.note ?? null');

    const form = readFileSync(resolve('src/components/finance/txn-note-form.tsx'), 'utf8');
    expect(form).toContain('updateTransactionNote');
    expect(form).not.toContain('useActionState');

    const actions = readFileSync(resolve('src/server/transaction-note-actions.ts'), 'utf8');
    expect(actions).toContain('isDemoUser');
    expect(actions).toContain('DEMO_ENTRY_BLOCKED');
    expect(actions).toContain('normalizeNote');
  });
});
