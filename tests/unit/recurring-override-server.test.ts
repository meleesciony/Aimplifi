/**
 * The recurring verdict through the server (TASKS O.13f / O.15 slice 4).
 *
 * `recurring-override.test.ts` proves the pure rules. What a pure test cannot see
 * is the thing this slice actually promises the reader: **say it once, and every
 * surface honours it** — which is a claim about a stored row reaching five
 * independent detection sites and, through the projection rebuild, the cash
 * surfaces that read stored `ScheduledTransaction` rows instead of detecting at all.
 *
 * So these tests drive the real actions against a real database and then ask the
 * READ paths what they now say: `getRecurring` (the page), and the stored scheduled
 * rows (the calendar / forecast / spending-plan basis). The demotion tests are the
 * sharper half — a false detection the reader cannot remove everywhere is not
 * removed at all.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { isoDate } from '@/lib/dates';
import { DEMO_USER_ID } from '@/lib/demo-user';
import {
  clearRecurringVerdict,
  markMerchantNotABill,
  markTransactionAsBill,
} from '@/server/recurring-override-actions';
import {
  VERDICT_BLOCKED_AGGREGATE,
  VERDICT_BLOCKED_SPLIT_PARENT,
  VERDICT_BLOCKED_TRANSFER,
} from '@/lib/engine/recurring/override';
import {
  getRecurringOverrides,
  getRecurringVerdictForTransaction,
  listRecurringOverrideRows,
  setRecurringOverride,
} from '@/server/recurring-overrides';
import { refreshRecurringForUser } from '@/server/recurring';
import { getProvider } from '@/lib/providers/demo';

const USER = `rov-${Date.now()}-${process.pid}`;
const OTHER = `${USER}-other`;
const TODAY = isoDate('2026-06-10');

/** Canonicals verified against `normalizeMerchant`, not assumed. */
const RENT_DESC = 'LAKESIDE PROPERTY MGMT RENT';
const RENT_CANONICAL = 'Lakeside Property Mgmt Rent';

let accountId = '';
let rentTxnId = '';

async function wipe() {
  for (const u of [USER, OTHER]) {
    await prisma.recurringOverride.deleteMany({ where: { userId: u } });
    await prisma.recurringSeries.deleteMany({ where: { userId: u } });
    await prisma.scheduledTransaction.deleteMany({ where: { account: { userId: u } } });
    await prisma.transaction.deleteMany({ where: { account: { userId: u } } });
    await prisma.account.deleteMany({ where: { userId: u } });
    await prisma.user.deleteMany({ where: { id: u } });
  }
}

beforeAll(async () => {
  await wipe();
  await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
  await prisma.user.create({ data: { id: OTHER, email: `${OTHER}@test.local` } });
  const account = await prisma.account.create({
    data: {
      userId: USER,
      name: 'Everyday Checking',
      type: 'CHECKING',
      provider: 'manual',
      currentBalanceCents: 500000,
      currency: 'USD',
    },
  });
  accountId = account.id;
  const merchant = await prisma.merchant.upsert({
    where: { canonical: RENT_CANONICAL },
    update: {},
    create: { canonical: RENT_CANONICAL },
  });
  // ONE charge — the whole case a declaration exists for: detection needs three.
  const txn = await prisma.transaction.create({
    data: {
      accountId,
      date: '2026-05-15',
      amountCents: -125000,
      rawDescriptor: RENT_DESC,
      merchantId: merchant.id,
      status: 'POSTED',
    },
  });
  rentTxnId = txn.id;
});

afterAll(wipe);

beforeEach(async () => {
  vi.mocked(auth).mockResolvedValue({ user: { id: USER } } as never);
  await prisma.recurringOverride.deleteMany({ where: { userId: USER } });
  await prisma.recurringSeries.deleteMany({ where: { userId: USER } });
  await prisma.scheduledTransaction.deleteMany({ where: { account: { userId: USER } } });
});

/** The stored rows the CASH surfaces read — the calendar, the forecast and the
 *  spending plan never detect anything themselves. */
async function storedScheduled() {
  return prisma.scheduledTransaction.findMany({
    where: { account: { userId: USER } },
    select: { description: true, amountCents: true, nextDate: true, cadence: true, source: true },
  });
}

