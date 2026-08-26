/**
 * Node type: live-probe (GRAPH.md §6 — proves one shipped claim against production).
 * Deploy proof for the Giving goal preset on /goals (DECISIONS #521), run against PRODUCTION.
 *
 * /goals is auth-gated. Signs into the shared demo and checks the chip:
 * it must fill the name "Giving" and leave the dollars blank. Does NOT submit
 * — the demo row is shared (shared-demo-account-must-not-learn).
 *
 *   node scripts/p21-live-deploy-check.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.LIVE_BASE ?? 'https://www.aimplifi.app';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 380, height: 800 } });

async function signInDemo() {
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('demo-sign-in').click();
    try {
      await page.waitForURL('**/dashboard', { timeout: 10_000 });
      return;
    } catch {
      // Native/aborted submit — reload and click again once hydrated.
    }
  }
  throw new Error('demo sign-in never reached /dashboard in 3 attempts');
}

try {
  await signInDemo();
  check('signed into the shared demo on production', true, BASE);

  await page.goto(`${BASE}/goals`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('goal-form').waitFor({ state: 'visible', timeout: 30_000 });
  check('goals has the new-goal form', true);

  const chip = page.getByTestId('goal-preset-giving');
  await chip.waitFor({ state: 'visible', timeout: 10_000 });
  check('giving preset chip is visible', true);

  const hint = ((await page.getByTestId('goal-preset-giving-hint').textContent()) ?? '').trim();
  check('hint names Gifts', /Gifts/.test(hint));
  check('hint names Charity & Donations', /Charity & Donations/.test(hint));
  check('hint says the reader types the dollars', /you type the dollars/i.test(hint));
  check('hint is a lens, not a grade', /lens, not a grade/i.test(hint));
  check('has no tithe or 10%', !/\b(tithe|10%)\b/i.test(hint));
  check('has no should-give or generously', !/\b(should give|generously)\b/i.test(hint));
  check('has no Coast-FI gate', !/\bCoast\b/i.test(hint));
  check('has no shame', !/\b(wasted|stop buying|guilty|shame)\b/i.test(hint));

  await chip.click();
  const name = await page.locator('[data-testid="goal-form"] input[name="name"]').inputValue();
  const target = await page.locator('[data-testid="goal-form"] input[name="target"]').inputValue();
  const monthly = await page.locator('[data-testid="goal-form"] input[name="monthly"]').inputValue();
  check('chip fills name Giving', name === 'Giving', name);
  check('chip does not invent a target', target === '');
  check('chip does not invent a monthly', monthly === '');
} finally {
  await browser.close();
}

const failed = results.filter((r) => r.ok === false);
console.log(`\n${results.length - failed.length}/${results.length} PASS`);
if (failed.length) {
  console.error('FAILED:', failed.map((f) => f.name).join(', '));
  process.exit(1);
}
