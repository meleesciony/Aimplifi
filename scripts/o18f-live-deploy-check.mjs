/**
 * Deploy proof for O.18f, run against PRODUCTION.
 *
 * The four surfaces that carry the excluded-card disclosure are all auth-gated, so
 * `curl | grep` gets a 307 and proves nothing. This signs into the shared demo (one
 * click, no credentials) and reads the real pages. Read-only throughout — it never
 * submits a form or writes anything.
 *
 * ANTI-VACUITY IS THE WHOLE POINT HERE. These sentences are CONDITIONAL: they render
 * only when the reader actually has an undated / statement-pending / duplicated /
 * frozen card. If the shared demo has none, every "the new copy is present" check
 * would pass by never running, which is precisely the silent-cap failure this wave
 * exists to remove. So the script reports, per surface, whether the disclosure was
 * REACHABLE at all, and only then whether it carries the new wording. An unreachable
 * disclosure is reported as SKIP — never as PASS.
 *
 *   node scripts/o18f-live-deploy-check.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.LIVE_BASE ?? 'https://www.aimplifi.app';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, skip: false, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const skip = (name, detail) => {
  results.push({ name, ok: true, skip: true, detail });
  console.log(`SKIP  ${name} — ${detail}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 380, height: 800 } });

try {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard', { timeout: 30_000 });
  check('signed into the shared demo on production', true, BASE);

  // ---- the deployed build is the one we think it is ----
  // The dashboard is the safe-to-spend card's own surface; if it renders, the
  // O.18f component tree is the one being served.
  const heroCount = await page.getByTestId('dashboard-safe-to-spend').count();
  check('dashboard renders the safe-to-spend card at all', heroCount > 0, `${heroCount} card`);

  // ---- dashboard: the three notes, each conditional ----
  const dashNotes = {
    excluded: 'safe-to-spend-undated-note',
    duplicate: 'safe-to-spend-duplicate-note',
    frozen: 'safe-to-spend-frozen-note',
  };
  for (const [fact, testid] of Object.entries(dashNotes)) {
    const n = await page.getByTestId(testid).count();
    if (n === 0) {
      skip(`dashboard ${fact} note`, 'not reachable on the demo dataset (no such card)');
      continue;
    }
    const text = (await page.getByTestId(testid).first().innerText()).replace(/\s+/g, ' ').trim();
    if (fact === 'frozen') {
      // The P2-1 fix: the referent follows the CARD, not the container. The old copy
      // ended "so the card-payments amount may be stale"; the broken interim ended
      // "so that amount may be stale" while naming "this figure".
      check(
        'dashboard frozen note binds its referent to the card (critic P2-1)',
        /so (its amount|their amounts) may be stale/.test(text),
        text,
      );
    } else if (fact === 'duplicate') {
      // The O.18f defect: "Two" was hardcoded. On the demo (one pair) the correct
      // output is still "Two of the cards", but it must now be the COUNTED form —
      // proven by the phrase "counted twice", which the old dashboard copy
      // ("the same card twice") did not have.
      check('dashboard duplicate note is the unified sentence', /counted twice/.test(text), text);
      check(
        'dashboard duplicate note carries the remedy it lacked before',
        /only you can confirm it, on Accounts/.test(text),
        text,
      );
    } else {
      // Old dashboard copy ended "may be lower." — the unified author names the referent.
      check(
        'dashboard excluded note names what the figure is lower THAN',
        /than shown/.test(text) || /no figure to show for it here/.test(text),
        text,
      );
    }
  }

  // ---- /spending-plan: the named surface ----
  await page.goto(`${BASE}/spending-plan`, { waitUntil: 'domcontentloaded' });
  const discl = await page.getByTestId('spending-plan-disclosures').count();
  check('/spending-plan renders its "What this figure can\'t see" section', discl > 0);

  const planFrozen = await page.getByTestId('plan-frozen-note').count();
  if (planFrozen === 0) {
    skip('/spending-plan frozen note', 'not reachable on the demo dataset');
  } else {
    const text = (await page.getByTestId('plan-frozen-note').first().innerText())
      .replace(/\s+/g, ' ')
      .trim();
    // Every count now carries its since-date; before, only the singular branch did.
    check(
      '/spending-plan frozen note carries the since-date',
      /since \d{4}-\d{2}-\d{2}/.test(text),
      text,
    );
  }

  // ---- /budgets: the strip, byte-identical by design ----
  await page.goto(`${BASE}/budgets`, { waitUntil: 'domcontentloaded' });
  const stripNotes = await page.getByTestId('conscious-card-note').count();
  if (stripNotes === 0) {
    skip('/budgets strip card notes', 'not reachable on the demo dataset');
  } else {
    const text = (await page.getByTestId('conscious-card-note').first().innerText())
      .replace(/\s+/g, ' ')
      .trim();
    check('/budgets strip still carries its card note', text.length > 0, text);
  }
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
const skipped = results.filter((r) => r.skip);
console.log(
  `\n${results.length - failed.length - skipped.length} passed, ${skipped.length} skipped (unreachable on demo), ${failed.length} failed`,
);
process.exit(failed.length === 0 ? 0 : 1);
