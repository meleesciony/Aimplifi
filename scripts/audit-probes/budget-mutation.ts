/** Instrument the budgets set→clear→set wedge: does the 2nd action POST? respond? */
import { chromium, devices } from '@playwright/test';

const BASE = 'http://127.0.0.1:3100';

(async () => {
  const browser = await chromium.launch(process.env.CHAN ? { channel: process.env.CHAN } : {});
  const ctx = await browser.newContext({
    ...(process.env.PIXEL === '1' ? devices['Pixel 5'] : {}),
    viewport: { width: 380, height: 800 },
    serviceWorkers: (process.env.SW === '0' ? 'block' : 'allow') as 'block' | 'allow',
  });
  const page = await ctx.newPage();
  page.on('request', (r) => { if (r.method() === 'POST') console.log(`REQ POST ${r.url().slice(21, 90)}`); });
  page.on('response', (r) => { if (r.request().method() === 'POST') console.log(`RES ${r.status()} ${r.url().slice(21, 90)}`); });
  page.on('requestfailed', (r) => console.log(`FAIL ${r.url().slice(21, 90)} :: ${r.failure()?.errorText}`));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`CON[${m.type()}] ${m.text().slice(0, 200)}`); });
  page.on('pageerror', (e) => console.log(`PAGEERR ${String(e).slice(0, 250)}`));

  await page.goto(`${BASE}/sign-in`);
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard', { timeout: 30_000 });
  if (process.env.SOFT === '1') { await page.getByTestId('nav-budgets').click(); await page.waitForURL('**/budgets'); } else { await page.goto(`${BASE}/budgets`); }
  await page.waitForLoadState('networkidle');

  console.log('--- SET #1 (groceries 500) ---');
  await page.getByTestId('budget-category').selectOption({ label: 'Groceries' });
  await page.getByTestId('budget-amount').fill('500');
  await page.getByTestId('budget-set').click();
  try {
    await page.getByTestId('budget-clear-groceries').waitFor({ state: 'visible', timeout: 8000 });
    console.log('SET #1 ok');
  } catch {
    await page.screenshot({ path: '.audit/set1-failed.png', fullPage: true });
    const boundary = await page.locator('text=Something went wrong').isVisible().catch(() => false);
    const status = await page.locator('[role="status"]').textContent().catch(() => null);
    const err = await page.locator('#budget-amount-error').textContent().catch(() => null);
    const btn = await page.getByTestId('budget-set').textContent().catch(() => null);
    console.log(`SET #1 FAILED boundary=${boundary} status="${status}" amountErr="${err}" btn="${btn}"`);
  }

  console.log('--- CLEAR (groceries) ---');
  await page.getByTestId('budget-clear-groceries').click();
  await page.getByTestId('budget-clear-groceries').waitFor({ state: 'detached', timeout: 8000 }).then(
    () => console.log('CLEAR ok (row gone)'),
    () => console.log('CLEAR did NOT remove the row'),
  );

  console.log('--- SET #2 (fuel 250) ---');
  await page.getByTestId('budget-category').selectOption({ label: 'Fuel' });
  await page.getByTestId('budget-amount').fill('250');
  await page.getByTestId('budget-set').click();
  await page.getByTestId('budget-clear-fuel').waitFor({ state: 'visible', timeout: 10_000 }).then(
    () => console.log('SET #2 ok'),
    async () => {
      const btn = await page.getByTestId('budget-set').textContent();
      console.log(`SET #2 WEDGED — button="${btn}"`);
    },
  );
  await browser.close();
})();
