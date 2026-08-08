/**
 * The convert lever through the SERVER (C.23 / DECISIONS #431, critic round 1).
 *
 * `fixed-setup-proposals.test.ts` proves the pure rules. What a pure test cannot
 * see is the WRITE the lever makes: one serializable transaction that creates
 * the reserve goal (linked to the series' canonical via `Goal.merchantCanonical`),
 * resolves the O.13c case-collision residual on the demotion, and pairs the
 * NOT_BILL override with the goal so the undo is the WHOLE pair.
 *
 * The two critic defects locked here:
 *   P1-3 — the exact-bytes upsert could MINT a second contradictory row beside
 *     a case-differing legacy one, and the older BILL row then outvoted the new
 *     NOT_BILL in `buildOverrideMap` (first row by createdAt): the series kept
 *     detecting while the reserve counted it — a silent, permanent double count
 *     with `ok: true` reported. Collision rows are deleted first, same tx.
 *   P1-2 (server half) — deleteReserve withdraws the paired override in the
 *     same transaction, and clearRecurringOverride REFUSES the inverse half
 *     (withdrawing the override alone would return the series to detection
 *     while the reserve still counts the money).
 *
 * The fixture reproduces the e2e shape 1:1 — an ANNUAL $120.00 series charged
 * on June 1 (the pin's CURRENT month, so no rollup mass in March/April/May) at
 * the vitest-pinned DEMO_TODAY=2026-06-10 — so the real loader offers the lever
 * exactly as the settings page would.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
// revalidatePath needs a Next request store absent in unit tests — no-op it.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { RESERVE_KIND } from '@/lib/engine/spending-plan/reserves';
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';
import { overrideKey } from '@/lib/engine/recurring/override';
import { createReserveFromSeries, deleteReserve } from '@/server/reserve-actions';
import { clearRecurringOverride, getRecurringOverrides, setRecurringOverride } from '@/server/recurring-overrides';
import { deleteGoal } from '@/server/goal-actions';

const USER = `rcv-${Date.now()}-${process.pid}`;
const DESC = 'AUTO CLUB DUES';
// The engine's OWN spelling of the payee — the canonical the proposal carries
// and the convert writes (derived, never assumed).
const CANONICAL = normalizeMerchant(DESC).canonical;

let accountId = '';

async function wipe() {
  await prisma.goal.deleteMany({ where: { userId: USER } });
  await prisma.recurringOverride.deleteMany({ where: { userId: USER } });
  await prisma.recurringSeries.deleteMany({ where: { userId: USER } });
  await prisma.scheduledTransaction.deleteMany({ where: { account: { userId: USER } } });
  await prisma.transaction.deleteMany({ where: { account: { userId: USER } } });
  await prisma.account.deleteMany({ where: { userId: USER } });
  await prisma.user.deleteMany({ where: { id: USER } });
}

beforeAll(async () => {
  await wipe();
  await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
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
  // The ANNUAL series: charged on the 1st of the PIN's current month (June
  // 2026) and one and two years before — gaps exactly 365, no charge in the
  // March/April/May rollup window, so the loader offers the lever (the e2e
  // fixture's own shape, verified there against the real union).
  for (const y of [2026, 2025, 2024]) {
    await prisma.transaction.create({
      data: {
        accountId,
        date: `${y}-06-01`,
        amountCents: -12000,
        rawDescriptor: DESC,
        categoryId: 'insurance',
        status: 'POSTED',
      },
    });
  }
  // ROLLUP MASS IN ANOTHER FIXED CATEGORY — measured, not theorized: with an
  // EMPTY category rollup the loader falls to the trailing-median basis, whose
  // covered-ids scan sees the June charge and marks insurance "covered" — no
  // lever. The e2e fixture keeps the plan on the category-designations basis
  // with gym+internet window mass; the internet rows alone reproduce that here
  // (three $80 charges on the 20th of the window months, exactly the e2e's).
  // (Critic round-3 P2-5 asked whether deleting these rows would put the
  // fixture on the median basis as a loader-wiring probe — MEASURED: it fails
  // the three convert-success tests, because at FIRST convert the exclusion
  // set is empty, so the median covered-ids scan sees the June charge and
  // refuses the lever. The rows stay; the P2-5 gap is recorded in STATUS.md.)
  for (const d of ['2026-05-20', '2026-04-20', '2026-03-20']) {
    await prisma.transaction.create({
      data: {
        accountId,
        date: d,
        amountCents: -8000,
        rawDescriptor: 'INTERNET CO',
        categoryId: 'internet',
        status: 'POSTED',
      },
    });
  }
});

afterAll(wipe);

beforeEach(async () => {
  vi.mocked(auth).mockResolvedValue({ user: { id: USER } } as never);
  await prisma.goal.deleteMany({ where: { userId: USER } });
  await prisma.recurringOverride.deleteMany({ where: { userId: USER } });
});

/** Seed the O.13c residual: a legacy override row whose SPELLING differs from
 *  the engine's canonical while the folded key (`overrideKey`) matches. */
