/**
 * Deploy proof for H.6 (DECISIONS #424), run against PRODUCTION. Read-only.
 *
 * HONESTY CONSTRAINT, the same one K.2b's check carries: the state H.6 changes — a Plaid
 * connection that already exists, being re-linked for depth — lives only on the OWNER's
 * account, which this script must never sign into. The demo user owns no PlaidItem, which is
 * precisely the predicate that decides whether the new door renders. So this proves three
 * things and claims only those three:
 *
 *   1. the deployed build is the NEW one — the /accounts client bundle carries the H.6
 *      strings, which exist in no earlier build (anti-vacuity: every one of them is new);
 *   2. the NEGATIVE direction live — the demo user, having nothing to deepen, is NOT shown
 *      the door: the new branch does not fire where its predicate is false;
 *   3. the copy the critic cycle forced is the copy that actually shipped — the amber caveat
 *      about hand-filed work, the wait-for-the-history sentence, and the non-combinable
 *      branch — and the pre-critic sentence it replaced is GONE from the served bundle.
 *
 * (3) is the half a status doc cannot substitute for: three of the four P1s this slice
 * closed were fixed in COPY, and copy that lost an edit between the local gate and the CDN
 * would leave the owner following instructions that a critic already proved destructive.
 *
 * The behavioural proof — that a wholly-redundant deepen link is KEPT rather than handed
 * back to Plaid — runs in the unit gate against a stubbed Plaid server
 * (tests/unit/plaid-link-collision-wiring.test.ts). It CANNOT be proven here: doing so would
 * mean creating a real Item at a real bank on the owner's account.
 *
 *   node scripts/h6-live-deploy-check.mjs
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

// Every script body the page loads, so the marker check reads the REAL served bundle rather
// than trusting a deploy dashboard — an old deployment answers 200 perfectly well.
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

  // 2. Negative direction, live DOM: nothing to deepen ⇒ no door, no explainer, no caveat.
  check('demo /accounts shows NO deepen panel', (await page.getByTestId('deepen-history-panel').count()) === 0);
  check('demo /accounts shows NO deepen button', (await page.getByTestId('deepen-history-btn').count()) === 0);
  check('demo /accounts shows NO deepen caveat', (await page.getByTestId('deepen-history-caveat').count()) === 0);

  // 1 + 3. Build identity and the copy the critic cycle forced.
  const corpus = scriptBodies.join('\n');
  check('bundle corpus non-trivial', corpus.length > 100_000, `${scriptBodies.length} scripts, ${corpus.length} chars`);
  check("bundle has the NEW door label 'Get the full two years of history'", corpus.includes('Get the full two years of history'));
  check("bundle has the panel heading 'Only seeing a few months?'", corpus.includes('Only seeing a few months?'));
  check(
    'bundle has the explainer premise (Plaid freezes the window at creation)',
    corpus.includes('be widened afterwards'),
  );
  check(
    "bundle has the 'share the same accounts' instruction — combine refuses without it",
    corpus.includes('the same accounts'),
  );
  // The caveat copy, narrowed by the H.6b(a) carry: hand-filed work now travels across the
  // combine onto the exact (date, amount) match, the honest remainder (an unmatched copy) still
  // stops being applied, and a stale split (critic P1-3, executed) is disclosed as going back
  // to review. The three carry markers are NEW to this slice — no earlier build can satisfy
  // them — so the bundle check doubles as the deploy proof.
  check(
    'bundle has the H.6b(a) caveat: hand-filed work carries across the exact match',
    corpus.includes('same date and same amount'),
  );
  check(
    'bundle still discloses the honest remainder: an unmatched copy stops being applied',
    corpus.includes('stops being applied'),
  );
  check(
    'bundle names the critic-forced stale-split exception: a broken split goes back to review',
    corpus.includes('no longer match the charge'),
  );
  check(
    'bundle KEEPS the F2 reassurance that no money moves',
    corpus.includes('Nothing is deleted and no balance changes'),
  );
  check(
    "bundle does NOT carry the pre-critic false promise 'categories, splits and notes stay'",
    !corpus.includes('categories, splits and notes stay'),
  );
} catch (e) {
  check('script completed', false, String(e));
} finally {
  await browser.close();
}

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} PASS against ${BASE}`);
process.exit(passed === results.length ? 0 : 1);
