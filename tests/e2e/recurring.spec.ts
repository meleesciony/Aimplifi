/**
 * Recurring & subscriptions (DECISIONS #71): the dashboard surfaces a live
 * monthly-recurring total, and the full view lists detected subscriptions with
 * the Netflix price increase flagged — all from the seed, zero credentials.
 */
import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from './helpers/test';

async function signIn(page: Page) {
  await page.goto('/');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');
}

/**
 * TASKS K.5 — a test stood here: 'dashboard surfaces a monthly recurring total'.
 *
 * #369 (2026-08-01) removed the recurring summary from Home deliberately — Home was reordered
 * around the IWT loop, and that commit states analytics (Ask, top spending, trends, recurring,
 * reminders, savings rate) belong on their own routes rather than stacked on Home. So there is no
 * surface to re-point this one at: the claim it guarded is a claim Home no longer makes, and the
 * monthly total itself is asserted below on /recurring.
 *
 * Deleting an assertion about a withdrawn claim is right; deleting it silently is not, which is why
 * this note stands in its place.
 *
 * Found while re-pointing it, recorded rather than fixed here: the ONLY `/recurring` link in the
 * whole app used to live on that summary card, so the route now has no entry point in the nav —
 * it is reachable from a transaction's detail view and from /spending-plan, and nowhere else.
 * That is a navigation question for the owner, not test debt.
 */

test('recurring view lists subscriptions, a monthly total, and flags the Netflix price increase', async ({
  page,
}) => {
  await signIn(page);
  await page.goto('/recurring');

  await expect(page.getByTestId('recurring-hero')).toBeVisible();
  await expect(page.getByTestId('recurring-monthly-total')).toContainText('$');
  await expect(page.getByTestId('recurring-list')).toBeVisible();

  // A known seed subscription is detected and listed.
  const netflix = page.getByTestId('recurring-row').filter({ hasText: 'Netflix' });
  await expect(netflix).toBeVisible();
  // Its price increase ($15.49 → $17.99) is flagged.
  await expect(netflix.getByTestId('price-change-badge')).toBeVisible();
});

test('coming-up schedule shows horizon totals and predicts Netflix at the NEW price (#246)', async ({
  page,
}) => {
  await signIn(page);
  await page.goto('/recurring');

  const section = page.getByTestId('coming-up');
  await expect(section).toBeVisible();

  // Three nested horizon tiles, each a real dollar figure; 30 days is nonzero
  // on the seed (monthly subscriptions are always due within a month).
  for (const days of [7, 30, 90]) {
    await expect(page.getByTestId(`coming-up-${days}d`)).toContainText('$');
  }
  await expect(page.getByTestId('coming-up-30d')).not.toContainText('$0.00');

  // The schedule is grounded in the two-plateau detector: Netflix's expected
  // charge is the post-increase price, with the honest "was" magnitude — the
  // same time-claim-free form as the row badge (critic #246 P2-1).
  const netflixRow = page.getByTestId('coming-up-row').filter({ hasText: 'Netflix' }).first();
  await expect(netflixRow).toBeVisible();
  await expect(netflixRow).toContainText('$17.99');
  await expect(netflixRow).toContainText('↑ was $15.49');

  // Estimates are disclosed inline (coaching guardrails: assumptions stated).
  await expect(section).toContainText('estimates, not bills');

  // The new section stays WCAG AA clean.
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(axe.violations).toEqual([]);
});

test('each row expands into the charges the detector saw, with the typical-not-total disclosure (O.18c)', async ({
  page,
}) => {
  await signIn(page);
  await page.goto('/recurring');

  // The toggle sits on every row; scope within the row like the badges do.
  const netflix = page.getByTestId('recurring-row').filter({ hasText: 'Netflix' });
  const toggle = netflix.getByTestId('recurring-charges-toggle');
  await expect(toggle).toContainText('Show');
  await expect(toggle).toContainText('charges');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');

  const panel = netflix.getByTestId('recurring-charges-panel');
  await expect(panel).toBeVisible();
  // The evidence: dated charges with signed amounts, newest first.
  const rows = panel.getByTestId('recurring-charges-rows').locator('li');
  const count = await rows.count();
  expect(count).toBeGreaterThan(3);
  await expect(panel.getByTestId('recurring-charges-row-amount').first()).toContainText('-$');
  await expect(rows.first()).toContainText(/^[A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2}/);

  // The disclosure contract — the sentence quotes the ROW's own rendered figure
  // (the wiring lock: pass a different figure and this fails), and says plainly
  // it is the typical amount, not the total.
  const basis = panel.getByTestId('recurring-charges-basis');
  await expect(basis.first()).toContainText('$17.99');
  await expect(basis.first()).toContainText('typical amount, not the total of');

  // The detector's reasoning: cadence, the price plateaus.
  await expect(panel).toContainText('Detected a monthly rhythm in these');
  await expect(panel).toContainText('The price changed from $15.49 to $17.99 on');

  // Collapse works, and the panel state follows aria.
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(panel).toBeHidden();

  // An income series uses deposit wording throughout (payroll is biweekly).
  const payroll = page.getByTestId('recurring-row').filter({ hasText: 'Acme Analytics' });
  await expect(payroll.getByTestId('recurring-charges-toggle')).toContainText('deposits');
  await payroll.getByTestId('recurring-charges-toggle').click();
  const payrollPanel = payroll.getByTestId('recurring-charges-panel');
  await expect(payrollPanel.getByTestId('recurring-charges-basis').first()).toContainText('most recent deposit');
  await expect(payrollPanel).toContainText('Detected a biweekly rhythm');

  // The expanded panel stays WCAG AA clean.
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(axe.violations).toEqual([]);
});
