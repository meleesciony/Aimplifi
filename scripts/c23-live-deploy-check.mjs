/**
 * Deploy proof for C.23/H.4 (#412), run against PRODUCTION.
 *
 * WHAT DISCRIMINATES THIS BUILD FROM THE LAST, stated up front:
 *
 *  1. THE SECTION ITSELF. The previous deployment has no "Money you set aside
 *     each month" section on /spending-plan, and no `reserves-section` testid.
 *     A stale deployment cannot produce it, so its presence IS the proof that
 *     this commit is the one being served.
 *  2. THE DEMO'S REFUSAL, which is a shipped behaviour and not an absence. The
 *     shared demo is one row every visitor signs into, so the reserve form is
 *     deliberately withheld there and replaced by a named note
 *     (`reserves-demo-note`). Both facts are asserted: the section renders, and
 *     the write control is absent for exactly the documented reason.
 *  3. THE C.19/H.3 INVARIANT STILL HOLDS with the new line kind in the list —
 *     the printed Fixed total equals the sum of the printed lines. This is the
 *     regression the change could most plausibly have caused, so it is
 *     re-executed live rather than assumed from the unit gate.
 *
 * WHAT IT CANNOT PROVE: the demo declares no reserves (it cannot — see 2), so
 * no reserve LINE appears in production's list. That a declared reserve renders
 * at cost/12 beside the mortgage is proven by the e2e over owner-shaped seed
 * data (`tests/e2e/fixed-composition.spec.ts`, the H.4 test, which drives the
 * real form), not by a demo that is structurally forbidden from having one.
 *
 * EXTENDED 2026-08-08 for the C.23 guided half (DECISIONS #431): the same
 * slice family adds the Fixed-costs SETTINGS card (`fixed-costs-card` on
 * /settings) with the convert lever ("turn this into a monthly reserve"). The
 * four extra checks below prove the new build AND the new schema together —
 * the /settings page select reads `user.reserveHoldingAccountId` and the
 * card's loader reads `Goal.merchantCanonical` on every load, so a render
 * that would 500 if `prisma db push` had not run IS the schema proof — and
 * that the fenced demo is offered no write door (the convert button and the
 * reserve form both gate on `canWrite`).
 *
 * Read-only throughout: one-click demo sign-in, reads two pages, writes nothing.
 *
 *   node scripts/c23-live-deploy-check.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.LIVE_BASE ?? 'https://www.aimplifi.app';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const centsOf = (text) => {
  const m = /\$([\d,]+)\.(\d{2})/.exec(text ?? '');
  return m === null ? null : Number(m[1].replace(/,/g, '')) * 100 + Number(m[2]);
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

  await page.goto(`${BASE}/spending-plan`, { waitUntil: 'domcontentloaded' });

  // 1 — THE MARKER. New this commit; a stale deployment has no such section.
  const section = page.getByTestId('reserves-section');
  await section.waitFor({ timeout: 30_000 });
  const heading = await section.locator('h2').textContent();
  check(
    'the reserves section renders with this commit’s heading',
    (heading ?? '').includes('Money you set aside each month'),
    heading ?? 'none',
  );

  // 2 — THE DEMO FENCE, as a rendered fact rather than an absence.
  const formCount = await page.getByTestId('reserve-form').count();
  check('the write form is withheld on the shared demo', formCount === 0, `forms=${formCount}`);
  const note = await page.getByTestId('reserves-demo-note').textContent();
  check(
    'and the reason is stated where the form would be',
    (note ?? '').includes('shared account'),
    (note ?? 'none').slice(0, 60),
  );

  // 3 — THE C.19/H.3 INVARIANT, re-executed with the new line kind in play.
  const panel = page.getByTestId('fixed-composition');
  await panel.waitFor({ timeout: 30_000 });
  const amounts = await panel.getByTestId('fixed-composition-amount').allInnerTexts();
  const sum = amounts.reduce((acc, t) => acc + (centsOf(t) ?? 0), 0);
  const totalText = await panel.getByTestId('fixed-composition-total').innerText();
  const total = centsOf(totalText);
  check(
    'the printed lines still add up to the printed Fixed total',
    amounts.length > 0 && sum === total,
    `${amounts.length} lines summing ${sum} vs total ${total}`,
  );

  // 4 — the composition still certifies itself one way or the other; a list
  // that says nothing is the state C.19's own critic cycle closed.
  const reconciled = await panel.getByTestId('fixed-composition-reconciled').count();
  const partial = await panel.getByTestId('fixed-composition-partial').count();
  const noteText =
    reconciled > 0
      ? await panel.getByTestId('fixed-composition-reconciled').innerText()
      : partial > 0
        ? await panel.getByTestId('fixed-composition-partial').innerText()
        : '';
  check(
    'the list still states a verdict about itself, and it is not empty',
    reconciled + partial === 1 && noteText.trim() !== '',
    noteText.slice(0, 70),
  );
  // ── THE C.23 GUIDED HALF (#431) — the /settings Fixed-costs card ──────────

  // 5 — THE MARKER + THE SCHEMA together: `fixed-costs-card` exists only in
  // this half, and rendering it required reading `reserveHoldingAccountId`
  // and `Goal.merchantCanonical` — if `prisma db push` had not run, this
  // render would 500 before the card could paint.
  const settingsRes = await page.goto(`${BASE}/settings`, { waitUntil: 'domcontentloaded' });
  const fixedCard = page.getByTestId('fixed-costs-card');
  await fixedCard.waitFor({ timeout: 30_000 });
  check(
    'the Fixed costs settings card renders (new build + reserve schema live)',
    (settingsRes?.status() ?? 0) < 400,
    `status=${settingsRes?.status()}`,
  );

  // 6 — the reserves figure names its zero on the demo; nothing is invented.
  const figure = await page.getByTestId('reserves-monthly-figure').textContent();
  check(
    'the reserves figure names the demo’s zero',
    (figure ?? '').includes('Nothing is set aside to reserves yet'),
    (figure ?? 'none').slice(0, 60),
  );

  // 7 — the fence is stated, and no write door renders (both gate on
  // `canWrite` — the demo is shared, so the convert lever and the form must
  // not exist for it).
  const fenceCount = await page.getByTestId('reserves-demo-note').count();
  const convertCount = await page.getByTestId('convert-to-reserve').count();
  const settingsFormCount = await page.getByTestId('reserve-form').count();
  check(
    'the demo gets the fence note and no write doors',
    fenceCount === 1 && convertCount === 0 && settingsFormCount === 0,
    `fence=${fenceCount} convert=${convertCount} forms=${settingsFormCount}`,
  );

  // 8 — no client-side explosion on either route.
  check('no uncaught client errors', pageErrors.length === 0, pageErrors[0] ?? 'none');
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
