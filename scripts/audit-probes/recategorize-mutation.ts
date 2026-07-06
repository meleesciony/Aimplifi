/**
 * Register recategorize at PLAIN pacing (#167): pick a category → "Just this
 * once" → the row's chip must show the new category (server truth re-rendered).
 * The old useTransition + router.refresh() path lost the application ~50% at
 * human pacing (the #164/#166 race) — witnessed as the transactions.spec.ts:145
 * e2e flake. Two rows are refiled: the SECOND action is where wedges showed.
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
  await page.goto(`${BASE}/transactions`);
  await page.waitForLoadState('networkidle');

  let failures = 0;
  for (let round = 1; round <= 2; round++) {
    // A fresh read each round: rows can re-render (or the page reload) after a refile.
    const row = page.getByTestId('txn-row').nth(round === 1 ? 0 : 3);
    const chip = row.getByTestId('category-chip');
    const before = ((await chip.textContent()) ?? '').trim();
    console.log(`--- ROUND ${round}: chip before = "${before}" ---`);
    await chip.click();
    await page.getByTestId('category-menu').waitFor({ state: 'visible', timeout: 5000 });
    // Choose the first option that isn't the current category.
    const options = page.getByTestId('cat-option');
    const n = await options.count();
    let target: string | null = null;
    for (let i = 0; i < n; i++) {
      const o = options.nth(i);
      if ((await o.getAttribute('aria-selected')) !== 'true') {
        target = ((await o.textContent()) ?? '').trim();
        await o.click();
        break;
      }
    }
    if (!target) { console.log('NO TARGET OPTION — probe setup failure'); failures++; continue; }
    console.log(`choosing "${target}" → Just this once`);
    await page.getByTestId('recat-once').click();
    // Server truth: the row (matched by its unchanged merchant text is fragile;
    // instead wait for ANY row whose chip shows the target where the old one was).
    try {
      await page
        .getByTestId('txn-row')
        .nth(round === 1 ? 0 : 3)
        .getByTestId('category-chip')
        .filter({ hasText: target })
        .waitFor({ state: 'visible', timeout: 8000 });
      console.log(`ROUND ${round} ok — chip now "${target}"`);
    } catch {
      const now = await page.getByTestId('txn-row').nth(round === 1 ? 0 : 3).getByTestId('category-chip').textContent().catch(() => null);
      console.log(`ROUND ${round} FAILED — chip still "${now?.trim()}" (expected "${target}")`);
      failures++;
    }
    await page.waitForLoadState('networkidle');
  }
  console.log(failures === 0 ? 'PROBE PASS' : `PROBE FAIL (${failures} round(s) lost)`);
  await browser.close();
  process.exit(failures === 0 ? 0 : 1);
})();
