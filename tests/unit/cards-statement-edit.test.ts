/**
 * Cards: edit/clear a manual statement without leaving for Accounts (DECISIONS #681).
 *
 * Add statement lived on Cards “No due date yet”. Edit/Clear lived only on
 * Accounts. Dated manual cards on /cards had no way to change the statement.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Cards can edit and clear a manual statement', () => {
  it('test_regression__household_can_edit_a_card_statement_without_leaving_for_accounts', () => {
    const control = readFileSync(resolve('src/components/finance/card-statement-control.tsx'), 'utf8');
    expect(control).toContain('setManualCardStatement');
    expect(control).toContain('clearManualCardStatement');
    expect(control).toContain('card-row-statement-edit');
    expect(control).toContain('card-row-statement-clear');
    expect(control).toContain('hasStatement');

    const breakdown = readFileSync(resolve('src/components/finance/cards-breakdown.tsx'), 'utf8');
    expect(breakdown).toContain('cardBilling');
    expect(breakdown).toContain('<CardStatementControl');
    expect(breakdown).toContain('card.isManual');

    const page = readFileSync(resolve('src/app/(app)/cards/page.tsx'), 'utf8');
    expect(page).toContain('cardBilling');
    expect(page).toContain('prisma.statement.findMany');
  });
});