async function seedLegacyCollision(decision: 'BILL' | 'NOT_BILL' = 'BILL'): Promise<void> {
  await prisma.recurringOverride.create({
    data: { userId: USER, merchantCanonical: CANONICAL.toLowerCase(), decision, cadence: null },
  });
}

describe('the convert write resolves the folded-key collision in the SAME transaction (critic P1-3)', () => {
  it('replaces a case-differing legacy row instead of minting a second, contradictory one', async () => {
    await seedLegacyCollision('BILL');

    const result = await createReserveFromSeries(CANONICAL);
    expect(result).toEqual({ ok: true });

    // The reserve goal carries the convert link (P1-1/P1-2 — the rollup
    // exclusion and the whole-pair undo both read it).
    const goal = await prisma.goal.findFirst({ where: { userId: USER, kind: RESERVE_KIND } });
    expect(goal?.merchantCanonical).toBe(CANONICAL);

    // ONE row states the reader's intent, in the engine's own spelling —
    // FAIL-OLD would leave BOTH rows, and the older BILL would outvote the
    // NOT_BILL in buildOverrideMap: the series kept detecting while the
    // reserve counted it (the double count with `ok: true`).
    const rows = await prisma.recurringOverride.findMany({
      where: { userId: USER },
      select: { merchantCanonical: true, decision: true },
    });
    expect(rows).toEqual([{ merchantCanonical: CANONICAL, decision: 'NOT_BILL' }]);

    // Every folded-key read (the detector's own map, the detail view, the
    // undo panel) now resolves to the demotion.
    const read = await getRecurringOverrides(USER);
    expect(read).toHaveLength(1);
    expect(read[0]!.decision).toBe('NOT_BILL');
    expect(overrideKey(read[0]!.merchantCanonical)).toBe(overrideKey(CANONICAL));
  });

  it('never creates a second reserve for a canonical that already has one — the conversion pair is 1:1 (critic round-2 P2-3)', async () => {
    // A reserve already linked to the canonical exists (seeded directly — the
    // invariant is about the pair, not how the pair came to be). A second
    // convert for the same payee must be refused INSIDE the transaction: two
    // reserves sharing one NOT_BILL would let either delete sever the other's
    // pair — the double count the whole design forbids.
    await prisma.goal.create({
      data: {
        userId: USER,
        name: 'Existing set-aside',
        kind: RESERVE_KIND,
        targetCents: 120_000,
        cadence: 'ANNUAL',
        savedCents: 0,
        monthlyContributionCents: null,
        merchantCanonical: CANONICAL,
      },
    });

    const result = await createReserveFromSeries(CANONICAL);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('already set aside as a reserve');
    }
    expect(await prisma.goal.count({ where: { userId: USER, kind: RESERVE_KIND } })).toBe(1);
  });

  it('a legacy NOT_BILL (folded match) already demotes the series — the convert is refused honestly and writes nothing', async () => {
    // The case-differing NOT_BILL resolves through the folded key on every
    // read, so the detector no longer EMITS the series: there is no proposal
    // to convert, and the refusal says exactly that. No reserve may sit on top
    // of a demotion — that would be the double count in reserve clothing.
    await seedLegacyCollision('NOT_BILL');

    const result = await createReserveFromSeries(CANONICAL);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("can't become a reserve");
    }
    // Nothing was written — no reserve, legacy row untouched.
    expect(await prisma.goal.count({ where: { userId: USER, kind: RESERVE_KIND } })).toBe(0);
    const rows = await prisma.recurringOverride.findMany({ where: { userId: USER } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.merchantCanonical).toBe(CANONICAL.toLowerCase());
    expect(rows[0]!.decision).toBe('NOT_BILL');
  });
});