describe('marking one transaction as recurring', () => {
  it('stores the verdict against the ROW’s payee, and projects it', async () => {
    // Before: one charge is not a pattern, so nothing is projected anywhere.
    await refreshRecurringForUser(USER, TODAY);
    expect(await storedScheduled()).toEqual([]);

    const res = await markTransactionAsBill({ transactionId: rentTxnId, cadence: 'MONTHLY' });
    expect(res).toEqual({ ok: true, projectionsRefreshed: true });

    expect(await getRecurringOverrides(USER)).toEqual([
      { merchantCanonical: RENT_CANONICAL, decision: 'BILL', cadence: 'MONTHLY', declaredSign: 'OUT' },
    ]);
    // …and the CASH basis moved in the same call, at the amount of his own charge.
    //
    // The DATE is asserted by shape rather than pinned: this action re-derives
    // "today" from the provider (a real clock for a real user), so a pinned value
    // here would be a test that passes in June and fails in July. The exact
    // stepping is a known-answer test in `recurring-override.test.ts`, against a
    // fixed today. What matters here is that the anchor kept his charge's DAY and
    // never lands in the past.
    const [projected] = await storedScheduled();
    expect(projected).toMatchObject({
      description: RENT_CANONICAL,
      amountCents: -125000,
      cadence: 'MONTHLY',
      source: 'recurring',
    });
    expect(projected.nextDate.endsWith('-15')).toBe(true);
    expect(projected.nextDate >= isoDate(getProvider().today(USER))).toBe(true);
  });

  it('refuses a rhythm the engine would not project — and saves nothing', async () => {
    for (const cadence of ['IRREGULAR', 'FORTNIGHTLY', '', 'monthly']) {
      const res = await markTransactionAsBill({ transactionId: rentTxnId, cadence });
      expect(res.ok).toBe(false);
    }
    expect(await listRecurringOverrideRows(USER)).toEqual([]);
  });

  it('refuses a transaction that is not the caller’s, indistinguishably from one that does not exist', async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: OTHER } } as never);
    const res = await markTransactionAsBill({ transactionId: rentTxnId, cadence: 'MONTHLY' });
    expect(res.ok).toBe(false);
    const missing = await markTransactionAsBill({ transactionId: 'no-such-id', cadence: 'MONTHLY' });
    expect(missing).toEqual(res);
    expect(await listRecurringOverrideRows(OTHER)).toEqual([]);
  });

  it('the demo account is fenced — one visitor may not rewrite what every other visitor sees', async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: DEMO_USER_ID } } as never);
    const res = await markTransactionAsBill({ transactionId: rentTxnId, cadence: 'MONTHLY' });
    expect(res.ok).toBe(false);
    expect(await prisma.recurringOverride.count({ where: { userId: DEMO_USER_ID } })).toBe(0);
    // …and the read path is fenced too, so a row written any other way is inert.
    expect(await getRecurringOverrides(DEMO_USER_ID)).toEqual([]);
  });
});

describe('the undo is the whole undo', () => {
  it('removing the verdict takes the projection with it', async () => {
    await markTransactionAsBill({ transactionId: rentTxnId, cadence: 'MONTHLY' });
    expect(await storedScheduled()).toHaveLength(1);

    const res = await clearRecurringVerdict({ merchantCanonical: RENT_CANONICAL });
    expect(res).toEqual({ ok: true, projectionsRefreshed: true });
    expect(await listRecurringOverrideRows(USER)).toEqual([]);
    // Back to exactly what the charges themselves say: nothing.
    expect(await storedScheduled()).toEqual([]);
  });

  it('changing his mind updates the one row rather than accumulating verdicts', async () => {
    await markTransactionAsBill({ transactionId: rentTxnId, cadence: 'MONTHLY' });
    await markTransactionAsBill({ transactionId: rentTxnId, cadence: 'ANNUAL' });
    await markMerchantNotABill({ merchantCanonical: RENT_CANONICAL });

    const rows = await listRecurringOverrideRows(USER);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ decision: 'NOT_BILL', cadence: null });
    expect(await storedScheduled()).toEqual([]);
  });
});

describe('demotion reaches the projection, not just the page', () => {
  it('a detected series stops being projected once the reader says it is not recurring', async () => {
    // Three charges a month apart: a genuine detection, with nothing declared.
    const merchant = await prisma.merchant.findUnique({ where: { canonical: RENT_CANONICAL } });
    await prisma.transaction.createMany({
      data: [
        { accountId, date: '2026-03-15', amountCents: -125000, rawDescriptor: RENT_DESC, merchantId: merchant!.id, status: 'POSTED' },
        { accountId, date: '2026-04-15', amountCents: -125000, rawDescriptor: RENT_DESC, merchantId: merchant!.id, status: 'POSTED' },
      ],
    });
    try {
      await refreshRecurringForUser(USER, TODAY);
      expect(await storedScheduled()).toHaveLength(1);

      const res = await markMerchantNotABill({ merchantCanonical: RENT_CANONICAL });
      expect(res).toEqual({ ok: true, projectionsRefreshed: true });
      expect(await storedScheduled()).toEqual([]);
      // The stored series row is gone too, so nothing downstream can read a
      // "recurring" fact the reader has withdrawn.
      expect(await prisma.recurringSeries.count({ where: { userId: USER } })).toBe(0);
    } finally {
      await prisma.transaction.deleteMany({
        where: { accountId, date: { in: ['2026-03-15', '2026-04-15'] } },
      });
    }
  });
});

