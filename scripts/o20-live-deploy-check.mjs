/**
 * Deploy proof for O.20, run against PRODUCTION.
 *
 * /reports is auth-gated, so `curl | grep` gets a 307 and proves nothing. This
 * signs into the shared demo (one click, no credentials) and reads the real
 * page. Read-only throughout — it never submits a form or writes anything.
 *
 * ANTI-VACUITY. The point of O.20 is that a bar on the income-vs-spending chart
 * now opens the transactions it is made of, so these checks are written to fail
 * on the OLD build rather than merely to find some text:
 *
 *   - the month picker must exist at all — the old build rendered no control
 *     whatsoever beneath the chart;
 *   - tapping a real Recharts rectangle must open a row list, which is the
 *     gesture the owner asked for and the one thing a testid alone cannot prove;
 *   - the rows must SUM to the headline the page paints, read back from the
 *     DOM — the claim the panel makes in words ("matched to the penny");
 *   - the panel must state the FLOWS basis ("Posted spending only") and must NOT
 *     carry the sibling category sentence, which says the opposite about pending
 *     charges;
 *   - the clamp sentence must never print a negative after "by" (the P1 both
 *     critics found). Reported as SKIP, not PASS, when the demo has no clamped
 *     month — asserting it there would pass by never running.
 *
 *   node scripts/o20-live-deploy-check.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.LIVE_BASE ?? 'https://www.aimplifi.app';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const skip = (name, why) => {
  results.push({ name, skipped: true });
  console.log(`SKIP  ${name} — ${why}`);
};

/** "$1,629.44" → 162944, and "−$1,629.44" → -162944. */
const parseCents = (text) => {
  const negative = /[-−]/.test(text);
  const value = Math.round(Number(text.replace(/[^0-9.]/g, '')) * 100);
  return negative ? -value : value;
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 380, height: 800 } });

try {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard', { timeout: 30_000 });
  check('signed into the shared demo on production', true, BASE);

  await page.goto(`${BASE}/reports`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('income-expense-chart').waitFor({ timeout: 30_000 });

  // 1. The control the old build did not have at all.
  const picker = page.getByTestId('month-flow-picker');
  const pickerVisible = await picker.isVisible().catch(() => false);
  check('the chart carries a month picker (absent from the old build)', pickerVisible);

  const monthButtons = page.locator('[data-testid^="month-flow-month-"]');
  const monthCount = await monthButtons.count();
  check('every charted month has a button', monthCount > 0, `${monthCount} months`);

  // 2. The gesture itself: click a real SVG rectangle, not a testid.
  const bars = page.locator('.recharts-bar-rectangle');
  await bars.first().waitFor({ timeout: 15_000 });
  await bars.last().click();
  const openRows = page
    .getByTestId('month-flow-panels')
    .locator('[data-testid^="month-flow-rows-"]')
    .first();
  const rowsOpened = await openRows.isVisible().catch(() => false);
  check('tapping a bar opens the rows behind it, already expanded', rowsOpened);

  if (!rowsOpened) throw new Error('no rows opened — the remaining checks would be vacuous');

  // 3. The money claim, read back from painted DOM.
  const testId = await openRows.getAttribute('data-testid');
  const key = testId.replace('month-flow-rows-', '');
  const headlineText = await page.getByTestId(`month-flow-headline-${key}`).innerText();
  const headline = parseCents(headlineText);
  const amounts = await openRows.getByTestId('month-flow-row-amount').allInnerTexts();
  const summed = amounts.reduce((s, t) => s + parseCents(t), 0);
  check(
    'the rows sum EXACTLY to the figure the page prints',
    amounts.length > 0 && summed === headline,
    `${amounts.length} rows, ${summed} vs ${headline} (${headlineText.trim()})`,
  );

  // 4. The basis: this chart's rule, not the category card's.
  const panel = page.getByTestId(`month-flow-panel-${key}`);
  const panelText = await panel.innerText();
  const isExpense = key.endsWith('expense');
  check(
    'the panel states the FLOWS basis (posted-only)',
    /Posted (spending|income) only/.test(panelText),
    isExpense ? 'expense panel' : 'income panel',
  );
  check(
    'it does NOT inherit the category panel’s pending sentence',
    !panelText.includes('the same way your reports and budgets count them'),
  );

  // 5. The cross-basis sentence, when the two figures disagree.
  const gapNote = page.getByTestId('reports-basis-gap');
  if (await gapNote.isVisible().catch(() => false)) {
    const gapText = await gapNote.innerText();
    check(
      'the two-bases sentence states a direction and names no mechanism',
      /(higher|lower) than this month/.test(gapText) && !/pending charge/i.test(gapText),
      gapText.trim(),
    );
  } else {
    skip('the two-bases sentence', 'the demo’s two figures agree this month');
  }

  // 6. The clamp sign — reported honestly rather than asserted vacuously.
  const clamp = page.locator('[data-testid^="month-flow-net-refund-"]').first();
  if (await clamp.isVisible().catch(() => false)) {
    const clampText = await clamp.innerText();
    check('the clamp sentence prints a magnitude, never a negative after “by”',
      !/by\s*[-−]/.test(clampText), clampText.trim());
  } else {
    skip('the clamp sentence', 'no charted month on the demo has returns outrunning purchases');
  }
} catch (err) {
  check('script completed without throwing', false, String(err && err.message));
} finally {
  await browser.close();
}

const failed = results.filter((r) => r.ok === false).length;
const passed = results.filter((r) => r.ok === true).length;
const skipped = results.filter((r) => r.skipped).length;
console.log(`\n${passed} passed, ${skipped} skipped, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
