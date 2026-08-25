/**
 * Node type: live-probe (GRAPH.md §6 — proves one shipped claim against production).
 * Deploy proof for P1.4 income lever (DECISIONS #514), run against PRODUCTION.
 *
 * /coach is auth-gated. Signs into the shared demo and checks the FI card's
 * raise slider: default $10,000/yr, a sooner sentence, idle at $0.
 *
 * ANTI-VACUITY. A pre-#514 deploy has no `income-lever-slider` testid.
 *
 *   node scripts/p14-live-deploy-check.mjs
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

  await page.goto(`${BASE}/coach`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('fi-card').waitFor({ state: 'visible', timeout: 30_000 });
  check('coach has fi-card', true);

  const slider = page.getByTestId('income-lever-slider');
  await slider.waitFor({ state: 'visible', timeout: 15_000 });
  check('fi-card has income-lever-slider', true);

  const raise = ((await page.getByTestId('income-lever-raise').textContent()) ?? '').trim();
  check('default thumb is $10,000.00/yr', raise.includes('$10,000.00/yr'), raise);

  const context = ((await page.getByTestId('income-lever-context').textContent()) ?? '').trim();
  check('context names average pace', /average pace/i.test(context), context.slice(0, 120));

  const result = ((await page.getByTestId('income-lever-result').textContent()) ?? '').trim();
  check('result names $10,000.00/yr raise', result.includes('$10,000.00/yr raise'), result.slice(0, 140));
  check('result says sooner', /sooner/i.test(result), result.slice(0, 140));
  check('result names rate-share extra savings', /Only that share of the raise is treated as extra savings/i.test(result));
  check('result names window average not current', /average/i.test(result) && !/your current /i.test(result), result.slice(0, 140));
  check('result names Coach assumptions', /same return and inflation assumptions as Coach/i.test(result));
  check('result is illustration not advice', /Illustration, not advice/i.test(result));
  check('result has no this-card/below', !/this card|\bbelow\b/i.test(result));

  await slider.fill('0');
  const idle = ((await page.getByTestId('income-lever-result').textContent()) ?? '').trim();
  check('zero raise shows idle prompt', /Drag to see what a raise/i.test(idle), idle.slice(0, 80));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} PASS`);
if (failed.length) {
  console.error('FAILED:', failed.map((f) => f.name).join(', '));
  process.exit(1);
}
