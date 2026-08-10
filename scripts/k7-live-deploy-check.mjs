/**
 * Deploy proof for K.7 (DECISIONS #437), run against PRODUCTION.
 *
 * THE HARD PART OF THIS ONE: the slice's own behavior cannot be painted on the
 * demo. `Auto Loan due` (the loan-due lock) renders only when the snapshot holds
 * the loan OBLIGATION, and the shared demo carries the stale shape — the detected
 * series with NO obligation (k7-live-probe, 2026-08-09) — so the engine's
 * passthrough branch makes /calendar, /forecast and /radar BYTE-IDENTICAL to the
 * prior deploy. The C.25 precedent (same shape: "no UI marker exists by
 * construction … the sha-match IS the live proof") covers this class: the
 * deployment status on the exact SHA is the claim, and the served build must not
 * contradict it.
 *
 * What discriminates the build is the NEXT.JS BUILD ID — a random 22-char id minted
 * per `next build`, embedded in every RSC payload as "b":"<id>". Vercel keeps each
 * deployment's URL immutable, so:
 *   - the NEW deployment URL serves the NEW build's id (proves this SHA deployed),
 *   - the OLD deployment URL serves the OLD build's id (proves the id is not a
 *     static constant — it changes when the build changes),
 *   - the www alias must serve exactly the NEW build's id (proves the alias is not
 *     answering from the previous deployment).
 *
 * What it checks, and why each is the risk of THIS deploy:
 *   1. THE DISCRIMINATOR — www serves the new build's id, and it differs from the
 *      previous build's id;
 *   2. the shared demo signs in (the app is up at all);
 *   3. /calendar still paints the detected series row for the demo (the passthrough
 *      branch was re-verified, not regressed — the split is a no-op on demo data);
 *   4. ABSTENTION — no obligation on the demo ⇒ no `Auto Loan due`, and no
 *      `CARMAX AUTO FINANCE` row is suppressed from the demo's calendar (the engine
 *      suppresses only rows a C.25 fact covers; the demo has no facts);
 *   5. no uncaught client errors on any route read.
 *
 * Read-only throughout: one-click demo sign-in, reads pages, writes nothing.
 *
 *   node scripts/k7-live-deploy-check.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.LIVE_BASE ?? 'https://www.aimplifi.app';
// Deployment URLs are immutable on Vercel; sha-anchored in the K.7 PROGRESS entry.
const NEW_DEPLOY = 'https://aimplifi-nk3iugdxg-reiforge.vercel.app'; // sha 41dcfba (K.8 ledger close-out; app tree identical to e4721d4)
const OLD_DEPLOY = 'https://aimplifi-jd98id3yp-reiforge.vercel.app'; // sha b8dbe8b (the 08:00 gate-green tree, build E6idweuWQNx4uX5Iyb6Bc)

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

// The RSC payload embeds the build id as "b":"<id>" — but on server-rendered pages it
// lives INSIDE a `self.__next_f.push([1,"0:{..."]` JS string, so the quotes are escaped
// (\”b\”:\”<id>\”). Match both the raw flight form and the escaped HTML form.
const buildIdOf = (html) => {
  // Observed ids: 21 chars through b8dbe8b (cpo-kt9TVyQCT2weegly6), then the
  // turbopack-era builds mint 15-char ids (QfSb4Bin36uw6nO on 41dcfba). Range
  // {14,30} covers both without matching the short `b:` component refs.
  const m = /\\?"b\\?":\\?"([A-Za-z0-9-]{14,30})/.exec(html);
  return m?.[1] ?? null;
};
const fetchBuildId = async (ctx, url) => {
  const res = await ctx.request.get(url, { maxRedirects: 5 });
  if (!res.ok()) return null;
  return buildIdOf(await res.text());
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 380, height: 800 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));

try {
  // 1 — THE DISCRIMINATOR: three build ids, one relation to prove.
  const newId = await fetchBuildId(page, `${NEW_DEPLOY}/calendar?month=2026-07`);
  const oldId = await fetchBuildId(page, `${OLD_DEPLOY}/calendar?month=2026-07`);
  const aliasId = await fetchBuildId(page, `${BASE}/calendar?month=2026-07`);
  check('DISCRIMINATOR: the new deployment serves a build id', newId !== null, newId ?? 'none');
  check('DISCRIMINATOR: the old deployment serves a DIFFERENT build id', oldId !== null && oldId !== newId, oldId ?? 'none');
  check(
    'DISCRIMINATOR: the www alias serves the NEW build, not the old one',
    aliasId !== null && aliasId === newId,
    `www=${aliasId ?? 'none'} new=${newId ?? 'none'} old=${oldId ?? 'none'}`,
  );

  // 2 — the app is up: the shared demo signs in.
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard', { timeout: 30_000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  check('signed into the shared demo on production', true, BASE);

  // 3 — /calendar: the passthrough branch still paints the demo's detected series.
  await page.goto(`${BASE}/calendar?month=2026-07`, { waitUntil: 'domcontentloaded' });
  const julText = await page.getByTestId('calendar-list').innerText().catch(() => '');
  check(
    '/calendar paints the demo’s detected series row (passthrough re-verified)',
    /Auto loan — CarMax/i.test(julText),
    julText.slice(0, 120).replace(/\s+/g, ' '),
  );

  // 4 — ABSTENTION: no obligation on the demo ⇒ the loan-due paint stays absent,
  //    and the split suppresses nothing (no C.25 facts on the demo).
  const loanDue = /Auto Loan due/i.test(julText);
  const carmaxCount = (julText.match(/CarMax/i) ?? []).length;
  check(
    'ABSTENTION: no obligation on the demo ⇒ no `Auto Loan due`, nothing suppressed',
    !loanDue && carmaxCount === 1,
    `loan-due=${loanDue} CarMax-rows=${carmaxCount}`,
  );

  check('no uncaught client errors on any route read', pageErrors.length === 0, pageErrors.join(' | '));
} finally {
  await browser.close();
}

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} ${passed === results.length ? 'PASS' : 'FAIL'}`);
process.exit(passed === results.length ? 0 : 1);
