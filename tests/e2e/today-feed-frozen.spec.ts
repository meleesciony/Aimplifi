/**
 * TASKS L.20 — the dashboard "Today" feed, which prints the two sharpest INSTRUCTIONS in the app,
 * and the all-clear an undatable frozen loan could never reach.
 *
 * L.19 closed /calendar. This is the surface directly above it in money consequence for a reader
 * who never leaves the dashboard: "About $X short by DATE" and "A transfer of about $X would cover
 * it" are amounts to move, walked forward from a funding balance the bank may have stopped sending.
 *
 * The QUIET case is the one that matters, and it is the first test below. A balance frozen HIGH
 * produces no shortfall and no dip, so both nudges return null and the feed prints "Nothing needs
 * you today." over a projection that cannot see the account it is projecting. Unit tests lock the
 * sentences; this locks that they REACH the page — and that they stay OFF it when nothing is
 * frozen, because a false hedge on an instruction makes a reader under-fund.
 *
 * Throwaway signup users, never the shared demo row (the shared-demo lesson): the demo seed is a
 * fixed golden dataset, and a spec that writes into it leaks into whatever runs next.
 */
import Database from 'better-sqlite3';
import { expect, test, type Page } from './helpers/test';
import { E2E_DB_URL } from '../setup/test-db';

/**
 * The e2e server runs with `DEMO_TODAY=2026-06-10` pinned in `.env` (businessToday precedence 1
 * pins EVERY user, not just the demo row) — the premise `calendar-frozen.spec.ts` and
 * `today-feed.spec.ts` are written against. Asserted once below rather than assumed.
 */
const TODAY = '2026-06-10';
const CARD_DUE_DATE = '2026-06-25';
const DROPPED_AT = '2026-05-20';

const FEED = 'today-feed-card';
const FEED_FROZEN = 'today-feed-frozen';
const SHORTFALL_FROZEN = 'nudge-frozen-cash_needed_shortfall';

