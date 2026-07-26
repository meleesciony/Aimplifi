/**
 * test_regression__household_nickname_leak (TASKS L.7, found by a fresh-context critic).
 *
 * A nickname is a label its author typed for HIMSELF. Sharing an account with a household
 * shares its money, not the words he chose in private — so at household scope the viewer must
 * see the BANK's name for a partner's row, on every surface, while still seeing his own
 * nicknames on his own rows.
 *
 * The first version of L.7 resolved the label inside the engines (`assemble.ts`,
 * `loans/obligations.ts`), which sit downstream of the household merge — so a partner's
 * `displayName` rode his shared rows into the viewer's cash-needed answer and printed there.
 * Locked here against the REAL server path (`getCashNeeded` / `getDashboardData` over real
 * Prisma rows), not against a pure builder, because the leak was a property of the wiring.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// The session IS the viewer for the household surfaces below (`requireViewer` → `auth()`), so
// it resolves to the OWNER — the member who must NOT see his partner's private names.
vi.mock('@/auth', () => ({ auth: async () => ({ user: { id: OWNER } }), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { prisma } = await import('@/lib/db');
const { getCashNeeded, getDashboardData } = await import('@/server/finance');

const STAMP = `${Date.now()}-${process.pid}`;
const OWNER = `hh-nick-owner-${STAMP}`;
const PARTNER = `hh-nick-partner-${STAMP}`;

/** What the partner typed in private. Must never appear at household scope. */
const PARTNER_CARD_NICKNAME = 'Divorce lawyer card';
const PARTNER_LOAN_NICKNAME = "Mom's secret loan";
/** What his bank sends. This is what the viewer may see. */
const PARTNER_CARD_FEED_NAME = 'CREDIT CARD';
const PARTNER_LOAN_FEED_NAME = 'AUTO LOAN';
/** The viewer's own nickname, which he keeps at every scope. */
const OWNER_CARD_NICKNAME = 'My everyday card';

let partnerCardId = '';
let ownerCardId = '';

async function wipe() {
  const members = await prisma.householdMember.findMany({
    where: { userId: { in: [OWNER, PARTNER] } },
    select: { householdId: true },
  });
  await prisma.household.deleteMany({ where: { id: { in: members.map((m) => m.householdId) } } });
  await prisma.user.deleteMany({ where: { id: { in: [OWNER, PARTNER] } } });
}

beforeAll(async () => {
  await wipe().catch(() => {});
  await prisma.user.create({ data: { id: OWNER, email: `${OWNER}@test.local`, name: 'owner' } });
  await prisma.user.create({ data: { id: PARTNER, email: `${PARTNER}@test.local`, name: 'partner' } });
  await prisma.household.create({
    data: {
      name: `Casa ${STAMP}`,
      members: {
        create: [
          { userId: OWNER, role: 'owner' },
          { userId: PARTNER, role: 'partner' },
        ],
      },
    },
  });

  const checking = await prisma.account.create({
    data: {
      userId: OWNER, provider: 'demo', name: 'Owner Checking', type: 'CHECKING',
      currentBalanceCents: 500_000, currency: 'USD',
    },
  });
  await prisma.user.update({ where: { id: OWNER }, data: { paymentAccountId: checking.id } });

  // The viewer's OWN card, renamed by him.
  const ownCard = await prisma.account.create({
    data: {
      userId: OWNER, provider: 'demo', name: 'VISA', displayName: OWNER_CARD_NICKNAME,
      type: 'CREDIT', currentBalanceCents: 20_000, currency: 'USD',
      dueDayOfMonth: 20, cycleCloseDayOfMonth: 1,
    },
  });
  ownerCardId = ownCard.id;
  await prisma.statement.create({
    data: {
      accountId: ownerCardId, cycleStart: '2026-06-01', cycleEnd: '2026-06-01', dueDate: '2026-07-20',
      statementBalanceCents: 20_000, minimumPaymentCents: 2_000,
    },
  });

  // The PARTNER's shared card and loan, both renamed by him with something private.
  const partnerCard = await prisma.account.create({
    data: {
      userId: PARTNER, provider: 'demo', name: PARTNER_CARD_FEED_NAME, displayName: PARTNER_CARD_NICKNAME,
      type: 'CREDIT', currentBalanceCents: 40_000, currency: 'USD',
      dueDayOfMonth: 20, cycleCloseDayOfMonth: 1, sharedToHousehold: true,
    },
  });
  partnerCardId = partnerCard.id;
  await prisma.statement.create({
    data: {
      accountId: partnerCardId, cycleStart: '2026-06-01', cycleEnd: '2026-06-01', dueDate: '2026-07-20',
      statementBalanceCents: 40_000, minimumPaymentCents: 4_000,
    },
  });
  await prisma.account.create({
    data: {
      userId: PARTNER, provider: 'demo', name: PARTNER_LOAN_FEED_NAME, displayName: PARTNER_LOAN_NICKNAME,
      type: 'LOAN', currentBalanceCents: 900_000, currency: 'USD',
      dueDayOfMonth: 5, minimumPaymentCents: 45_000, sharedToHousehold: true,
    },
  });
});

