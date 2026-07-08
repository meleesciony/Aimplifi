/**
 * Glass-Box (DECISIONS #178, Competitive-Gap Gap 4 §1): tap a headline number →
 * the rows it's made of, reconciled to the penny. The reconciliation here is
 * REAL: the test parses the rendered row amounts off the DOM, sums them, and
 * compares against the rendered headline — end to end, not a trusted flag.
 */
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/** "$5,412.33" / "− $1,234.56" / "-$0.50" → signed integer cents. */
function textToCents(s: string): number {
  const trimmed = s.trim();
  const negative = trimmed.startsWith('−') || trimmed.startsWith('-');
  const digits = trimmed.replace(/[^0-9]/g, '');
  return (negative ? -1 : 1) * Number(digits);
}

async function signIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');
}

test('dashboard cash-needed: tapping the number opens rows that sum to it exactly', async ({ page }) => {
  await signIn(page);

  const amount = page.getByTestId('cash-needed-amount');
  const panel = page.getByTestId('glass-box-panel');

  // Closed by default; the trigger is a real disclosure button.
  await expect(panel).toBeHidden();
  await expect(amount).toHaveAttribute('aria-expanded', 'false');

  await amount.click();
  await expect(panel).toBeVisible();
  await expect(amount).toHaveAttribute('aria-expanded', 'true');

  // The felt promise: rows parsed off the DOM sum to the rendered headline.
  const rowTexts = await page.getByTestId('glass-box-row-amount').allTextContents();
  expect(rowTexts.length).toBeGreaterThan(0);
  const rowSum = rowTexts.reduce((acc, t) => acc + textToCents(t), 0);
  const headlineCents = textToCents((await amount.textContent()) ?? '');
  expect(rowSum).toBe(headlineCents); // seed: 271233 + 210000 + 60000 = 541233
  await expect(page.getByTestId('glass-box-sum')).toHaveText('$5,412.33');
  await expect(page.getByTestId('glass-box-reconciled')).toContainText('matched to the penny');
  await expect(page.getByTestId('glass-box-reconciled')).toContainText('nothing is invented');

  // Provenance rides along: the seed's autopay card explains itself in-row.
  await expect(panel).toContainText('Autopay handles this payment');
  // The seed's Store Card (no generated statement) is disclosed as excluded.
  await expect(panel).toContainText('next cycle');

  // The expanded panel is WCAG-AA clean (scoped to the card).
  const results = await new AxeBuilder({ page })
    .include('[data-testid="cash-needed-card"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);

  // Toggles closed again.
  await amount.click();
  await expect(panel).toBeHidden();
  await expect(amount).toHaveAttribute('aria-expanded', 'false');
});

test('spending plan: the four breakdown lines sum to "Left to spend" exactly', async ({ page }) => {
  await signIn(page);
  await page.goto('/spending-plan');
  await expect(page.getByTestId('spending-plan-hero')).toBeVisible();

  const rowTexts = await page.getByTestId('plan-row-amount').allTextContents();
  expect(rowTexts).toHaveLength(4);
  const rowSum = rowTexts.reduce((acc, t) => acc + textToCents(t), 0);
  const totalCents = textToCents((await page.getByTestId('plan-total').textContent()) ?? '');
  expect(rowSum).toBe(totalCents);

  await expect(page.getByTestId('plan-reconciled')).toContainText('matched to the penny');
});