describe('the verdict the detail view renders', () => {
  it('reads back through the engine’s parser, so an unreadable row is no instruction', async () => {
    expect(await getRecurringVerdictForTransaction(USER, rentTxnId)).toEqual({
      merchantCanonical: RENT_CANONICAL,
      decision: null,
      cadence: null,
      blockedReason: null,
    });

    await setRecurringOverride(USER, { merchantCanonical: RENT_CANONICAL, decision: 'BILL', cadence: 'WEEKLY' });
    expect(await getRecurringVerdictForTransaction(USER, rentTxnId)).toEqual({
      merchantCanonical: RENT_CANONICAL,
      decision: 'BILL',
      cadence: 'WEEKLY',
      blockedReason: null,
    });

    // A row the DETECTOR would ignore may not render as an instruction in force.
    await prisma.recurringOverride.updateMany({
      where: { userId: USER, merchantCanonical: RENT_CANONICAL },
      data: { cadence: 'IRREGULAR' },
    });
    expect(await getRecurringVerdictForTransaction(USER, rentTxnId)).toEqual({
      merchantCanonical: RENT_CANONICAL,
      decision: null,
      cadence: null,
      blockedReason: null,
    });
    expect(await getRecurringOverrides(USER)).toEqual([]);
  });

  it('another user’s transaction resolves to no payee at all', async () => {
    expect(await getRecurringVerdictForTransaction(OTHER, rentTxnId)).toEqual({
      merchantCanonical: null,
      decision: null,
      cadence: null,
      blockedReason: null,
    });
  });
});

describe('REGRESSION — the key is the string the DETECTOR groups by, not the Merchant row', () => {
  /**
   * Caught by the e2e, not by any unit test written before it: the first cut keyed
   * an instruction on `Transaction.merchant.canonical`, which is NULL for every
   * hand-entered row. So the reader with ONE typed charge — precisely the person a
   * declaration exists for — was told his transaction had no payee and refused.
   *
   * These two rows are the fail-old lock: reverting `seriesKeyForRow` to the
   * merchant relation makes the first refuse and the second store a key
   * `detectRecurring` never looks up.
   */
  const TYPED_DESC = 'CITY WATER UTILITY AUTOPAY';
  const TYPED_CANONICAL = 'City Water Utility Autopay';

  it('a hand-entered row with NO merchant row is still declarable, and projects', async () => {
    const txn = await prisma.transaction.create({
      data: { accountId, date: '2026-05-02', amountCents: -8800, rawDescriptor: TYPED_DESC, status: 'POSTED' },
    });
    try {
      expect(txn.merchantId).toBeNull(); // precondition: the shape that used to be refused

      const res = await markTransactionAsBill({ transactionId: txn.id, cadence: 'MONTHLY' });
      expect(res).toEqual({ ok: true, projectionsRefreshed: true });
      expect(await getRecurringOverrides(USER)).toEqual([
        { merchantCanonical: TYPED_CANONICAL, decision: 'BILL', cadence: 'MONTHLY', declaredSign: 'OUT' },
      ]);
      // …and it reached the projection, which is the half a stored row alone does
      // not prove: the detector had to find the instruction under this key.
      const projected = await storedScheduled();
      expect(projected.map((p) => p.description)).toContain(TYPED_CANONICAL);
    } finally {
      await prisma.transaction.deleteMany({ where: { id: txn.id } });
    }
  });

  it('a RENAMED payee is keyed on the bank text the detector reads, not the name on screen', async () => {
    // O.13c re-points `merchantId` at a Merchant whose canonical is the name the
    // reader typed. Detection never reads that row — it normalizes `rawDescriptor`
    // — so an instruction keyed on the display name would be stored and inert.
    const renamed = await prisma.merchant.upsert({
      where: { canonical: 'Water Bill' },
      update: {},
      create: { canonical: 'Water Bill' },
    });
    const txn = await prisma.transaction.create({
      data: {
        accountId,
        date: '2026-05-03',
        amountCents: -8800,
        rawDescriptor: TYPED_DESC,
        merchantId: renamed.id,
        status: 'POSTED',
      },
    });
    try {
      await markTransactionAsBill({ transactionId: txn.id, cadence: 'MONTHLY' });
      const [stored] = await listRecurringOverrideRows(USER);
      expect(stored.merchantCanonical).toBe(TYPED_CANONICAL);
      expect((await storedScheduled()).map((p) => p.description)).toContain(TYPED_CANONICAL);
    } finally {
      await prisma.transaction.deleteMany({ where: { id: txn.id } });
    }
  });
});

