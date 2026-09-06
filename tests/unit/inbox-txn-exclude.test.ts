/**
 * Inbox exclude-from-totals on a single charge without opening detail (DECISIONS #664).
 *
 * setExcludeFromTotals lived in Activity and Home (#663). Inbox singles had no
 * exclude control. Same writer. Multi-txn groups stay without an exclude control.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Inbox reuses TxnExcludeControl on single charges', () => {
  it('test_regression__household_can_exclude_an_inbox_charge_from_totals_without_opening_detail', () => {
    const inbox = readFileSync(resolve('src/components/triage/triage-inbox.tsx'), 'utf8');
    expect(inbox).toContain('TxnExcludeControl');
    expect(inbox).toContain("from '@/components/finance/txn-exclude-form'");
    expect(inbox).toContain('canRenamePayee');
    expect(inbox).toContain('triggerTestId="inbox-exclude"');
    expect(inbox).toContain('triggerTestId="inbox-single-exclude"');

    const singlesStart = inbox.indexOf("mode === 'singles'");
    expect(singlesStart).toBeGreaterThan(-1);
    const singlesBlock = inbox.slice(singlesStart);
    const singlesMap = singlesBlock.indexOf('top.rows.map');
    expect(singlesMap).toBeGreaterThan(-1);
    const singlesMapBlock = singlesBlock.slice(singlesMap, singlesMap + 6500);
    expect(singlesMapBlock).toContain('<TxnExcludeControl');
    expect(singlesMapBlock).toContain('r.excludeFromTotals');
    expect(singlesMapBlock).toContain('canRenamePayee');

    const group = readFileSync(resolve('src/lib/engine/categorize/group.ts'), 'utf8');
    expect(group).toContain('excludeFromTotals: boolean');
    expect(group).toContain('excludeFromTotals: m.excludeFromTotals');
    expect(group).toContain("'excludeFromTotals'");

    const triage = readFileSync(resolve('src/server/triage.ts'), 'utf8');
    expect(triage).toContain('excludeFromTotals: t.excludeFromTotals');

    const form = readFileSync(resolve('src/components/finance/txn-exclude-form.tsx'), 'utf8');
    expect(form).toContain('setExcludeFromTotals');
    expect(form).toContain('exclude: !excluded');
    expect(form).not.toContain('useActionState');

    const actions = readFileSync(resolve('src/server/transaction-flags-actions.ts'), 'utf8');
    expect(actions).toContain('isDemoUser');
    expect(actions).toContain('DEMO_ENTRY_BLOCKED');
  });
});
