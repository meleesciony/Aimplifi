/**
 * Home recent-charge account write without opening detail (DECISIONS #631).
 *
 * Account write already lived on transaction detail (TxnAccountControl +
 * updateTransactionAccount). Home's Recent transactions card did not print or
 * write account at all, so a household standing on Home could not change which
 * account a charge belongs to. Same writer — no second action. The account
 * control is a sibling of the C.15 row Link, not inside it, so C.15 still
 * clicks through to detail. Visible dollars stay on TxnAmountControl, shrink-0
 * (f530612 / 380px). Account idle is truncated so 380px does not eat the
 * dollars.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Home recent charges reuse TxnAccountControl', () => {
  it('test_regression__household_can_change_which_account_a_home_recent_charge_belongs_to', () => {
    const card = readFileSync(resolve('src/components/dashboard/recent-transactions-card.tsx'), 'utf8');
    expect(card).toContain('TxnAccountControl');
    expect(card).toContain("from '@/components/finance/txn-account-form'");
    expect(card).toContain('triggerTestId="home-recent-account"');
    expect(card).toContain('canRenamePayee');

    // TxnAccountControl is a sibling of the row Link, not nested inside it.
    const mapStart = card.indexOf('rows.map');
    expect(mapStart).toBeGreaterThan(-1);
    const mapBlock = card.slice(mapStart);
    const controlIdx = mapBlock.indexOf('<TxnAccountControl');
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
    expect(rowLinkInner).not.toContain('TxnAccountControl');

    const recent = readFileSync(resolve('src/server/dashboard-recent.ts'), 'utf8');
    const pushStart = recent.indexOf('rows.push');
    expect(pushStart).toBeGreaterThan(-1);
    const pushBlock = recent.slice(pushStart, recent.indexOf('});', pushStart) + 3);
    expect(pushBlock).toContain('accountId');
    expect(pushBlock).toContain('accountName');
    expect(pushBlock).toContain('accountLabel');

    const page = readFileSync(resolve('src/app/(app)/dashboard/page.tsx'), 'utf8');
    expect(page).toContain('listTxnMoveAccounts');

    const form = readFileSync(resolve('src/components/finance/txn-account-form.tsx'), 'utf8');
    expect(form).toContain('updateTransactionAccount');
    expect(form).not.toContain('useActionState');
    expect(form).toContain("triggerTestId = 'detail-account'");

    const actions = readFileSync(resolve('src/server/transaction-account-actions.ts'), 'utf8');
    expect(actions).toContain('rematchAfterTxnWrite');
    expect(actions).toContain('isDemoUser');
    expect(actions).toContain('DEMO_ENTRY_BLOCKED');
  });
});
