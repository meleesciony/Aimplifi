/**
 * Accounts manual mutations at PLAIN pacing (#167): add asset → edit its value
 * → delete it. Every step's confirmation is the server-rendered row/net-worth,
 * so a lost router.refresh() application (the #164/#166 race) shows up as a
 * stale list. Leaves the demo dataset exactly as found (add→delete round-trip).
 */
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
  page.on('requestfailed', (r) => console.log(`FAIL ${r.url().slice(21, 90)} :: ${r.failure()?.errorText}`));
  page.on('pageerror', (e) => console.log(`PAGEERR ${String(e).slice(0, 250)}`));

  await page.goto(`${BASE}/sign-in`);
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard', { timeout: 30_000 });
  await page.goto(`${BASE}/accounts`);
  await page.waitForLoadState('networkidle');

  let failures = 0;
  const nw = () => page.getByTestId('accounts-net-worth-amount').textContent();
  const before = await nw();
  console.log(`net worth before: ${before}`);

  console.log('--- ADD (Probe Asset $1,000) ---');
  await page.getByTestId('add-asset-btn').click();
  await page.getByTestId('manual-name').fill('Probe Asset');
  await page.getByTestId('manual-value').fill('1000');
  await page.getByTestId('manual-submit').click();
  const row = () => page.getByTestId('manual-account-row').filter({ hasText: 'Probe Asset' });
  try {
    await row().waitFor({ state: 'visible', timeout: 8000 });
    console.log('ADD ok — row rendered');
  } catch {
    console.log('ADD FAILED — row never rendered (application lost?)');
    failures++;
  }

  if ((await row().count()) > 0) {
    console.log('--- EDIT VALUE ($1,000 → $2,000) ---');
    await row().getByTestId('manual-edit').click();
    await row().getByTestId('manual-value-input').fill('2000');
    await row().getByTestId('manual-value-save').click();
    try {
      await row().filter({ hasText: '$2,000.00' }).waitFor({ state: 'visible', timeout: 8000 });
      console.log('EDIT ok — $2,000.00 rendered');
    } catch {
      console.log('EDIT FAILED — value still stale');
      failures++;
    }

    console.log('--- DELETE (revert) ---');
    await row().getByTestId('manual-delete').click();
    await row().getByTestId('manual-delete-confirm').click();
    try {
      await row().waitFor({ state: 'detached', timeout: 8000 });
      console.log('DELETE ok — row gone');
    } catch {
      console.log('DELETE FAILED — row still present');
      failures++;
    }
    const after = await nw();
    console.log(`net worth after: ${after} (${after === before ? 'reverted ok' : 'MISMATCH'})`);
    if (after !== before) failures++;
  }

  console.log(failures === 0 ? 'PROBE PASS' : `PROBE FAIL (${failures} step(s) lost)`);
  await browser.close();
  process.exit(failures === 0 ? 0 : 1);
})();
