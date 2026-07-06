/** Hypothesis: soft-nav fails iff the TARGET month is >= the current month (Jun 2026). */
import { chromium } from '@playwright/test';

const BASE = 'http://127.0.0.1:3100';

async function testNav(page: import('@playwright/test').Page, startUrl: string, arrow: 'cal-next' | 'cal-prev', expectMonth: string) {
  await page.goto(`${BASE}${startUrl}`);
  await page.waitForSelector(`[data-testid="${arrow}"]`);
  await page.click(`[data-testid="${arrow}"]`);
  let ok = true;
  try {
    await page.waitForFunction(
      (m) => document.querySelector('[data-testid="cal-month"]')?.getAttribute('data-month') === m,
      expectMonth, { timeout: 3500 },
    );
  } catch { ok = false; }
  console.log(`${startUrl.padEnd(28)} ${arrow === 'cal-next' ? '→' : '←'} target=${expectMonth}  ${ok ? 'COMMITTED' : 'FAILED'}`);
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 380, height: 800 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/sign-in`);
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard', { timeout: 30_000 });

  await testNav(page, '/calendar?month=2025-01', 'cal-next', '2025-02'); // deep past → past
  await testNav(page, '/calendar?month=2026-04', 'cal-next', '2026-05'); // past → past (known works)
  await testNav(page, '/calendar?month=2026-05', 'cal-next', '2026-06'); // past → CURRENT
  await testNav(page, '/calendar?month=2026-08', 'cal-prev', '2026-07'); // future → FUTURE via ←
  await testNav(page, '/calendar?month=2026-07', 'cal-prev', '2026-06'); // future → CURRENT via ←
  await testNav(page, '/calendar?month=2026-07', 'cal-next', '2026-08'); // future → future
  await testNav(page, '/calendar?month=2026-06', 'cal-prev', '2026-05'); // current → past (known works)
  await browser.close();
})();
