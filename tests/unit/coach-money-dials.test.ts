/**
 * Coach money dials without leaving for Settings (DECISIONS #683).
 *
 * WealthTargetCard linked to /settings#money-dials. MoneyDialsForm lived only
 * on Settings, so changing return/inflation/wage from Coach required leaving.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Coach mounts MoneyDialsForm on the page', () => {
  it('test_regression__household_can_change_coach_money_dials_without_leaving_for_settings', () => {
    const page = readFileSync(resolve('src/app/(app)/coach/page.tsx'), 'utf8');
    expect(page).toContain('MoneyDialsForm');
    expect(page).toContain('coach-money-dials');
    expect(page).toContain('reloadOnSuccess');
    expect(page).toContain('assumptionsHref="#coach-money-dials"');
    expect(page).toContain('MoneyDialsForm');

    const card = readFileSync(resolve('src/components/coach/wealth-target-card.tsx'), 'utf8');
    expect(card).toContain('assumptionsHref');
    expect(card).toContain('href={assumptionsHref}');

    const form = readFileSync(resolve('src/components/settings/money-dials-form.tsx'), 'utf8');
    expect(form).toContain('reloadOnSuccess');
    expect(form).toContain('updateMoneyDials');
  });
});
