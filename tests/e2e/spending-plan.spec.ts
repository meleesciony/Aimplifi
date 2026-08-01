/**
 * Spending Plan (DECISIONS #66; #295 guilt-free reframe; L.22 pattern re-spec):
 * demo sign-in → Plan → "guilt-free to spend" headline renders with its
 * breakdown. The exact cents come from the seed, so we assert a money-shaped
 * value + the breakdown structure rather than a brittle pinned number.
 */
import { expect, test } from './helpers/test';
import { clickMoreNav } from './helpers/more-nav';

test('Spending Plan: guilt-free headline + breakdown render for the demo user', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');

  await clickMoreNav(page, 'nav-spending-plan');
  await page.waitForURL('**/spending-plan');

  await expect(page.getByTestId('spending-plan-hero')).toBeVisible();
  await expect(page.getByTestId('safe-to-spend')).toHaveText(/-?\$[\d,]+\.\d{2}/);
  // L.22: income is a trailing pattern, expenses a monthly-rate pattern — the
  // demo seed has complete months, so the median basis renders.
  await expect(page.getByText(/Income \(median of last \d months?/, { exact: false })).toBeVisible();
  // #371: non-discretionary pattern when history exists; else recurring series.
  await expect(
    page.getByText(/Fixed (costs \(non-discretionary|& recurring expenses \(monthly pattern\))/, {
      exact: false,
    }),
  ).toBeVisible();
  // Owner 2026-08-01: card payments are not a Plan row (settlement, not a cost class).
  await expect(page.getByText('Card payments due this month', { exact: true })).toHaveCount(0);

  // Allocation legend (#186): labeled swatches under the bar (touch-visible;
  // title= tooltips alone are not).
  const legend = page.getByTestId('spending-plan-legend');
  await expect(legend).toBeVisible();
  await expect(legend.getByText('Fixed expenses', { exact: true })).toBeVisible();
  await expect(legend.getByText('Savings', { exact: true })).toBeVisible();
  await expect(legend.getByText('Guilt-free', { exact: true })).toBeVisible();
  // The old cash-month rows are gone — no per-day framing anywhere (L.22).
  await expect(page.getByText('/day', { exact: false })).toHaveCount(0);

  // L.23/L.24: what the figure cannot see is stated unconditionally, because the
  // two detector limits below hold for every reader — and each names its
  // direction. The demo has NO long-cadence series at all (one BIWEEKLY + eleven
  // MONTHLY, re-verified by probe in L.24), so the precondition note speaks and
  // the "spread across the year" clause must NOT: an unconditional clause told
  // every reader their premium was handled when the detector needs ~2 years of
  // steady history to see one. The unrecognized-rhythm list no longer says
  // "quarterly, or twice a year" — L.24 recognizes both — so the assertion binds
  // to a rhythm that is still genuinely dropped.
  const cantSee = page.getByTestId('spending-plan-disclosures');
  await expect(cantSee).toBeVisible();
  await expect(page.getByTestId('plan-unrecognized-cadence-note')).toContainText(
    'every couple of months',
  );
  await expect(page.getByTestId('plan-unrecognized-cadence-note')).toContainText(
    /may be (lower|higher) than shown/,
  );
  await expect(page.getByTestId('plan-long-cadence-precondition-note')).toContainText('three times at a steady price');
  // L.24 copy critic P1-1/P1-2/P2-4: the list may not read as a closed world, the
  // every-gap rule is permanent rather than "yet", and a long bill that goes
  // overdue silently stops counting — all three are reader-facing or they are not
  // disclosed at all.
  await expect(page.getByTestId('plan-unrecognized-cadence-note')).toContainText('every four or five months');
  await expect(page.getByTestId('plan-long-cadence-precondition-note')).toContainText(
    'differ by more than about a week',
  );
  await expect(page.getByTestId('plan-long-cadence-overdue-note')).toContainText('half a cycle overdue');
  await expect(page.getByText('A yearly bill is spread across the year', { exact: false })).toHaveCount(0);
  // And the audit panel names the biweekly rate it used to omit.
  await expect(page.getByText('a biweekly one 26/12', { exact: false })).toBeVisible();
});
