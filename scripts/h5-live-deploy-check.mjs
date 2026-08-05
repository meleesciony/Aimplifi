/**
 * Deploy proof for H.5 (#413), run against PRODUCTION.
 *
 * WHAT THIS SLICE CAN AND CANNOT PROVE LIVE — stated up front, because H.5 has
 * NO UI of its own and the usual "grep for a new testid" discriminator does not
 * exist here:
 *
 *  - The change is a server path (`backfillSimplefinHistory`) plus one additive
 *    nullable column (`SimpleFinConnection.historyBackfilledAt`). Nothing it does
 *    is visible except through a REAL SimpleFIN connection, and the shared demo
 *    is fenced from provider egress by construction (#242 F1) — deliberately, and
 *    asserted in the unit suite. So production cannot be made to run a backfill.
 *  - What production CAN prove, and what this script actually checks:
 *      1. the build succeeded, which means `prisma db push` ran the new column
 *         against Neon — it is in `vercel.json`'s buildCommand, so a failed
 *         migration is a failed deploy, not a silent skip;
 *      2. the SCHEMA CHANGE DID NOT BREAK THE LIVE APP — the real risk of this
 *         deploy. Every page that reads a connection or a transaction still
 *         renders for a signed-in user;
 *      3. the surface H.5 relies on to REPORT depth is present and reads from
 *         real data: `txn-history-span` ("History available from <date>"), which
 *         is derived from the oldest actual transaction rather than from any
 *         promised window — which is why no new surface was built.
 *
 *  - NOT PROVEN HERE, and proven by the unit/e2e gate instead: that a backfill
 *    reaches past the 90-day floor, that it is add-only over a three-year
 *    overlap, and that it converges under the per-run cap. Those live in
 *    tests/unit/simplefin-history-backfill{,-server,-scale}.test.ts against a
 *    mocked bridge, because production has no SimpleFIN connection to exercise.
 *
 * Read-only throughout: one-click demo sign-in, reads pages, writes nothing.
 *
 *   node scripts/h5-live-deploy-check.mjs
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

  // 1 — THE SCHEMA CHANGE IS LIVE AND THE APP STILL READS CONNECTIONS.
  // `/accounts` is the page that queries SimpleFinConnection. If `prisma db push`
  // had not applied `historyBackfilledAt`, every Prisma read selecting the model
  // would throw P2022 and this page would 500 — so a rendered account list is a
  // positive statement about the column, not merely "the site is up".
  const accountsRes = await page.goto(`${BASE}/accounts`, { waitUntil: 'domcontentloaded' });
  const accountsOk = (accountsRes?.status() ?? 0) < 400;
  const connectBtn = await page.getByTestId('simplefin-connect-btn').count();
  check(
    'the accounts page renders and reads the SimpleFIN connection model',
    accountsOk && connectBtn > 0,
    `status=${accountsRes?.status()} connect-control=${connectBtn}`,
  );

  // 2 — THE DEPTH SURFACE H.5 RELIES ON, reading real data.
  await page.goto(`${BASE}/transactions`, { waitUntil: 'domcontentloaded' });
  const span = page.getByTestId('txn-history-span');
  await span.waitFor({ timeout: 30_000 });
  const spanText = (await span.textContent()) ?? '';
  const hasDate = /\b(19|20)\d{2}\b/.test(spanText);
  check(
    'the register states how far back history actually goes, from a real date',
    spanText.includes('History available from') && hasDate,
    spanText.trim().slice(0, 60),
  );

  // 3 — THE SYNC PATH THIS SLICE EDITED STILL LOADS. The demo cannot sync (it is
  // fenced), but the page that OWNS the sync controls is the one whose server
  // module now imports the backfill; a broken import would 500 the route.
  const dash = await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
  check('the dashboard still renders after the sync-path change', (dash?.status() ?? 0) < 400, `status=${dash?.status()}`);

  // 4 — NO CLIENT-SIDE EXPLOSION on any of the three routes read above.
  check('no uncaught client errors on the routes read', pageErrors.length === 0, pageErrors[0] ?? 'none');
} finally {
  await browser.close();
}

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
