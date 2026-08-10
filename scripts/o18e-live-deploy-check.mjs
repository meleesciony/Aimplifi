/**
 * Deploy proof for O.18e (#440), run against PRODUCTION.
 *
 * O.18e gave the /trends "New this month" rows their merchant-scope panel —
 * the toggle is the discriminating marker: the previous build had no per-row
 * expansion on this card at all, so `new-merchant-breakdown-toggle-*` cannot
 * exist on the old deployment.
 *
 * The disclosure contract is the point, checked against the e2e lock: the
 * basis sentence embeds the card's OWN rendered figure and names the window
 * this figure actually sums — "in Jun '26 through Wed, Jun 10, 2026" — because
 * the in-progress month stops at the as-of date while the movers beside it
 * compare complete months (a stop-at-today figure must never read as the whole
 * month; /reports shares the stop-at-today basis since C.26). The
 * panel carries the glass-box contract (rows add up to the figure — the
 * "matched to the penny" line), which is what distinguishes this panel from
 * O.18c's inverse contract.
 *
 * Data-driven: whichever new merchant the demo surfaces, its card figure, its
 * panel sum and its basis sentence must all agree.
 *
 * Read-only: one-click demo sign-in, one page read, writes nothing.
 *
 *   node scripts/o18e-live-deploy-check.mjs
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

  await page.goto(`${BASE}/trends`, { waitUntil: 'networkidle' });

  // The marker itself — impossible on the previous build. The first row is the
  // biggest new merchant; the demo's date is pinned (asOf 2026-06-10).
  const row = page.getByTestId('new-merchant-row').first();
  await row.waitFor({ timeout: 30000 });
  const rowText = await row.innerText();
  const merchantName = rowText.split('\n')[0];
  const cardFigure = rowText.split('\n').find((l) => /^\$[\d,]+\.\d{2}$/.test(l));
  check('a new-merchant row renders with its figure', !!cardFigure, `${merchantName}: ${cardFigure}`);

  const toggle = row.getByTestId(/new-merchant-breakdown-toggle-/);
  await toggle.waitFor({ timeout: 30000 });
  const toggleText = await toggle.innerText();
  check('the row carries the panel toggle', toggleText.includes('Show'), toggleText.trim());

  // Expand — the panel lists the rows the figure summed, dated and signed.
  await toggle.click();
  const panel = row.getByTestId(/new-merchant-breakdown-panel-/);
  await panel.waitFor({ state: 'visible', timeout: 10000 });
  const rowCount = await panel.getByTestId(/new-merchant-breakdown-rows-/).locator('li').count();
  check('the panel lists the merchant-scope rows', rowCount >= 1, `${rowCount} rows`);
  const firstRowText = await panel.getByTestId(/new-merchant-breakdown-rows-/).locator('li').first().innerText();
  check('rows carry dates', /^[A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2}/.test(firstRowText), firstRowText.split('\n')[0]);

  // The glass-box contract (vs O.18c's inverse): the panel's total equals the
  // card figure, and the reconcile line says so.
  const sumText = await panel.getByTestId(/new-merchant-breakdown-sum-/).innerText();
  check('the panel total equals the card figure', sumText === cardFigure, `${sumText} === ${cardFigure}`);

  const reconciled = await panel
    .getByTestId(/new-merchant-breakdown-reconciled-/)
    .first()
    .innerText();
  if (rowCount === 1) {
    check('a one-row figure says it is the whole figure', reconciled === 'This amount is the whole figure.', reconciled);
  } else {
    check(
      'the reconcile line matches to the penny with the card figure',
      reconciled === `These ${rowCount} rows add up to exactly ${cardFigure} — matched to the penny.`,
      reconciled,
    );
  }

  // The THIRD basis, stated: the sentence embeds the card's own rendered figure
  // and the pinned through-date — the exact window the `<= today` guard sums.
  const panelText = await panel.innerText();
  check(
    'the basis embeds the card figure and the through-date window',
    panelText.includes(
      `The ${cardFigure} above is this merchant's spending in Jun '26 through Wed, Jun 10, 2026.`,
    ),
    panelText.split('\n').find((l) => l.includes("this merchant's spending"))?.slice(0, 100) ?? '',
  );
  check(
    'the basis states what the rows count and leave out',
    panelText.includes('These are the rows the figure counts. Pending charges are included'),
  );

  // Collapse.
  await toggle.click();
  const expanded = await toggle.getAttribute('aria-expanded');
  check('the panel collapses and aria follows', expanded === 'false');

  check('zero page errors', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 120));
} catch (err) {
  check('script completed', false, String(err).slice(0, 200));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length === 0 ? 'ALL CHECKS PASSED' : `${failed.length} CHECK(S) FAILED`} (${results.length} total)`);
process.exit(failed.length === 0 ? 0 : 1);
