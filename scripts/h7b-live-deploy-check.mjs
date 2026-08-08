/**
 * Deploy proof for H.7b (#428), run against PRODUCTION. Read-only: one-click
 * demo sign-in, reads /settings, writes nothing (the demo is fenced from the
 * apply anyway, and this script never clicks it).
 *
 * What each check proves:
 *  1. the new BUILD is serving — the "Transfer mark repair" card exists only
 *     in this slice, so its testid is the unique marker CLAUDE.md rule 5 asks
 *     for (an old deployment answers 200 perfectly well);
 *  2. the new SCHEMA is live — getTransferFlagRepairPreview queries
 *     TransferFlagRepairRun.findFirst on every /settings load, so if
 *     `prisma db push` had not created the table this render would 500;
 *  3. the card lands in a truthful state for the shared demo: one of the two
 *     valid renders (the claim or a named zero), and NEVER an apply button —
 *     the demo must not be offered a door that fails;
 *  4. no uncaught client errors.
 *
 * NOT proven here (proven by the unit/e2e gate instead): the clear/undo writes
 * themselves — production's only reachable account is the fenced shared demo.
 *
 *   node scripts/h7b-live-deploy-check.mjs
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

  // 1+2 — the new card renders, which requires both the new build AND the new
  // table (the preview query runs before the page can answer).
  const res = await page.goto(`${BASE}/settings`, { waitUntil: 'domcontentloaded' });
  const card = page.getByTestId('transfer-repair-settings-card');
  await card.waitFor({ timeout: 30_000 });
  const cardText = (await card.textContent()) ?? '';
  check(
    'the Transfer mark repair card renders (new build + TransferFlagRepairRun table live)',
    (res?.status() ?? 0) < 400 && cardText.includes('Transfer mark repair'),
    `status=${res?.status()}`,
  );

  // 3 — a truthful state: the claim or a named zero, never a bare card.
  const hasClaim = (await page.getByTestId('transfer-repair-claim').count()) > 0;
  const hasZero = (await page.getByTestId('transfer-repair-nothing').count()) > 0;
  check('the card states a claim or names its zero', hasClaim !== hasZero || hasClaim, `claim=${hasClaim} zero=${hasZero}`);

  // …and the fenced demo is never offered the write.
  const applyCount = await page.getByTestId('transfer-repair-apply').count();
  const undoCount = await page.getByTestId('transfer-repair-undo').count();
  check('the shared demo is offered no door that fails', applyCount === 0 && undoCount === 0, `apply=${applyCount} undo=${undoCount}`);

  // 4 — no client-side explosion.
  check('no uncaught client errors', pageErrors.length === 0, pageErrors[0] ?? 'none');
} finally {
  await browser.close();
}

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