describe('CRITIC CYCLE 1 — rows the server must refuse to declare, not merely disable in the menu', () => {
  /**
   * Three shapes, one decision point (`declarationBlockedReason`), enforced on the
   * wire as well as in the menu — because the first cut enforced them nowhere: the
   * detail page rendered the form three inches under a disabled menu item, saved,
   * and reported success for an instruction detection can never match.
   *
   * The AGGREGATE case is the one that moved money. `Check`, `Venmo`, `Zelle
   * Payment` are one canonical over many unrelated payees; detection is safe there
   * only because it needs three sightings at a stable amount. Declared, "my rent is
   * monthly" said on a rent CHECK would have projected whatever the most recent
   * check happened to be — the gardener's $40 — onto /calendar and cash-needed.
   */
  async function row(data: { rawDescriptor: string; isTransfer?: boolean; isSplitParent?: boolean }) {
    return prisma.transaction.create({
      data: {
        accountId,
        date: '2026-05-20',
        amountCents: -180000,
        rawDescriptor: data.rawDescriptor,
        isTransfer: data.isTransfer ?? false,
        isSplitParent: data.isSplitParent ?? false,
        status: 'POSTED',
      },
    });
  }

  it('an AGGREGATE payee (a check, Venmo, Zelle) may not be declared — it would follow whichever payment came last', async () => {
    const check = await row({ rawDescriptor: 'CHECK #2204' });
    try {
      const res = await markTransactionAsBill({ transactionId: check.id, cadence: 'MONTHLY' });
      expect(res.ok).toBe(false);
      expect(res).toMatchObject({ error: VERDICT_BLOCKED_AGGREGATE });
      expect(await listRecurringOverrideRows(USER)).toEqual([]);
      expect(await storedScheduled()).toEqual([]);
    } finally {
      await prisma.transaction.deleteMany({ where: { id: check.id } });
    }
  });

  it('a TRANSFER and a SPLIT CONTAINER are refused with the sentence the menu shows', async () => {
    const transfer = await row({ rawDescriptor: 'ONLINE TRANSFER TO SAVINGS', isTransfer: true });
    const container = await row({ rawDescriptor: 'TARGET STORE 1123', isSplitParent: true });
    try {
      expect(await markTransactionAsBill({ transactionId: transfer.id, cadence: 'MONTHLY' })).toMatchObject({
        ok: false,
        error: VERDICT_BLOCKED_TRANSFER,
      });
      expect(await markTransactionAsBill({ transactionId: container.id, cadence: 'MONTHLY' })).toMatchObject({
        ok: false,
        error: VERDICT_BLOCKED_SPLIT_PARENT,
      });
      expect(await listRecurringOverrideRows(USER)).toEqual([]);
    } finally {
      await prisma.transaction.deleteMany({ where: { id: { in: [transfer.id, container.id] } } });
    }
  });

  it('the detail page is told the same reason it is refused for, so screen and wire cannot disagree', async () => {
    const check = await row({ rawDescriptor: 'VENMO PAYMENT 1042' });
    try {
      const verdict = await getRecurringVerdictForTransaction(USER, check.id);
      expect(verdict.blockedReason).toBe(VERDICT_BLOCKED_AGGREGATE);
    } finally {
      await prisma.transaction.deleteMany({ where: { id: check.id } });
    }
  });

  it('DEMOTION is still allowed on those rows — it can only remove a projection, never invent one', async () => {
    const venmo = await row({ rawDescriptor: 'VENMO PAYMENT 1042' });
    try {
      const res = await markMerchantNotABill({ merchantCanonical: 'Venmo' });
      expect(res).toMatchObject({ ok: true });
    } finally {
      await prisma.transaction.deleteMany({ where: { id: venmo.id } });
      await prisma.recurringOverride.deleteMany({ where: { userId: USER } });
    }
  });
});

describe('CRITIC CYCLE 1 — the declared DIRECTION is stored and honoured end to end', () => {
  it('a declaration from an outflow row stores OUT and projects an expense', async () => {
    const res = await markTransactionAsBill({ transactionId: rentTxnId, cadence: 'MONTHLY' });
    expect(res.ok).toBe(true);
    const stored = await prisma.recurringOverride.findFirst({ where: { userId: USER } });
    expect(stored?.declaredSign).toBe('OUT');
    expect((await storedScheduled())[0]).toMatchObject({ amountCents: -125000, source: 'recurring' });
  });
});
