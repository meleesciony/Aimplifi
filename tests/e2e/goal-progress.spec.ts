/**
 * Goal progress + pace (DECISIONS #737). A savings goal card shows how far along it is
 * (bar + percent) and ONE verdict about its date, and the verdict follows every edit:
 * no date → a funded-by month; a date → on pace; more saved → ahead; a smaller pledge →
 * behind, with the monthly that closes the gap. Home then surfaces the goal that needs a
 * look. Isolation: throwaway user (the demo row's goal edits are fenced), on the server's
 * DEMO_TODAY (2026-06-10) — the same "today" every user gets in e2e.
 */
import { execSync } from 'node:child_process';
import { expect, test, type Locator } from './helpers/test';
import { E2E_DB_URL } from '../setup/test-db';

async function openEditor(card: Locator, trigger: string, input: string) {
  await expect(async () => {
    await card.getByTestId(trigger).click({ timeout: 2000 });
    await expect(card.getByTestId(input)).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20000 });
}

test('goal card shows progress + pace that follows date, saved and monthly edits; Home surfaces it', async ({ page }) => {
  const email = `e2e-goal-pace-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill('e2e-password-123');
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20000 });

  execSync(`npx tsx scripts/e2e-add-foreign-account.ts ${email} --usd-only`, {
    env: { ...process.env, DATABASE_URL: E2E_DB_URL },
    stdio: 'inherit',
  });

  await page.goto('/goals');
  await expect(page.getByTestId('goal-form')).toBeVisible({ timeout: 20000 });
  await page.locator('input[name="name"]').fill('Pace check');
  await page.locator('input[name="target"]').fill('6000');
  await page.locator('input[name="monthly"]').fill('500');
  await page.getByTestId('goal-create').click();

  const card = page.getByTestId('goals-list').locator('[data-slot="card"]').filter({
    has: page.getByRole('button', { name: 'Rename Pace check' }),
  });
  await expect(card).toBeVisible({ timeout: 20000 });
  const pace = card.getByTestId('goal-pace');
  const percent = card.getByTestId('goal-progress-percent');
  const bar = card.getByTestId('goal-progress-bar');

  // No date yet: a funded-by month (2026-06-10 + 12 months), never a pace verdict.
  await expect(percent).toHaveText('0% funded');
  await expect(bar).toHaveAttribute('aria-valuenow', '0');
  await expect(pace).toHaveAttribute('data-pace', 'no-date');
  await expect(pace).toContainText('funded by Jun 2027');
  await expect(card.getByTestId('goal-pace-badge')).toHaveText('No date yet');

  // "by Jun 2027" (stored as the 1st) at $500/mo → on pace, right on the date — the
  // month-granular deadline, not "1 month behind" a 1st-of-June the reader never chose.
  await openEditor(card, 'goal-row-target-date', 'goal-target-date-input');
  await card.getByTestId('goal-target-date-input').fill('2027-06');
  await card.getByTestId('goal-target-date-save').click();
  await expect(pace).toHaveAttribute('data-pace', 'on-track', { timeout: 20000 });
  await expect(pace).toContainText('right on your date');
  await expect(card.getByTestId('goal-pace-badge')).toHaveText('On pace');

  // $1,500 already saved → 25%, 3 months ahead.
  await openEditor(card, 'goal-row-saved', 'goal-saved-input');
  await card.getByTestId('goal-saved-input').fill('1500');
  await card.getByTestId('goal-saved-save').click();
  await expect(percent).toHaveText('25% funded', { timeout: 20000 });
  await expect(bar).toHaveAttribute('aria-valuenow', '25');
  await expect(pace).toHaveAttribute('data-pace', 'on-track');
  await expect(pace).toContainText('3 months ahead of your Jun 2027 date');

  // $300/mo → behind; the card names the monthly that closes the gap.
  await openEditor(card, 'goal-row-monthly', 'goal-monthly-input');
  await card.getByTestId('goal-monthly-input').fill('300');
  await card.getByTestId('goal-monthly-save').click();
  await expect(pace).toHaveAttribute('data-pace', 'behind', { timeout: 20000 });
  await expect(pace).toContainText("counting the $1,500.00 you've marked saved");
  await expect(pace).toContainText('$375.00/mo gets you there on time ($75.00/mo more)');
  await expect(pace).toContainText("update what you've saved");
  await expect(card.getByTestId('goal-pace-badge')).toHaveText('Behind pace');

  // Home: the same row, same verdict, same sentence, and the hand-typed basis in view.
  await page.goto('/dashboard');
  const home = page.getByTestId('home-goals-card');
  await expect(home).toBeVisible({ timeout: 20000 });
  await expect(home.getByTestId('home-goals-headline')).toHaveText('Your goal needs a look');
  await expect(home).toContainText('Pace check');
  await expect(home.getByTestId('home-goal-basis')).toHaveText('$1,500.00 marked saved of $6,000.00 · 25% funded');
  const homePace = home.getByTestId('home-goal-pace');
  await expect(homePace).toHaveAttribute('data-pace', 'behind');
  await expect(homePace).toContainText('$375.00/mo gets you there on time ($75.00/mo more)');
  await home.getByTestId('home-goals-link').click();
  await page.waitForURL('**/goals');
});