afterAll(wipe);

describe('a nickname never crosses to another household member', () => {
  it('household-scope cash-needed names a partner card and loan by the BANK name', async () => {
    const hh = await getCashNeeded(OWNER, 'PAY_IN_FULL', 'household');

    const everyLabel = [
      ...hh.result.cards.map((c) => c.cardName),
      ...hh.result.unknownDueDateCards.map((c) => c.cardName),
      ...hh.loanObligations.map((l) => l.accountName),
      ...hh.undatableFrozenLoans.map((l) => l.accountName),
      hh.input.paymentAccount.name,
    ];
    expect(everyLabel).not.toContain(PARTNER_CARD_NICKNAME);
    expect(everyLabel).not.toContain(PARTNER_LOAN_NICKNAME);

    // …and it is not that the rows are missing: the partner's money IS in the answer, under
    // the name his bank sends. (An assertion that only proved absence would also pass if the
    // household merge had silently stopped working.)
    const partnerCard = hh.result.cards.find((c) => c.cardId === partnerCardId);
    expect(partnerCard?.cardName).toBe(PARTNER_CARD_FEED_NAME);
    expect(hh.loanObligations.map((l) => l.accountName)).toContain(PARTNER_LOAN_FEED_NAME);
  });

  it('the viewer keeps his OWN nickname at household scope', async () => {
    const hh = await getCashNeeded(OWNER, 'PAY_IN_FULL', 'household');
    const ownCard = hh.result.cards.find((c) => c.cardId === ownerCardId);
    expect(ownCard?.cardName).toBe(OWNER_CARD_NICKNAME);
  });

  it('the dashboard at household scope leaks neither nickname, on cards or reminders', async () => {
    const d = await getDashboardData(OWNER, 'household');
    const everyLabel = [
      ...d.payInFull.cards.map((c) => c.cardName),
      ...d.reminders.map((r) => r.accountName),
    ];
    expect(everyLabel).not.toContain(PARTNER_CARD_NICKNAME);
    expect(everyLabel).not.toContain(PARTNER_LOAN_NICKNAME);
    expect(everyLabel).toContain(PARTNER_CARD_FEED_NAME);
    // His own row still reads the way he named it, on the same screen.
    expect(d.payInFull.cards.map((c) => c.cardName)).toContain(OWNER_CARD_NICKNAME);
  });

  it('the shared register names a partner account by the bank name too', async () => {
    // `getSharedTransactionsView` carries a four-line privacy comment and had nothing asserting
    // it. Driven through the real viewer path.
    const { getSharedTransactionsView } = await import('@/server/household');
    const txnDate = '2026-06-15';
    const account = await prisma.account.findFirstOrThrow({
      where: { userId: PARTNER, type: 'CREDIT' },
      select: { id: true },
    });
    await prisma.transaction.create({
      data: {
        accountId: account.id, date: txnDate, amountCents: -1234,
        rawDescriptor: 'HH NICKNAME PROBE', status: 'posted',
      },
    });
    const view = await getSharedTransactionsView();
    const names = view.kind === 'member' ? view.rows.map((r) => r.accountName) : [];
    expect(names).not.toContain(PARTNER_CARD_NICKNAME);
    expect(names).toContain(PARTNER_CARD_FEED_NAME);
  });

  it('personal scope is unaffected: the partner sees his own nicknames', async () => {
    const own = await getCashNeeded(PARTNER, 'PAY_IN_FULL', 'mine');
    const labels = [
      ...own.result.cards.map((c) => c.cardName),
      ...own.result.unknownDueDateCards.map((c) => c.cardName),
      ...own.loanObligations.map((l) => l.accountName),
      ...own.undatableFrozenLoans.map((l) => l.accountName),
    ];
    expect(labels).toContain(PARTNER_CARD_NICKNAME);
    expect(labels).toContain(PARTNER_LOAN_NICKNAME);
  });
});
