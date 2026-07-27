/**
 * Recurring re-detection after ingest (ROADMAP #1b / DECISIONS #22 tail) — drives
 * the REAL refreshRecurringForUser against a throwaway user with monthly recurring
 * transactions. Proves it persists the detected series + the scheduled projection,
 * is idempotent (full replace, not duplicate), and leaves user/seed scheduled rows
 * intact.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { addMonthsClamped, isoDate } from '@/lib/dates';
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';
import { refreshRecurringForUser } from '@/server/recurring';
import { prisma } from '@/lib/db';

describe('refreshRecurringForUser (post-ingest re-detection)', () => {
  const USER = `rec-refresh-${Date.now()}-${process.pid}`;
  const DESC = 'NETFLIX MONTHLY';
  const CANON = normalizeMerchant(DESC).canonical;
  let checkingId = '';
  let merchantId = '';

  async function wipe() {
    await prisma.user.deleteMany({ where: { id: USER } });
  }
  beforeAll(async () => {
    await wipe();
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
    const chk = await prisma.account.create({
      data: { userId: USER, provider: 'plaid', name: 'Checking', type: 'CHECKING', currentBalanceCents: 500_000 },
    });
    checkingId = chk.id;
    const m = await prisma.merchant.upsert({
      where: { canonical: CANON },
      create: { canonical: CANON, defaultCategoryId: null },
      update: {},
    });
    merchantId = m.id;
    // Four monthly $15.99 charges → a MONTHLY recurring series.
    for (let i = 0; i < 4; i++) {
      await prisma.transaction.create({
        data: {
          accountId: checkingId,
          date: addMonthsClamped(isoDate('2026-02-15'), i),
          amountCents: -1599,
          rawDescriptor: DESC,
          merchantId,
          categoryId: null,
          status: 'POSTED',
        },
      });
    }
  });
  afterAll(wipe);

  it('detects the recurring series + a scheduled projection on a cash account', async () => {
    const r = await refreshRecurringForUser(USER, isoDate('2026-06-01'));
    expect(r.series).toBeGreaterThanOrEqual(1);

    const s = await prisma.recurringSeries.findFirst({ where: { userId: USER, merchantId } });
    expect(s).not.toBeNull();
    expect(s!.cadence).toBe('MONTHLY');
    expect(s!.typicalAmountCents).toBe(-1599);

    expect(r.scheduled).toBeGreaterThanOrEqual(1);
    expect(
      await prisma.scheduledTransaction.count({ where: { account: { userId: USER }, source: 'recurring' } }),
    ).toBeGreaterThanOrEqual(1);
  });

  it('is idempotent (replace, not duplicate) and preserves a user-managed scheduled row', async () => {
    // a user's own scheduled row must survive a re-detection
    await prisma.scheduledTransaction.create({
      data: { accountId: checkingId, description: 'Rent', amountCents: -200_000, nextDate: '2026-07-01', cadence: 'MONTHLY', source: 'user' },
    });
    await refreshRecurringForUser(USER, isoDate('2026-06-01'));
    await refreshRecurringForUser(USER, isoDate('2026-06-01')); // twice

    // exactly one series (full replace, no duplicates)
    expect(await prisma.recurringSeries.count({ where: { userId: USER, merchantId } })).toBe(1);
    // exactly one detected scheduled row for the series (not accumulated)
    expect(await prisma.scheduledTransaction.count({ where: { account: { userId: USER }, source: 'recurring' } })).toBe(1);
    // the user's Rent row is untouched
    expect(await prisma.scheduledTransaction.count({ where: { account: { userId: USER }, source: 'user' } })).toBe(1);
  });
});

/**
 * test_regression__a_sync_that_rewrites_the_projections_says_so (L.28)
 *
 * `refreshRecurringForUser` runs at the tail of every sync and full-replaces the
 * derived rows the spending plan, forecast, calendar and radar are summed from. It
 * reported only how many rows it wrote, never whether they DIFFERED from the ones it
 * found — so the page-load auto-sync, which re-renders only on a reported change, had
 * nothing to go on. On the owner's live data L.26's re-keying turned 0 stored
 * scheduled rows into 8 ($684.31/month) during syncs reporting `added: 0`, and the
 * very load that repaired his guilt-free breakdown re-painted the stale $0.00.
 *
 * The third case is the one that matters for the DESIGN: comparing the returned
 * `{series, scheduled}` COUNTS — the cheaper implementation — passes the first two and
 * fails this one, because a bill whose amount moves changes every figure on the page
 * while changing no count at all.
 */
