/**
 * Ask `goal_status` (DECISIONS #738). A named stored savings goal answers with
 * the SAME pace sentence the /goals card prints — not a newly inverse-planned
 * amount+date. Isolation: throwaway user (the demo row now carries GL.4's seeded
 * goals, but this spec's names are its own), on the server's DEMO_TODAY
 * (2026-06-10).
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

test("Ask answers on-track for a stored savings goal with the card's own sentence", async ({ page }) => {
  const email = `e2e-goal-ask-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
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
  await openEditor(card, 'goal-row-target-date', 'goal-target-date-input');
  await card.getByTestId('goal-target-date-input').fill('2027-06');
  await card.getByTestId('goal-target-date-save').click();
  const pace = card.getByTestId('goal-pace');
  await expect(pace).toHaveAttribute('data-pace', 'on-track', { timeout: 20000 });
  const cardSentence = (await pace.innerText()).trim();
  expect(cardSentence).toContain('right on your date');

  await page.goto('/ask');
  await page.getByTestId('ask-input').fill('am I on track for my Pace check?');
  await page.getByTestId('ask-submit').click();
  const answer = page.getByTestId('ask-answer');
  await expect(answer).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('ask-headline')).toHaveText('Pace check — On pace.');
  await expect(answer).toContainText(cardSentence);
  await expect(page.getByTestId('ask-source')).toHaveAttribute('href', '/goals');
});
