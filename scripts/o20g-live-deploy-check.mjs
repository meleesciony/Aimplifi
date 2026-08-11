/**
 * Deploy proof for O.20g, run against PRODUCTION.
 *
 * O.20g stopped the lifestyle-creep detector counting merchandise returns as
 * income, and gave the card a THIRD verdict for a window it cannot compare.
 *
 * WHAT THIS CAN AND CANNOT PROVE, stated up front so the instrument is not
 * mistaken for a stronger one than it is:
 *
 *  - The third verdict ("Can't compare yet") is NOT reachable on the production
 *    demo. The demo seed pays income in every window month (2–4 counted income
 *    rows per month at DEMO_TODAY, first-half median $5,280.00), so the demo is
 *    permanently in the measured half of the branch. That state is covered by
 *    `tests/e2e/coach-creep-verdict.spec.ts`, which seeds a throwaway user whose
 *    February has no income row, and it runs in the CI gate.
 *  - What the demo CAN discriminate is the copy this slice changed on the
 *    measured path, and the new markup that carries it. Both are things no
 *    pre-O.20g build can produce:
 *      · `creep-title` — a testid that did not exist before this slice (the
 *        title was inline text in the page, not a composed value).
 *      · "income was flat" — the demo's income growth is an EXACT 0 bps, and
 *        `growthPhrase` now renders that as "flat". Every previous build
 *        rendered "income grew 0.0%", which this check asserts is GONE.
 *    A check that only asserted the demo still says "Spending is outpacing
 *    income" would pass against the old deployment too — the wrong-instrument
 *    class the /ask and /trends live checks were corrected for.
 *
 * Read-only: one-click demo sign-in, page reads, writes nothing.
 *
 *   node scripts/o20g-live-deploy-check.mjs
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

  await page.goto(`${BASE}/coach`, { waitUntil: 'networkidle' });
  const card = page.getByTestId('creep-card');
  await card.waitFor({ timeout: 30000 });

  /* ── the composed title: new markup, and the verdict the demo should be in ── */
  const title = page.getByTestId('creep-title');
  await title.waitFor({ timeout: 30000 });
  const titleText = (await title.innerText()).trim();
  check('coach: the creep title is a composed value (creep-title testid is new in O.20g)', true, titleText);
  check(
    'coach: the demo — every window month covered — is still a MEASURED verdict',
    titleText === 'Spending is outpacing income' || titleText === 'Tracking income',
    titleText,
  );
  check(
    'coach: the demo is NOT in the refusal state (its income is covered, so the card must not refuse)',
    titleText !== "Can't compare yet",
    titleText,
  );

  /* ── the sentence O.20g changed on the measured path ── */
  const verdict = (await page.getByTestId('creep-verdict').innerText()).trim();
  check(
    'coach: an exactly-flat income reads as "flat", not as a growth figure (the O.20g discriminator)',
    verdict.includes('income was flat'),
    verdict.slice(0, 140),
  );
  check(
    'coach: the pre-O.20g wording for the same state is GONE',
    !verdict.includes('income grew 0.0%'),
  );
  check(
    'coach: no growth figure is described with a negated percentage ("grew ~-12.0%")',
    !verdict.includes('grew ~-'),
  );

  /* ── the link travels with the verdict ── */
  const link = page.getByTestId('coach-creep-link');
  const href = await link.getAttribute('href');
  const label = (await link.innerText()).trim();
  check(
    'coach: the link matches the verdict the title states',
    titleText === 'Spending is outpacing income'
      ? href === '/transactions?type=expense' && label === 'See the expenses in your activity'
      : href === '/transactions?type=income' && label === 'See the income in your activity',
    `${label} → ${href}`,
  );

  /* ── the O.20d panel sentence O.20g had to correct ──
   *
   * The month matters. The disclosure only renders on a month where a
   * discretionary CREDIT posted, and on the demo that is exactly one month:
   * 2026-05 (`hasDiscretionaryRefunds` true there and false on the other five,
   * measured on the seed at DEMO_TODAY). Clicking `.first()` — December — would
   * open a panel that never carries the sentence, and the negative assertion
   * below would pass against ANY build, which is not a check.
   */
  const bar = card.getByTestId('creep-bar-2026-05');
  await bar.waitFor({ timeout: 30000 });
  await bar.click();
  const panel = page.getByTestId('creep-bar-panel-2026-05');
  await panel.waitFor({ state: 'visible', timeout: 10000 });
  const panelText = await panel.innerText();
  // Anti-vacuity FIRST: prove this panel is the one that carries the sentence,
  // so the negative below is about wording and not about an absent branch.
  check(
    'coach: the May panel carries the discretionary-credit disclosure (the branch under test is live)',
    panelText.includes('A credit posted to a discretionary category'),
    panelText.slice(0, 160),
  );
  check(
    'coach: that disclosure says the credit does not reduce the figure',
    panelText.includes('does not reduce this figure'),
  );
  check(
    'coach: and no longer claims it "counts as money in" — false since O.20g refuses it from income',
    !panelText.includes('counts as money in'),
  );

  check('coach: no page errors', pageErrors.length === 0, pageErrors.join(' | '));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(
  `\nDEPLOY PROOF: ${failed.length === 0 ? 'PASS' : 'FAIL'}, ${results.length} checks` +
    `${failed.length ? ` — failing: ${failed.map((f) => f.name).join(', ')}` : ''}`,
);
process.exit(failed.length === 0 ? 0 : 1);
