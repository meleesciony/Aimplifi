/**
 * Inbox charge tax-tag write without opening detail (DECISIONS #647).
 *
 * Tax write lived on detail and Home via updateTransactionTaxClass (tax only;
 * note untouched — #640). Inbox had no taxClass on ReviewRow. Same writer —
 * no second action. Multi-txn groups stay without a tax control.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Inbox reuses TxnTaxClassControl on single charges', () => {
  it('test_regression__household_can_set_a_tax_tag_on_an_inbox_charge_without_opening_detail', () => {
    const inbox = readFileSync(resolve('src/components/triage/triage-inbox.tsx'), 'utf8');
    expect(inbox).toContain('TxnTaxClassControl');
    expect(inbox).toContain("from '@/components/finance/txn-tax-form'");
    expect(inbox).toContain('canRenamePayee');
    expect(inbox).toContain('compact');
    expect(inbox).toContain('triggerTestId="inbox-tax"');
    expect(inbox).toContain('triggerTestId="inbox-single-tax"');

    const singlesStart = inbox.indexOf("mode === 'singles'");
    expect(singlesStart).toBeGreaterThan(-1);
    const singlesBlock = inbox.slice(singlesStart);
    const singlesMap = singlesBlock.indexOf('top.rows.map');
    expect(singlesMap).toBeGreaterThan(-1);
    const singlesMapBlock = singlesBlock.slice(singlesMap, singlesMap + 5500);
    expect(singlesMapBlock).toContain('<TxnTaxClassControl');
    expect(singlesMapBlock).toContain('r.taxClass');
    expect(singlesMapBlock).toContain('canRenamePayee');

    const group = readFileSync(resolve('src/lib/engine/categorize/group.ts'), 'utf8');
    expect(group).toContain('taxClass: string | null');
    expect(group).toContain('taxClass: m.taxClass');

    const triage = readFileSync(resolve('src/server/triage.ts'), 'utf8');
    expect(triage).toContain('taxClass: t.taxClass ?? null');

    const form = readFileSync(resolve('src/components/finance/txn-tax-form.tsx'), 'utf8');
    expect(form).toContain('updateTransactionTaxClass');
    expect(form).not.toContain('useActionState');

    const actions = readFileSync(resolve('src/server/transaction-tax-actions.ts'), 'utf8');
    expect(actions).toContain('isDemoUser');
    expect(actions).toContain('DEMO_ENTRY_BLOCKED');
  });
});