describe('the undo is the WHOLE pair (critic P1-2, server half)', () => {
  it('deleteReserve withdraws the paired NOT_BILL in the same transaction — detection re-arms with no residue', async () => {
    const result = await createReserveFromSeries(CANONICAL);
    expect(result).toEqual({ ok: true });
    const goal = await prisma.goal.findFirst({ where: { userId: USER, kind: RESERVE_KIND } });
    expect(goal).not.toBeNull();

    await deleteReserve(goal!.id);

    // Both halves gone — the override does not survive its reserve.
    expect(await prisma.goal.count({ where: { userId: USER, kind: RESERVE_KIND } })).toBe(0);
    expect(await prisma.recurringOverride.count({ where: { userId: USER } })).toBe(0);
  });

  it('clearRecurringOverride refuses the inverse half — withdrawing the override alone would double count', async () => {
    const result = await createReserveFromSeries(CANONICAL);
    expect(result).toEqual({ ok: true });

    // The raw store function (no auth wrapper) — refused for the same reason
    // the /recurring page would refuse, folded key included: a case-differing
    // caller spelling is the same reserve link.
    const clear = await clearRecurringOverride(USER, CANONICAL.toLowerCase());
    expect(clear.ok).toBe(false);
    if (!clear.ok) {
      expect(clear.error).toContain('remove the reserve on your plan page first');
    }
    // The pair is still intact — nothing was half-undone.
    expect(await prisma.recurringOverride.count({ where: { userId: USER } })).toBe(1);
    expect(await prisma.goal.count({ where: { userId: USER, kind: RESERVE_KIND } })).toBe(1);
  });

  it('setRecurringOverride BILL refuses on a converted payee — re-declaring the bill would double count (critic P1-1)', async () => {
    const result = await createReserveFromSeries(CANONICAL);
    expect(result).toEqual({ ok: true });

    // The reader sees the next charge post and taps "this is a bill, annually".
    // Honoring it would resurrect the series to detection while the linked
    // reserve still counts the money — the same payee twice in Fixed, with
    // `ok: true`. The fold: a case-differing caller spelling is the same payee.
    const declared = await setRecurringOverride(USER, {
      merchantCanonical: CANONICAL.toLowerCase(),
      decision: 'BILL',
      cadence: 'ANNUAL',
    });
    expect(declared.ok).toBe(false);
    if (!declared.ok) {
      expect(declared.error).toContain('remove the reserve on your plan page first');
    }
    // The NOT_BILL demotion still stands — nothing was half-written, so no
    // figure moved. (The critic's repro showed the pre-fix `{ok:true}` here
    // and a fixedExpensesCents up by exactly the reserve's rate.)
    const overrides = await getRecurringOverrides(USER);
    const demote = overrides.find(
      (o) => overrideKey(o.merchantCanonical) === overrideKey(CANONICAL),
    );
    expect(demote?.decision).toBe('NOT_BILL');
    expect(await prisma.goal.count({ where: { userId: USER, kind: RESERVE_KIND } })).toBe(1);
  });

  it('deleteGoal refuses a reserve id — the goals page never offers one, and deleting it here would orphan the NOT_BILL (critic P2-1)', async () => {
    const result = await createReserveFromSeries(CANONICAL);
    expect(result).toEqual({ ok: true });
    const goal = await prisma.goal.findFirst({ where: { userId: USER, kind: RESERVE_KIND } });
    expect(goal).not.toBeNull();

    await expect(deleteGoal(goal!.id)).rejects.toThrow(/reserve/);
    // The pair is intact — the reserve AND its NOT_BILL both still stand.
    expect(await prisma.goal.count({ where: { userId: USER, kind: RESERVE_KIND } })).toBe(1);
    expect(await prisma.recurringOverride.count({ where: { userId: USER } })).toBe(1);
  });
});
