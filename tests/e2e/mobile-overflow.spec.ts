/**
 * Wave M.1 — the mobile layout gate that was missing (docs/MOBILE_UI_BRIEF.md).
 *
 * WHY THIS FILE EXISTS: the 143-test e2e suite renders at exactly ONE width
 * (mobile-380) and NO test asserted anything about layout — so a page whose
 * content runs off the right edge passed here and looked broken on the owner's
 * phone (real screenshots 2026-07-21: /accounts Assets + Liabilities, money
 * values and the Delete action clipped by the viewport edge). A half-visible
 * figure is a WRONG figure — the cardinal sin this codebase is organised around.
 *
 * This spec asserts the objective invariant a screenshot can't: at every real
 * phone width, the document is not wider than the viewport
 * (scrollWidth <= clientWidth). It loops widths inside one browser context
 * (cheaper and more targeted than 4×-ing every project) and reproduces the
 * owner's exact trigger — LONG account names + 6/7-figure balances — on a
 * throwaway signup user, because the frozen demo seed has short names and
 * modest figures and so cannot by itself reproduce the reported overflow.
 */
import Database from 'better-sqlite3';
import { expect, test, type Page } from '@playwright/test';
import { E2E_DB_URL } from '../setup/test-db';

// Narrowest common Android, iPhone 15/16, and Pro Max — all below Tailwind `sm`
// (640), so this is the unprefixed mobile default every real phone lands on.
const WIDTHS = [360, 393, 430] as const;
const HEIGHT = 900;

async function assertFitsEveryWidth(page: Page, label: string) {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: HEIGHT });
    // Poll until the layout settles, rather than measuring once after a fixed delay.
    // A genuine overflow (the synchronous CSS min-width bug this gate exists for —
    // e.g. the original /accounts clip) persists across every retry and still fails.
    // But a Recharts ResponsiveContainer reflows its SVG after a viewport change via a
    // ResizeObserver (async), and under full-suite parallel load that reflow can lag
    // past a fixed 50ms wait — a transient wide reading that a real user (who loads the
    // page AT their phone width; probed fresh-360 fits) never sees. Persistence is what
    // separates a real wrong-width figure from an async reflow, so assert on the
    // SETTLED width: retry until it fits, or the timeout proves it never will.
    await expect(async () => {
      const m = await page.evaluate(() => {
        const el = document.scrollingElement ?? document.documentElement;
        return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
      });
      // +1 absorbs sub-pixel rounding only. Anything beyond that is real overflow.
      expect(
        m.scrollWidth,
        `${label} @${width}px overflows horizontally: scrollWidth ${m.scrollWidth} > clientWidth ${m.clientWidth}. A money value pushed off the right edge is a wrong value.`,
      ).toBeLessThanOrEqual(m.clientWidth + 1);
    }).toPass({ timeout: 4_000, intervals: [50, 100, 200, 400, 800] });
  }
}

async function signInDemo(page: Page) {
  await page.goto('/sign-in');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');
}

async function signUpThrowaway(page: Page): Promise<string> {
  const email = `e2e-overflow-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill('e2e-password-123');
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20_000 });
  return email;
}

/**
 * Seed a SYNCED (provider='simplefin') account for a signed-up user, straight
 * into the e2e SQLite the running server reads. This is the ONLY way to render a
 * real LinkedRow with a long institution name — the manual-add UI caps names at
 * 60 chars and always renders a ManualRow, but the owner's overflow is in
 * LinkedRow (a synced name like "Charles Schwab US Community Property …383 (383)"
 * that doesn't truncate). Synced names have no length cap.
 */
function seedSyncedAccount(opts: {
  email: string;
  name: string;
  type: string;
  balanceCents: number;
}) {
  const file = E2E_DB_URL.replace(/^file:/, '');
  const db = new Database(file, { timeout: 15_000 });
  try {
    const user = db.prepare('SELECT id FROM User WHERE email = ?').get(opts.email) as
      | { id: string }
      | undefined;
    if (!user) throw new Error(`seedSyncedAccount: user ${opts.email} not found`);
    const id = `e2e-linked-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    db.prepare(
      `INSERT INTO Account (id, userId, provider, name, type, currentBalanceCents, currency)
       VALUES (?, ?, 'simplefin', ?, ?, ?, 'USD')`,
    ).run(id, user.id, opts.name, opts.type, opts.balanceCents);
  } finally {
    db.close();
  }
}

