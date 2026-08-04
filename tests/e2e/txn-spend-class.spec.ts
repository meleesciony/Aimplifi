/**
 * Register Fixed / Discretionary labels (DECISIONS #378).
 */
import { expect, test, type Page } from './helpers/test';
import { clickMoreNav } from './helpers/more-nav';

async function signIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');
}

test('every register row shows a Fixed or Discretionary class, or says why it has neither', async ({
  page,
}) => {
  await signIn(page);
  await clickMoreNav(page, 'nav-transactions');
  await page.waitForURL('**/transactions**');

  const rows = page.getByTestId('txn-row');
  await expect(rows.first()).toBeVisible();
  const n = await rows.count();
  expect(n).toBeGreaterThan(0);

  for (let i = 0; i < Math.min(n, 12); i++) {
    const cls = rows.nth(i).getByTestId('txn-spend-class');
    await expect(cls).toBeVisible();
    const kind = await cls.getAttribute('data-spend-class');
    expect(['fixed', 'guilt-free', 'out-of-scope']).toContain(kind);
  }

  // Demo seed must expose both classes — soft ifs let this lock decay.
  const groceries = page.getByTestId('txn-row').filter({ hasText: 'Groceries' }).first();
  await expect(groceries).toBeVisible();
  await expect(groceries.getByTestId('txn-spend-class')).toHaveAttribute(
    'data-spend-class',
    'fixed',
  );
  const dining = page.getByTestId('txn-row').filter({ hasText: 'Dining' }).first();
  await expect(dining).toBeVisible();
  await expect(dining.getByTestId('txn-spend-class')).toHaveAttribute(
    'data-spend-class',
    'guilt-free',
  );
  // Shared demo: badge only — the dial is fenced off the demo (#396). The
  // live dial is a button chip (not a native select — iOS floors selects at
  // 16px and blew past Details/Rules).
  await expect(groceries.locator('button[data-testid="txn-spend-class"]')).toHaveCount(0);
  await expect(groceries.locator('select[data-testid="txn-spend-class"]')).toHaveCount(0);
});

test('a row with no Fixed/Discretionary side says why, by tap', async ({ page }) => {
  // The owner asked what "Not counted" meant (2026-08-03) — the second time
  // this chip was renamed rather than explained. The explanation used to live
  // in a `title` attribute, which a phone cannot open at all: this project runs
  // its e2e at mobile-380, so a hover-only disclosure is an invisible one.
  await signIn(page);
  await clickMoreNav(page, 'nav-transactions');
  await page.waitForURL('**/transactions**');

  const chip = page
    .getByTestId('txn-row')
    .locator('[data-testid="txn-spend-class"][data-spend-class="out-of-scope"]')
    .first();
  await expect(chip).toBeVisible();

  // The chip names the row's OWN fact, never the old catch-all.
  const label = (await chip.innerText()).trim();
  expect(label).not.toBe('Not counted');
  expect(label).not.toBe('Neither');
  expect(label.length).toBeGreaterThan(0);
  // …and it carries the reason it was chosen from, so a wrong chip is debuggable.
  await expect(chip).toHaveAttribute('data-spend-class-reason', /.+/);

  // Tapping it answers "not counted WHERE" — the part the old label never said.
  await expect(chip.getByTestId('txn-spend-class-why-panel')).toHaveCount(0);
  await chip.getByTestId('txn-spend-class-why').click();
  const panel = chip.getByTestId('txn-spend-class-why-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Not part of Fixed or Discretionary');
});
