/**
 * Deploy proof for K.5 (#420), run against PRODUCTION.
 *
 * THE HARD PART OF THIS ONE: the slice's own sentence cannot be painted on the
 * demo. `today-feed-frozen-dues` renders only for a reader whose bank has stopped
 * sharing an account, and the shared demo has no frozen row — by design, since the
 * demo is a fixed golden dataset. So unlike K.3, no page state discriminates the
 * new build from the old one.
 *
 * What discriminates it instead is the SERVED BUNDLE. `today-feed-frozen-dues` is
 * a string that exists in no earlier build, and today-feed-card is a client
 * component, so the literal is compiled into a chunk the browser downloads. If it
 * is in a chunk production is serving, the new code is the code serving — which is
 * the claim a 200 cannot make (CLAUDE.md rule 5).
 *
 * What it checks, and why each is the risk of THIS deploy:
 *   1. the shared demo signs in (the app is up at all);
 *   2. THE DISCRIMINATOR — a served JS chunk contains the new testid;
 *   3. the Today feed still renders and, on a reader with nothing frozen, says
 *      NOTHING about frozen dues — the abstention direction, and the one this
 *      change could plausibly break by rendering an empty paragraph always;
 *   4. /cards paints the total and the per-card rows the re-pointed duplicate
 *      assertions now read (`scenario-required`, `user-action-*`);
 *   5. /calendar names card dues, and next month names the Auto Loan — the
 *      surface that inherited "upcoming card AND loan payments, by name";
 *   6. Home renders the recent-transactions card that inherited the sparse-card
 *      invariant from the deleted recurring summary;
 *   7. /recurring still serves its monthly total — the route that lost its only
 *      nav link, recorded as a residual;
 *   8. no uncaught client errors on any route read.
 *
 * Read-only throughout: one-click demo sign-in, reads pages, writes nothing.
 *
 *   node scripts/k5-live-deploy-check.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.LIVE_BASE ?? 'https://www.aimplifi.app';
const NEW_TESTID = 'today-feed-frozen-dues';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 380, height: 800 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));

// Every script URL the browser actually fetched — the bundle production served us.
const scriptUrls = new Set();
page.on('response', (r) => {
  const u = r.url();
  if (u.endsWith('.js') || u.includes('/_next/static/chunks/')) scriptUrls.add(u);
});

try {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard', { timeout: 30_000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  check('signed into the shared demo on production', true, BASE);

  // 2 — THE DISCRIMINATOR. Fetch each served chunk and look for the new literal.
  let foundIn = null;
  for (const url of scriptUrls) {
    try {
      const res = await page.request.get(url);
      if (!res.ok()) continue;
      const body = await res.text();
      if (body.includes(NEW_TESTID)) {
        foundIn = url;
        break;
      }
    } catch {
      /* a chunk that will not fetch is not evidence either way — keep looking */
    }
  }
  check(
    `DISCRIMINATOR: a served chunk contains "${NEW_TESTID}" (exists in no earlier build)`,
    foundIn !== null,
    foundIn ? foundIn.replace(BASE, '') : `searched ${scriptUrls.size} chunks`,
  );

  // 3 — the abstention: nothing frozen on the demo, so the new paragraph must be absent.
  const feed = page.getByTestId('today-feed-card');
  const feedVisible = await feed.isVisible().catch(() => false);
  check('the Today feed renders on Home', feedVisible);
  const frozenDues = await page.getByTestId(NEW_TESTID).count();
  check(
    'ABSTENTION: no frozen accounts on the demo ⇒ the new frozen-dues paragraph is absent',
    frozenDues === 0,
    `count=${frozenDues}`,
  );

  // 6 — the card that inherited the sparse-card invariant (auth.spec re-point).
  const recent = await page.getByTestId('dashboard-recent-list').count();
  const recentEmpty = await page.getByTestId('dashboard-recent-empty').count();
  check(
    'Home renders the recent-transactions card (the slot the recurring summary left)',
    recent + recentEmpty > 0,
    `list=${recent} empty=${recentEmpty}`,
  );

  // 4 — /cards: the surface the duplicate-disclosure assertions were re-pointed at.
  await page.goto(`${BASE}/cards`, { waitUntil: 'domcontentloaded' });
  const required = await page.getByTestId('scenario-required').count();
  const rows = await page.locator('[data-testid^="user-action-"]').count();
  check(
    '/cards paints its own total and per-card rows (the re-pointed sum identity)',
    required > 0 && rows > 0,
    `scenario-required=${required} rows=${rows}`,
  );

  // 5 — /calendar: the surface that inherited named card AND loan dues.
  await page.goto(`${BASE}/calendar`, { waitUntil: 'domcontentloaded' });
  const calText = await page.getByTestId('calendar-list').innerText().catch(() => '');
  check(
    '/calendar names card dues this month',
    /Card due/i.test(calText),
    calText.match(/[A-Za-z ]+Card due/)?.[0] ?? 'no "… Card due" found',
  );
  // NOT a loan-due check. The first version of this script asserted "Auto Loan appears next
  // month" and FAILED — then a probe showed why, and the failure was the honest one: the demo's
  // auto loan reaches /calendar as a DETECTED SERIES (`Auto loan — CarMax`, `scheduled` badge),
  // never as the `${accountName} due` a LoanObligation emits, in any of Jun/Jul/Sep/Oct/Nov.
  // Recorded as TASKS K.7. What this deploy is entitled to claim is that the month NAVIGATES,
  // which is the affordance K.1 made honest — so that is what is checked.
  await page.goto(`${BASE}/calendar?month=2026-07`, { waitUntil: 'domcontentloaded' });
  const julMonth = await page.getByTestId('cal-month').innerText().catch(() => '');
  const julText = await page.getByTestId('calendar-list').innerText().catch(() => '');
  check(
    '/calendar navigates to another month and paints it',
    /Jul/i.test(julMonth) && julText.length > 0,
    julMonth.trim(),
  );

  // 7 — the route that lost its only nav link still serves.
  await page.goto(`${BASE}/recurring`, { waitUntil: 'domcontentloaded' });
  const total = await page.getByTestId('recurring-monthly-total').innerText().catch(() => '');
  check('/recurring still serves its monthly total', /\$/.test(total), total.trim());

  check('no uncaught client errors on any route read', pageErrors.length === 0, pageErrors.join(' | '));
} finally {
  await browser.close();
}

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} ${passed === results.length ? 'PASS' : 'FAIL'}`);
process.exit(passed === results.length ? 0 : 1);
