/**
 * Deploy proof for O.11d, run against PRODUCTION (www.aimplifi.app).
 *
 * O.11d shipped free-form tags: the register's tag dropdown + row chips, the
 * detail view's editor, and — the part production can actually discriminate —
 * the SEEDED demo tags (SEED_SPEC §Tags: 2 tags / 6 assignments). A stale
 * deployment cannot pass this: the pre-O.11d build has no `txn-filter-tag`
 * select, no `txn-tag-badge` badge, and no seeded tag rows at all.
 *
 * Read-only: one-click demo sign-in, page reads, writes nothing. The demo fence
 * is asserted too — the detail page shows chips but NO input — which is the
 * shared-action fence rendered as an explanation.
 *
 *   node scripts/o11d-live-deploy-check.mjs
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
  // The one-click demo sign-in is intermittently slow in production (observed
  // 2026-09-25) — retry the entry rather than reporting a harness flake.
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
  check('demo: one-click sign-in reached the dashboard', signedIn, signedIn ? 'after retries' : lastErr);
  if (!signedIn) throw new Error(`demo sign-in failed after retries: ${lastErr}`);

  await page.goto(`${BASE}/transactions`, { waitUntil: 'networkidle' });

  // 1. The toolbar's tag dropdown exists and lists the SEEDED vocabulary — the
  //    seeded tags are unique to a post-O.11d database AND the select is unique
  //    to a post-O.11d build, so this discriminates both halves at once.
  const select = page.getByTestId('txn-filter-tag');
  await select.waitFor({ timeout: 30000 });
  const options = await select.locator('option').allTextContents();
  check('register: the tag dropdown offers the seeded vocabulary',
    options.some((o) => o.trim() === 'work trip') && options.some((o) => o.trim() === 'date night'),
    `options=${JSON.stringify(options)}`);

  // 2. Filter by the seed's "work trip": exactly 3 rows (SEED_SPEC §Tags), each
  //    carrying the chip. The commit is a client-component onChange, so re-fire
  //    once if the first change event landed before hydration (the same race the
  //    e2e's selectTag helper defends).
  await select.selectOption({ label: 'work trip' });
  try {
    await page.waitForURL(/tag=/, { timeout: 5000 });
  } catch {
    await select.selectOption({ label: 'work trip' });
    await page.waitForURL(/tag=/, { timeout: 30000 });
  }
  const rows = await page.getByTestId('txn-row').count();
  const chips = await page.getByTestId('txn-tag-badge').count();
  check('register: the tag filter shows exactly the 3 seeded rows', rows === 3, `rows=${rows}`);
  check('register: every filtered row carries its tag chip', chips === 3, `chips=${chips}`);

  // 3. The fence renders: chips on the detail page, NO input (shared demo is
  //    read-only, and the why is on screen for the untagged case).
  await page.getByTestId('txn-row').first().getByTestId('txn-detail-link').click();
  await page.getByTestId('detail-tag-chips').waitFor({ timeout: 30000 });
  check('detail: the seeded chip renders on the demo row',
    (await page.getByTestId('detail-tag-chip').count()) > 0);
  check('detail: the shared demo offers no tag input (the fence renders)',
    (await page.getByTestId('detail-tag-input').count()) === 0);

  check('no page errors anywhere in the flow', pageErrors.length === 0, pageErrors.join(' | '));
} catch (e) {
  check('script completed', false, String(e).slice(0, 300));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(failed === 0 ? 'DEPLOY PROOF: PASS' : `DEPLOY PROOF: FAIL (${failed} failed)`);
process.exitCode = failed === 0 ? 0 : 1;
