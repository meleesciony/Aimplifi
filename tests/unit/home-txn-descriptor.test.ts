/**
 * Home recent-charge bank-text write without opening detail (DECISIONS #632).
 *
 * Bank-text write already lived on transaction detail (TxnDescriptorControl +
 * updateTransactionDescriptor). Home's Recent transactions card did not print
 * or write rawDescriptor, so a household standing on Home could not change the
 * bank text a rule matches. Same writer — no second action. The descriptor
 * control is a sibling of the C.15 row Link, not inside it, so C.15 still
 * clicks through to detail. Visible dollars stay on TxnAmountControl, shrink-0
 * (f530612 / 380px). Compact idle is "Bank text", not the full descriptor.
 * Payee rename stays the overlay; this is rawDescriptor.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Home recent charges reuse TxnDescriptorControl', () => {
  it('test_regression__household_can_change_the_bank_text_on_a_home_recent_charge_without_opening_detail', () => {
    const card = readFileSync(resolve('src/components/dashboard/recent-transactions-card.tsx'), 'utf8');
    expect(card).toContain('TxnDescriptorControl');
    expect(card).toContain("from '@/components/finance/txn-descriptor-form'");
    expect(card).toContain('compact');
    expect(card).toContain('triggerTestId="home-recent-descriptor"');
    expect(card).toContain('canRenamePayee');

    // TxnDescriptorControl is a sibling of the row Link, not nested inside it.
    const mapStart = card.indexOf('rows.map');
    expect(mapStart).toBeGreaterThan(-1);
    const mapBlock = card.slice(mapStart);
    const controlIdx = mapBlock.indexOf('<TxnDescriptorControl');
    const rowTestIdIdx = mapBlock.indexOf('data-testid="dashboard-recent-row"');
    expect(controlIdx).toBeGreaterThan(-1);
    expect(rowTestIdIdx).toBeGreaterThan(-1);
    const linkOpen = mapBlock.lastIndexOf('<Link', rowTestIdIdx);
    expect(linkOpen).toBeGreaterThan(-1);
    const linkClose = mapBlock.indexOf('</Link>', rowTestIdIdx);
    expect(linkClose).toBeGreaterThan(linkOpen);
    const rowLinkInner = mapBlock.slice(linkOpen, linkClose);
    expect(rowLinkInner).toContain('data-testid="dashboard-recent-row"');
    expect(rowLinkInner).toContain('formatCents');
    expect(rowLinkInner).toContain('Open');
    expect(rowLinkInner).not.toContain('TxnDescriptorControl');

    const recent = readFileSync(resolve('src/server/dashboard-recent.ts'), 'utf8');
    const pushStart = recent.indexOf('rows.push');
    expect(pushStart).toBeGreaterThan(-1);
    const pushBlock = recent.slice(pushStart, recent.indexOf('});', pushStart) + 3);
    expect(pushBlock).toContain('rawDescriptor');

    const form = readFileSync(resolve('src/components/finance/txn-descriptor-form.tsx'), 'utf8');
    expect(form).toContain('updateTransactionDescriptor');
    expect(form).toContain('compact');
    expect(form).toContain('Bank text');
    expect(form).not.toContain('useActionState');
    expect(form).toContain("triggerTestId = 'detail-raw-descriptor'");

    const actions = readFileSync(resolve('src/server/transaction-descriptor-actions.ts'), 'utf8');
    expect(actions).toContain('rematchAfterTxnWrite');
    expect(actions).toContain('isDemoUser');
    expect(actions).toContain('DEMO_ENTRY_BLOCKED');
  });
});
