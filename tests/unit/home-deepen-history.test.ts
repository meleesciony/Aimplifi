/**
 * Home: deepen Plaid history without leaving for Accounts (DECISIONS #711).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Home mounts deepen-history when Plaid is connected', () => {
  it('test_regression__household_can_deepen_plaid_history_from_home_without_leaving_for_accounts', () => {
    const page = readFileSync(resolve('src/app/(app)/dashboard/page.tsx'), 'utf8');
    expect(page).toContain('home-deepen-history-card');
    expect(page).toContain('ConnectAccountsButton');
    expect(page).toContain('deepenHistory');
    expect(page).toContain('canDeepenHistory');
    expect(page).toContain('plaidCount');
  });
});
