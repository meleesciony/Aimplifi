/**
 * Node type: live-probe (GRAPH.md §6 — proves one shipped claim against production).
 * Deploy proof for W.6(d) drawdown on FI date (DECISIONS #512), run against PRODUCTION.
 *
 * /coach is auth-gated. Signs into the shared demo and checks the FI card's
 * portfolio-drawdown disclosure opens with the 30% shock sentence.
 *
 * ANTI-VACUITY. A pre-#512 deploy has no `fi-drawdown` testid.
 *
 *   node scripts/w6d-live-deploy-check.mjs
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
  const drawdown = page.getByTestId('fi-drawdown');
  await drawdown.waitFor({ state: 'visible', timeout: 30_000 });
  check('FI card has portfolio-drawdown disclosure (fi-drawdown)', true);

  const summary = ((await drawdown.locator('summary').textContent()) ?? '').trim();
  check('drawdown summary names 30%', summary.includes('30%'), summary);

  await drawdown.locator('summary').click();
  const sentence = ((await page.getByTestId('fi-drawdown-sentence').textContent()) ?? '').trim();
  check('drawdown sentence names a 30% drop', sentence.includes('30% drop'), sentence.slice(0, 120));
  check('drawdown sentence claims a later FI date', /later/i.test(sentence), sentence.slice(0, 120));
  check('drawdown sentence is illustration-not-advice', sentence.includes('Illustration, not advice'));
  check('drawdown sentence names Coach assumptions', sentence.includes('assumptions as Coach'));
  check('drawdown has no "this card"/"below"', !/this card|\bbelow\b/i.test(sentence));

  const years = ((await page.getByTestId('years-to-fi').textContent()) ?? '').trim();
  check('years-to-FI line still present (baseline projection)', years.length > 10, years.slice(0, 80));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} PASS`);
if (failed.length) {
  console.error('FAILED:', failed.map((f) => f.name).join(', '));
  process.exit(1);
}
