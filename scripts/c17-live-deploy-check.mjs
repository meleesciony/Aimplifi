/**
 * Deploy proof for C.17 (#435), run against PRODUCTION.
 *
 * C.17 was the audit P2 sweep; the discriminating markers on the live demo:
 *
 *   - /calendar's posted line states its scope — "Posted + pending across all
 *     your accounts" — where the old build said "Posted + pending through …"
 *     (the totals span every account; the old adjacency read as one account's);
 *   - /cards' minimum-path interest sentence names the covered set — "the N
 *     cards that carry a balance" with the average-daily-balance disclosure —
 *     where the old build printed the total without saying which cards were in
 *     it (undatable and next-cycle cards are excluded and now named);
 *   - the merchant lens's scope note states the GROSS-POSTED basis — "refunds
 *     not netted, nothing pending" — where the old note said only "not only
 *     the rows listed below", letting the lens total sit unexplained beside
 *     the register summary that nets refunds and includes pending.
 *
 * Read-only: one-click demo sign-in, three page reads, writes nothing.
 *
 *   node scripts/c17-live-deploy-check.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.LIVE_BASE ?? 'https://www.aimplifi.app';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 380, height: 800 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));

try {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard', { timeout: 30000 });

  // /calendar — the posted line names its scope (audit P2; impossible on the
  // previous build, which said "Posted + pending through …" with no scope).
  await page.goto(`${BASE}/calendar`, { waitUntil: 'networkidle' });
  const postedLine = page.getByTestId('cal-posted-line');
  await postedLine.waitFor({ timeout: 30000 });
  const postedText = await postedLine.innerText();
  check(
    'the calendar posted line states its scope',
    postedText.includes('Posted + pending across all your accounts'),
    postedText.slice(0, 80),
  );
  check(
    'the old scope-less adjacency is gone',
    !postedText.includes('Posted + pending through'),
  );

  // /cards — the minimum-interest sentence names the covered set (audit P2).
  await page.goto(`${BASE}/cards`, { waitUntil: 'networkidle' });
  const interest = page.getByTestId('minimum-interest');
  await interest.waitFor({ timeout: 30000 });
  const interestText = await interest.innerText();
  check(
    'the /cards minimum-interest note names the covered cards',
    /the \d+ card(s)? that (carries|carry) a balance/.test(interestText) &&
      interestText.includes('average-daily-balance'),
    interestText.slice(0, 120),
  );

  // /transactions at one merchant — the lens states the gross-posted basis.
  await page.goto(`${BASE}/transactions?merchant=Blue%20Bottle%20Coffee`, {
    waitUntil: 'networkidle',
  });
  const scope = page.getByTestId('merchant-lens-scope');
  await scope.waitFor({ timeout: 30000 });
  const scopeText = await scope.innerText();
  check(
    'the merchant lens states the gross-posted basis',
    scopeText.includes('gross, refunds not netted') &&
      scopeText.includes('nothing pending'),
    scopeText.slice(0, 120),
  );
  check(
    'the lens names the register summary as the different set',
    scopeText.includes('nets refunds and includes pending'),
  );
} catch (e) {
  check('script reached the end', false, String(e));
}

check('zero page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
await browser.close();

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
