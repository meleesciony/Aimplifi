/**
 * Calendar: edit/add manual card statement on card-due without leaving for Cards/Accounts (DECISIONS #710).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Calendar mounts CardStatementControl on card-due', () => {
  it('test_regression__household_can_edit_card_statement_from_calendar_without_leaving_for_cards', () => {
    const page = readFileSync(resolve('src/app/(app)/calendar/page.tsx'), 'utf8');
    expect(page).toContain('CardStatementControl');
    expect(page).toContain('calendar-card-statement-');
    expect(page).toContain("e.kind === 'card-due'");
    expect(page).toContain('canAddStatementById');
    expect(page).toContain('cardBilling');
    expect(page).toContain("provider === 'manual'");

    const actions = readFileSync(resolve('src/server/card-actions.ts'), 'utf8');
    expect(actions).toContain("revalidatePath('/calendar')");
  });
});
