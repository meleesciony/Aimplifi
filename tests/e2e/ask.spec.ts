/**
 * Ask Aimplifi (DECISIONS #75): a grounded NL assistant discoverable from a
 * dashboard card, answering questions about the user's own seed data with zero
 * credentials (deterministic routing + tested engines, no LLM key). Pins real
 * seed values (net worth $144,804.74; biggest June purchase Costco $158.44) and
 * runs a WCAG-AA axe scan on the answered page.
 */
import { execSync } from 'node:child_process';
import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';
import { E2E_DB_URL } from '../setup/test-db';

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

test('shows contextual follow-up chips after a spend answer and re-asks on click', async ({
  page,
}) => {
  await signIn(page);
  await page.goto('/ask');
  // "this month" = June 2026 on the demo clock — biggest purchase is Costco $158.44.
  await ask(page, 'How much did I spend on groceries this month?');
  const chips = page.getByTestId('ask-follow-up');
  await expect(chips).toHaveCount(3);
  await chips.filter({ hasText: /biggest purchase/i }).click();
  await expect(page.getByTestId('ask-answer')).toBeVisible();
  await expect(page.getByTestId('ask-headline')).toContainText('Costco');
});

test('answers typed questions grounded in the seed', async ({ page }) => {
  await signIn(page);
  await page.goto('/ask');

  await ask(page, 'What is my net worth?');
  await expect(page.getByTestId('ask-headline')).toContainText('Your net worth is $144,804.74.');

  await ask(page, 'What was my biggest purchase this month?');
  await expect(page.getByTestId('ask-headline')).toContainText('Costco');
  await expect(page.getByTestId('ask-headline')).toContainText('$158.44');

  // #168 per-merchant spend: "at Costco" sums that merchant's purchases (the seed
  // has June Costco spend, so a real figure — grounded to /transactions activity).
  await ask(page, 'How much did I spend at Costco this month?');
  await expect(page.getByTestId('ask-headline')).toContainText(/You spent \$[\d,]+\.\d{2} at Costco this month\./);
  await expect(page.getByTestId('ask-source')).toHaveAttribute('href', '/transactions');

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

test('plans retire-at-age (inverse planning) and offers to save the age as a plan', async ({ page }) => {
  // DECISIONS #131 — "Plan in Words" retirement slice: a stated age is solved for the required
  // monthly contribution to make the portfolio last, grounded in the same /coach figures the
  // /investments retirement outlook uses. With a 20-year runway (default age 40 → 60) the outcome
  // is always reachable or already-on-track (never unreachable), so the save affordance appears.
  await signIn(page);
  await page.goto('/ask');
  await ask(page, 'Can I retire at 60?');

  const headline = page.getByTestId('ask-headline');
  await expect(headline).toContainText('60');
  // Grounded: a retirement plan persists to the planning dial, surfaced on /investments (not /goals).
  await expect(page.getByTestId('ask-source')).toHaveAttribute('href', '/investments');
  const save = page.getByTestId('ask-save-goal');
  await expect(save).toBeVisible();
  await expect(save).toContainText('Save as my plan'); // retirement-specific copy, not "Save as a goal"
  // Deterministic route (the demo has no LLM key) — the interpreted banner must be absent.
  await expect(page.getByText('I interpreted your question')).toHaveCount(0);

  // The save affordance must pass a11y. We do NOT click Save — persisting would mutate the
  // shared demo user under parallel e2e; the save path is locked by save-retirement-age.test.ts.
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

test('a follow-up fragment is answered against the previous question (TASKS 2.1)', async ({
  page,
}) => {
  await signIn(page);
  await page.goto('/ask');

  // The frame: a category question in the current window (June 2026 on the demo clock).
  await ask(page, 'How much did I spend on groceries this month?');
  await expect(page.getByTestId('ask-headline')).toContainText(/Groceries/i);
  await expect(page.getByTestId('ask-headline')).toContainText(/this month/i);

  // Ellipsis 1 — swap the WINDOW; the category is carried, not re-stated.
  await ask(page, 'what about last month?');
  await expect(page.getByTestId('ask-headline')).toContainText(/Groceries/i);
  await expect(page.getByTestId('ask-headline')).toContainText(/last month/i);

  // Ellipsis 2 — swap the CATEGORY; the window (last month) is carried.
  await ask(page, 'and restaurants?');
  await expect(page.getByTestId('ask-headline')).toContainText(/last month/i);
  await expect(page.getByTestId('ask-headline')).not.toContainText(/Groceries/i);
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

/**
 * Learned vocabulary (TASKS 2.3 / DECISIONS #225). The demo dataset learns nothing on
 * its own, so the fixture plants the EVIDENCE a repeat-asker would generate and runs
 * the real miner over it (3 independent rescues → shadow; 2 held-out → flagged).
 *
 * Then the whole user-facing contract, in one flow: a phrasing the parser cannot route
 * is answered anyway, the answer says so, and one click ends it permanently.
 */
test('a learned phrasing answers, discloses itself, and can be forgotten', async ({ page }) => {
  // A REAL account, not the one-click demo: the shared demo login deliberately never
  // learns (one visitor's typed words must not reach the next), so the loop can only
  // be driven end-to-end as a signed-up user.
  const email = `vocab-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill('e2e-password-123');
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20000 });

  execSync('npx tsx scripts/e2e-vocab-fixture.ts', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: E2E_DB_URL, VOCAB_FIXTURE_EMAIL: email },
  });

  await page.goto('/ask');

  // Slang the deterministic parser has no rule for — with no LLM key configured, the
  // ONLY thing that can answer it is the learned phrase.
  await ask(page, 'Whats the damage on groceries?');
  await expect(page.getByTestId('ask-headline')).toContainText(/Groceries/i);
  // The figure is the ENGINE's, not the rule's — this account has no transactions, so
  // the honest answer is the zero-spend copy. The rule routed the question; it did not
  // supply, and could not have supplied, a number.
  await expect(page.getByTestId('ask-headline')).toContainText(/No Groceries spending/i);
  const learnedHeadline = await page.getByTestId('ask-headline').textContent();

  // Nothing is served silently: the flagged band discloses + offers the undo.
  const learned = page.getByTestId('ask-learned');
  await expect(learned).toBeVisible();
  await expect(learned).toContainText(/learned from how you ask/i);

  // Forgetting is terminal — the same question falls back to the honest `unknown`.
  await page.getByTestId('ask-forget-phrase').click();
  await expect(page.getByTestId('ask-forget-phrase')).toContainText(/Forgotten/i);

  // Reload first: the previous answer is still the client's conversation frame
  // (TASKS 2.1), and this question names a category the frame would legitimately swap
  // in. A fresh page isolates the vocabulary route, which is what's under test.
  await page.reload();
  await ask(page, 'Whats the damage on groceries?');
  await expect(page.getByTestId('ask-answer')).not.toContainText(/learned from how you ask/i);
  await expect(page.getByTestId('ask-headline')).toContainText(
    /I can answer questions grounded in your own accounts/i,
  );
  expect(learnedHeadline).not.toBe(await page.getByTestId('ask-headline').textContent());
});
