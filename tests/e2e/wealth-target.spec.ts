/**
 * Wealth target on /coach — the "$10M, what do I need to do?" card.
 *
 * What this spec is for: the engine's own suite proves the arithmetic, and a pure-engine
 * test can never see whether the numbers reach the page or whether the controls are wired
 * to them (the L.31 lesson — a unit test on a converter proves the arithmetic, never the
 * intake). So every assertion here is about the RENDERED card changing when the reader
 * acts, plus the two claims the copy makes that a reader would be misled by if they were
 * silently dropped: today's-dollars basis, and the return spread.
 */
import { expect, test } from './helpers/test';

test('wealth target: typing a target and dragging the horizon move the live answer', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');

  await page.getByTestId('bottom-nav-coach').click();
  await page.waitForURL('**/coach');

  const card = page.getByTestId('wealth-target-card');
  await expect(card).toBeVisible();

  // The basis is stated on the card itself, never left to a footnote: both the
  // today's-dollars reading and the after-inflation rate it was computed at.
  const basis = page.getByTestId('wealth-target-basis');
  await expect(basis).toContainText("today's money");
  await expect(basis).toContainText('after inflation');

  // Raising the target can only push the answer further out — the pace line must MOVE.
  const paceBefore = await page.getByTestId('wealth-target-pace').textContent();
  await page.getByTestId('wealth-target-amount').fill('$10,000,000');
  await expect(page.getByTestId('wealth-target-pace')).not.toHaveText(paceBefore ?? '');

  // The required-contribution half answers the deadline question, and dragging the
  // horizon changes it live (a shorter horizon demands more per month).
  const requiredAt25 = await page.getByTestId('wealth-target-required').textContent();
  await page.getByTestId('wealth-target-horizon').fill('10');
  await expect(page.getByTestId('wealth-target-horizon-value')).toHaveText('10 years');
  const requiredAt10 = await page.getByTestId('wealth-target-required').textContent();
  expect(requiredAt10).not.toBe(requiredAt25);
  expect(requiredAt10).toContain('/month');

  // A negative guilt-free figure must never be described as money the reader HAS. The demo
  // is overspent (`leftToSpendCents` = -$2,432.33, `overspent: true`), so this fixture
  // genuinely exercises the branch — asserted here so the lock cannot quietly degrade into
  // measuring only the affordable case if the seed ever changes.
  const additional = page.getByTestId('wealth-target-additional');
  await expect(additional).toContainText('no guilt-free figure to weigh it against');
  await expect(additional).not.toContainText('-$');
  await expect(additional).not.toContainText('guilt-free spending you have');

  // The two cards on this page rest on different bases; the newer one names the difference
  // rather than leaving a reader to reconcile two dates on their own.
  await expect(page.getByTestId('wealth-target-vs-fi')).toContainText('before inflation');

  // The sensitivity table always carries three rows — the spread is the point, and a
  // single confident date would hide it. Open the disclosure so the assertion is about
  // what the reader can actually SEE, not merely what is in the DOM.
  await page.getByTestId('wealth-target-sensitivity').locator('summary').click();
  const rows = page.getByTestId('wealth-target-sensitivity-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toBeVisible();
  // Each row names the nominal assumption AND what it deflates to.
  await expect(rows.first()).toContainText('after inflation');
});

/**
 * The input boundary. Both hostile critics broke the card here and a pure-engine test
 * could not have seen any of it: the crash lived in a `useMemo` during render, and the
 * stale-answer bug lived in the gap between what the box showed and what state held.
 */
test('wealth target: the amount box refuses rather than crashing or answering a stale number', async ({
  page,
}) => {
  await page.goto('/sign-in');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');
  await page.goto('/coach');

  const box = page.getByTestId('wealth-target-amount');
  const basis = page.getByTestId('wealth-target-basis');
  await expect(page.getByTestId('wealth-target-card')).toBeVisible();

  // A 14-digit paste used to reach `cents()`, throw mid-render, and unwind the WHOLE page
  // to the error boundary — every other coach card with it. The engine refuses instead.
  await box.fill('90000000000000');
  await expect(page.getByTestId('wealth-target-card')).toBeVisible();
  await expect(basis).toContainText('Enter a target between');
  // The card refuses as a whole: no date, no contribution, no sensitivity rows.
  await expect(page.getByTestId('wealth-target-pace')).toHaveCount(0);
  await expect(page.getByTestId('wealth-target-required')).toHaveCount(0);
  await expect(page.getByTestId('wealth-target-sensitivity-row')).toHaveCount(0);

  // Clearing the box must not leave the previous target's answer standing under an empty
  // field: the reader can see no number, so the card claims none.
  await box.fill('$25,000.00');
  await expect(basis).toContainText('$25,000.00');
  await box.fill('');
  await expect(basis).toContainText('Enter a target amount');
  await expect(basis).not.toContainText('$25,000.00');
  await expect(box).toHaveAttribute('aria-invalid', 'true');

  // Unparseable text is the same state — "ten million" is not a number this app reads.
  await box.fill('ten million');
  await expect(basis).toContainText('Enter a target amount');
  await expect(box).toHaveAttribute('aria-invalid', 'true');

  // And a real number brings the answer back, with the field no longer flagged.
  await box.fill('$2,000,000');
  await expect(basis).toContainText('$2,000,000.00');
  await expect(box).toHaveAttribute('aria-invalid', 'false');
  await expect(page.getByTestId('wealth-target-pace')).toBeVisible();
});
