/**
 * Deploy proof for DECISIONS #796 (Ask answers a savings rate over the period the reader
 * names), run against PRODUCTION (www.aimplifi.app). Node type: live probe (GRAPH.md §6).
 *
 * The discriminator a pre-#796 build cannot pass: the owner's own question, "What was
 * my effective savings rate over last year?", answers for 2025 (the demo clock is June
 * 2026 and its records start in December 2024, so all of 2025 is on record). Before, it
 * answered one month: "Your savings rate was …% in May 2026." Also: "how much did I save
 * last year?" is a savings answer (before: the capabilities list), the derivation panel's
 * rate is the headline's, and the standing "what's my savings rate?" answer is unchanged
 * in shape. Guards: nothing pushes /ask sideways at 380px (the answer lists 12 months),
 * and no uncaught page errors.
 *
 * Read-only: one-click demo sign-in and questions on /ask. Writes nothing.
 *
 *   node scripts/ask-savings-period-live-deploy-check.mjs
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
  return headlineNow();
}

const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const centsOf = (t) => Number(t.replace(/[^0-9]/g, '')) * (/^[−-]/.test(t.trim()) ? -1 : 1);

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

  const year = await ask('What was my effective savings rate over last year?');
  check(
    'the owner\'s question answers for 2025, not one month',
    /Your savings rate in 2025 was -?\d+\.\d% — you (kept|spent) \$[\d,]+\.\d{2}/.test(year),
    year.slice(0, 160),
  );
  check('the answer lists each month of 2025', (await page.getByText('Dec 2025', { exact: true }).count()) > 0);
  check('the answer stays inside a 380px screen', (await overflow()) <= 0);

  const pct = year.match(/(-?\d+\.\d)%/)?.[1];
  await page.getByTestId('ask-headline').click();
  await page.getByTestId('ask-trace').waitFor({ timeout: 15000 });
  const lines = await page.getByTestId('ask-deriv-row-amount').allTextContents();
  const kept = centsOf((await page.getByTestId('ask-deriv-saved').textContent()) ?? '');
  const rate = (await page.getByTestId('ask-deriv-rate').textContent()) ?? '';
  check(
    'the panel re-adds income and expenses to the kept figure, at the headline\'s rate',
    lines.length === 2 && lines.reduce((s, t) => s + centsOf(t), 0) === kept && rate === `${pct}%`,
    `${lines.join(' + ')} = ${kept}; ${rate} vs ${pct}%`,
  );

  const saved = await ask('how much did I save last year?');
  check('"how much did I save last year?" is a savings answer for 2025', /savings rate in 2025 was/.test(saved), saved.slice(0, 160));

  const standing = await ask("what's my savings rate?");
  check(
    'the standing answer (no period) keeps its shape: the last full month',
    /^Your savings rate was -?\d+\.\d% in [A-Z][a-z]+ \d{4}\.$/.test(standing.trim()),
    standing.slice(0, 120),
  );

  check('no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
} catch (err) {
  check('script completed without error', false, String(err).slice(0, 200));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\nDEPLOY PROOF ${failed ? 'FAIL' : 'PASS'} ${results.length - failed}/${results.length}`);
process.exit(failed ? 1 : 0);