/**
 * Seed a synced account PLUS one large POSTED inflow for a signed-up user, so a
 * money-display grid renders a 7-figure figure. M.3: the `grid-cols-3` summary
 * strips (transaction summary, forecast milestones, recurring "coming up") size
 * each `1fr` track as `minmax(auto, 1fr)`, whose `auto` minimum is the cell's
 * min-content — an unbreakable "$9,999,999.00" is wider than a ~100px column at
 * 360px, so pre-fix it forces the track wide and pushes the page past the
 * viewport edge. Unlike the Safari-only flex `min-width:auto` quirk (#263), grid
 * track sizing is identical in Chromium and WebKit, so this DOES fail-old here.
 */
function seedTransaction(opts: {
  email: string;
  name: string;
  type: string;
  balanceCents: number;
  amountCents: number;
  date: string;
}) {
  const file = E2E_DB_URL.replace(/^file:/, '');
  const db = new Database(file, { timeout: 15_000 });
  try {
    const user = db.prepare('SELECT id FROM User WHERE email = ?').get(opts.email) as
      | { id: string }
      | undefined;
    if (!user) throw new Error(`seedTransaction: user ${opts.email} not found`);
    const accountId = `e2e-acct-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    db.prepare(
      `INSERT INTO Account (id, userId, provider, name, type, currentBalanceCents, currency)
       VALUES (?, ?, 'simplefin', ?, ?, ?, 'USD')`,
    ).run(accountId, user.id, opts.name, opts.type, opts.balanceCents);
    // "Transaction" is a SQLite reserved keyword — must be quoted.
    db.prepare(
      `INSERT INTO "Transaction" (id, accountId, date, amountCents, rawDescriptor, status)
       VALUES (?, ?, ?, ?, ?, 'POSTED')`,
    ).run(
      `e2e-txn-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      accountId,
      opts.date,
      opts.amountCents,
      opts.name,
    );
  } finally {
    db.close();
  }
}

/**
 * Seed ONE unrecognised POSTED outflow that lands in the triage queue, for a
 * throwaway signed-up user. Deliberately NOT the demo user: the demo row is
 * shared, and the other specs (phase2-triage) file its queue, so a demo-based
 * triage fixture passes alone and finds an empty inbox under the full suite.
 *
 * The descriptor is nonsense on purpose. `suggestAlternatives` (pipeline.ts) is
 * deterministic: an unrecognised merchant with a negative amount yields exactly
 * ['shopping','dining','household'] → "Shopping" / "Dining Out" / "Household &
 * Home" — the third of which is the long name this test exists to measure. System
 * categories are global (userId=null), so a fresh user resolves the same names.
 */
function seedTriageTransaction(opts: { email: string; descriptor: string; date: string }) {
  const file = E2E_DB_URL.replace(/^file:/, '');
  const db = new Database(file, { timeout: 15_000 });
  try {
    const user = db.prepare('SELECT id FROM User WHERE email = ?').get(opts.email) as
      | { id: string }
      | undefined;
    if (!user) throw new Error(`seedTriageTransaction: user ${opts.email} not found`);
    const accountId = `e2e-triage-acct-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    db.prepare(
      `INSERT INTO Account (id, userId, provider, name, type, currentBalanceCents, currency)
       VALUES (?, ?, 'simplefin', 'Everyday Checking', 'CHECKING', 250000, 'USD')`,
    ).run(accountId, user.id);
    db.prepare(
      `INSERT INTO "Transaction" (id, accountId, date, amountCents, rawDescriptor, status, needsReview)
       VALUES (?, ?, ?, ?, ?, 'POSTED', 1)`,
    ).run(
      `e2e-triage-txn-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      accountId,
      opts.date,
      -4210,
      opts.descriptor,
    );
  } finally {
    db.close();
  }
}