describe('refreshRecurringForUser — the derived-projection change signal', () => {
  const USER = `rec-changed-${Date.now()}-${process.pid}`;
  const DESC = 'SPOTIFY MONTHLY';
  const CANON = normalizeMerchant(DESC).canonical;
  const TODAY = isoDate('2026-06-01');
  let checkingId = '';
  let lastTxnId = '';

  async function wipe() {
    await prisma.user.deleteMany({ where: { id: USER } });
  }
  const counts = async () => ({
    series: await prisma.recurringSeries.count({ where: { userId: USER } }),
    scheduled: await prisma.scheduledTransaction.count({
      where: { account: { userId: USER }, source: { in: ['recurring', 'payroll-detected'] } },
    }),
  });

  beforeAll(async () => {
    await wipe();
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
    const chk = await prisma.account.create({
      data: { userId: USER, provider: 'plaid', name: 'Checking', type: 'CHECKING', currentBalanceCents: 500_000 },
    });
    checkingId = chk.id;
    const m = await prisma.merchant.upsert({
      where: { canonical: CANON },
      create: { canonical: CANON, defaultCategoryId: null },
      update: {},
    });
    for (let i = 0; i < 4; i++) {
      const t = await prisma.transaction.create({
        data: {
          accountId: checkingId,
          date: addMonthsClamped(isoDate('2026-02-15'), i),
          amountCents: -1099,
          rawDescriptor: DESC,
          merchantId: m.id,
          categoryId: null,
          status: 'POSTED',
        },
      });
      lastTxnId = t.id;
    }
  });
  afterAll(wipe);

  it('reports changed when it writes projections the user did not have', async () => {
    expect(await counts()).toEqual({ series: 0, scheduled: 0 });

    const r = await refreshRecurringForUser(USER, TODAY);

    expect(r.scheduled).toBeGreaterThanOrEqual(1);
    expect(r.changed).toBe(true);
  });

  it('reports NOT changed when the same run lands on identical rows', async () => {
    // Immediately re-run against unchanged transactions: a full delete+create mints new
    // ids for every row, so an id-bearing comparison would answer "changed" here and be
    // exactly as useless as never answering at all.
    const r = await refreshRecurringForUser(USER, TODAY);

    expect(r.scheduled).toBeGreaterThanOrEqual(1);
    expect(r.changed).toBe(false);
  });

  it('reports changed when an amount moves and the row COUNTS do not', async () => {
    const before = await counts();

    // A price change on the newest charge. The series still detects (two distinct
    // amounts is a price change, not instability), so nothing is added or dropped —
    // only the stored amounts move.
    await prisma.transaction.update({ where: { id: lastTxnId }, data: { amountCents: -1299 } });
    const r = await refreshRecurringForUser(USER, TODAY);

    // The counts are the assertion, not the setup: this test only proves what it
    // claims while both sides of the comparison stay equal.
    expect(await counts()).toEqual(before);
    expect(r.series).toBe(before.series);
    expect(r.scheduled).toBe(before.scheduled);
    expect(r.changed).toBe(true);
  });
});

/**
 * test_regression__consent_and_the_projections_it_governs_commit_together (L.28 critic P0)
 *
 * Both fresh-context critics found this independently, and one proved it with a probe:
 * `refreshRecurringForUser` retired a resumed income-pause confirmation with its own
 * `deleteMany`, committed BEFORE the replace transaction. A throw at or after that
 * point — the `$transaction` itself being the likeliest site — left the user's consent
 * destroyed for good, while both providers' catch blocks carried a comment asserting
 * the exact opposite ("a throw means the replace transaction rolled back, so nothing
 * changed") and reported `derivedChanged: false` to the page.
 *
 * Retiring consent is the one change the row digest cannot see (it lives in a third
 * table), so nothing else could have caught it. Its own user, because a fixture that
 * depends on what a sibling test left behind is the other half of this bug's family.
 */
describe('refreshRecurringForUser — a resumed pause is retired atomically', () => {
  const USER = `rec-consent-${Date.now()}-${process.pid}`;
  const PAYROLL = 'ACME PAYROLL DIRECT DEP';
  const CANON = normalizeMerchant(PAYROLL).canonical;
  const TODAY = isoDate('2026-06-01');

  async function wipe() {
    await prisma.user.deleteMany({ where: { id: USER } });
  }
  const confirmations = () => prisma.incomePauseConfirmation.count({ where: { userId: USER } });

  beforeAll(async () => {
    await wipe();
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
    const chk = await prisma.account.create({
      data: { userId: USER, provider: 'plaid', name: 'Checking', type: 'CHECKING', currentBalanceCents: 400_000 },
    });
    const m = await prisma.merchant.upsert({
      where: { canonical: CANON },
      create: { canonical: CANON, defaultCategoryId: null },
      update: {},
    });
    // Four MONTHLY deposits of $2,500, the last on 2026-05-15. Positive ⇒ income, and
    // `missedSinceOf('2026-05-15','MONTHLY')` = 2026-06-15, which is >= TODAY — so
    // `confirmedPauseState` returns 'resumed' and the retirement branch actually runs.
    // (Without that, the confirmation is 'inert', nothing is queued, and this test
    // would pass on the OLD code too — which is exactly what the first draft did.)
    for (let i = 0; i < 4; i++) {
      await prisma.transaction.create({
        data: {
          accountId: chk.id,
          date: addMonthsClamped(isoDate('2026-02-15'), i),
          amountCents: 250_000,
          rawDescriptor: PAYROLL,
          merchantId: m.id,
          categoryId: null,
          status: 'POSTED',
        },
      });
    }
    await prisma.incomePauseConfirmation.create({ data: { userId: USER, merchantCanonical: CANON } });
  });
  afterAll(wipe);

  it('keeps the confirmation when the replace transaction fails', async () => {
    expect(await confirmations()).toBe(1);

    const spy = vi.spyOn(prisma, '$transaction').mockRejectedValueOnce(new Error('deadlock detected'));
    await expect(refreshRecurringForUser(USER, TODAY)).rejects.toThrow('deadlock detected');
    spy.mockRestore();

    // The write that used to survive the rollback, silently and permanently.
    expect(await confirmations()).toBe(1);
  });

  it('still retires it — and reports the change — when the transaction commits', async () => {
    // The other direction, so the fix cannot be "never retire anything".
    const r = await refreshRecurringForUser(USER, TODAY);

    expect(await confirmations()).toBe(0);
    expect(r.changed).toBe(true);
  });
});
