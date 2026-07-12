/**
 * Household membership core — /settings Household section (TASKS 4.2 slice 1).
 *
 * RENDER-ONLY on purpose (the #182 render-only Sessions precedent): the demo
 * user must NEVER join a household (HOUSEHOLD_ARCHITECTURE T6 — golden/demo
 * safety), so this spec asserts the empty-state card renders with the create
 * form and the honesty disclosure, and never clicks a mutation. The behavior
 * load is carried by tests/unit/household-actions.test.ts (real actions
 * against throwaway users).
 */
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function signIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');
}

test('settings renders the Household card in its no-household state (T6: demo user has no membership)', async ({
  page,
}) => {
  await signIn(page);
  await page.goto('/settings');

  const card = page.getByTestId('household-card');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Household');

  // Honesty disclosure: membership alone shares nothing.
  await expect(page.getByTestId('household-disclosure')).toContainText('shares');
  await expect(page.getByTestId('household-disclosure')).toContainText('nothing');

  // Demo user has no membership and no incoming invites — the create form is
  // the whole body: no member rows, no invite entry, no leave control.
  await expect(page.getByTestId('household-create-form')).toBeVisible();
  await expect(page.getByTestId('household-create-name')).toBeVisible();
  await expect(page.getByTestId('household-member-row')).toHaveCount(0);
  await expect(page.getByTestId('household-incoming-invite')).toHaveCount(0);
  await expect(page.getByTestId('household-leave')).toHaveCount(0);

  // The new card itself is WCAG-AA clean (scoped, per the ai-trust precedent).
  const results = await new AxeBuilder({ page })
    .include('[data-testid="household-card"]')
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  expect(results.violations).toEqual([]);
});

test('slice 2 golden safety: /accounts shows NO household-sharing card for the demo user (T6)', async ({
  page,
}) => {
  await signIn(page);
  await page.goto('/accounts');

  // The page itself renders normally…
  await expect(page.getByTestId('accounts-net-worth')).toBeVisible();
  await expect(page.getByTestId('account-row').first()).toBeVisible();
  // …and the household-sharing surface is entirely absent without a membership
  // (getAccountSharingView → kind 'none'): demo /accounts is byte-identical.
  await expect(page.getByTestId('household-sharing-card')).toHaveCount(0);
  await expect(page.getByTestId('shared-account-row')).toHaveCount(0);
  await expect(page.getByTestId('own-share-row')).toHaveCount(0);
});

test('slice 4 golden safety: /dashboard shows NO household-scope toggle for the demo user (T6)', async ({
  page,
}) => {
  await signIn(page);
  await page.goto('/dashboard');

  await expect(page.getByTestId('cash-needed-card')).toBeVisible();
  // No membership → getDashboardData's `household` is null: the toggle never mounts.
  await expect(page.getByTestId('household-scope-toggle')).toHaveCount(0);

  // A stale/guessed `?scope=household` link must never error — getDashboardData
  // silently degenerates to 'mine' without live partners (§4.4).
  await page.goto('/dashboard?scope=household');
  await expect(page.getByTestId('cash-needed-card')).toBeVisible();
  await expect(page.getByTestId('household-scope-toggle')).toHaveCount(0);
});

/**
 * Slice-2 member state (critic F4): a THROWAWAY signup user (auth.spec /
 * manual-card-statement pattern — never the demo user, T6 guard untouched)
 * creates a household, adds a manual account, and toggles a REAL share via
 * setAccountShared. Locks the mounted card's consent copy (full disclosure —
 * critic F2), the round-trip flag flip, and WCAG AA on the member-state DOM.
 * Post-reload clicks use the state-aware click-and-verify retry (#167).
 */