async function addManual(
  page: Page,
  kind: 'asset' | 'liability',
  name: string,
  typeId: string,
  value: string,
) {
  const btn = kind === 'asset' ? 'add-asset-btn' : 'add-liability-btn';
  await expect(async () => {
    await page.getByTestId(btn).click({ timeout: 2_000 });
    await expect(page.getByTestId('manual-name')).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  await page.getByTestId('manual-name').fill(name);
  await page.getByTestId('manual-type').selectOption(typeId);
  await page.getByTestId('manual-value').fill(value);
  await page.getByTestId('manual-submit').click();
  await expect(
    page.getByTestId('manual-account-row').filter({ hasText: name }),
  ).toBeVisible({ timeout: 20_000 });
}

test('/accounts (demo) fits every phone width without horizontal overflow', async ({ page }) => {
  await signInDemo(page);
  await page.goto('/accounts');
  await expect(page.getByTestId('accounts-net-worth')).toBeVisible();
  await assertFitsEveryWidth(page, '/accounts (demo)');
});

test('/accounts with long names + large balances fits every phone width', async ({ page }) => {
  await signUpThrowaway(page);
  await page.goto('/accounts');
  // Mirror the owner's real rows: a long institution name and a 7-figure asset,
  // plus a long-named 6-figure liability, so BOTH the net-worth summary line
  // (two big figures side by side) and a long row name are exercised.
  // Names stay <=60 chars (the manual-account cap); synced names can be longer,
  // but the overflow driver the owner hit is the net-worth summary line holding
  // two big figures, which these 6/7-figure balances reproduce.
  await addManual(
    page,
    'asset',
    'Charles Schwab US Roth Contributory IRA 156',
    'INVESTMENT',
    '1735553.08',
  );
  await addManual(
    page,
    'liability',
    'American Express Delta SkyMiles Platinum Card',
    'OTHER_LIABILITY',
    '997970.24',
  );
  await expect(page.getByTestId('accounts-net-worth')).toBeVisible();
  await assertFitsEveryWidth(page, '/accounts (long names + large balances)');
});

test('/accounts with a long SYNCED account name fits every phone width', async ({ page }) => {
  // The owner's exact failure mode: a synced (LinkedRow) account whose long
  // institution name pushes the balance and Delete control off the right edge.
  const email = await signUpThrowaway(page);
  seedSyncedAccount({
    email,
    name: 'Charles Schwab US Community Property Brokerage 383 (383)',
    type: 'INVESTMENT',
    balanceCents: 89876543,
  });
  seedSyncedAccount({
    email,
    name: 'American Express Additional Delta SkyMiles Platinum Card 20',
    type: 'CREDIT',
    balanceCents: 22544,
  });
  await page.goto('/accounts');
  await expect(
    page.getByTestId('account-row').filter({ hasText: 'Charles Schwab US Community Property' }),
  ).toBeVisible({ timeout: 20_000 });
  await assertFitsEveryWidth(page, '/accounts (long synced name)');
});

test('/transactions with a 7-figure summary fits every phone width', async ({ page }) => {
  // M.3 money-grid fix. The `grid-cols-3` summary strip (Money in / out / Net) put
  // three `formatCents` figures in ~100px columns at 360px. A seeded 7-figure
  // inflow renders "$9,999,999.00" — wider than its track — which pre-fix forced
  // the grid past the viewport edge (a clipped figure is a wrong figure). The fix
  // is `min-w-0` on each cell + `break-words` on the value, so it wraps in place.
  const email = await signUpThrowaway(page);
  seedTransaction({
    email,
    name: 'Big Bank Everyday Checking',
    type: 'CHECKING',
    balanceCents: 999999900,
    amountCents: 999999900, // +$9,999,999.00 inflow
    date: '2026-07-15',
  });
  await page.goto('/transactions');
  await expect(page.getByTestId('summary-in')).toHaveText(/9,999,999/, { timeout: 20_000 });
  // Tailwind `grid-cols-3` is `repeat(3, minmax(0,1fr))`, so the track shrinks and
  // the page never scrolls — but pre-fix the unbreakable "$9,999,999.00" overflows
  // its OWN ~100px cell (overlapping the neighbouring figure: a wrong figure). The
  // fix (`break-words` + `min-w-0`) wraps it in place, so its own scrollWidth no
  // longer exceeds its clientWidth. That is the assertion that fails-old here.
  await assertFitsEveryWidth(page, '/transactions (7-figure summary)');
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: HEIGHT });
    await page.waitForTimeout(50);
    const m = await page.getByTestId('summary-in').evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    expect(
      m.scrollWidth,
      `summary-in @${width}px: the money figure overflows its own cell (scrollWidth ${m.scrollWidth} > clientWidth ${m.clientWidth}) — it overlaps the neighbouring figure instead of wrapping.`,
    ).toBeLessThanOrEqual(m.clientWidth + 1);
  }
});

