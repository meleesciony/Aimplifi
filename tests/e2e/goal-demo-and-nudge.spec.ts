/**
 * TASKS GL.4 + GL.3 + GL.5 on the demo and a throwaway user, at the server's pinned
 * DEMO_TODAY (2026-06-10):
 *   - the demo seed now carries two savings goals (one on pace, one behind), so the
 *     demo /goals page and the Home Goals card open populated, and the behind goal
 *     produces a goal_behind_pace row on the demo Today feed;
 *   - the goal date editor refuses a month past the 1200-month planning horizon
 *     with an inline field error (the native max is the client half).
 *
 * Demo sections are read-only (the shared-demo lesson): they assert, they never write.
 * The horizon section uses a throwaway user — a demo write is fenced anyway, and the
 * refusal must be proven on a writer that can actually run.
 */
import { execSync } from 'node:child_process';
import { expect, test } from './helpers/test';
import { clickMoreNav } from './helpers/more-nav';
import { E2E_DB_URL } from '../setup/test-db';

test('demo goals: the seeded goals render on /goals and Home, and the behind one nudges on the Today feed', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard', { timeout: 20000 });

  // Home: the Goals card exists with the seeded rows — behind first (attention rank).
  const home = page.getByTestId('home-goals-card');
  await expect(home).toBeVisible({ timeout: 20000 });
  await expect(home.getByTestId('home-goals-headline')).toHaveText('1 of 2 goals needs a look');
  await expect(home).toContainText('New Car Fund');
  await expect(home).toContainText('Vacation Fund');
  await expect(home.getByTestId('home-goal-pace').first()).toHaveAttribute('data-pace', 'behind');

  // /goals: both cards, with the progress layer.
  await clickMoreNav(page, 'nav-goals');
  await page.waitForURL('**/goals');
  const carCard = page.getByTestId('goals-list').locator('[data-slot="card"]').filter({
    has: page.getByRole('button', { name: 'Rename New Car Fund' }),
  });
  const vacationCard = page.getByTestId('goals-list').locator('[data-slot="card"]').filter({
    has: page.getByRole('button', { name: 'Rename Vacation Fund' }),
  });
  await expect(carCard).toBeVisible({ timeout: 20000 });
  await expect(vacationCard).toBeVisible();
  await expect(carCard.getByTestId('goal-progress-percent')).toHaveText('10% funded');
  await expect(carCard.getByTestId('goal-pace')).toContainText('$450.00/mo gets you there on time ($300.00/mo more)');
  await expect(carCard.getByTestId('goal-pace-badge')).toHaveText('Behind pace');
  await expect(vacationCard.getByTestId('goal-pace-badge')).toHaveText('No date yet');
  await expect(vacationCard.getByTestId('goal-progress-percent')).toHaveText('33% funded');

  // Home Today feed: the seeded behind goal speaks as a nudge, with the card's own
  // sentence as its detail — the GL.2 single-copy-truth invariant, now on the feed.
  await page.goto('/dashboard');
  const nudge = page.getByTestId('nudge-goal_behind_pace');
  await expect(nudge).toBeVisible({ timeout: 20000 });
  await expect(nudge).toContainText('New Car Fund is behind pace');
  await expect(nudge).toContainText('$450.00/mo gets you there on time ($300.00/mo more)');
  await expect(nudge).toContainText("counting the $600.00 you've marked saved");
  await expect(nudge.getByTestId('nudge-dismiss-goal_behind_pace')).toBeVisible();
});

test('goal date editor refuses a month past the 1200-month horizon with an inline error (GL.5)', async ({
  page,
}) => {
  const email = `e2e-goal-horizon-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill('e2e-password-123');
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20000 });

  // The /goals form is gated on having an account (the same setup goal-progress.spec runs).
  execSync(`npx tsx scripts/e2e-add-foreign-account.ts ${email} --usd-only`, {
    env: { ...process.env, DATABASE_URL: E2E_DB_URL },
    stdio: 'inherit',
  });

  await page.goto('/goals');
  await expect(page.getByTestId('goal-form')).toBeVisible({ timeout: 20000 });
  await page.locator('input[name="name"]').fill('Horizon check');
  await page.locator('input[name="target"]').fill('1000');
  await page.getByTestId('goal-create').click();

  const card = page.getByTestId('goals-list').locator('[data-slot="card"]').filter({
    has: page.getByRole('button', { name: 'Rename Horizon check' }),
  });
  await expect(card).toBeVisible({ timeout: 20000 });

  // Open the date editor. A month in the seam between the server's horizon and the
  // client's native max (server refuses from Jul 2126; the input's max is 1200 real
  // months ahead) must be refused by the SERVER with its field error. The refusal
  // itself is locked directly by goal-date-horizon.test.ts; this proves it renders
  // through the real form.
  await expect(async () => {
    await card.getByTestId('goal-row-target-date').click({ timeout: 2000 });
    await expect(card.getByTestId('goal-target-date-input')).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20000 });
  await expect(card.getByTestId('goal-target-date-input')).toHaveAttribute('max', /.+/);
  await card.getByTestId('goal-target-date-input').fill('2126-08');
  await card.getByTestId('goal-target-date-save').click();
  await expect(card.getByText('Pick a month within 100 years')).toBeVisible({ timeout: 20000 });
  // Nothing stored: after closing the editor the row still offers "Set date".
  await card.getByRole('button', { name: 'Cancel' }).click();
  await expect(card.getByTestId('goal-row-target-date')).toContainText('Set date');

  // A month past the native max never reaches the server either way — whichever
  // layer refuses (native constraint, or the server on a month-input fallback),
  // the editor stays open with the typed value and the row is untouched.
  await expect(async () => {
    await card.getByTestId('goal-row-target-date').click({ timeout: 2000 });
    await expect(card.getByTestId('goal-target-date-input')).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20000 });
  await card.getByTestId('goal-target-date-input').fill('3200-01');
  await card.getByTestId('goal-target-date-save').click();
  await expect(card.getByTestId('goal-target-date-input')).toHaveValue('3200-01');
  await expect(page.getByTestId('goals-list').getByText('by Sep 3200')).toHaveCount(0);
  await card.getByRole('button', { name: 'Cancel' }).click();

  // A near-term date still saves (and the month input carries the native max).
  await expect(async () => {
    await card.getByTestId('goal-row-target-date').click({ timeout: 2000 });
    await expect(card.getByTestId('goal-target-date-input')).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20000 });
  await card.getByTestId('goal-target-date-input').fill('2027-06');
  await card.getByTestId('goal-target-date-save').click();
  await expect(card.getByTestId('goal-row-target-date')).toContainText('by Jun 2027', {
    timeout: 20000,
  });

  // Cleanup so reruns stay deterministic (the throwaway row is ours).
  const confirmBtn = card.getByTestId('goal-delete-confirm');
  await expect(async () => {
    if ((await confirmBtn.count()) === 0) {
      await card.getByRole('button', { name: 'Delete Horizon check' }).click({ timeout: 2000 });
    }
    await expect(confirmBtn).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20000 });
  await confirmBtn.click();
  await expect(card).toHaveCount(0);
});
