/**
 * Deploy proof for K.3 (#417), run against PRODUCTION.
 *
 * Unlike H.5/H.7, this slice HAS a discriminator: `txn-empty-before-history` is
 * a testid that does not exist in any earlier build, and the sentence it wraps
 * must name the same date the filter bar prints. So this script can prove the
 * new code is the code serving, not merely that the site answers 200.
 *
 * What it checks, and why each one is the risk of THIS deploy:
 *   1. the shared demo signs in (the app is up);
 *   2. a window entirely before the demo's history renders the NEW branch —
 *      the discriminator;
 *   3. the empty state and the filter bar name the SAME date — the actual
 *      property of the slice, since the defect was two surfaces disagreeing;
 *   4. the OLD sentence is gone from that screen;
 *   5. the UNFILTERED register still renders — this is the regression the
 *      in-session read caught: `str(sp.to)` is '' when unset and `isoDate('')`
 *      throws, so a bare cast would 500 this exact page on every load;
 *   6. a genuine no-match zero still gets #186's filter sentence — the branch
 *      this slice deliberately preserved;
 *   7. no uncaught client errors on any route read.
 *
 * Read-only throughout: one-click demo sign-in, reads pages, writes nothing.
 *
 *   node scripts/k3-live-deploy-check.mjs
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
  await page.waitForURL('**/dashboard', { timeout: 30_000 });
  check('signed into the shared demo on production', true, BASE);

  // 2 — THE DISCRIMINATOR. 2019 is before any seeded demo history, so the
  // window is disjoint and the new branch must paint.
  const res = await page.goto(`${BASE}/transactions?from=2019-01-01&to=2019-12-31`, {
    waitUntil: 'domcontentloaded',
  });
  const newBranch = page.getByTestId('txn-empty-before-history');
  let newBranchVisible = false;
  try {
    await newBranch.waitFor({ timeout: 30_000 });
    newBranchVisible = true;
  } catch {
    newBranchVisible = false;
  }
  const emptyText = newBranchVisible ? ((await newBranch.textContent()) ?? '') : '';
  check(
    'a window before the register history renders the NEW empty-state branch',
    (res?.status() ?? 0) < 400 && newBranchVisible,
    `status=${res?.status()} ${emptyText.trim().slice(0, 90)}`,
  );

  // 3 — THE PROPERTY: the two surfaces name the SAME date. "A date rendered"
  // would not be a proof; the defect was disagreement.
  const spanText = (await page.getByTestId('txn-history-span').textContent()) ?? '';
  const printed = /History available from (.+)\./.exec(spanText)?.[1] ?? '';
  check(
    'the empty state names the same date the filter bar prints',
    printed.length > 0 && emptyText.includes(printed),
    printed ? `both say "${printed}"` : 'the filter bar printed no bound',
  );

  // 4 — the sentence the owner actually saw must be gone from this screen.
  check(
    'the old "matched nothing" sentence is gone from a disjoint window',
    !emptyText.includes('No transactions match these filters'),
    emptyText.includes('No transactions match these filters') ? 'still present' : 'absent',
  );

  // 5 — THE CRASH PATH. Unfiltered, `from`/`to` are '' — the value that would
  // have reached isoDate('') and thrown the route.
  const plain = await page.goto(`${BASE}/transactions`, { waitUntil: 'domcontentloaded' });
  const rowsOrEmpty = (await page.textContent('body')) ?? '';
  check(
    'the unfiltered register still renders (the empty-string bound path)',
    (plain?.status() ?? 0) < 400 && rowsOrEmpty.includes('Transactions'),
    `status=${plain?.status()}`,
  );

  // 6 — the preserved branch: a real no-match inside the span still says #186.
  await page.goto(`${BASE}/transactions?q=ZZZ_NO_MATCH_K3_LIVE`, { waitUntil: 'domcontentloaded' });
  const filtersEmpty = page.getByTestId('txn-empty');
  await filtersEmpty.waitFor({ timeout: 30_000 });
  const filtersText = (await filtersEmpty.textContent()) ?? '';
  check(
    'a genuine no-match zero still gets the unchanged filter sentence',
    filtersText.includes('No transactions match these filters'),
    filtersText.trim().slice(0, 60),
  );

  check('no uncaught client errors on the routes read', pageErrors.length === 0, pageErrors[0] ?? 'none');
} finally {
  await browser.close();
}

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