// Structural regression lock (Wave M.1's deferred "extend the overflow scan to the
// other routes"). Demo data is modest, so most of these do NOT fail-old for the
// money-scale class — their value is catching any unprefixed fixed-width element
// (a w-72 dropdown, a w-40/w-44 input, an unbreakable label) that overflows even at
// demo scale, on the routes the overflow net never covered. This now spans every
// authenticated content route except /accounts (which has its own dedicated tests
// above). Each `ready` testid is an UNCONDITIONAL demo-rendered anchor — chosen over
// count-gated ones so the wait can't hang on an empty state (/goals seeds no goals,
// /triage's demo inbox is empty, /recurring's "coming up" is occurrence-gated).
const DEMO_ROUTES: ReadonlyArray<{ path: string; ready: string }> = [
  { path: '/dashboard', ready: 'cash-needed-card' },
  { path: '/transactions', ready: 'txn-list' },
  { path: '/forecast', ready: 'forecast-hero' },
  { path: '/recurring', ready: 'recurring-hero' },
  { path: '/reports', ready: 'income-expense-chart' },
  { path: '/investments', ready: 'investments-summary' },
  { path: '/spending-plan', ready: 'spending-plan-hero' },
  { path: '/ask', ready: 'ask-input' },
  { path: '/trends', ready: 'trends-movers' },
  { path: '/trust', ready: 'trust-headline' },
  { path: '/coach', ready: 'opportunities-card' },
  { path: '/goals', ready: 'cushion-is-a-goal' },
  { path: '/budgets', ready: 'budget-list' },
  { path: '/calendar', ready: 'cal-month' },
  { path: '/cards', ready: 'toggle-minimum' },
  { path: '/triage', ready: 'accuracy-card' },
  { path: '/settings', ready: 'export-card' },
];

// One sign-in that loops every route, NOT one test per route. Each demo sign-in
// touches the shared demo User row (e.g. lastSeenDate stamping), so 17 routes × 2
// projects as separate tests would add ~34 concurrent demo sessions under 4 workers
// — enough extra SQLite write contention to tip the borderline reload-bearing
// mutation specs (pwa-offline's budget-clear round-trip flaked exactly this way when
// these were separate tests; see playwright.config.ts's worker note + the e2e-flake
// lessons). Looping keeps full coverage at a fraction of the load; the per-route
// `label` in assertFitsEveryWidth's message preserves failure attribution.
// Wave M.3 §a, the deferred half: every control behind a TAP was invisible to the
// sweep above, which only loads routes passively. Measured at 360px before the fix,
// the triage quick-pick grid put "Household & Home" (min-content 108px) in a ~102px
// `grid-cols-3` track — the Button base is `whitespace-nowrap`, so the label painted
// outside its own cell, and a longer user-created category name would run off the
// edge. The page-level gate cannot see this (the bleed lands in the 16px gutter, so
// document scrollWidth never exceeds the viewport), which is why it needs its own
// per-element assertion. A category name is the label on a control that files money.
test('triage quick-pick category names fit their own cells at every phone width', async ({
  page,
}) => {
  const email = await signUpThrowaway(page);
  seedTriageTransaction({ email, descriptor: 'ZZQX LOCAL VENDOR 4471', date: '2026-07-15' });
  await page.goto('/triage');
  await expect(page.getByTestId('triage-inbox')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('triage-more').click();
  const quickPicks = page.getByTestId('triage-alternatives').locator('button');
  await expect(quickPicks.first()).toBeVisible();

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: HEIGHT });
    await page.waitForTimeout(50);
    const measured = await quickPicks.evaluateAll((els) =>
      els.map((el) => ({
        text: (el.textContent ?? '').trim(),
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      })),
    );
    // Guard the FIXTURE, not just the invariant: if the quick picks ever stop
    // including the long name, this test would still pass while measuring only
    // short labels that fit anything — a lock that cannot fail.
    expect(measured.map((m) => m.text)).toContain('Household & Home');
    for (const m of measured) {
      expect(
        m.scrollWidth,
        `triage quick-pick "${m.text}" @${width}px overflows its own cell (scrollWidth ${m.scrollWidth} > clientWidth ${m.clientWidth}) — the category name is clipped or paints over its neighbour.`,
      ).toBeLessThanOrEqual(m.clientWidth + 1);
    }
  }
  // The whole panel must also fit the page at every width.
  await assertFitsEveryWidth(page, '/triage (picker open)');
});

test('every authenticated content route (demo) fits every phone width', async ({ page }) => {
  test.setTimeout(120_000); // 17 routes × 3 widths in one test — legitimately longer.
  await signInDemo(page);
  for (const { path, ready } of DEMO_ROUTES) {
    await page.goto(path);
    await expect(page.getByTestId(ready)).toBeVisible({ timeout: 20_000 });
    await assertFitsEveryWidth(page, `${path} (demo)`);
  }
});
