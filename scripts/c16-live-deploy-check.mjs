/**
 * Deploy proof for C.16 (#434), run against PRODUCTION.
 *
 * C.16 moved the Fixed/Discretionary WRITE off the register row into the one
 * action menu (F4: the always-on dial was the clunk the owner named), and
 * fenced the demo there too: the verb is DISABLED with the shared-account
 * sentence on the demo, because a shared visitor's class write would rewrite
 * every visitor's Plan. What discriminates THIS build from the last:
 *
 *   - the action menu lists a "Change spending class…" verb — the old build
 *     had no such verb anywhere (the dial was the only write path);
 *   - on the demo that verb is disabled with the 'shared account' reason —
 *     the same sentence the server action refuses with;
 *   - the register row's class is a badge SPAN — the old build rendered a
 *     live <select> on every row.
 *
 * Read-only: one-click demo sign-in, one register read, one menu open,
 * writes nothing.
 *
 *   node scripts/c16-live-deploy-check.mjs
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

  await page.goto(`${BASE}/transactions`, { waitUntil: 'networkidle' });
  const row = page.getByTestId('txn-row').first();
  await row.waitFor({ timeout: 30000 });

  // The register renders a badge SPAN, never the old live <select> (F4).
  const badge = row.getByTestId('txn-spend-class').first();
  await badge.waitFor({ timeout: 15000 });
  const kind = await badge.getAttribute('data-spend-class');
  check(
    'the register row shows a Fixed/Discretionary badge',
    kind === 'fixed' || kind === 'guilt-free' || kind === 'out-of-scope',
    `data-spend-class=${kind}`,
  );
  check(
    'the badge is a span, not a select',
    (await row.locator('select[data-testid="txn-spend-class"]').count()) === 0,
  );

  // The menu carries the C.16 verb — impossible on the previous build — and
  // the demo fence lives there with the shared-account sentence.
  await row.getByTestId('txn-action-trigger').click();
  const verb = page.getByTestId('txn-action-spendClass');
  await verb.waitFor({ timeout: 15000 });
  check('the menu lists "Change spending class…"', (await verb.innerText()).includes('Change spending class'));
  check(
    'the demo fence: verb disabled with the shared-account reason',
    (await verb.isDisabled()) &&
      /shared account/.test(await page.getByTestId('txn-action-spendClass-reason').innerText()),
  );
} catch (e) {
  check('script reached the end', false, String(e));
}

check('zero page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
await browser.close();

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
