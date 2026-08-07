/**
 * Deploy proof for K.2b (DECISIONS #423), run against PRODUCTION. Read-only.
 *
 * HONESTY CONSTRAINT: the state K.2b fixes (SimpleFIN accounts whose connection row was
 * deleted) exists only on the OWNER's account, which this script must never sign into.
 * The demo user cannot reach it (demo accounts are provider 'demo'; orphaned is null by
 * construction). So this proves three things, and CLAIMS only those three:
 *
 *   1. the deployed build is the NEW one — the /accounts client bundle contains the
 *      K.2b strings ('Reconnect your bank (SimpleFIN)', 'Bank connection removed'),
 *      which exist in no pre-K.2b build (anti-vacuity: the strings are new);
 *   2. the NEGATIVE direction live — the demo user (not connected, nothing orphaned)
 *      still gets the unchanged first-time door '+ Connect a bank (SimpleFIN)' and NO
 *      disconnected notice: the new branch does not fire where its predicate is false;
 *   3. the old hedge copy is still reachable-by-design elsewhere (freshnessMessage
 *      very_stale is unchanged) — i.e. the bundle carries BOTH sentences, proving the
 *      new level was ADDED, not a rename.
 *
 * The BEHAVIORAL proof for the orphaned state runs in CI/e2e against a real browser
 * and a seeded user (tests/e2e/connection-health.spec.ts, the K.2b test).
 *
 *   node scripts/k2b-live-deploy-check.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.LIVE_BASE ?? 'https://www.aimplifi.app';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 380, height: 800 } });

// Collect every script body the page loads, so the marker check reads the real
// served bundle rather than trusting a deploy dashboard.
const scriptBodies = [];
page.on('response', async (r) => {
  try {
    if (r.request().resourceType() === 'script' && r.ok()) scriptBodies.push(await r.text());
  } catch {
    /* a script that fails to read just isn't part of the corpus */
  }
});

try {
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard', { timeout: 30000 });

  await page.goto(`${BASE}/accounts`, { waitUntil: 'networkidle' });
  await page.getByTestId('accounts-net-worth').waitFor({ timeout: 30000 });

  // 2. Negative direction, live DOM: demo gets the unchanged first-time door.
  const btn = page.getByTestId('simplefin-connect-btn');
  const btnText = (await btn.textContent()) ?? '';
  check('demo /accounts still shows the first-time door', btnText.includes('+ Connect a bank (SimpleFIN)'), JSON.stringify(btnText));
  check('demo /accounts shows NO disconnected notice', (await page.getByTestId('simplefin-disconnected-notice').count()) === 0);
  check(
    'demo /accounts shows no per-row freshness (all provider demo)',
    (await page.getByTestId('account-freshness').count()) === 0,
  );

  // 1 + 3. Build identity: the served JS corpus carries the NEW strings and the old level's copy.
  const corpus = scriptBodies.join('\n');
  check('bundle corpus non-trivial', corpus.length > 100_000, `${scriptBodies.length} scripts, ${corpus.length} chars`);
  check("bundle has NEW door label 'Reconnect your bank (SimpleFIN)'", corpus.includes('Reconnect your bank (SimpleFIN)'));
  check("bundle has NEW per-row fact 'Bank connection removed'", corpus.includes('Bank connection removed'));
  check("bundle has NEW notice copy 'no new transactions since'", corpus.includes('no new transactions since'));
  check("bundle KEEPS the very_stale hedge (added level, not a rename)", corpus.includes('you may need to reconnect'));
  check(
    "bundle does NOT carry the critic-killed remedy tail 'Reconnect to resume updates.'",
    !corpus.includes('Reconnect to resume updates.'),
  );
} catch (e) {
  check('script completed', false, String(e));
} finally {
  await browser.close();
}

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} PASS against ${BASE}`);
process.exit(passed === results.length ? 0 : 1);
