/**
 * TASKS L.19 — /calendar, the surface whose entire product is a DATED AMOUNT TO PAY.
 *
 * L.18 reached /cards, Ask and /coach. The calendar was left silent, and it is the highest-
 * consequence surface of the set: every row on the grid reads "pay this much on this day", and for a
 * frozen LOAN the stale field is not the amount but the DUE DAY itself — the one thing this page
 * exists to state. `frozenCalendarNotice` builds the disclosure; the unit tests lock its sentences.
 * This locks that it REACHES the page, and — just as importantly — that it stays off the page when
 * the month on screen holds no due event for the frozen account.
 *
 * The abstention half is not decoration here. The notice names accounts, and the reader's only way
 * to act on it is to find the named row on the grid in front of them. A notice rendered on a month
 * whose grid does not carry that row points at nothing, which is the exact defect the "resolve the
 * claim against the events this month actually paints" rule exists to prevent.
 *
 * Throwaway signup users, never the shared demo row (the shared-demo lesson): the demo seed is a
 * fixed golden dataset and a spec that writes into it leaks into whatever runs next.
 */
import Database from 'better-sqlite3';
import { expect, test, type Page } from './helpers/test';
import { E2E_DB_URL } from '../setup/test-db';

/**
 * The e2e server runs with `DEMO_TODAY=2026-06-10` pinned in `.env` (businessToday precedence 1
 * pins EVERY user, not just the demo row) — the same premise `today-feed.spec.ts` and
 * `phase2-triage.spec.ts` are written against. Every date below is chosen relative to it, so the
 * premise is ASSERTED once (`the calendar opens on the pinned month`, below) rather than assumed:
 * if the pin ever moves, that assertion fails loudly instead of these tests failing mysteriously.
 */
const TODAY = '2026-06-10';
const DUE_MONTH = '2026-06';
/** Mid-month on purpose: a business-day rollback can only move a due date EARLIER, and from the
 *  22nd/25th it can never cross back out of the displayed month. */
const CARD_DUE_DATE = '2026-06-25';
const LOAN_DUE_DAY = 22;
/** Three months past the loan's first due month. Pre-C.8 this month's grid could not hold the loan
 *  (`selectLoanObligations` emitted exactly one occurrence); C.8 makes dues REPEAT monthly, so this
 *  month now paints the loan's next payment and the frozen disclosure must follow it there. */
const LATER_MONTH = '2026-09';
/** The only months still quiet after C.8 are the ones BEFORE the first due month: there is no
 *  history to backfill, so nothing is painted and nothing may be qualified. */
const QUIET_MONTH = '2026-05';
const DROPPED_AT = '2026-05-20';