async function signUpThrowaway(page: Page): Promise<string> {
  const email = `e2e-feed-frozen-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill('e2e-password-123');
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20_000 });
  return email;
}

function openDb() {
  return new Database(E2E_DB_URL.replace(/^file:/, ''), { timeout: 15_000 });
}

function userId(db: Database.Database, email: string): string {
  const user = db.prepare('SELECT id FROM User WHERE email = ?').get(email) as
    | { id: string }
    | undefined;
  if (!user) throw new Error(`today-feed-frozen: user ${email} not found`);
  return user.id;
}

/**
 * A wholly LIVE card carrying a real issuer statement, plus a checking account that funds it.
 * `checkingCents` decides the whole point of each test: above the statement there is no shortfall
 * and no dip (the quiet case), below it there is a shortfall and the feed prints an instruction.
 *
 * `droppedAt` freezes ONLY the funding account. The card and the connection stay live, and the
 * connection's own `lastSyncedAt` is the pinned today — the bank is fine, this one account is not,
 * which is exactly the state that made the old silence so convincing.
 */
function seedFunding(
  email: string,
  opts: { checkingName: string; checkingCents: number; droppedAt: string | null },
) {
  const db = openDb();
  try {
    const uid = userId(db, email);
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const itemId = `e2e-tff-item-${stamp}`;
    db.prepare(
      `INSERT INTO PlaidItem (id, userId, itemId, accessToken, institution, institutionId, lastSyncedAt, createdAt)
       VALUES (?, ?, ?, 'ciphertext-not-used-by-this-spec', 'Chase', 'ins_56', ?, CURRENT_TIMESTAMP)`,
    ).run(`e2e-tff-pi-${stamp}`, uid, itemId, TODAY);

    const chkId = `e2e-tff-chk-${stamp}`;
    db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, plaidItemId, name, type, mask, currentBalanceCents, currency, feedDroppedAt)
       VALUES (?, ?, 'plaid', ?, ?, ?, 'CHECKING', '0977', ?, 'USD', ?)`,
    ).run(
      chkId,
      uid,
      `ref-tff-chk-${stamp}`,
      itemId,
      opts.checkingName,
      opts.checkingCents,
      opts.droppedAt,
    );

    const cardId = `e2e-tff-card-${stamp}`;
    db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, plaidItemId, name, type, mask, currentBalanceCents, currency, aprBps, dueDayOfMonth, cycleCloseDayOfMonth)
       VALUES (?, ?, 'plaid', ?, ?, 'Freedom Card', 'CREDIT', '4321', 217999, 'USD', 2399, 25, 31)`,
    ).run(cardId, uid, `ref-tff-card-${stamp}`, itemId);

    db.prepare(
      `INSERT INTO Statement (id, accountId, cycleStart, cycleEnd, dueDate, statementBalanceCents, minimumPaymentCents, isEstimated)
       VALUES (?, ?, '2026-05-01', '2026-05-31', ?, 217999, 3500, 0)`,
    ).run(`e2e-tff-stmt-${stamp}`, cardId, CARD_DUE_DATE);

    db.prepare('UPDATE User SET paymentAccountId = ? WHERE id = ?').run(chkId, uid);
    return { chkId, cardId };
  } finally {
    db.close();
  }
}

/**
 * A checking account plus a frozen LOAN carrying NEITHER a due day NOR anything else that could
 * date it. `selectLoanObligations` emits nothing for it, so before L.20 it appeared in no dues
 * list, no reminder and no all-clear — the one row the L.19 qualifier could never be built from.
 */
function seedUndatableFrozenLoan(email: string, loanName: string) {
  const db = openDb();
  try {
    const uid = userId(db, email);
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const itemId = `e2e-tff-litem-${stamp}`;
    db.prepare(
      `INSERT INTO PlaidItem (id, userId, itemId, accessToken, institution, institutionId, lastSyncedAt, createdAt)
       VALUES (?, ?, ?, 'ciphertext-not-used-by-this-spec', 'Wells Fargo', 'ins_127991', ?, CURRENT_TIMESTAMP)`,
    ).run(`e2e-tff-lpi-${stamp}`, uid, itemId, TODAY);

    const chkId = `e2e-tff-lchk-${stamp}`;
    db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, plaidItemId, name, type, mask, currentBalanceCents, currency)
       VALUES (?, ?, 'plaid', ?, ?, 'Everyday Checking', 'CHECKING', '0977', 850000, 'USD')`,
    ).run(chkId, uid, `ref-tff-lchk-${stamp}`, itemId);

    // A real monthly payment, and NO due day — the shape Plaid returns when an issuer reports the
    // loan but never a next payment date. Frozen, so the missing due day cannot arrive on its own.
    const loanId = `e2e-tff-loan-${stamp}`;
    db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, plaidItemId, name, type, mask, currentBalanceCents, currency, minimumPaymentCents, dueDayOfMonth, feedDroppedAt)
       VALUES (?, ?, 'plaid', ?, ?, ?, 'MORTGAGE', '5150', 24500000, 'USD', 184250, NULL, ?)`,
    ).run(loanId, uid, `ref-tff-loan-${stamp}`, itemId, loanName, DROPPED_AT);

    db.prepare('UPDATE User SET paymentAccountId = ? WHERE id = ?').run(chkId, uid);
    return { loanId, chkId };
  } finally {
    db.close();
  }
}

test.describe('TASKS L.20 — the Today feed and a frozen funding balance', () => {
  test('THE QUIET CASE: frozen high, nothing fires, and the feed says so', async ({ page }) => {
    const email = await signUpThrowaway(page);
    // $2,500.00 funding against a $2,179.99 statement: covered, so there is no shortfall and no
    // dip. Before L.20 this page printed "Nothing needs you today." and nothing else.
    seedFunding(email, {
      checkingName: 'Everyday Checking',
      checkingCents: 250_000,
      droppedAt: DROPPED_AT,
    });
    await page.goto('/dashboard');

    const feed = page.getByTestId(FEED);
    await expect(feed).toBeVisible();
    // The premise: pinned today, so the seeded dates mean what they are chosen to mean.
    await expect(page.getByTestId('cash-needed-card')).toContainText('$2,179.99');

    const note = page.getByTestId(FEED_FROZEN);
    await expect(note).toBeVisible();
    await expect(note).toContainText('Everyday Checking');
    await expect(note).toContainText(
      'if neither has flagged a problem, that silence rests on a figure we cannot refresh',
    );
    // It qualifies an absence — it must not borrow the projection sentence, which would name a
    // projection this feed does not render.
    await expect(note).not.toContainText('This projection');
  });

  test('when a shortfall DOES fire, the row carries the note and the feed does not repeat it', async ({
    page,
  }) => {
    const email = await signUpThrowaway(page);
    // $300.00 against the same $2,179.99 statement: a real shortfall, so the feed prints an
    // instruction — and the qualifier belongs on that row, not floating above the ranked list.
    seedFunding(email, {
      checkingName: 'Everyday Checking',
      checkingCents: 30_000,
      droppedAt: DROPPED_AT,
    });
    await page.goto('/dashboard');

    await expect(page.getByTestId('nudge-cash_needed_shortfall')).toBeVisible();
    const rowNote = page.getByTestId(SHORTFALL_FROZEN);
    await expect(rowNote).toBeVisible();
    await expect(rowNote).toContainText('Everyday Checking');
    // The instruction guard: this is an amount to MOVE, so the reader is told it is a floor.
    await expect(rowNote).toContainText('Treat the amount as a floor and check the account first.');
    await expect(rowNote).toContainText('understates what you need to move');
    // Exclusive: the sentence appears once, attached to the claim it qualifies.
    await expect(page.getByTestId(FEED_FROZEN)).toHaveCount(0);
  });

  test('ABSTENTION: a live funding balance produces no note anywhere on the feed', async ({
    page,
  }) => {
    const email = await signUpThrowaway(page);
    seedFunding(email, {
      checkingName: 'Everyday Checking',
      checkingCents: 30_000,
      droppedAt: null,
    });
    await page.goto('/dashboard');

    // The shortfall itself still fires — this asserts the hedge is gated on the frozen fact and
    // not on the instruction being present, which is the false-hedge direction.
    await expect(page.getByTestId('nudge-cash_needed_shortfall')).toBeVisible();
    await expect(page.getByTestId(SHORTFALL_FROZEN)).toHaveCount(0);
    await expect(page.getByTestId(FEED_FROZEN)).toHaveCount(0);
  });

  test('an UNDATABLE frozen loan finally reaches the all-clear', async ({ page }) => {
    const email = await signUpThrowaway(page);
    seedUndatableFrozenLoan(email, 'Home Mortgage');
    await page.goto('/dashboard');

    const card = page.getByTestId('payment-reminders-card');
    await expect(card).toBeVisible();
    // The positive half is still stated, then narrowed — never replaced (L.19 critic P2-2).
    await expect(card).toContainText('You’re all caught up');
    await expect(card).toContainText('Home Mortgage');
    // This fixture holds a $1,842.50 payment and no due day, so the sentence must name the due
    // date as the thing we lack and NOT deny holding the payment (L.20 critic cycle, B-2).
    await expect(card).toContainText('we hold no due date for it');
    await expect(card).not.toContainText('no due date and no payment amount');
    // Not the datable-loan wording, which would describe a stored due date it does not have.
    await expect(card).not.toContainText('a change to its payment or due date since');
  });

  test('the undatable loan is still named when another payment IS due', async ({ page }) => {
    // The gap all three L.20 critics found independently: `frozenAllClear` was interpolated only
    // into the empty branch, and an `undatable-loan` can never be a reminder — so one unrelated
    // card being due removed the mortgage from the only sentence that ever named it. The mixed
    // case is the likelier one and the cost is a missed mortgage payment.
    const email = await signUpThrowaway(page);
    seedUndatableFrozenLoan(email, 'Home Mortgage');
    // A wholly LIVE card with a real statement due 2026-06-25, funded well above it: the dues list
    // is non-empty and nothing else on the page is frozen, so the only thing that can speak about
    // the mortgage is the branch this test exists for.
    seedFunding(email, {
      checkingName: 'Everyday Checking',
      checkingCents: 250_000,
      droppedAt: null,
    });
    await page.goto('/dashboard');

    const card = page.getByTestId('payment-reminders-card');
    await expect(card).toBeVisible();
    // The list is non-empty — this is the branch that used to say nothing at all.
    await expect(card).toContainText('Upcoming card & loan payments this cycle');
    await expect(card).toContainText('Home Mortgage');
    await expect(card).toContainText('we hold no due date for it');
    // The all-clear wording must NOT appear — there is something due, and the claim being made is
    // narrower: this list is incomplete, not empty.
    await expect(card).not.toContainText('You’re all caught up');
  });
});
