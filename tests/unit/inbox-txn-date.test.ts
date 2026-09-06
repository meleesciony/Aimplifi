/**
 * Inbox charge date write without opening detail (DECISIONS #642).
 *
 * Date write already lived on detail and Home (TxnDateControl +
 * updateTransactionDate; rematch #621). Inbox printed formatISODate as
 * static text on single-txn group cards and one-by-one rows. Same writer —
 * no second action. Multi-txn group date ranges stay display-only.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Inbox reuses TxnDateControl on single charges', () => {
  it('test_regression__household_can_change_an_inbox_charge_date_without_opening_detail', () => {
    const inbox = readFileSync(resolve('src/components/triage/triage-inbox.tsx'), 'utf8');
    expect(inbox).toContain('TxnDateControl');
    expect(inbox).toContain("from '@/components/finance/txn-date-form'");
    expect(inbox).toContain('canRenamePayee');
    expect(inbox).toContain('triggerTestId="inbox-date"');
    expect(inbox).toContain('triggerTestId="inbox-single-date"');

    // Singles map mounts TxnDateControl on each row when canRenamePayee.
    const singlesStart = inbox.indexOf("mode === 'singles'");
    expect(singlesStart).toBeGreaterThan(-1);
    const singlesBlock = inbox.slice(singlesStart);
    const singlesMap = singlesBlock.indexOf('top.rows.map');
    expect(singlesMap).toBeGreaterThan(-1);
    const singlesMapBlock = singlesBlock.slice(singlesMap, singlesMap + 4500);
    expect(singlesMapBlock).toContain('<TxnDateControl');
    expect(singlesMapBlock).toContain('canRenamePayee');
    expect(singlesMapBlock).toContain('r.date');
    expect(singlesMapBlock).toContain('triggerTestId="inbox-single-date"');

    // Single-txn group meta uses TxnDateControl; multi path keeps formatISODate range.
    expect(inbox).toContain('one && canRenamePayee');
    const metaStart = inbox.indexOf('data-testid="triage-group-meta"');
    expect(metaStart).toBeGreaterThan(-1);
    const metaRegion = inbox.slice(metaStart, metaStart + 1200);
    expect(metaRegion).toContain('canRenamePayee');
    expect(metaRegion).toContain('<TxnDateControl');
    expect(metaRegion).toContain('anchorRow.id');
    expect(metaRegion).toContain('anchorRow.date');
    expect(metaRegion).toContain('triggerTestId="inbox-date"');
    expect(metaRegion).toContain("formatISODate(isoDate(top.oldestDate), 'long')");
    expect(metaRegion).toContain("formatISODate(isoDate(top.newestDate), 'long')");

    const form = readFileSync(resolve('src/components/finance/txn-date-form.tsx'), 'utf8');
    expect(form).toContain('updateTransactionDate');
    expect(form).not.toContain('useActionState');

    const actions = readFileSync(resolve('src/server/transaction-date-actions.ts'), 'utf8');
    expect(actions).toContain('updateTransactionDate');
    expect(actions).toContain('rematchAfterTxnWrite');
    expect(actions).toContain('isDemoUser');
    expect(actions).toContain('DEMO_ENTRY_BLOCKED');
  });
});