async function signUpThrowaway(page: Page): Promise<string> {
  const email = `e2e-cal-frozen-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
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
  if (!user) throw new Error(`calendar-frozen: user ${email} not found`);
  return user.id;
}

/**
 * A live Chase connection with a healthy checking account and a CREDIT card carrying a real
 * STATEMENT due inside the displayed month, so the grid paints a genuine "pay $X on this day" row.
 * The connection's own `lastSyncedAt` is the pinned today: the BANK is fine, this one account is not
 * — which is exactly the state that made the old silence so convincing.
 *
 * `droppedAt: null` seeds the same fixture wholly LIVE, for the abstention case.
 */
function seedCard(email: string, opts: { cardName: string; droppedAt: string | null }) {
  const db = openDb();
  try {
    const uid = userId(db, email);
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const itemId = `e2e-calf-item-${stamp}`;
    db.prepare(
      `INSERT INTO PlaidItem (id, userId, itemId, accessToken, institution, institutionId, lastSyncedAt, createdAt)
       VALUES (?, ?, ?, 'ciphertext-not-used-by-this-spec', 'Chase', 'ins_56', ?, CURRENT_TIMESTAMP)`,
    ).run(`e2e-calf-pi-${stamp}`, uid, itemId, TODAY);

    const chkId = `e2e-calf-chk-${stamp}`;
    db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, plaidItemId, name, type, mask, currentBalanceCents, currency)
       VALUES (?, ?, 'plaid', ?, ?, 'Everyday Checking', 'CHECKING', '0977', 250000, 'USD')`,
    ).run(chkId, uid, `ref-calf-chk-${stamp}`, itemId);

    const cardId = `e2e-calf-card-${stamp}`;
    db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, plaidItemId, name, type, mask, currentBalanceCents, currency, aprBps, dueDayOfMonth, cycleCloseDayOfMonth, feedDroppedAt)
       VALUES (?, ?, 'plaid', ?, ?, ?, 'CREDIT', '4321', 900000, 'USD', 2399, 25, 31, ?)`,
    ).run(cardId, uid, `ref-calf-card-${stamp}`, itemId, opts.cardName, opts.droppedAt);

    // A real issuer statement, so the dated amount on the grid comes from the STATEMENT rather than
    // from an estimate over the frozen balance — the harder and more common case.
    db.prepare(
      `INSERT INTO Statement (id, accountId, cycleStart, cycleEnd, dueDate, statementBalanceCents, minimumPaymentCents, isEstimated)
       VALUES (?, ?, '2026-05-01', '2026-05-31', ?, 217999, 3500, 0)`,
    ).run(`e2e-calf-stmt-${stamp}`, cardId, CARD_DUE_DATE);

    db.prepare('UPDATE User SET paymentAccountId = ? WHERE id = ?').run(chkId, uid);
    return { cardId, chkId };
  } finally {
    db.close();
  }
}

/**
 * A checking account plus a LOAN the bank has stopped sharing, carrying the two fields
 * `selectLoanObligations` reads: the fixed monthly payment and the due day. No card at all, so the
 * only due event this user can ever put on a grid is the loan's — which is what lets the quiet-month
 * assertion below mean something.
 */
function seedFrozenLoan(email: string, loanName: string) {
  const db = openDb();
  try {
    const uid = userId(db, email);
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const itemId = `e2e-calf-litem-${stamp}`;
    db.prepare(
      `INSERT INTO PlaidItem (id, userId, itemId, accessToken, institution, institutionId, lastSyncedAt, createdAt)
       VALUES (?, ?, ?, 'ciphertext-not-used-by-this-spec', 'Wells Fargo', 'ins_127991', ?, CURRENT_TIMESTAMP)`,
    ).run(`e2e-calf-lpi-${stamp}`, uid, itemId, TODAY);

    const chkId = `e2e-calf-lchk-${stamp}`;
    db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, plaidItemId, name, type, mask, currentBalanceCents, currency)
       VALUES (?, ?, 'plaid', ?, ?, 'Everyday Checking', 'CHECKING', '0977', 850000, 'USD')`,
    ).run(chkId, uid, `ref-calf-lchk-${stamp}`, itemId);

    const loanId = `e2e-calf-loan-${stamp}`;
    db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, plaidItemId, name, type, mask, currentBalanceCents, currency, minimumPaymentCents, dueDayOfMonth, feedDroppedAt)
       VALUES (?, ?, 'plaid', ?, ?, ?, 'LOAN', '5150', 24500000, 'USD', 184250, ?, ?)`,
    ).run(loanId, uid, `ref-calf-loan-${stamp}`, itemId, loanName, LOAN_DUE_DAY, DROPPED_AT);

    db.prepare('UPDATE User SET paymentAccountId = ? WHERE id = ?').run(chkId, uid);
    return { loanId, chkId };
  } finally {
    db.close();
  }
}

/**
 * The case no due row accounts for: every card and loan LIVE, and the FUNDING account — the one
 * `User.paymentAccountId` points at — frozen. Nothing on the grid is stale, so the money-out total
 * and the payment count are perfectly current; what is stale is the balance the "Projected low …
 * transfer $X by DATE to stay covered" line is walked forward from.
 *
 * Balances are chosen so the projection ends with NO dip ($2,500.00 funding against a $2,179.99
 * due), which is the quiet and expensive direction: a balance frozen HIGH prints no dip line at all
 * and reassures the reader into doing nothing.
 */
function seedFrozenFunding(email: string, opts: { checkingName: string; cardName: string }) {
  const db = openDb();
  try {
    const uid = userId(db, email);
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const itemId = `e2e-calf-fitem-${stamp}`;
    db.prepare(
      `INSERT INTO PlaidItem (id, userId, itemId, accessToken, institution, institutionId, lastSyncedAt, createdAt)
       VALUES (?, ?, ?, 'ciphertext-not-used-by-this-spec', 'Chase', 'ins_56', ?, CURRENT_TIMESTAMP)`,
    ).run(`e2e-calf-fpi-${stamp}`, uid, itemId, TODAY);

    // The funding account, and the ONLY frozen row in this fixture.
    const chkId = `e2e-calf-fchk-${stamp}`;
    db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, plaidItemId, name, type, mask, currentBalanceCents, currency, feedDroppedAt)
       VALUES (?, ?, 'plaid', ?, ?, ?, 'CHECKING', '0977', 250000, 'USD', ?)`,
    ).run(chkId, uid, `ref-calf-fchk-${stamp}`, itemId, opts.checkingName, DROPPED_AT);

    // A wholly LIVE card with a real statement, so the grid really does paint a dated due and the
    // money-out total really is non-empty — which is what makes the ABSENT totalNote meaningful.
    const cardId = `e2e-calf-fcard-${stamp}`;
    db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, plaidItemId, name, type, mask, currentBalanceCents, currency, aprBps, dueDayOfMonth, cycleCloseDayOfMonth)
       VALUES (?, ?, 'plaid', ?, ?, ?, 'CREDIT', '4321', 900000, 'USD', 2399, 25, 31)`,
    ).run(cardId, uid, `ref-calf-fcard-${stamp}`, itemId, opts.cardName);
    db.prepare(
      `INSERT INTO Statement (id, accountId, cycleStart, cycleEnd, dueDate, statementBalanceCents, minimumPaymentCents, isEstimated)
       VALUES (?, ?, '2026-05-01', '2026-05-31', ?, 217999, 3500, 0)`,
    ).run(`e2e-calf-fstmt-${stamp}`, cardId, CARD_DUE_DATE);

    db.prepare('UPDATE User SET paymentAccountId = ? WHERE id = ?').run(chkId, uid);
    return { cardId, chkId };
  } finally {
    db.close();
  }
}

/** The notice's text, whitespace-normalized — the same idiom the duplicate-connections calendar
 *  test uses, because the copy wraps across list items. */
async function frozenText(page: Page): Promise<string> {
  const notice = page.getByTestId('calendar-frozen');
  await expect(notice).toBeVisible({ timeout: 20_000 });
  return (await notice.innerText()).replace(/\s+/g, ' ');
}

/** The sentence about the month summary — a figure in its own right, printed above the grid. */
const TOTAL_NOTE = 'These payments are inside the money-out total and the count of payments due above.';

/**
 * The heading, for a single frozen account.
 *
 * NOT "no longer being shared" — that wording collided with the household vocabulary
 * `HouseholdScopeToggle` renders inches above it on this same page, where "shared" means shared
 * between household MEMBERS. It read as "your partner stopped sharing this with you" rather than
 * "the bank stopped sending it". "behind" rather than "on", because the funding account drives the
 * projection without ever painting a row of its own.
 */
const TITLE_ONE = 'One account behind this calendar has stopped updating';

/**
 * The premise every date in this file rests on, asserted rather than assumed. `/calendar` with no
 * `?month=` opens on `today.slice(0, 7)`, so this is a direct read of the server's business today.
 */
test('the calendar opens on the pinned month this spec is written against', async ({ page }) => {
  const email = await signUpThrowaway(page);
  seedCard(email, { cardName: 'Premise Check Card', droppedAt: null });
  await page.goto('/calendar');
  await expect(page.getByTestId('cal-month')).toHaveAttribute('data-month', DUE_MONTH, {
    timeout: 20_000,
  });
});

test('a frozen CARD due this month is disclosed over the grid that dates it', async ({ page }) => {
  const email = await signUpThrowaway(page);
  const cardName = 'Chase Sapphire';
  seedCard(email, { cardName, droppedAt: DROPPED_AT });

  await page.goto(`/calendar?month=${DUE_MONTH}`);

  // The row the notice is ABOUT really is on this grid — without it the disclosure would be
  // pointing at nothing, and every assertion below would pass for the wrong reason.
  await expect(
    page.getByTestId('calendar-list').getByText(`${cardName} due`, { exact: false }).first(),
  ).toBeVisible({ timeout: 20_000 });

  const text = await frozenText(page);
  expect(text).toContain(TITLE_ONE);
  // The per-row sentence still says what happened, in the bank's vocabulary rather than the
  // household's: "Your bank stopped sharing Chase Sapphire on DATE".
  expect(text).toContain('stopped sharing');
  // Named, so the reader can find the row it qualifies — under the label the grid itself paints.
  expect(text).toContain(cardName);
  // The page's rows are instructions ("pay this much on this day"), so the guard rides along.
  expect(text).toContain('Check the card with your bank before paying');

  // THE DATE, not just the amount. Every other surface qualifies only the figure, because a figure
  // is all they print; here the reader's takeaway is "pay this much ON THIS DAY", and the day is as
  // unconfirmed as the money. Worse, the date on the grid may be one the APP produced rather than
  // one any bank sent — `buildObligation` clamps an already-passed due date to today, and for a
  // frozen card no new statement can ever arrive to move it back off today.
  expect(text).toContain('The due date shown for it is taken from the last statement the bank sent');
  expect(text).toContain('a due date that has already passed is shown here as due today');

  // The month summary is its own figure, and it is stated above the grid — so it gets its own claim.
  expect(text).toContain(TOTAL_NOTE);
});

/**
 * THE CENTRAL CASE. A frozen loan is worse here than anywhere else in the app: everywhere else the
 * stale field that bites is an amount, and here the reader is looking at a grid whose whole
 * organising principle is the DATE — and `dueDayOfMonth` is precisely the field the bank stopped
 * confirming on the drop date. The card sentence would be false about it twice over (a loan issues
 * no statement and no payment is ever subtracted), so the loan claim must be its own.
 */
test('a frozen LOAN says its DUE DATE is the last one the bank sent', async ({ page }) => {
  const email = await signUpThrowaway(page);
  const loanName = 'Wells Fargo Mortgage';
  seedFrozenLoan(email, loanName);

  await page.goto(`/calendar?month=${DUE_MONTH}`);

  await expect(
    page.getByTestId('calendar-list').getByText(`${loanName} due`, { exact: false }).first(),
  ).toBeVisible({ timeout: 20_000 });

  const text = await frozenText(page);
  expect(text).toContain(loanName);
  // The claim this page needs and no other builder makes: the DATE is stale, not just the amount.
  expect(text).toContain('the payment amount and due date shown here are the last ones it sent');
  expect(text).toContain('nothing about this loan has been confirmed since');
  // The loan mechanism, not the card one — a reader told a payment they made is missing from a
  // mortgage figure would conclude the reminder is stale and skip the payment.
  expect(text).not.toContain('statement');
  expect(text).toContain(TOTAL_NOTE);
});

/**
 * ABSTENTION, and the reason `frozenCalendarNotice` is resolved against the events the displayed
 * month actually paints rather than against the obligations behind them. The account is still
 * frozen; it simply has no row on THIS month's grid, and a disclosure naming a row the reader
 * cannot see sends them looking for something that is not there.
 *
 * C.8 moved where abstention lives: dues now repeat monthly, so a LATER month paints the loan and
 * the disclosure FOLLOWS it (the frozen fact rides the money, L.14's thesis, onto the synthesized
 * event too). The silent case is now a month BEFORE the first due, which paints nothing.
 */
test('a frozen loan follows its recurring payment into a later month; only a pre-due month is silent', async ({
  page,
}) => {
  const email = await signUpThrowaway(page);
  const loanName = 'Wells Fargo Mortgage';
  seedFrozenLoan(email, loanName);

  // Positive control first, on the SAME user and the SAME account: the fixture really is frozen and
  // really does speak somewhere, so the silence below is abstention rather than a seed that failed.
  await page.goto(`/calendar?month=${DUE_MONTH}`);
  expect(await frozenText(page)).toContain(loanName);

  // C.8: the later month PAINTS the recurring payment, and the disclosure names the frozen loan
  // over it — a reader looking at September's grid is told the amount and day are unconfirmed.
  await page.goto(`/calendar?month=${LATER_MONTH}`);
  await expect(page.getByTestId('cal-month')).toHaveAttribute('data-month', LATER_MONTH, {
    timeout: 20_000,
  });
  await expect(
    page.getByTestId('calendar-list').getByText(`${loanName} due`, { exact: false }).first(),
  ).toBeVisible({ timeout: 20_000 });
  expect(await frozenText(page)).toContain(loanName);

  // The silent case: a month before any due paints nothing, so nothing may be qualified.
  await page.goto(`/calendar?month=${QUIET_MONTH}`);
  await expect(page.getByTestId('cal-month')).toHaveAttribute('data-month', QUIET_MONTH, {
    timeout: 20_000,
  });
  await expect(page.getByTestId('calendar-frozen')).toHaveCount(0);
  // …and this month genuinely carries no due for it, which is why there is nothing to qualify.
  await expect(page.getByText(`${loanName} due`)).toHaveCount(0);
});

/**
 * ABSTENTION, the everyone-else half. A disclosure that renders for every user is noise, and on a
 * page of payment instructions a false hedge is worse than noise: it invites a reader to under-fund
 * a payment that was never in doubt.
 */
test('an all-live user sees no frozen notice on a month full of dues', async ({ page }) => {
  const email = await signUpThrowaway(page);
  const cardName = 'Chase Sapphire';
  seedCard(email, { cardName, droppedAt: null });

  await page.goto(`/calendar?month=${DUE_MONTH}`);

  // The grid is NOT empty — the abstention is about a page that really is printing dated amounts.
  await expect(
    page.getByTestId('calendar-list').getByText(`${cardName} due`, { exact: false }).first(),
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('calendar-frozen')).toHaveCount(0);
});

/**
 * THE SILENT CASE. This page prints one dated instruction that no due row accounts for — "Projected
 * low: $X — transfer $Y by DATE to stay covered" — and it is walked forward from the FUNDING
 * balance, not from any card or loan. With every due row live and only that balance frozen, a
 * builder that resolves its claim purely against the grid's events finds nothing and says nothing.
 *
 * That silence is the expensive direction. A balance frozen HIGH does not print a wrong dip; it
 * prints NO dip, and an absent warning reads as an all-clear. The notice must therefore be able to
 * exist with zero frozen due rows — and, in exactly that state, must NOT claim anything about the
 * money-out total, which is a sum of due rows that are all perfectly current.
 */
test('a frozen FUNDING account speaks even when every due row is live', async ({ page }) => {
  const email = await signUpThrowaway(page);
  const checkingName = 'Everyday Checking';
  const cardName = 'Chase Sapphire';
  seedFrozenFunding(email, { checkingName, cardName });

  await page.goto(`/calendar?month=${DUE_MONTH}`);

  // The grid really is printing a dated due, and that due is LIVE — so the money-out total below is
  // current, and the absence of the total claim is a judgement rather than an empty page.
  await expect(
    page.getByTestId('calendar-list').getByText(`${cardName} due`, { exact: false }).first(),
  ).toBeVisible({ timeout: 20_000 });

  const text = await frozenText(page);
  expect(text).toContain(TITLE_ONE);
  // Named as the reader's own /accounts lists it — the projection's starting point.
  expect(text).toContain(checkingName);
  expect(text).toContain('stopped updating on');
  // The whole reason this case exists: no dip is not evidence of safety.
  expect(text).toContain('no dip here is not evidence that the account is safe');

  // NOT a word about the money-out total: every payment inside it is live, and hedging a current
  // figure is the false-hedge failure this disclosure keeps arguing against.
  expect(text).not.toContain(TOTAL_NOTE);
  // …and the live card is not named, because nothing is wrong with it.
  expect(text).not.toContain(cardName);
});