test('member state: create household → add account → share it (real mutation round-trip + axe)', async ({
  page,
}) => {
  const email = `e2e-share-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill('e2e-password-123');
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20000 });

  // Create a household (state-aware retry: a pre-hydration submit is dropped).
  await page.goto('/settings');
  await expect(async () => {
    if (!(await page.getByTestId('household-name').isVisible().catch(() => false))) {
      await page.getByTestId('household-create-name').fill('E2E Casa');
      await page.getByTestId('household-create-submit').click({ timeout: 2000 });
    }
    await expect(page.getByTestId('household-name')).toHaveText('E2E Casa', { timeout: 3000 });
  }).toPass({ timeout: 30000 });

  // Add a manual account so there is something to share.
  await page.goto('/accounts');
  await expect(page.getByTestId('accounts-empty')).toBeVisible({ timeout: 20000 });
  await page.getByTestId('add-asset-btn').click();
  await page.getByTestId('manual-name').fill('E2E Shared Checking');
  await page.getByTestId('manual-type').selectOption('CHECKING');
  await page.getByTestId('manual-value').fill('250');
  await page.getByTestId('manual-submit').click();

  // The member-state sharing card mounts with the FULL consent disclosure (F2).
  const card = page.getByTestId('household-sharing-card');
  await expect(card).toBeVisible({ timeout: 20000 });
  await expect(card).toContainText('name, type, last 4 digits, balance, and transactions');
  const row = card.getByTestId('own-share-row').filter({ hasText: 'E2E Shared Checking' });
  await expect(row).toBeVisible();

  // Share it — a real setAccountShared round-trip (success = full reload).
  await expect(async () => {
    if (!(await row.getByText('· shared').isVisible().catch(() => false))) {
      await row.getByRole('button').click({ timeout: 2000 });
    }
    await expect(row.getByRole('button')).toHaveText('Stop sharing', { timeout: 3000 });
  }).toPass({ timeout: 30000 });

  // WCAG AA on the mounted member-state card (scoped, ai-trust precedent).
  const results = await new AxeBuilder({ page })
    .include('[data-testid="household-sharing-card"]')
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  expect(results.violations).toEqual([]);

  // Slice 4: a single-member household (no partner has joined yet) still shows
  // no toggle — `hasPartners` is false, so there is nothing a "household" scope
  // could add. The two-partner merge itself is proven against a real DB in
  // tests/unit/household-cash-needed.test.ts (this e2e user has no partner to
  // invite/accept within one Playwright session).
  await page.goto('/dashboard');
  await expect(page.getByTestId('household-scope-toggle')).toHaveCount(0);
});

test('slice 5 golden safety: /cards and /calendar show NO household-scope toggle for the demo user (T6)', async ({
  page,
}) => {
  await signIn(page);

  await page.goto('/cards');
  await expect(page.getByTestId('household-scope-toggle')).toHaveCount(0);
  // Stale `?scope=household` must never error — getDashboardData silently
  // degenerates to 'mine' without live partners (§4.4), same as /dashboard.
  await page.goto('/cards?scope=household');
  await expect(page.getByTestId('household-scope-toggle')).toHaveCount(0);

  await page.goto('/calendar');
  await expect(page.getByTestId('cal-month')).toBeVisible();
  await expect(page.getByTestId('household-scope-toggle')).toHaveCount(0);
  await page.goto('/calendar?scope=household');
  await expect(page.getByTestId('cal-month')).toBeVisible();
  await expect(page.getByTestId('household-scope-toggle')).toHaveCount(0);
});

test('slice 3 golden safety: /transactions shows NO shared-txn section for the demo user (T6)', async ({
  page,
}) => {
  await signIn(page);
  await page.goto('/transactions');

  await expect(page.getByTestId('txn-list')).toBeVisible();
  // getSharedTransactionsView → kind 'none' without membership: demo register
  // is byte-identical aside from the (absent) shared section.
  await expect(page.getByTestId('shared-txn-section')).toHaveCount(0);
  await expect(page.getByTestId('shared-txn-row')).toHaveCount(0);
});
