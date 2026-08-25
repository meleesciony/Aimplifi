/**
 * Node type: live-probe (GRAPH.md §6 — proves one shipped claim against production).
 * Deploy proof for W.6(b) next-dollar ranking (DECISIONS #510), run against
 * PRODUCTION.
 *
 * /coach and /ask are auth-gated, so `curl | grep` gets a 307. This signs
 * into the shared demo and checks the Coach card AND the Ask answer share
 * the investing headline (demo: Auto Loan 6.49% under the 7.00% default).
 *
 * ANTI-VACUITY. A pre-#510 deploy has no `next-dollar-card` testid and Ask
 * "Where should my next dollar go?" is unknown.
 *
 *   node scripts/w6b-live-deploy-check.mjs
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
  await page.getByTestId('next-dollar-card').waitFor({ state: 'visible', timeout: 30_000 });
  const headline = ((await page.getByTestId('next-dollar-headline').textContent()) ?? '').trim();
  check('Coach next-dollar headline is investing (demo shape)',
    headline.includes('investing'), headline.slice(0, 90));
  const why = ((await page.getByTestId('next-dollar-why').textContent()) ?? '');
  check('Coach why names Auto Loan at 6.49%',
    why.includes('Auto Loan') && why.includes('6.49%'));
  const assumptions = ((await page.getByTestId('next-dollar-assumptions').textContent()) ?? '');
  check('Coach assumptions name the default 7.00% return (nominal, same unit as APR)',
    assumptions.includes('our default 7.00% return assumption')
    && assumptions.includes('nominal, the same unit as APR'));
  const card = ((await page.getByTestId('next-dollar-card').textContent()) ?? '');
  check('Coach card has no "this card"/"below"', !/this card|\bbelow\b/i.test(card));

  await page.goto(`${BASE}/ask`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('ask-input').waitFor({ state: 'visible', timeout: 30_000 });
  const question = 'Where should my next dollar go?';
  for (let attempt = 0; attempt < 12; attempt++) {
    await page.waitForLoadState('load');
    await page.getByTestId('ask-input').fill(question);
    const value = await page.getByTestId('ask-input').inputValue();
    if (value === question) break;
    await page.waitForTimeout(500);
  }
  await page.getByTestId('ask-submit').click();
  await page.getByTestId('ask-answer').waitFor({ state: 'visible', timeout: 30_000 });
  const askHeadline = ((await page.getByTestId('ask-headline').textContent()) ?? '').trim();
  check('Ask headline matches the Coach ranking', askHeadline === headline, askHeadline.slice(0, 90));
  const askAnswer = ((await page.getByTestId('ask-answer').textContent()) ?? '');
  check('Ask names Auto Loan and does not fall through to unknown',
    askAnswer.includes('Auto Loan')
    && !askAnswer.includes('I can answer questions grounded'));
  check('Ask has no "this card"/"below"', !/this card|\bbelow\b/i.test(askAnswer));

  // Cycle-4 P1: the ranking proxy must not steal cash-needed's modal.
  const p1 = 'How much should I pay off my cards before I can invest?';
  for (let attempt = 0; attempt < 12; attempt++) {
    await page.waitForLoadState('load');
    await page.getByTestId('ask-input').fill(p1);
    const value = await page.getByTestId('ask-input').inputValue();
    if (value === p1) break;
    await page.waitForTimeout(500);
  }
  await page.getByTestId('ask-submit').click();
  await page.getByTestId('ask-answer').waitFor({ state: 'visible', timeout: 30_000 });
  const p1Headline = ((await page.getByTestId('ask-headline').textContent()) ?? '').trim();
  check('Ask P1 string is cash-needed, not the extra-dollar ranking',
    /You need \$[\d,]+\.\d{2}/.test(p1Headline)
    && !p1Headline.includes('Next extra dollar'),
    p1Headline.slice(0, 90));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(failed.length === 0 ? '\nALL CHECKS PASSED' : `\n${failed.length} CHECK(S) FAILED`);
process.exit(failed.length === 0 ? 0 : 1);
