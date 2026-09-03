/**
 * Cards page statement add without opening Accounts (DECISIONS #634).
 *
 * Statement write already lived on Accounts (setManualCardStatement, manual
 * CREDIT only). Cards “No due date yet” named Accounts as the place to enter
 * one, so a household standing on Cards could not attach a statement they
 * were looking at. Same writer — no second action. Demo / linked / partner
 * stay without a writer. Dated cards unchanged.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Cards page reuses setManualCardStatement', () => {
  it('test_regression__household_can_add_a_card_statement_from_the_cards_page_without_opening_accounts', () => {
    const breakdown = readFileSync(resolve('src/components/finance/cards-breakdown.tsx'), 'utf8');
    expect(breakdown).toContain('CardStatementControl');
    expect(breakdown).toContain("from '@/components/finance/card-statement-control'");
    expect(breakdown).toContain('canAddStatementById');
    expect(breakdown).toContain('canRenameCard && canAddStatementById?.[c.cardId] && !owner');
    expect(breakdown).toContain('<CardStatementControl accountId={c.cardId} />');

    const unknownStart = breakdown.indexOf('cards-unknown-due');
    expect(unknownStart).toBeGreaterThan(-1);
    const unknownBlock = breakdown.slice(unknownStart);
    expect(unknownBlock).toContain('CardStatementControl');
    expect(unknownBlock).toContain('href="/accounts"');

    const datedStart = breakdown.indexOf('ordered.map((card)');
    expect(datedStart).toBeGreaterThan(-1);
    const datedEnd = breakdown.indexOf('cards-unknown-due', datedStart);
    const datedBlock = breakdown.slice(datedStart, datedEnd);
    expect(datedBlock).not.toContain('CardStatementControl');

    const page = readFileSync(resolve('src/app/(app)/cards/page.tsx'), 'utf8');
    expect(page).toContain('canAddStatementById');
    expect(page).toContain("provider: true");
    expect(page).toContain("a.provider === 'manual'");
    expect(page).toContain('isDemoUser');
    const breakdownCall = page.indexOf('<CardsBreakdown');
    expect(breakdownCall).toBeGreaterThan(-1);
    const breakdownBlock = page.slice(breakdownCall, page.indexOf('/>', breakdownCall) + 2);
    expect(breakdownBlock).toContain('canAddStatementById={canAddStatementById}');
    const emptyIdx = page.indexOf('cards-empty');
    expect(emptyIdx).toBeGreaterThan(-1);
    expect(emptyIdx).toBeLessThan(breakdownCall);

    const form = readFileSync(resolve('src/components/finance/card-statement-control.tsx'), 'utf8');
    expect(form).toContain('setManualCardStatement');
    expect(form).toContain("from '@/server/card-actions'");
    expect(form).toContain('ManualCardStatementForm');
    expect(form).not.toContain('useActionState');
    expect(form).toContain('data-testid="card-row-statement-add"');
    expect(form).toContain('data-testid="card-row-statement"');
    expect(form).toContain('setManualCardStatement({ accountId, ...values })');

    const actions = readFileSync(resolve('src/server/card-actions.ts'), 'utf8');
    expect(actions).toContain('async function ownedManualCard');
    expect(actions).toContain("if (a.provider !== 'manual')");
    expect(actions).toContain("if (a.type !== 'CREDIT')");

    const accounts = readFileSync(resolve('src/components/finance/accounts-list.tsx'), 'utf8');
    expect(accounts).toContain('setManualCardStatement');
    expect(accounts).toContain('data-testid="card-statement-add"');

    const types = readFileSync(resolve('src/lib/engine/cash-needed/types.ts'), 'utf8');
    expect(types).not.toContain('canAddStatementById');
    expect(types).not.toContain('CardStatementControl');
  });
});
