/**
 * Home recent-charge in/out write without opening detail (DECISIONS #630).
 *
 * Direction flip already lived on transaction detail (TxnDirectionControl +
 * flipTransactionDirection). Home's Recent transactions card implied direction
 * by amount color only, so a household standing on Home could not flip in/out.
 * Same writer — no second action. The flip control is a sibling of the C.15
 * row Link, not inside it, so C.15 still clicks through to detail. Visible
 * dollars stay on TxnAmountControl, shrink-0 (f530612 / 380px).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Home recent charges reuse TxnDirectionControl', () => {
  it('test_regression__household_can_flip_a_home_recent_charge_in_or_out_without_opening_detail', () => {
    const card = readFileSync(resolve('src/components/dashboard/recent-transactions-card.tsx'), 'utf8');
    expect(card).toContain('TxnDirectionControl');
    expect(card).toContain("from '@/components/finance/txn-direction-form'");
    expect(card).toContain('compact');
    expect(card).toContain('flipTestId="home-recent-direction"');
    expect(card).toContain('canRenamePayee');

    // TxnDirectionControl is a sibling of the row Link, not nested inside it.
    const mapStart = card.indexOf('rows.map');
    expect(mapStart).toBeGreaterThan(-1);
    const mapBlock = card.slice(mapStart);
    const controlIdx = mapBlock.indexOf('<TxnDirectionControl');
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
    expect(rowLinkInner).not.toContain('TxnDirectionControl');

    // shrink-0 on the flip control wrapper — not a flex-1 slot that collapses
    // at 380px (f530612). Visible dollars stay on TxnAmountControl.
    const wrapOpen = mapBlock.lastIndexOf('<span', controlIdx);
    expect(wrapOpen).toBeGreaterThan(-1);
    const flipWrap = mapBlock.slice(wrapOpen, controlIdx);
    expect(flipWrap).toContain('shrink-0');
    expect(flipWrap).not.toContain('flex-1');

    const form = readFileSync(resolve('src/components/finance/txn-direction-form.tsx'), 'utf8');
    expect(form).toContain('flipTransactionDirection');
    expect(form).toContain('compact');
    expect(form).not.toContain('useActionState');
    expect(form).toContain("flipTestId = 'txn-direction-flip'");
    expect(form).toContain('detail-direction');
    expect(form).toContain("'Money in'");
    expect(form).toContain("'Money out'");
    expect(form).toContain("{busy ? 'Saving…' : current}");
    expect(form).not.toContain("isIn ? 'In' : 'Out'");

    const actions = readFileSync(resolve('src/server/transaction-amount-actions.ts'), 'utf8');
    expect(actions).toContain('rematchAfterTxnWrite');
    expect(actions).toContain('isDemoUser');
    expect(actions).toContain('DEMO_ENTRY_BLOCKED');
    expect(actions).toContain('flippedTxnAmountCents');
  });
});
