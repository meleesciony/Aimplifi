/**
 * Home recent-charge amount write without opening detail (DECISIONS #629).
 *
 * Amount write already lived on transaction detail (TxnAmountControl +
 * updateTransactionAmount). Home printed formatCents as static text inside
 * the C.15 row Link, so a household standing on Home could not change an
 * amount they were looking at. Same writer — no second action. The amount
 * control is a sibling of the row Link, not inside it, so C.15 still clicks
 * through to detail. Visible dollars stay shrink-0 (f530612 / 380px).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Home recent charges reuse TxnAmountControl', () => {
  it('test_regression__household_can_change_a_home_recent_charge_amount_without_opening_detail', () => {
    const card = readFileSync(resolve('src/components/dashboard/recent-transactions-card.tsx'), 'utf8');
    expect(card).toContain('TxnAmountControl');
    expect(card).toContain("from '@/components/finance/txn-amount-form'");
    expect(card).toContain('triggerTestId="home-recent-amount"');
    expect(card).toContain('canRenamePayee');

    // TxnAmountControl is a sibling of the row Link, not nested inside it.
    const mapStart = card.indexOf('rows.map');
    expect(mapStart).toBeGreaterThan(-1);
    const mapBlock = card.slice(mapStart);
    const controlIdx = mapBlock.indexOf('<TxnAmountControl');
    const rowTestIdIdx = mapBlock.indexOf('data-testid="dashboard-recent-row"');
    expect(controlIdx).toBeGreaterThan(-1);
    expect(rowTestIdIdx).toBeGreaterThan(-1);
    expect(controlIdx).toBeLessThan(rowTestIdIdx);
    const linkOpen = mapBlock.lastIndexOf('<Link', rowTestIdIdx);
    expect(linkOpen).toBeGreaterThan(-1);
    const linkClose = mapBlock.indexOf('</Link>', rowTestIdIdx);
    expect(linkClose).toBeGreaterThan(linkOpen);
    const rowLinkInner = mapBlock.slice(linkOpen, linkClose);
    expect(rowLinkInner).toContain('data-testid="dashboard-recent-row"');
    expect(rowLinkInner).toContain('formatCents');
    expect(rowLinkInner).not.toContain('TxnAmountControl');

    // shrink-0 on the amount control wrapper — not a flex-1 amount slot that
    // collapses to 0 width at 380px (f530612).
    const wrapOpen = mapBlock.lastIndexOf('<span', controlIdx);
    expect(wrapOpen).toBeGreaterThan(-1);
    const amountWrap = mapBlock.slice(wrapOpen, controlIdx);
    expect(amountWrap).toContain('shrink-0');
    expect(amountWrap).not.toContain('flex-1');
    expect(card).toContain('idleClassName=');
    expect(card).toContain('text-sm tabular-nums');

    const form = readFileSync(resolve('src/components/finance/txn-amount-form.tsx'), 'utf8');
    expect(form).toContain('updateTransactionAmount');
    expect(form).not.toContain('useActionState');
    expect(form).toContain("triggerTestId = 'detail-amount'");

    const actions = readFileSync(resolve('src/server/transaction-amount-actions.ts'), 'utf8');
    expect(actions).toContain('rematchAfterTxnWrite');
    expect(actions).toContain('isDemoUser');
    expect(actions).toContain('DEMO_ENTRY_BLOCKED');
    expect(actions).toContain('parseDollarInput');
    const writeStart = actions.indexOf('export async function updateTransactionAmount');
    expect(writeStart).toBeGreaterThan(-1);
    const writeFn = actions.slice(writeStart);
    expect(writeFn).toContain('amountCents');
    expect(writeFn).toContain('parseDollarInput');
    expect(writeFn).not.toContain('parseFloat');
  });
});
