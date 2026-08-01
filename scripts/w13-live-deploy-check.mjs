/**
 * Deploy proof for W.13, run against PRODUCTION.
 *
 * /coach, /investments and /settings are auth-gated, so `curl | grep` gets a 307 and
 * proves nothing (`committed-is-not-shipped`). This signs into the shared demo — one
 * click, no credentials — and reads the real pages. Read-only throughout: it never
 * submits a form or writes anything.
 *
 * ANTI-VACUITY. Every check below is a PAIR: the new possessive must be present AND
 * the old one absent, on an element asserted to exist first. The demo row is the exact
 * case W.13 is about — `expectedReturnBps` is the schema's own 700 and `inflationBps`
 * is null — so the old build printed "your 7.00% return assumption" on every one of
 * these surfaces and cannot pass a single line of this file.
 *
 *   node scripts/w13-live-deploy-check.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.LIVE_BASE ?? 'https://www.aimplifi.app';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

/** Text of a locator, with the element's existence asserted as its own check. */
async function textOf(el, label, where) {
  const count = await el.count();
  check(`${label} renders at all`, count > 0, `${where}: ${count} found`);
  return count > 0 ? ((await el.first().textContent()) ?? '') : '';
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 380, height: 800 } });

try {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard', { timeout: 30_000 });
  check('signed into the shared demo on production', true, BASE);

  await page.goto(`${BASE}/coach`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('fi-card').waitFor({ state: 'visible', timeout: 30_000 });

  // ---- the FI card's basis paragraph ----
  const basis = await textOf(page.getByTestId('fi-projection-basis'), 'FI projection basis', 'fi-projection-basis');
  check(
    'FI basis calls the return dial OURS',
    basis.includes('our default 7.00% return assumption'),
    basis.slice(0, 120),
  );
  check('FI basis no longer calls it the reader\'s', !basis.includes('your 7.00%'), '');

  // ---- the opportunity list's basis ----
  const oppBasis = await textOf(page.getByTestId('opportunities-basis'), 'opportunity list basis', 'opportunities-basis');
  check(
    'opportunity basis calls the return dial OURS',
    oppBasis.includes('our default 7.00% return assumption'),
    oppBasis.slice(0, 120),
  );
  check('opportunity basis no longer calls it the reader\'s', !oppBasis.includes('your 7.00%'), '');

  // ---- the wealth card's dials sentence: the one that said it outright ----
  const dials = await textOf(page.getByTestId('wealth-target-dials'), 'wealth-target dials sentence', 'wealth-target-dials');
  check(
    'dials sentence attributes BOTH rates to Aimplifi',
    dials.includes("Both rates are Aimplifi's defaults") && dials.includes('7.00% return and 2.50% inflation'),
    dials.slice(0, 140),
  );
  check(
    'the retired claim is gone ("return is your setting" / "you haven\'t changed")',
    !dials.includes('your setting') && !dials.includes("haven't changed") && !dials.includes('haven’t changed'),
    'the old build printed both of these to every reader',
  );

  // ---- /investments: the retirement outlook's assumption clause ----
  await page.goto(`${BASE}/investments`, { waitUntil: 'domcontentloaded' });
  const outlook = await textOf(page.getByTestId('retirement-outlook'), 'retirement outlook card', 'retirement-outlook');
  check(
    'retirement outlook calls the return dial OURS',
    outlook.includes('our default 7% expected return'),
    'the clause reads a server field three components away',
  );
  check(
    'retirement outlook no longer calls it the reader\'s',
    !outlook.includes('your 7% expected return'),
    '',
  );

  // ---- /settings: the page the copy above defers to must say the same thing ----
  await page.goto(`${BASE}/settings`, { waitUntil: 'domcontentloaded' });
  const hint = await textOf(page.locator('#dials-hint-return'), 'expected-return field hint', '#dials-hint-return');
  check(
    'the settings hint says the pre-filled 7% is ours (NEW in W.13)',
    hint.includes('is our default'),
    hint.slice(-80),
  );
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed / ${failed.length} failed`);
if (failed.length > 0) process.exit(1);
