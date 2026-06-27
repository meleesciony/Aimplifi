/**
 * Phase 4 golden flows (380×800): cash-flow calendar, goals with FI impact,
 * budgets, exports (CSV + PDF with audit), PWA manifest, security headers.
 */
import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');
}

test('calendar shows inflows, outflows, and effective card due dates on one timeline', async ({ page }) => {
  await signIn(page);
  await page.getByTestId('bottom-nav-calendar').click();
  await page.waitForURL('**/calendar');
  await expect(page.getByTestId('cal-month')).toHaveText('Jun 2026');

  const list = page.getByTestId('calendar-list');
  await expect(list).toContainText('Payroll');
  await expect(list).toContainText('Rent');
  await expect(list).toContainText('Sapphire Card due');
  await expect(list).toContainText('Freedom Card due');
  // Freedom's weekend issuer date (Sun 06-28) appears on Fri, Jun 26
  await expect(list).toContainText('Fri, Jun 26');

  // month navigation
  await page.getByTestId('cal-next').click();
  await expect(page.getByTestId('cal-month')).toHaveText('Jul 2026');
});

test('goals: creating a goal shows its effect on the FI date', async ({ page }) => {
  await signIn(page);
  await page.getByTestId('nav-goals').click();
  await page.waitForURL('**/goals');

  await page.locator('input[name="name"]').fill('Japan trip');
  await page.locator('input[name="target"]').fill('6000');
  await page.locator('input[name="monthly"]').fill('500');
  await page.getByTestId('goal-create').click();

  const card = page.locator('[data-testid^="goal-"]', { hasText: 'Japan trip' });
  await expect(card).toBeVisible();
  await expect(card.getByTestId('goal-fi-impact')).toContainText('Funded in ~12 months');
  await expect(card.getByTestId('goal-fi-impact')).toContainText(/FI date|No measurable effect/);

  // cleanup so reruns stay deterministic (two-step delete confirm)
  await card.getByRole('button', { name: 'Delete Japan trip' }).click();
  await card.getByTestId('goal-delete-confirm').click();
  await expect(card).toHaveCount(0);
});

test('budgets page shows category spending with transfers excluded', async ({ page }) => {
  await signIn(page);
  await page.getByTestId('nav-budgets').click();
  await page.waitForURL('**/budgets');
  const list = page.getByTestId('budget-list');
  await expect(list).toBeVisible();
  // June spend exists in the seed (subscriptions at minimum)
  await expect(list.locator('li').first()).toBeVisible();
  await expect(list).not.toContainText('Transfer');
});

test('exports: CSV and PDF download with auth; PDF has the %PDF magic', async ({ page }) => {
  await signIn(page);
  const csv = await page.request.get('/api/export?format=transactions-csv');
  expect(csv.status()).toBe(200);
  const csvText = await csv.text();
  expect(csvText.startsWith('date,account,description')).toBe(true);
  expect(csvText).toContain('ACH DEPOSIT ACME ANALYTICS PAYROLL');

  const pdf = await page.request.get('/api/export?format=net-worth-pdf');
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()['content-type']).toContain('application/pdf');
  const body = await pdf.body();
  expect(body.subarray(0, 5).toString()).toBe('%PDF-');
});

test('unauthenticated export is rejected; cron route requires the secret; security headers are set', async ({ browser }) => {
  const fresh = await browser.newContext();
  const anon = await fresh.newPage();
  const res = await anon.request.get('/api/export?format=transactions-csv');
  expect(res.status()).toBe(401);
  const cron = await anon.request.get('/api/cron/sync');
  expect(cron.status()).toBe(401);

  const home = await anon.request.get('/sign-in');
  expect(home.headers()['content-security-policy']).toContain("default-src 'self'");
  expect(home.headers()['x-frame-options']).toBe('DENY');
  // HSTS is emitted by the production build (next start) the e2e runs against.
  expect(home.headers()['strict-transport-security']).toContain('max-age=63072000');
  await fresh.close();
});

test('PWA: manifest is served and linked', async ({ page }) => {
  await signIn(page);
  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(manifestHref).toBe('/manifest.webmanifest');
  const manifest = await page.request.get('/manifest.webmanifest');
  expect(manifest.status()).toBe(200);
  const json = await manifest.json();
  expect(json.name).toBe('Aimplifi');
  expect(json.icons.length).toBeGreaterThanOrEqual(2);
  const icon = await page.request.get('/icon-192.png');
  expect(icon.status()).toBe(200);
});


