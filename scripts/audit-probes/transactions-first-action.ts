/** Re-witness the /transactions first-action wedge (agent1 flow17): fresh session per control. */
import { chromium } from '@playwright/test';

const BASE = 'http://127.0.0.1:3100';

async function freshSession(name: string, act: (page: import('@playwright/test').Page) => Promise<boolean>) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 380, height: 800 }, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/sign-in`);
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard', { timeout: 30_000 });
  await page.goto(`${BASE}/transactions`);
  await page.waitForLoadState('networkidle');
  let ok = false;
  try { ok = await act(page); } catch { ok = false; }
  console.log(`${name.padEnd(22)} ${ok ? 'WORKS' : 'FAILED'}  url=${page.url().slice(21, 100)}`);
  await browser.close();
}

(async () => {
  await freshSession('account-select', async (p) => {
    await p.selectOption('select[name="account"], [data-testid="filter-account"] , select >> nth=0', { index: 1 }).catch(async () => {
      // fall back: first select on the page
      await p.locator('select').first().selectOption({ index: 1 });
    });
    await p.waitForURL(/account=|type=|category=/, { timeout: 4000 });
    return true;
  });
  await freshSession('pagination-next', async (p) => {
    await p.locator('a:has-text("Next")').first().scrollIntoViewIfNeeded();
    await p.locator('a:has-text("Next")').first().click();
    await p.waitForURL(/page=2/, { timeout: 4000 });
    return true;
  });
  await freshSession('import-link', async (p) => {
    await p.locator('a[href*="import"]').first().click();
    await p.waitForURL(/import/, { timeout: 4000 });
    return true;
  });
  await freshSession('search-coffee', async (p) => {
    await p.fill('input[type="search"], input[placeholder*="Search"]', 'coffee');
    await p.keyboard.press('Enter');
    await p.waitForURL(/q=coffee/, { timeout: 4000 });
    return true;
  });
})();
