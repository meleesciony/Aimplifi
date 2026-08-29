/**
 * Node type: live-probe (GRAPH.md §6 — proves one shipped claim against production).
 * Deploy proof for employer-match Settings (DECISIONS #528), run against PRODUCTION.
 *
 * /settings is auth-gated. Signs into the shared demo and checks the card:
 * demo note visible, form absent. Pre-#528 deploys have no `employer-match-card`.
 *
 *   node scripts/employer-match-live-check.mjs
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
      /* native submit before hydration */
    }
  }
  throw new Error('demo sign-in never reached /dashboard in 3 attempts');
}

try {
  await signInDemo();
  check('signed into the shared demo on production', true, BASE);

  await page.goto(`${BASE}/settings`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('employer-match-card').waitFor({ state: 'visible', timeout: 30_000 });
  await page.getByTestId('employer-match-demo-note').waitFor({ state: 'visible', timeout: 30_000 });
  check('demo settings shows the employer-match card and its shared-account note', true);
  check(
    'demo sees no employer-match form (write leg is fenced in the UI too)',
    (await page.getByTestId('employer-match-form').count()) === 0,
  );

  await page.goto(`${BASE}/coach`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('next-dollar-card').waitFor({ state: 'visible', timeout: 30_000 });
  const skipped = ((await page.getByTestId('next-dollar-skipped').textContent()) ?? '').trim();
  check(
    'demo next-dollar still skips match and names Settings',
    /Employer match isn't on file yet/i.test(skipped) && /Settings/i.test(skipped),
    skipped.slice(0, 160),
  );
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} PASS`);
if (failed.length) {
  console.error('FAILED:', failed.map((f) => f.name).join(', '));
  process.exit(1);
}
