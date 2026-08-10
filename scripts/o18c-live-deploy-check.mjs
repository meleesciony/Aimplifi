/**
 * Deploy proof for O.18c (#439), run against PRODUCTION.
 *
 * O.18c gave the /recurring rows their charges panel — the toggle is the
 * discriminating marker: the previous build had no per-row expansion at all,
 * so `recurring-charges-toggle` cannot exist on the old deployment.
 *
 * The disclosure contract is the point, checked verbatim against the e2e lock:
 * the basis sentence embeds the row's OWN rendered figure and says it is the
 * typical amount, not the total of the charges listed (the figure is a median;
 * a "rows add up to this" sentence would be false). The price-change sentence
 * exists only for detected plateaus, and income series read "deposit"/"amount"
 * throughout.
 *
 * Read-only: one-click demo sign-in, one page read, writes nothing.
 *
 *   node scripts/o18c-live-deploy-check.mjs
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

  await page.goto(`${BASE}/recurring`, { waitUntil: 'networkidle' });

  // The marker itself — impossible on the previous build.
  const netflix = page.getByTestId('recurring-row').filter({ hasText: 'Netflix' });
  const toggle = netflix.getByTestId('recurring-charges-toggle');
  await toggle.waitFor({ timeout: 30000 });
  const toggleText = await toggle.innerText();
  check(
    'the /recurring rows carry the charges toggle',
    toggleText.includes('Show') && toggleText.includes('charges'),
    toggleText.trim(),
  );

  // Expand — dated charges with signed amounts, newest first.
  await toggle.click();
  const panel = netflix.getByTestId('recurring-charges-panel');
  await panel.waitFor({ state: 'visible', timeout: 10000 });
  const rowCount = await panel.getByTestId('recurring-charges-rows').locator('li').count();
  check('the panel lists the charges the detector saw', rowCount > 3, `${rowCount} rows`);
  const firstAmount = await panel.getByTestId('recurring-charges-row-amount').first().innerText();
  check('rows carry signed amounts', firstAmount.includes('-$'), firstAmount);
  const firstDate = await panel.getByTestId('recurring-charges-rows').locator('li').first().innerText();
  check('rows carry dates', /^[A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2}/.test(firstDate), firstDate.split('\n')[0]);

  // The disclosure contract — the sentence quotes the row's own figure.
  const basis = panel.getByTestId('recurring-charges-basis').first();
  const basisText = await basis.innerText();
  check(
    'the basis embeds the row figure and names it typical, not total',
    basisText.includes('$17.99') && basisText.includes('typical amount, not the total of'),
    basisText.slice(0, 110),
  );

  // The detector's reasoning: cadence + the price plateaus.
  const panelText = await panel.innerText();
  check('the rhythm sentence states the detected cadence', panelText.includes('Detected a monthly rhythm in these'));
  check(
    'the price-change sentence names both plateaus',
    panelText.includes('The price changed from $15.49 to $17.99 — the first charge at the new price was'),
  );

  // Collapse.
  await toggle.click();
  const expanded = await toggle.getAttribute('aria-expanded');
  check('the panel collapses and aria follows', expanded === 'false');

  // An income series uses deposit wording throughout (payroll is biweekly).
  const payroll = page.getByTestId('recurring-row').filter({ hasText: 'Acme Analytics' });
  const payrollToggleText = await payroll.getByTestId('recurring-charges-toggle').innerText();
  check('an income series says deposits', payrollToggleText.includes('deposits'), payrollToggleText.trim());
  await payroll.getByTestId('recurring-charges-toggle').click();
  const payrollBasis = await payroll.getByTestId('recurring-charges-basis').first().innerText();
  check('the income disclosure says most recent deposit', payrollBasis.includes('most recent deposit'));
  const payrollPanelText = await payroll.getByTestId('recurring-charges-panel').innerText();
  check('the income rhythm sentence names biweekly', payrollPanelText.includes('Detected a biweekly rhythm'));

  check('zero page errors', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 120));
} catch (err) {
  check('script completed', false, String(err).slice(0, 200));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length === 0 ? 'ALL CHECKS PASSED' : `${failed.length} CHECK(S) FAILED`} (${results.length} total)`);
process.exit(failed.length === 0 ? 0 : 1);
