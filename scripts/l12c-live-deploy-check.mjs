/**
 * Deploy proof for L.12(c), run against PRODUCTION (www.aimplifi.app).
 *
 * L.12(c) widened the generic dining keyword token \bGRILL\b → GRILLE?S? so the
 * owner's "Goose Pond Bar Grille" inbox group gets a one-tap Dining suggestion.
 *
 * WHAT THIS CAN AND CANNOT PROVE, stated up front so the instrument is not
 * mistaken for a stronger one than it is:
 *
 *  - The demo seed (prisma/seed.ts) contains NO GRILLE/GRILLS descriptor, so this
 *    check CANNOT behaviorally discriminate the widened rule — no demo page state
 *    differs between the pre- and post-L.12(c) builds. The behavioral discriminator
 *    is `tests/e2e/triage-provider-suggestion.spec.ts` (both suggestion ladders,
 *    throwaway signups), which runs in the CI gate on exactly this sha.
 *  - What production CAN discriminate is that the deployment serves the triage
 *    inbox healthy on the demo account: one-click demo sign-in, the inbox renders
 *    with groups remaining, per-group controls respond, and no page errors. A
 *    broken build or a broken /triage data path fails this.
 *
 * Read-only: one-click demo sign-in, page reads, writes nothing.
 *
 *   node scripts/l12c-live-deploy-check.mjs
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

  await page.goto(`${BASE}/triage`, { waitUntil: 'networkidle' });
  const inbox = page.getByTestId('triage-inbox');
  await inbox.waitFor({ timeout: 30000 });

  /* ── the inbox answers on the live deployment ── */
  const remaining = Number(await inbox.getAttribute('data-remaining'));
  check('triage: the inbox renders with the demo queue', Number.isFinite(remaining) && remaining >= 1, `data-remaining=${remaining}`);

  // The first group card carries the per-group controls the slice feeds
  // (suggestion ladder: our suggestion → provider guess → none yet). The demo
  // seed's exact suggestion mix is seed-dependent — this asserts the controls
  // exist and the queue is drivable, not a specific ladder rung.
  const accept = page.getByTestId('triage-accept').first();
  await accept.waitFor({ timeout: 30000 });
  check('triage: the per-group accept control renders', true, (await accept.innerText()).trim().slice(0, 80));

  check('triage: no page errors', pageErrors.length === 0, pageErrors.join(' | '));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(
  `\nDEPLOY PROOF: ${failed.length === 0 ? 'PASS' : 'FAIL'}, ${results.length} checks` +
    `${failed.length ? ` — failing: ${failed.map((f) => f.name).join(', ')}` : ''}`,
);
process.exit(failed.length === 0 ? 0 : 1);
