/**
 * Deploy proof for C.19/H.3 (#411), run against PRODUCTION.
 *
 * WHAT DISCRIMINATES THIS BUILD FROM THE LAST, stated up front:
 *
 *  1. THE SECTION ITSELF. The previous deployment has NO
 *     "What makes up your fixed costs" section on /spending-plan at all — the
 *     page itemized nothing. Its `fixed-composition` testid and the engine's
 *     per-line `basisNote` are new this commit.
 *  2. A CLIENT-BUNDLE LITERAL. The /spending-plan page is a server component,
 *     so the marker lives in server-rendered HTML for a signed-in user, and in
 *     any client chunk that carries the section's markup. The served HTML for
 *     the signed-in demo is the proof.
 *  3. THE INVARIANT, EXECUTED LIVE: the Fixed total printed at the bottom of
 *     the list equals the sum of the lines above it, and the page says the
 *     lines are "matched to the penny" (reconciles) OR says plainly that they
 *     are not (partial). A stale deployment cannot render this section at all.
 *
 * WHAT IT CANNOT PROVE: the shared demo dataset carries no structural loan
 * payment, so there is no $6,217.07 mortgage line here — the owner's exact
 * figure is proven by the e2e over owner-shaped seed data, not by a demo that
 * cannot move. The demo's own list (category lines only) is what this script
 * checks, because it is what production can show.
 *
 * Read-only throughout: one-click demo sign-in, reads one page, writes nothing.
 *
 *   node scripts/c19-live-deploy-check.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.LIVE_BASE ?? 'https://www.aimplifi.app';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const centsOf = (text) => {
  const m = /\$([\d,]+)\.(\d{2})/.exec(text ?? '');
  return m === null ? null : Number(m[1].replace(/,/g, '')) * 100 + Number(m[2]);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 380, height: 800 } });

try {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard', { timeout: 30_000 });
  check('signed into the shared demo on production', true, BASE);

  await page.goto(`${BASE}/spending-plan`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('fixed-composition').waitFor({ timeout: 30_000 });
  check('the Fixed composition section renders on /spending-plan', true);

  // THE MARKER — the section is new this commit; a stale deployment cannot
  // produce it.
  const heading = await page
    .getByTestId('fixed-composition')
    .locator('h2')
    .textContent();
  check('the section carries this commit\'s heading', (heading ?? '').includes('What makes up your fixed costs'), heading ?? 'none');

  // THE INVARIANT — the printed total equals the sum of the printed lines,
  // and the page certifies it.
  const amounts = await page
    .getByTestId('fixed-composition')
    .getByTestId('fixed-composition-amount')
    .allInnerTexts();
  const sum = amounts.reduce((acc, s) => acc + (centsOf(s) ?? 0), 0);
  const total = centsOf(
    await page.getByTestId('fixed-composition-total').textContent(),
  );
  check('the lines add up to the printed total', sum === total, `${sum} vs ${total}`);
  check('the page certifies the reconciliation', await page.getByTestId('fixed-composition-reconciled').isVisible().catch(() => false));

  // INFORMATIONAL — the unnamed-bill label is genuinely unreachable on the demo
  // (every bill the demo knows has a merchant name), so it must NOT be a pass/
  // fail check: it would fail identically on a correct build, which would make
  // this script useless as a discriminator. The section itself is the
  // discriminator.
  const scripts = await page.evaluate(() =>
    [...document.querySelectorAll('script[src]')].map((s) => s.src),
  );
  let blobs = '';
  for (const src of scripts) {
    try {
      blobs += `${await (await page.context().request.get(src)).text()}\n`;
    } catch {
      /* a chunk that 404s cannot hold the marker */
    }
  }
  console.log(`INFO  served bundle carries the unnamed-bill label: ${blobs.includes('A recurring bill we detected')}`);
} catch (err) {
  check('script completed without error', false, String(err).slice(0, 200));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\nDEPLOY PROOF: ${failed === 0 ? 'PASS' : 'FAIL'} (${results.length - failed}/${results.length})`);
process.exit(failed === 0 ? 0 : 1);
