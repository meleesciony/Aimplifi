/**
 * Home Cash Needed: add/edit manual card statement for undated cards without
 * leaving for Cards (DECISIONS #727). Same writers as Cards/Calendar (#710).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Home Cash Needed mounts CardStatementControl for manual undated', () => {
  it('test_regression__household_can_edit_card_statement_from_home_cash_needed_without_leaving_for_cards', () => {
    const page = readFileSync(resolve('src/app/(app)/dashboard/page.tsx'), 'utf8');
    expect(page).toContain('CashNeededCard');
    expect(page).toContain('canAddStatementById');
    expect(page).toContain('cardBilling');
    expect(page).toContain("provider === 'manual'");

    const card = readFileSync(resolve('src/components/finance/cash-needed-card.tsx'), 'utf8');
    expect(card).toContain('CardStatementControl');
    expect(card).toContain('home-cash-needed-statements');
    expect(card).toContain('canAddStatementById');
    expect(card).toContain('cardBilling');

    const actions = readFileSync(resolve('src/server/card-actions.ts'), 'utf8');
    expect(actions).toContain("revalidatePath('/dashboard')");
  });
});
