/**
 * Deploy proof for Ask's same-account comparison (DECISIONS #781), run against
 * PRODUCTION (www.aimplifi.app). Node type: live probe (GRAPH.md §6).
 *
 * Discriminators a pre-#781 build cannot pass: a one-month spend answer offers the
 * comparison as its third chip (before, that chip was "biggest purchase"); tapping it
 * answers with the comparison's reading line; the typed grammar ("did I spend more …
 * than …") answers with the same reading. Guards: nothing pushes the page sideways at
 * 380px, and no uncaught page errors.
 *
 * Read-only: one-click demo sign-in and questions on /ask. Writes nothing (the demo
 * cannot answer account questions, and this probe never taps them).
 *
 *   node scripts/ask-compare-live-deploy-check.mjs
 */
import { chromium, devices } from 'playwright';

const BASE = process.env.LIVE_BASE ?? 'https://www.aimplifi.app';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch();
const context = await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 380, height: 800 } });
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));

/** Wait for the answer to `question` itself: a new headline, under that question's quote. */
async function settle(question, previousHeadline) {
  await page.waitForFunction(
    ([q, prev]) => {
      const answer = document.querySelector('[data-testid="ask-answer"]');
      const headline = document.querySelector('[data-testid="ask-headline"]')?.textContent ?? '';
      return !!answer && answer.textContent.includes(`“${q}”`) && headline !== prev && headline.length > 0;
    },
    [question, previousHeadline],
    { timeout: 30000 },
  );
}

const headlineNow = async () => ((await page.getByTestId('ask-headline').count()) ? await page.getByTestId('ask-headline').textContent() : '') ?? '';

async function ask(question) {
  const before = await headlineNow();
  await page.getByTestId('ask-input').fill(question);
  await page.getByTestId('ask-submit').click();
  await settle(question, before);
}

const answerText = async () => (await page.getByTestId('ask-answer').textContent()) ?? '';
const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

try {
  let signedIn = false;
  let lastErr = '';
  for (let i = 0; i < 3 && !signedIn; i++) {
    try {
      await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
      await page.getByTestId('demo-sign-in').click({ timeout: 15000 });
      await page.waitForURL('**/dashboard', { timeout: 45000 });
      signedIn = true;
    } catch (e) {
      lastErr = String(e).split('\n')[0];
    }
  }
  check('demo sign-in reaches the dashboard', signedIn, lastErr);

  await page.goto(`${BASE}/ask`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('ask-input').waitFor({ timeout: 30000 });

  // The demo clock is June 2026: "this month" is in progress, so the chip offers the two
  // finished months behind it.
  await ask('How much did I spend on groceries this month?');
  const chip = page.getByTestId('ask-follow-up').filter({ hasText: 'Compare Groceries spending in May 2026 to April 2026' });
  check('a one-month answer offers the comparison chip', (await chip.count()) === 1);
  check(
    'the biggest-purchase chip gave way to it',
    (await page.getByTestId('ask-follow-up').filter({ hasText: /biggest purchase/i }).count()) === 0,
  );

  if ((await chip.count()) === 1) {
    const before = await headlineNow();
    await chip.click();
    await settle('Compare Groceries spending in May 2026 to April 2026', before);
  }
  const tapped = await answerText();
  check(
    'the chip answers with the comparison reading',
    tapped.includes('Reading: Groceries spending, May 2026 against April 2026'),
    tapped.slice(0, 160),
  );
  check('the comparison answer stays inside a 380px screen', (await overflow()) <= 0);

  await ask('did I spend more in may than april');
  const typed = await answerText();
  check('the typed grammar answers with the same kind of reading', typed.includes('Reading: All spending, May 2026 against April 2026'), typed.slice(0, 160));

  check('no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\nDEPLOY PROOF ${failed ? 'FAIL' : 'PASS'} ${results.length - failed}/${results.length}`);
process.exit(failed ? 1 : 0);
