/**
 * Deploy proof for W.2 + W.9, run against PRODUCTION.
 *
 * /coach is auth-gated, so `curl | grep` gets a 307 and proves nothing. This signs
 * into the shared demo (one click, no credentials) and reads the real page.
 * Read-only throughout — it never submits a form or writes anything.
 *
 * ANTI-VACUITY. The point of W.2 is that the FI projections stopped compounding at
 * the nominal dial, so the checks below are written to fail if the OLD build is
 * being served, not merely to find some text:
 *
 *   - the basis paragraph must exist AND name 4.50% (7.00% less the 2.50% default),
 *     which the old build could not print anywhere;
 *   - the years-to-FI line must say "growth after inflation", where the old build
 *     said "average annual returns";
 *   - the retired reconciliation wording ("before inflation" / "its date is
 *     earlier") must be ABSENT from the wealth card — an absence check that would
 *     pass on an empty page, so the card is asserted present first;
 *   - the demo has no stored inflationBps, so the possessive must read "our
 *     default", never "your 2.50%".
 *
 *   node scripts/w2-live-deploy-check.mjs
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

try {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard', { timeout: 30_000 });
  check('signed into the shared demo on production', true, BASE);

  await page.goto(`${BASE}/coach`, { waitUntil: 'domcontentloaded' });
  const fiCard = page.getByTestId('fi-card');
  await fiCard.waitFor({ state: 'visible', timeout: 30_000 });
  check('/coach renders the FI card at all', true, 'anti-vacuity anchor for every check below');

  // ---- W.2: the basis paragraph, and the real rate it names ----
  const basis = page.getByTestId('fi-projection-basis');
  const basisCount = await basis.count();
  check('the FI card carries a projection-basis paragraph (NEW in W.2)', basisCount > 0, `${basisCount} found`);
  const basisText = basisCount > 0 ? ((await basis.first().textContent()) ?? '') : '';
  check("basis says the dates are in today's money", basisText.includes("today's money"), basisText.slice(0, 90));
  check(
    'basis names the REAL rate 4.50% (7.00% less the 2.50% default)',
    basisText.includes('4.50%'),
    'the old build could not print this rate anywhere on the card',
  );
  check('basis names the nominal 7.00% as an operand', basisText.includes('7.00%'), '');
  check(
    'basis will not call an unset inflation dial "yours"',
    basisText.includes('our default 2.50%') && !basisText.includes('your 2.50%'),
    'the demo row has no stored inflationBps',
  );

  // ---- W.2: the projections themselves changed wording with the basis ----
  const years = (await page.getByTestId('years-to-fi').textContent()) ?? '';
  check(
    'years-to-FI says "growth after inflation", not "average annual returns"',
    years.includes('growth after inflation') && !years.includes('average annual returns'),
    years.slice(0, 90),
  );

  // ---- W.9: the Coast horizon says who chose it ----
  const coast = (await page.getByTestId('coast-fi').textContent()) ?? '';
  check('Coast line discloses the app-chosen horizon (W.9)', coast.includes('not a date you set'), coast.slice(0, 90));

  // ---- the rewritten reconciliation sentence between the two cards ----
  const vsFi = page.getByTestId('wealth-target-vs-fi');
  const vsFiCount = await vsFi.count();
  check('the wealth card renders its FI-reconciliation line', vsFiCount > 0, 'asserted present BEFORE the absence checks');
  const vsFiText = vsFiCount > 0 ? ((await vsFi.first().textContent()) ?? '') : '';
  check('reconciliation claims a SHARED basis', vsFiText.includes('same footing'), vsFiText.slice(0, 90));
  check(
    'the RETIRED claim is gone ("before inflation" / "date is earlier")',
    vsFiCount > 0 && !vsFiText.includes('before inflation') && !vsFiText.includes('earlier'),
    'this is why the line above asserts the element exists first',
  );
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed / ${failed.length} failed`);
if (failed.length > 0) process.exit(1);
