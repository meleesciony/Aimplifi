/**
 * Investments view (DECISIONS #78): reachable from /accounts, then a portfolio
 * summary (value + gain + allocation) and per-account holdings, all from the seed
 * with zero credentials. Includes a WCAG-AA axe scan.
 */
import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from './helpers/test';
import { clickMoreNav } from './helpers/more-nav';

async function signIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');
}

test('investments has its own main-nav entry (production-readiness backlog, 2026-06-24)', async ({ page }) => {
  await signIn(page);
  // #187: secondary destinations live in the More sheet on phones.
  await clickMoreNav(page, 'nav-investments');
  await page.waitForURL('**/investments');
  await expect(page.getByTestId('investments-total-value')).toContainText('$142,000.00');
});

test('investments is reachable from accounts and shows the seeded portfolio', async ({ page }) => {
  await signIn(page);
  await page.goto('/accounts');
  const link = page.getByTestId('investments-link');
  await expect(link).toBeVisible();
  await link.click();
  await page.waitForURL('**/investments');

  // Seeded Brokerage portfolio: $142,000.00 market value, with a gain and AAPL holding.
  await expect(page.getByTestId('investments-total-value')).toContainText('$142,000.00');
  await expect(page.getByTestId('investments-total-gain')).toContainText('total return');
  await expect(page.getByTestId('holding-row').filter({ hasText: 'AAPL' })).toBeVisible();

  // DECISIONS #180 golden lock: the seed's five holdings are all user-entered (source
  // 'manual'), so NO "Synced" provenance badge renders — the demo /investments is
  // byte-identical to before this feature. A synced badge only appears on a real feed row.
  await expect(page.getByTestId('holding-provenance')).toHaveCount(0);
});

test('an investment account row links straight to the portfolio view (DECISIONS #159)', async ({ page }) => {
  await signIn(page);
  await page.goto('/accounts');

  // #159: the seeded "Brokerage" (INVESTMENT) account row is itself navigable to
  // /investments — a user taps their brokerage and lands on holdings/performance,
  // not its transaction ledger. The row carries an inline "View holdings" cue so the
  // destination is discoverable (and screen-reader announced) rather than surprising.
  const brokerageRow = page.getByTestId('account-row').filter({ hasText: 'Brokerage' });
  await expect(brokerageRow).toBeVisible();
  await expect(brokerageRow).toContainText('View holdings');

  await brokerageRow.click();
  // #160: the row now carries the account id (would time out here if it had gone to
  // /transactions). Lands on the portfolio view scoped to that account.
  await page.waitForURL(/\/investments\?account=/);
  await expect(page.getByTestId('investments-total-value')).toContainText('$142,000.00');
  // The seed has a single investment account, so scoping is inert: the page renders the
  // full portfolio with no "Show all accounts" chip — byte-identical to an unscoped load.
  await expect(page.getByTestId('investments-scope')).toHaveCount(0);
});

test('an unknown ?account id falls back to the full portfolio (DECISIONS #160)', async ({ page }) => {
  await signIn(page);
  // A stale / hand-typed deep-link must never yield an empty or broken page: it degrades
  // to the whole-portfolio view, unchanged (the golden-safe fallback).
  await page.goto('/investments?account=does-not-exist');
  await expect(page.getByTestId('investments-total-value')).toContainText('$142,000.00');
  await expect(page.getByTestId('holding-row').filter({ hasText: 'AAPL' })).toBeVisible();
  await expect(page.getByTestId('investments-scope')).toHaveCount(0);
});

test('retirement outlook projects the seeded portfolio with stated assumptions', async ({ page }) => {
  await signIn(page);
  await page.goto('/investments');

  const card = page.getByTestId('retirement-outlook');
  await expect(card).toBeVisible();
  // Grounded headline + a projected balance at the assumed retirement age (65).
  await expect(page.getByTestId('retirement-headline')).toContainText(/age \d+/);
  await expect(page.getByTestId('retirement-outcome')).toContainText('Projected balance at age 65');
  await expect(page.getByTestId('retirement-balance-at-retirement')).toContainText(/\$[\d,]+\.\d{2}/);
  // Every assumption is stated inline (the coaching guardrail — no hidden facts):
  // the current-age assumption that drives accumulation, the inflation adjustment that
  // makes "today's dollars" honest, and the today's-dollars framing itself.
  await expect(card).toContainText(/you.re 40 today/);
  await expect(card).toContainText('inflation');
  await expect(card).toContainText('in today’s dollars');
});

test('retirement what-if recomputes the projection live without saving (DECISIONS #123)', async ({ page }) => {
  await signIn(page);
  await page.goto('/investments');

  // Starts at the saved/default plan: retire at 65.
  await expect(page.getByTestId('retirement-outcome')).toContainText('age 65');

  // Drag the retirement age earlier → the projection recomputes instantly (client-side),
  // and the card flags that the saved plan is untouched.
  await page.getByTestId('whatif-retirement-age').fill('50');
  await expect(page.getByTestId('retirement-outcome')).toContainText('age 50');
  await expect(page.getByTestId('retirement-whatif-note')).toContainText('saved plan is unchanged');

  // Reset restores the saved plan.
  await page.getByTestId('retirement-whatif-reset').click();
  await expect(page.getByTestId('retirement-outcome')).toContainText('age 65');

  // The exploration never persisted: a fresh load is back at the saved plan (golden-safe).
  await page.reload();
  await expect(page.getByTestId('retirement-outcome')).toContainText('age 65');
  await expect(page.getByTestId('whatif-retirement-age')).toHaveValue('65');
});

test('investments page passes WCAG 2.1 AA (axe)', async ({ page }) => {
  await signIn(page);
  await page.goto('/investments');
  await expect(page.getByTestId('investments-summary')).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations, JSON.stringify(results.violations.map((v) => v.id))).toEqual([]);
});
