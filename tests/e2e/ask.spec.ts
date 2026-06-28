/**
 * Ask Aimplifi (DECISIONS #75): a grounded NL assistant discoverable from a
 * dashboard card, answering questions about the user's own seed data with zero
 * credentials (deterministic routing + tested engines, no LLM key). Pins real
 * seed values (net worth $144,804.74; biggest June purchase Costco $158.44) and
 * runs a WCAG-AA axe scan on the answered page.
 */
import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';

async function signIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');
}

async function ask(page: Page, question: string) {
  await page.getByTestId('ask-input').fill(question);
  await page.getByTestId('ask-submit').click();
  await expect(page.getByTestId('ask-answer')).toBeVisible();
}

test('discoverable from the dashboard Ask card', async ({ page }) => {
  await signIn(page);
  const card = page.getByTestId('dashboard-ask');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Ask Aimplifi');
  await card.click();
  await page.waitForURL('**/ask');
  await expect(page.getByTestId('ask-input')).toBeVisible();
});

test('answers a suggestion chip', async ({ page }) => {
  await signIn(page);
  await page.goto('/ask');
  await page.getByTestId('ask-suggestion').filter({ hasText: 'net worth' }).first().click();
  await expect(page.getByTestId('ask-answer')).toBeVisible();
  await expect(page.getByTestId('ask-headline')).toContainText('$144,804.74');
});

test('answers typed questions grounded in the seed', async ({ page }) => {
  await signIn(page);
  await page.goto('/ask');

  await ask(page, 'What is my net worth?');
  await expect(page.getByTestId('ask-headline')).toContainText('Your net worth is $144,804.74.');

  await ask(page, 'What was my biggest purchase this month?');
  await expect(page.getByTestId('ask-headline')).toContainText('Costco');
  await expect(page.getByTestId('ask-headline')).toContainText('$158.44');

  await ask(page, 'How much can I safely spend this month?');
  await expect(page.getByTestId('ask-headline')).toContainText(/left to spend|over your plan/);
  await expect(page.getByTestId('ask-source')).toBeVisible();

  // savings_rate delegates to the Coach read-path (same value as /coach)
  await ask(page, "What's my savings rate?");
  await expect(page.getByTestId('ask-headline')).toContainText(/savings rate was .*%|full month of income/);
});

test('plans debt-free BY A DATE (inverse planning) and offers to save it as a goal', async ({ page }) => {
  // DECISIONS #125 — "Plan in Words" debt slice: a stated date is solved for the
  // required extra payment, grounded in the same debt read-path as /goals.
  await signIn(page);
  await page.goto('/ask');
  await ask(page, 'Can I be debt-free by December 2028?');

  const headline = page.getByTestId('ask-headline');
  await expect(headline).toContainText(/debt-free/i);
  await expect(headline).toContainText('December 2028');
  // Grounded: links to the debt plan, and offers the confirm-before-create save action.
  await expect(page.getByTestId('ask-source')).toHaveAttribute('href', '/goals');
  await expect(page.getByTestId('ask-save-goal')).toBeVisible();
  // Deterministic route (the demo has no LLM key) — the interpreted banner must be absent.
  await expect(page.getByText('I interpreted your question')).toHaveCount(0);

  // The new save affordance must also pass a11y (it adds a button to the answer card).
  // NOTE: we deliberately do NOT click Save here — persisting a goal would mutate the
  // shared demo user under parallel e2e; the save path is locked by save-debt-free-goal.test.ts.
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations, JSON.stringify(results.violations.map((v) => v.id))).toEqual([]);
});

test('plans a savings goal BY A DATE (inverse planning) and offers to save it as a goal', async ({ page }) => {
  // DECISIONS #126 — "Plan in Words" savings slice: a stated amount + date is solved for the
  // required monthly contribution, grounded in the same safe-to-spend read-path as /spending-plan.
  await signIn(page);
  await page.goto('/ask');
  await ask(page, 'Can I save $20,000 by December 2028?');

  const headline = page.getByTestId('ask-headline');
  await expect(headline).toContainText('$20,000.00');
  await expect(headline).toContainText('December 2028');
  await expect(headline).toContainText('/mo'); // a real monthly figure, whatever the budget state
  // Grounded: links to goals, and offers the confirm-before-create save action.
  await expect(page.getByTestId('ask-source')).toHaveAttribute('href', '/goals');
  await expect(page.getByTestId('ask-save-goal')).toBeVisible();
  // Deterministic route (the demo has no LLM key) — the interpreted banner must be absent.
  await expect(page.getByText('I interpreted your question')).toHaveCount(0);

  // The save affordance must pass a11y. We do NOT click Save — persisting a goal would mutate
  // the shared demo user under parallel e2e; the save path is locked by save-savings-goal.test.ts.
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations, JSON.stringify(results.violations.map((v) => v.id))).toEqual([]);
});

test('an off-topic question still returns a safe, non-empty answer (no crash)', async ({ page }) => {
  // Env-robust: with no LLM key this is the deterministic capabilities answer;
  // with a key the classifier routes it — either way the pipeline must not crash
  // and never throws. (The no-key capabilities path is covered by unit tests.)
  await signIn(page);
  await page.goto('/ask');
  await page.getByTestId('ask-input').fill('tell me a joke about taxes');
  await page.getByTestId('ask-submit').click();
  // Unknown phrasings may consult the LLM classifier (when a key is set), which is
  // bounded by a 7s timeout before falling back deterministically — allow for it.
  await expect(page.getByTestId('ask-answer')).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('ask-headline')).not.toBeEmpty();
});

test('the answered Ask page passes WCAG 2.1 AA (axe)', async ({ page }) => {
  await signIn(page);
  await page.goto('/ask');
  await ask(page, 'What is my net worth?');
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations, JSON.stringify(results.violations.map((v) => v.id))).toEqual([]);
});
