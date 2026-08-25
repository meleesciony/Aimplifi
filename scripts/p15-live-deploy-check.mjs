/**
 * Node type: live-probe (GRAPH.md §6 — proves one shipped claim against production).
 * Deploy proof for P1.5 investing ladder + fee-drag (DECISIONS #515), run against PRODUCTION.
 *
 * /coach is auth-gated. Signs into the shared demo and checks the investing-order
 * card: $142k fee-drag in today's money, monthly leak, grow-then-deflate, ladder.
 *
 * ANTI-VACUITY. A pre-#515 deploy has no `investing-ladder-card` testid.
 *
 *   node scripts/p15-live-deploy-check.mjs
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
  await page.getByTestId('investing-ladder-card').waitFor({ state: 'visible', timeout: 30_000 });
  check('coach has investing-ladder-card', true);

  const sentence = ((await page.getByTestId('fee-drag-sentence').textContent()) ?? '').trim();
  check('fee-drag names $142,000.00', sentence.includes('$142,000.00'), sentence.slice(0, 160));
  check('fee-drag golden is $68,822.18 today', sentence.includes('$68,822.18'), sentence.slice(0, 160));
  check('fee-drag names $118.33 a month leak', sentence.includes('$118.33 a month'), sentence.slice(0, 160));
  check("fee-drag is today's money", /today's money/i.test(sentence), sentence.slice(0, 160));
  check(
    'fee-drag names grow-then-deflate',
    /grown at our default 7\.00% return assumption/i.test(sentence)
      && /2\.50% inflation assumption taken off/i.test(sentence),
  );
  check('demo does not claim trails', !/assumptions working/i.test(sentence));
  check('fee-drag is not their actual fee', /not a fee we can see/i.test(sentence));
  check('fee-drag is not AUM-on-growth', /not a fee that grows with the pile/i.test(sentence));
  check('fee-drag is illustration not advice', /Illustration, not advice/i.test(sentence));
  check('fee-drag has no this-card/below', !/this card|\bbelow\b/i.test(sentence));
  check('fee-drag has no tickers', !/\b(VTSAX|VTI|VOO|SPY|AAPL)\b/.test(sentence));

  const summary = ((await page.getByTestId('investing-ladder').locator('summary').textContent()) ?? '').trim();
  check('ladder summary is a lens not a rule', /lens, not a rule/i.test(summary), summary);

  await page.getByTestId('investing-ladder').locator('summary').click();
  const steps = ((await page.getByTestId('investing-ladder-steps').textContent()) ?? '').trim();
  check('ladder names 401(k) match', /401\(k\) match/i.test(steps), steps.slice(0, 120));
  check('ladder does not claim they have a match', /don't yet know whether you have a match/i.test(steps));

  const timing = ((await page.getByTestId('dont-time-it').textContent()) ?? '').trim();
  check('dont-time-it names staying invested', /Staying invested/i.test(timing), timing.slice(0, 80));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} PASS`);
if (failed.length) {
  console.error('FAILED:', failed.map((f) => f.name).join(', '));
  process.exit(1);
}
