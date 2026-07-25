/**
 * TASKS L.14 — the claim under the disclosure, driven against the REAL sums.
 *
 * Both fresh-context critics landed the same test finding: every copy test in this slice is a
 * PURE-BUILDER test, so the suite was green while the central sentence — "that last balance is
 * still counted wherever Aimplifi adds up your accounts" — was false on at least one surface. A
 * builder cannot catch a wiring bug (the L.15 lesson, repeated here), so this file asserts the
 * claim itself: real rows, real Prisma, real totals.
 *
 * If a future change starts excluding a feed-dropped row from a total, this file goes red and the
 * shipped copy has to change with it. That is the whole point — the sentence and the arithmetic
 * are locked together.
 *
 * It also locks the two P0s the critics found, both of which were cases where the app announced a
 * number as counted while something upstream had already removed it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { isoDate } from '@/lib/dates';
import { computeRadar, type RadarInput } from '@/lib/engine/radar/radar';
import { computeCashNeeded } from '@/lib/engine/cash-needed/engine';
import { cents } from '@/lib/money';
import { holidayTable } from '@/lib/dates';
import { prisma } from '@/lib/db';
import { getAccountsView, getFeedDroppedAccounts } from '@/server/transactions';

const USER = `l14-int-${Date.now()}-${process.pid}`;
const DROPPED_AT = '2026-07-19';

let checkingId = '';
let frozenSavingsId = '';

describe('a feed-dropped row is STILL COUNTED — the sentence, against the arithmetic', () => {
  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { id: USER } });
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
    const chk = await prisma.account.create({
      data: {
        userId: USER,
        provider: 'plaid',
        providerRef: `${USER}-chk`,
        name: 'Everyday Checking',
        type: 'CHECKING',
        currency: 'USD',
        currentBalanceCents: 250_000,
      },
    });
    checkingId = chk.id;
    const sav = await prisma.account.create({
      data: {
        userId: USER,
        provider: 'plaid',
        providerRef: `${USER}-sav`,
        name: 'Rainy Day Savings',
        type: 'SAVINGS',
        currency: 'USD',
        currentBalanceCents: 421_055,
        feedDroppedAt: DROPPED_AT,
      },
    });
    frozenSavingsId = sav.id;
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: USER } });
  });

  it('the dashboard announces the frozen account', async () => {
    const dropped = await getFeedDroppedAccounts(USER);
    expect(dropped.map((d) => d.name)).toEqual(['Rainy Day Savings']);
    expect(dropped[0].currentBalanceCents).toBe(421_055);
  });

  it('…and net worth really does include it: $2,500.00 + $4,210.55 = $6,710.55', async () => {
    // The arithmetic the sentence promises. Not a builder — `getAccountsView` runs the real
    // grouping engine over real rows, through the reconciliation boundary and currency guard.
    const view = await getAccountsView(USER);
    expect(view.netWorthCents).toBe(671_055);
  });

  it('…and the ASSETS subtotal on /accounts includes it too', async () => {
    const view = await getAccountsView(USER);
    expect(view.assets.subtotalCents).toBe(671_055);
    expect(view.assets.accounts.map((a) => a.id)).toContain(frozenSavingsId);
  });

  it('…and the row still renders, carrying its stamp and its bank’s liveness', async () => {
    const view = await getAccountsView(USER);
    const row = view.assets.accounts.find((a) => a.id === frozenSavingsId)!;
    expect(row.feedDroppedAt).toBe(DROPPED_AT);
    expect(row.currentBalanceCents).toBe(421_055);
    // No PlaidItem was created for this fixture, so the bank reads as disconnected and the note
    // must offer the connect-again remedy rather than a re-tick control that is not on the page.
    expect(row.connectionLive).toBe(false);
  });

  it('a still-shared sibling is not announced', async () => {
    const dropped = await getFeedDroppedAccounts(USER);
    expect(dropped.map((d) => d.id)).not.toContain(checkingId);
  });
});

describe('critic P0-1 — a superseded predecessor is not announced as counted', () => {
  const U2 = `${USER}-sup`;
  let predId = '';

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { id: U2 } });
    await prisma.user.create({ data: { id: U2, email: `${U2}@test.local` } });
    const pred = await prisma.account.create({
      data: {
        userId: U2,
        provider: 'plaid',
        providerRef: `${U2}-pred`,
        name: 'Old Chase Savings',
        type: 'SAVINGS',
        currency: 'USD',
        currentBalanceCents: 421_055,
        feedDroppedAt: DROPPED_AT,
      },
    });
    predId = pred.id;
    const succ = await prisma.account.create({
      data: {
        userId: U2,
        provider: 'plaid',
        providerRef: `${U2}-succ`,
        name: 'Chase Savings',
        type: 'SAVINGS',
        currency: 'USD',
        currentBalanceCents: 430_000,
      },
    });
    await prisma.accountReconciliation.create({
      data: {
        userId: U2,
        predecessorAccountId: predId,
        successorAccountId: succ.id,
        cutoverDate: '2026-07-20',
        matchSignal: 'mask',
        confidence: 'high',
        confirmedByUserAt: new Date(),
      },
    });
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: U2 } });
  });

  it('stays silent about a row the boundary has already zeroed and hidden', async () => {
    // Executed by the critic: the banner quoted a real $4,210.55 as "still counted" while the
    // reconciliation boundary had zeroed it (contributing $0) and /accounts had folded the row
    // into "Combined accounts" — so it also sent the reader to a page where the row is not shown.
    // That pairing is the journey this very disclosure provokes: freeze → re-add the bank →
    // disconnect the old one → accept "Continue this account".
    const dropped = await getFeedDroppedAccounts(U2);
    expect(dropped.map((d) => d.id)).not.toContain(predId);
    expect(dropped).toEqual([]);
  });
});

describe('critic P0-2 — a frozen balance is never offered as money to move', () => {
  const TODAY = isoDate('2026-07-25');
  const base: Omit<RadarInput, 'accounts'> = {
    today: TODAY,
    horizonDays: 90,
    startingBalanceCents: cents(10_000),
    committedEvents: [
      { date: isoDate('2026-07-28'), amountCents: cents(-480_000), label: 'Sapphire' },
    ],
    cardDues: [],
    paymentAccountId: 'chk',
    holidays: holidayTable(2026, 2027),
    burn: null,
    assumptions: [],
  };

  it('withholds the frozen savings account, and says why', () => {
    const out = computeRadar({
      ...base,
      accounts: [
        { id: 'chk', name: 'Everyday Checking', type: 'CHECKING', currentBalanceCents: 10_000, feedDroppedAt: null },
        { id: 'sav', name: 'Rainy Day Savings', type: 'SAVINGS', currentBalanceCents: 900_000, feedDroppedAt: DROPPED_AT },
      ],
    });
    // It would have sorted FIRST (largest balance) and been stamped `sufficient: true` from a
    // number the app knows is frozen — on the one surface that says "move $X from Y". Acting on
    // it means a transfer that bounces and a card payment that overdrafts.
    expect(out.coverTransfer?.sources.map((s) => s.id) ?? []).not.toContain('sav');
    expect(out.assumptions.join(' ')).toContain('Rainy Day Savings is not offered as a source');
    expect(out.assumptions.join(' ')).toContain(DROPPED_AT);
  });

  it('still offers a healthy account, so the guard did not just disable the feature', () => {
    const out = computeRadar({
      ...base,
      accounts: [
        { id: 'chk', name: 'Everyday Checking', type: 'CHECKING', currentBalanceCents: 10_000, feedDroppedAt: null },
        { id: 'sav', name: 'Rainy Day Savings', type: 'SAVINGS', currentBalanceCents: 900_000, feedDroppedAt: null },
      ],
    });
    expect(out.coverTransfer?.sources.map((s) => s.id)).toContain('sav');
    expect(out.assumptions.join(' ')).not.toContain('is not offered as a source');
  });
});

describe('critic F-1 — the payment account itself can be frozen', () => {
  const TODAY = isoDate('2026-07-25');
  const input = (frozenSince: string | null) => ({
    today: TODAY,
    paymentAccount: { name: 'Everyday Checking', balanceCents: cents(600_000), pending: [], frozenSince },
    cards: [],
    scheduled: [],
    scenario: 'PAY_IN_FULL' as const,
    holidayTable: holidayTable(2026, 2027),
  });

  it('says the projection rests on a balance that has stopped updating', () => {
    // The finding both critics reached independently, and the deepest one: this slice argued its
    // "keep counting, just say so" stance over LIABILITIES, where a stale card balance merely
    // over-funds. For the funding ASSET the direction inverts — a balance frozen HIGH reports
    // shortfall $0 and no transfer recommendation while the real account cannot cover the autopay,
    // which is the exact missed payment the reasoning set out to avoid.
    const out = computeCashNeeded(input('2026-07-04'));
    const said = out.assumptions.join(' ');
    expect(said).toContain('Everyday Checking');
    expect(said).toContain('has not updated since 2026-07-04');
    expect(said).toContain('your bank stopped sharing that account');
  });

  it('says nothing of the kind for a healthy funding account', () => {
    const out = computeCashNeeded(input(null));
    expect(out.assumptions.join(' ')).not.toContain('has not updated since');
  });

  it('does NOT adjust the balance — inventing a lower one would fabricate', () => {
    const frozen = computeCashNeeded(input('2026-07-04'));
    const healthy = computeCashNeeded(input(null));
    expect(frozen.headline.requiredCents).toBe(healthy.headline.requiredCents);
    expect(frozen.headline.shortfallCents).toBe(healthy.headline.shortfallCents);
  });
});
