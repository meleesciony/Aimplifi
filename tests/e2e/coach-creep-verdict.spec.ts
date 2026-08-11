/**
 * O.20g — the Lifestyle-creep card has THREE verdicts, and the third one is the
 * whole point of the slice: a window the app cannot compare used to render as
 * "Tracking income … no lifestyle drift detected", a false all-clear over an
 * income series that may not exist.
 *
 * The refusal rule under test: the first-half income median must be positive AND
 * at least the first-half discretionary-spending median. It is deliberately NOT
 * a count of months carrying an income row — that rule was built first and two
 * fresh-context critics broke it from opposite sides (8 cents of monthly savings
 * interest satisfies a coverage count while the reader's payroll account is
 * unlinked; and a median of three is unmoved by ONE missing month, so vetoing on
 * a single gap silences a correct figure for anyone paid ten months a year).
 * This spec pins both directions.
 *
 * The demo cannot reach the refusal. Its seed pays income in every window month
 * (first-half median $5,280.00 against ~$1,236.40 of discretionary spending), so
 * the demo is permanently in the MEASURED half of the branch — which is why the
 * state needs a throwaway user, and why the demo makes the anti-vacuity control:
 * the same page, the same component, the other verdict.
 *
 * The unit suite locks the engine rule and the composer's three-way selection.
 * What no pure test can see is the SHIPPED wiring: that the page renders the
 * composed title, body and link together, and that the Money Review beside it
 * keeps its watch line — the first cut of this slice dropped that line entirely,
 * silently shrinking the recap to two, and no unit test could see it.
 *
 * The e2e server pins DEMO_TODAY=2026-06-10 for EVERY user, so the compared
 * window is 2025-12 … 2026-05 for the throwaway user too — the fixture is built
 * at the server's today, not the wall clock.
 */
import Database from 'better-sqlite3';
import { expect, test, type Page } from './helpers/test';
import { E2E_DB_URL } from '../setup/test-db';

/** The six full months before the pinned DEMO_TODAY=2026-06-10. */
const WINDOW = ['2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05'] as const;

async function signUpThrowaway(page: Page, tag: string): Promise<string> {
  const email = `e2e-creep-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill('e2e-password-123');
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20_000 });
  return email;
}

function openDb() {
  return new Database(E2E_DB_URL.replace(/^file:/, ''), {
    timeout: Number(process.env.SQLITE_BUSY_TIMEOUT_MS) || 15_000,
  });
}

/**
 * Seeds a checking account plus per-month income and discretionary spending.
 *
 * `incomeCentsPerMonth` is the only knob the two tests differ on: 8 cents of
 * savings interest (the unreadable-income reader) versus a real paycheck with
 * one month missing (the ten-month-a-year reader).
 */
function seedCreepFixture(
  email: string,
  incomeByMonth: Record<string, { cents: number; categoryId: string }>,
) {
  const db = openDb();
  try {
    const user = db.prepare('SELECT id FROM User WHERE email = ?').get(email) as { id: string } | undefined;
    if (!user) throw new Error(`seedCreepFixture: user ${email} not found`);
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

    const checkingId = `e2e-chk-${stamp}`;
    db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, name, type, mask, currentBalanceCents, currency)
       VALUES (?, ?, 'manual', ?, 'Everyday Checking', 'CHECKING', '0977', 500000, 'USD')`,
    ).run(checkingId, user.id, `ref-chk-${stamp}`);

    // "Transaction" is a SQLite reserved word — quote it or prepare() fails.
    const txn = db.prepare(
      `INSERT INTO "Transaction" (id, accountId, date, amountCents, rawDescriptor, categoryId, status, isTransfer, isSplitParent)
       VALUES (?, ?, ?, ?, ?, ?, 'POSTED', 0, 0)`,
    );
    WINDOW.forEach((month, i) => {
      const income = incomeByMonth[month];
      if (income) {
        txn.run(`e2e-inc-${i}-${stamp}`, checkingId, `${month}-05`, income.cents, 'E2E INCOME', income.categoryId);
      }
      // Discretionary spending in every month, $1,000 → $2,500 across the halves
      // so the SPEND side is unambiguously measurable and growing 150%.
      //
      // The merchant and the day VARY deliberately. An identical charge at an
      // identical payee on the same day of six consecutive months is a textbook
      // recurring series, and the first version of this fixture was detected as
      // one — with a $1,500/mo price increase, which correctly outranks the
      // creep line in the recap's watch role (`watch-price-increase` is first in
      // the floor's chain) and made the assertion below fail on a page that was
      // behaving exactly as designed. The creep bar counts by CATEGORY, so
      // varying the payee changes nothing this test is about.
      txn.run(
        `e2e-buy-${i}-${stamp}`,
        checkingId,
        `${month}-${String(6 + i * 3).padStart(2, '0')}`,
        i < 3 ? -100_000 : -250_000,
        `E2E STORE ${String.fromCharCode(65 + i)}`,
        'shopping',
      );
    });
  } finally {
    db.close();
  }
}

