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
import { expect, test, type Page } from './helpers/test';

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

test('#251: the engineered income pause surfaces on demo as ACTION with both bases inline — and NO confirm control (fence)', async ({ page }) => {
  await signIn(page);
  // Demo-first: the seed's engineered Stripe Payout pause (EDGE_CASES §Income-Pause
  // Radar seed lock: 4 × +$380.00 monthly, silent since 2026-04-10) must be visible
  // at ACTION tier — an acknowledgment, never competing with CRITICAL warnings.
  const row = page.getByTestId('nudge-income_pause');
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute('data-tier', 'action');
  await expect(row).toContainText('A regular deposit seems paused');
  await expect(row).toContainText('$380.00 from Stripe Payout usually arrives monthly');
  await expect(row).toContainText('based on 4 deposits'); // the cadence claim's basis, inline
  // The runway figure states its own formula next to the number (coaching guardrail).
  await expect(row).toContainText('covers about');
  await expect(row).toContainText('(cash ÷ your 6-month average expenses)');
  // Dismissable (ACTION), but the demo NEVER gets the confirm control: one visitor's
  // "my income stopped" must not mutate the shared account's projections (#243 fence
  // family) — the affordance is absent, not just a dead button.
  await expect(row.getByTestId('nudge-dismiss-income_pause')).toBeVisible();
  await expect(row.getByTestId('nudge-income-pause-confirm')).toHaveCount(0);
});

test('#251: throwaway user — confirm marks the pause HANDLED (projections excluded), Undo restores it', async ({ page }) => {
  // Full confirm/undo loop on an isolated signup user (the #244 throwaway pattern —
  // confirm WRITES, so it can never run as demo). Dates are relative to the SERVER'S
  // clock: e2e runs with DEMO_TODAY=2026-06-10 pinned (.env; businessToday precedence
  // 1 pins EVERY user, not only demo — the phase2-triage SEED_AS_OF precedent), so
  // four monthly deposits ending two months before the PIN → lapsed 31 days (inside
  // grace 10 ≤ daysLate ≤ 60).
  const email = `e2e-pause-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill('e2e-password-123');
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20000 });

  // One checking account to file deposits against.
  await page.goto('/accounts');
  await expect(async () => {
    await page.getByTestId('add-asset-btn').click({ timeout: 2000 });
    await expect(page.getByTestId('manual-name')).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20000 });
  await page.getByTestId('manual-name').fill('E2E Pause Checking');
  await page.getByTestId('manual-type').selectOption('CHECKING');
  await page.getByTestId('manual-value').fill('5000');
  await page.getByTestId('manual-submit').click();
  await expect(page.getByTestId('manual-account-row').filter({ hasText: 'E2E Pause Checking' })).toBeVisible({ timeout: 20000 });

  // Four monthly +$380.00 deposits, months -5..-2 relative to the pinned server
  // clock — detectRecurring sees MONTHLY ×4, lapsed 31 days at DEMO_TODAY.
  const PINNED_TODAY = new Date(Date.UTC(2026, 5, 10)); // DEMO_TODAY 2026-06-10 (.env)
  for (let back = 5; back >= 2; back--) {
    const d = new Date(PINNED_TODAY);
    d.setUTCMonth(d.getUTCMonth() - back);
    const dateStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    await page.goto('/transactions/new');
    // Money-in toggle is React state: a pre-hydration click drops silently and the
    // deposit would file as money-OUT (splitting the sign group below 4 occurrences).
    // Click-and-verify against the React-controlled aria-pressed (#167 idiom).
    await expect(async () => {
      await page.getByTestId('dir-in').click({ timeout: 2000 });
      await expect(page.getByTestId('dir-in')).toHaveAttribute('aria-pressed', 'true', { timeout: 2000 });
    }).toPass({ timeout: 20000 });
    await page.getByTestId('txn-descriptor').fill('STRIPE PAYOUT ETSY SHOP');
    await page.getByTestId('txn-amount').fill('380.00');
    await page.getByTestId('txn-date').fill(dateStr);
    await page.getByTestId('txn-submit').click();
    await page.waitForURL('**/transactions', { timeout: 20000 });
  }

  // The pause surfaces with the confirm control (a real user, not demo).
  await page.goto('/dashboard');
  const row = page.getByTestId('nudge-income_pause');
  await expect(row).toBeVisible({ timeout: 20000 });
  await expect(row).toHaveAttribute('data-tier', 'action');
  const confirm = row.getByTestId('nudge-income-pause-confirm');
  await expect(confirm).toBeVisible();

  // Confirm → the row flips to quiet HANDLED state ("projections don't count it")
  // carrying the Undo — the mutation stays visible for as long as it is in force.
  // First click after load can land pre-hydration; click-and-verify (#167 idiom).
  await expect(async () => {
    await confirm.click({ timeout: 2000 });
    await expect(page.locator('[data-testid="nudge-income_pause"][data-tier="handled"]')).toBeVisible({ timeout: 5000 });
  }).toPass({ timeout: 30000 });
  const handled = page.locator('[data-testid="nudge-income_pause"][data-tier="handled"]');
  await expect(handled).toContainText('Income marked paused');
  await expect(handled).toContainText('cash projections don’t count it');
  const undo = handled.getByTestId('nudge-income-pause-undo');
  await expect(undo).toBeVisible();

  // Undo → back to the unconfirmed ACTION nudge (the mutation is reversible).
  await expect(async () => {
    await undo.click({ timeout: 2000 });
    await expect(page.locator('[data-testid="nudge-income_pause"][data-tier="action"]')).toBeVisible({ timeout: 5000 });
  }).toPass({ timeout: 30000 });
  await expect(page.getByTestId('nudge-income-pause-confirm')).toBeVisible();
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
