/** Re-witness agent-2 P1-2: goals delete + budgets set→clear→set must update the UI. */
import { chromium } from '@playwright/test';

const BASE = 'http://127.0.0.1:3100';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 380, height: 800 }, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/sign-in`);
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard', { timeout: 30_000 });

  // Goals: add then delete; the card must appear and then disappear without reload.
  await page.goto(`${BASE}/goals`);
  await page.locator('input[name="name"]').fill('Probe Goal');
  await page.locator('input[name="target"]').fill('$1,234');
  await page.getByTestId('goal-create').click();
  const card = page.locator('[data-testid^="goal-"]', { hasText: 'Probe Goal' });
  await card.waitFor({ state: 'visible', timeout: 8000 });
  console.log('goal ADD with "$1,234": card appeared (lenient parse OK)');
  await page.waitForTimeout(800);
  await card.getByTestId('goal-delete').click();
  await page.waitForTimeout(400);
  await card.getByTestId('goal-delete-confirm').click();
  try {
    await card.waitFor({ state: 'detached', timeout: 8000 });
    console.log('goal DELETE: card disappeared without reload — HEALED');
  } catch {
    console.log('goal DELETE: card STILL VISIBLE after 8s — STILL BROKEN');
  }

  // Goals: garbage target must show inline error, not the crash page.
  await page.locator('input[name="name"]').fill('Bad Goal');
  await page.locator('input[name="target"]').fill('abc');
  await page.getByTestId('goal-create').click();
  await page.waitForTimeout(1500);
  const errVisible = await page.locator('#goal-error-target').isVisible().catch(() => false);
  const crashed = await page.locator('text=Something went wrong').isVisible().catch(() => false);
  console.log(`goal ADD "abc": inlineError=${errVisible} crashPage=${crashed}`);

  // Budgets: set → clear → set again; each must reflect without reload.
  await page.goto(`${BASE}/budgets`);
  await page.getByTestId('budget-category').selectOption({ label: 'Groceries' });
  await page.getByTestId('budget-amount').fill('$500');
  await page.getByTestId('budget-set').click();
  const clearBtn = page.getByTestId('budget-clear-groceries');
  try {
    await clearBtn.waitFor({ state: 'visible', timeout: 8000 });
    console.log('budget SET with "$500": target row appeared — lenient parse + refresh OK');
  } catch { console.log('budget SET: no target row appeared — BROKEN'); }
  await clearBtn.click();
  await page.waitForTimeout(2000);
  await page.getByTestId('budget-category').selectOption({ label: 'Fuel' });
  await page.getByTestId('budget-amount').fill('250');
  await page.getByTestId('budget-set').click();
  try {
    await page.getByTestId('budget-clear-fuel').waitFor({ state: 'visible', timeout: 8000 });
    console.log('budget SECOND SET after clear: appeared — the stale-page wedge is HEALED');
  } catch { console.log('budget SECOND SET: page never updated — STILL BROKEN'); }
  // cleanup
  const c2 = page.getByTestId('budget-clear-fuel');
  if (await c2.isVisible().catch(() => false)) await c2.click();

  // Budgets: garbage amount → inline error, no crash.
  await page.getByTestId('budget-amount').fill('abc');
  await page.getByTestId('budget-set').click();
  await page.waitForTimeout(1500);
  const bErr = await page.locator('#budget-amount-error').isVisible().catch(() => false);
  const bCrash = await page.locator('text=Something went wrong').isVisible().catch(() => false);
  console.log(`budget SET "abc": inlineError=${bErr} crashPage=${bCrash}`);

  await browser.close();
})();
