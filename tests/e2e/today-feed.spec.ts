/**
 * "Today" nudge feed (NUDGE_PLAN slice 2) — golden-safety on the demo user.
 *
 * The feed is a pure reshape+order of the cards already on the dashboard
 * (buildNudgeFeed). The demo has payment reminders plus two opportunities (LA Fitness
 * unused-subscription, Netflix price-increase — see phase3-coach.spec), so the feed
 * always has a headline and at least one dismissable OPPORTUNITY row.
 *
 * Dismissal is SAFE to exercise here because the demo user is fenced: dismissNudge is a
 * no-op for `user-demo` (session-only collapse, nothing persisted), so this spec never
 * perturbs the shared seed for parallel specs (the #182/#234 render-only precedent —
 * satisfied here by the fence itself, not by avoiding the interaction).
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard', { timeout: 20000 });
  await expect(page.getByTestId('today-feed-card')).toBeVisible({ timeout: 20000 });
}

test('feed renders a headline (not the empty state) with a why-this disclosure', async ({ page }) => {
  await signIn(page);

  await expect(
    page.getByTestId('today-feed-card').getByRole('heading', { name: 'Today' }),
  ).toBeVisible();
  // Not the honest-empty state — the demo has real proposals.
  await expect(page.getByTestId('today-feed-empty')).toHaveCount(0);
  // The transparency control the plan requires is present.
  await expect(page.getByText('Why am I seeing this?').first()).toBeVisible();
  // The two demo opportunities surface in the feed.
  await expect(page.getByTestId('nudge-unused-subscription')).toBeVisible();
  await expect(page.getByTestId('nudge-price-increase')).toBeVisible();

  // P1-1 (honest money semantics): centsAtStake for price-increase is the monthly
  // INCREASE (Netflix $15.49→$17.99 = $2.50/mo; see phase3-coach.spec), so the copy
  // must say "Up $2.50/mo" — never "Now $2.50/mo" (which would claim the price is
  // $2.50). Locks the false-money-copy regression.
  await expect(page.getByTestId('nudge-price-increase')).toContainText('Up $2.50/mo');
  await expect(page.getByTestId('nudge-price-increase')).not.toContainText('Now $');

  // P2-2 (why-this shows verbatim inputs, not just a generic sentence).
  await expect(page.getByTestId('nudge-why-inputs').first()).toContainText('at stake');
});

test('#249: the engineered $214.36 unusual charge surfaces as a dismissable ACTION row with its median basis', async ({ page }) => {
  await signIn(page);
  // Demo-first: the seed's engineered Blue Bottle anomaly (EDGE_CASES §Unusual Charge
  // Radar seed lock) must be visible on the demo dashboard, at ACTION tier (a decision,
  // never competing with CRITICAL warnings), with the comparison basis disclosed.
  const row = page.getByTestId('nudge-unusual_charge');
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute('data-tier', 'action');
  await expect(row).toContainText('Unusual charge worth a look');
  await expect(row).toContainText('$214.36 at Blue Bottle Coffee');
  await expect(row).toContainText('median of'); // the basis, inline next to the figure
  // ACTION tier is dismissable (session-only for the fenced demo user).
  await expect(row.getByTestId('nudge-dismiss-unusual_charge')).toBeVisible();
});

test('P1-2: obligations are labeled "Payment due", never "Card payment due" (loans included)', async ({ page }) => {
  await signIn(page);
  // The feed drops the card/loan discriminant, so it must not assert "card" — a
  // mortgage/loan due would otherwise be mislabeled a card payment.
  await expect(page.getByTestId('today-feed-card')).not.toContainText('Card payment due');
  await expect(page.getByTestId('nudge-payment_due').first()).toContainText('Payment due');
});

test('a critical payment_due row is never given a Dismiss control (never buried)', async ({ page }) => {
  await signIn(page);
  // CRITICAL proposals (dues within the push window) must not offer a hide button.
  const criticalDue = page.locator('[data-testid="nudge-payment_due"][data-tier="critical"]').first();
  if (await criticalDue.count()) {
    await expect(criticalDue.getByTestId('nudge-dismiss-payment_due')).toHaveCount(0);
  }
  // Opportunities, by contrast, ARE dismissable.
  await expect(page.getByTestId('nudge-dismiss-unused-subscription')).toBeVisible();
});

test('dismiss collapses an opportunity in-session; show-everything brings it back', async ({ page }) => {
  await signIn(page);

  // No hidden items yet → the show-everything control is absent.
  await expect(page.getByTestId('today-feed-show-all')).toHaveCount(0);

  await page.getByTestId('nudge-dismiss-unused-subscription').click();
  // Collapsed from the default view immediately (session-only; nothing persisted).
  await expect(page.getByTestId('nudge-unused-subscription')).toHaveCount(0);

  // Now one item is hidden → the control appears and reveals it again.
  const showAll = page.getByTestId('today-feed-show-all');
  await expect(showAll).toBeVisible();
  await expect(showAll).toContainText('1 hidden');
  await showAll.click();
  await expect(page.getByTestId('nudge-unused-subscription')).toBeVisible();
});

test('feed passes WCAG AA with the disclosure and full feed open', async ({ page }) => {
  await signIn(page);
  await page.getByTestId('today-feed-card').getByText('Why am I seeing this?').first().click();
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations, 'axe violations on today-feed').toEqual([]);
});