test('income the app cannot really see refuses the comparison instead of printing an all-clear', async ({
  page,
}) => {
  const email = await signUpThrowaway(page, 'refuse');
  // 8 cents of savings interest every month. A rule counting months with an
  // income ROW would call this fully covered and let the card assert a verdict.
  seedCreepFixture(
    email,
    Object.fromEntries(WINDOW.map((m) => [m, { cents: 8, categoryId: 'interest-income' }])),
  );
  await page.goto('/coach');

  await expect(page.getByTestId('creep-card')).toBeVisible();
  await expect(page.getByTestId('creep-title')).toHaveText("Can't compare yet");

  const verdict = page.getByTestId('creep-verdict');
  // It states the side it CAN measure …
  await expect(verdict).toContainText('Typical discretionary spending grew ~150.0%');
  // … prints the two figures the refusal rests on, so the reader can check it …
  await expect(verdict).toContainText('$0.08 a month of income against $1,000.00 a month of discretionary spending');
  // … and names the likely cause without asserting it.
  await expect(verdict).toContainText('not that you earned nothing');

  // ANTI-VACUITY, the direction that matters: neither claim this state may not
  // make can be on the page. Before this slice both were — spending grew 150%
  // against an 8-cent income and the page said "no lifestyle drift detected".
  await expect(verdict).not.toContainText('no lifestyle drift detected');
  await expect(verdict).not.toContainText('tracking income growth');
  // Nor may the unmeasured figure itself be printed: a card headed "Can't
  // compare yet" that opens with a six-figure percentage refutes itself.
  await expect(verdict).not.toContainText('Typical income');

  // The Money Review beside it keeps its watch line. The first cut of this slice
  // added the new candidate id and left the deterministic floor's watch chain
  // alone, so this line VANISHED and the recap silently rendered two rows.
  await expect(page.getByTestId('review-creep')).toContainText("What we can't tell yet");
  await expect(page.getByTestId('review-creep')).not.toContainText('no lifestyle drift detected');

  // The control opens the register for the side that is missing, with a label
  // that does not assert a definition the register does not implement
  // (`type=income` there is a SIGN filter, not the engine's income predicate).
  const link = page.getByTestId('coach-creep-link');
  await expect(link).toHaveText('See the money coming in on your activity');
  await expect(link).toHaveAttribute('href', '/transactions?type=income');

  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.reload();
  await expect(page.getByTestId('creep-title')).toHaveText("Can't compare yet");
  expect(errors).toEqual([]);
});

test('a single missing income month does NOT refuse — the median was already robust to it', async ({
  page,
}) => {
  const email = await signUpThrowaway(page, 'gap');
  // A real $5,000 paycheck in five of six months. The ten-month-a-year reader:
  // a coverage-count rule would silence this window every year; the median of
  // [5000, 5000, 0] is still $5,000, so the figure is sound and must stand.
  const income = Object.fromEntries(
    WINDOW.filter((m) => m !== '2026-02').map((m) => [m, { cents: 500_000, categoryId: 'paycheck' }]),
  );
  seedCreepFixture(email, income);
  await page.goto('/coach');

  await expect(page.getByTestId('creep-title')).toHaveText('Spending is outpacing income');
  await expect(page.getByTestId('creep-verdict')).toContainText('not a verdict');
  await expect(page.getByTestId('creep-verdict')).toContainText('spending grew ~150.0%');
  await expect(page.getByTestId('creep-verdict')).toContainText('income was flat');
  await expect(page.getByTestId('coach-creep-link')).toHaveAttribute('href', '/transactions?type=expense');
});

test('the demo — a real income baseline — still gets a measured verdict from the same component', async ({
  page,
}) => {
  // The control. If this went to "Can't compare yet" too, the tests above would
  // be asserting a page that says one thing to everybody.
  await page.goto('/');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');
  await page.goto('/coach');

  await expect(page.getByTestId('creep-title')).toHaveText('Spending is outpacing income');
  await expect(page.getByTestId('creep-verdict')).toContainText('not a verdict');
  // The demo's income is genuinely flat across the window (first-half median
  // $5,280.00, second-half the same) — a MEASURED zero, which reads as "flat"
  // rather than as a growth figure of "0.0%".
  await expect(page.getByTestId('creep-verdict')).toContainText('income was flat');
  await expect(page.getByTestId('creep-verdict')).not.toContainText('grew ~-');
  await expect(page.getByTestId('coach-creep-link')).toHaveAttribute('href', '/transactions?type=expense');
});
