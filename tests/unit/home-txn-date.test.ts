/**
 * Home recent-charge date write without opening detail (DECISIONS #628).
 *
 * Date write already lived on transaction detail (TxnDateControl +
 * updateTransactionDate). Home printed r.date as static text inside the C.15
 * row Link, so a household standing on Home could not change a date they were
 * looking at. Same writer — no second action. The date control is a sibling
 * of the row Link, not inside it, so C.15 still clicks through to detail.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Home recent charges reuse TxnDateControl', () => {
  it('test_regression__household_can_change_a_home_recent_charge_date_without_opening_detail', () => {
    const card = readFileSync(resolve('src/components/dashboard/recent-transactions-card.tsx'), 'utf8');
    expect(card).toContain('TxnDateControl');
    expect(card).toContain("from '@/components/finance/txn-date-form'");
    expect(card).toContain('triggerTestId="home-recent-date"');
    expect(card).toContain('canRenamePayee');

    // TxnDateControl is a sibling of the row Link, not nested inside it.
    const mapStart = card.indexOf('rows.map');
    expect(mapStart).toBeGreaterThan(-1);
    const mapBlock = card.slice(mapStart);
    const controlIdx = mapBlock.indexOf('<TxnDateControl');
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
    expect(rowLinkInner).not.toContain('{r.date}');
    expect(rowLinkInner).not.toContain('TxnDateControl');

    const form = readFileSync(resolve('src/components/finance/txn-date-form.tsx'), 'utf8');
    expect(form).toContain('updateTransactionDate');
    expect(form).not.toContain('useActionState');
    expect(form).toContain("triggerTestId = 'detail-date'");

    const actions = readFileSync(resolve('src/server/transaction-date-actions.ts'), 'utf8');
    expect(actions).toContain('rematchAfterTxnWrite');
    expect(actions).toContain('isDemoUser');
    expect(actions).toContain('DEMO_ENTRY_BLOCKED');
  });
});
