/**
 * Wave 4.6 slice 4 — reconciled cards / loans / scheduled + household follow-through.
 * Real-Prisma integration tests (shared temp SQLite, throwaway users) proving the
 * slice-4 boundary extensions + household exclusions are wired end-to-end:
 *
 *   R4 — cash-needed for a reconciled CREDIT card uses the successor's statement only;
 *        the predecessor's stale statement never inflates the due total, and its
 *        statements are DROPPED from the snapshot (so the coach cleared-streak, which
 *        reads snap.statements join-free, is not corrupted). A reconciled LOAN likewise
 *        emits ONE obligation (successor), never a phantom from the zeroed predecessor
 *        whose minimumPaymentCents the boundary can't zero — in cash-needed AND the forecast.
 *   F6 — the predecessor's ScheduledTransaction rows re-key onto the successor, so the
 *        forecast (pinned to the remapped successor payment account) still projects the
 *        income/bills instead of silently dropping them.
 *   R5 — a partner's reconciled+shared pair appears ONCE (the successor) across EVERY
 *        household read surface; the stale predecessor is never separately shared. One
 *        test drives all five sanctioned shared-set reads so a missed site fails loudly.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { isoDate } from '@/lib/dates';
import { DemoProvider } from '@/lib/providers/demo';
import { getCashNeeded } from '@/server/finance';
import { getCashFlowForecast } from '@/server/forecast';
import { getSharedSnapshotSlice, getHouseholdDuplicateCandidates } from '@/server/household-finance';
import { getAccountSharingView, getSharedTransactionsView } from '@/server/household';
import { recategorizeSharedTransaction } from '@/server/household-actions';
import { getHouseholdDigestContext } from '@/server/household-digest';
import { resolveViewer } from '@/server/household-authz';
import { activeSupersededPredecessorIds, confirmReconciliationFor } from '@/server/reconciliation';

const TODAY = '2026-07-22';
const CUTOVER = '2026-06-30';
const STAMP = `${Date.now()}-${process.pid}-s4`;
const R4USER = `recon-s4-r4-${STAMP}`;
const LOANUSER = `recon-s4-loan-${STAMP}`;
const F6USER = `recon-s4-f6-${STAMP}`;
const CLAIM2USER = `recon-s4-c2-${STAMP}`;
const XCURRUSER = `recon-s4-xc-${STAMP}`;
const VIEWER = `recon-s4-view-${STAMP}`;
const PARTNER = `recon-s4-partner-${STAMP}`;
const ALL_USERS = [R4USER, LOANUSER, F6USER, CLAIM2USER, XCURRUSER, VIEWER, PARTNER];

const provider = new DemoProvider();
const priorDemoToday = process.env.DEMO_TODAY;

let r4PredCard = '';
let r4SuccCard = '';
let loanPred = '';
let loanSucc = '';
let f6Pred = '';
let f6Succ = '';
let c2CardX = '';
let c2Pred = '';
let c2Succ = '';
let xcValidPred = '';
let xcUsdPred = '';
let xcEurSucc = '';
let partnerPred = '';
let partnerSucc = '';
let partnerPredTxnId = '';

function actAs(userId: string) {
  vi.mocked(auth).mockResolvedValue({ user: { id: userId } } as never);
}

async function wipe() {
  const memberships = await prisma.householdMember.findMany({
    where: { userId: { in: ALL_USERS } },
    select: { householdId: true },
  });
  await prisma.household.deleteMany({ where: { id: { in: memberships.map((m) => m.householdId) } } });
  await prisma.user.deleteMany({ where: { id: { in: ALL_USERS } } });
}

beforeAll(async () => {
  process.env.DEMO_TODAY = TODAY;
  await wipe().catch(() => {});
  await prisma.user.createMany({ data: ALL_USERS.map((id) => ({ id, email: `${id}@test.local` })) });

  const link = (userId: string, predecessorAccountId: string, successorAccountId: string) =>
    prisma.accountReconciliation.create({
      data: { userId, predecessorAccountId, successorAccountId, cutoverDate: CUTOVER, matchSignal: 'mask', confidence: 'high' },
    });

  // ── R4: reconciled CREDIT card (successor live, predecessor stale) ─────────
  r4SuccCard = (
    await prisma.account.create({
      data: {
        userId: R4USER, provider: 'plaid', providerRef: 'r4-succ', name: 'Amex (live)', type: 'CREDIT',
        currentBalanceCents: 60_000, currency: 'USD', dueDayOfMonth: 20, cycleCloseDayOfMonth: 1,
      },
    })
  ).id;
  r4PredCard = (
    await prisma.account.create({
      data: {
        userId: R4USER, provider: 'simplefin', providerRef: 'r4-pred', name: 'Amex (old)', type: 'CREDIT',
        currentBalanceCents: 50_000, currency: 'USD', dueDayOfMonth: 20, cycleCloseDayOfMonth: 1,
      },
    })
  ).id;
  // Both cards carry an unpaid statement (positive balance, no payments → always "current").
  await prisma.statement.createMany({
    data: [
      { accountId: r4SuccCard, cycleStart: '2026-06-01', cycleEnd: '2026-06-25', dueDate: '2026-08-20', statementBalanceCents: 60_000, minimumPaymentCents: 6_000 },
      { accountId: r4PredCard, cycleStart: '2026-05-01', cycleEnd: '2026-05-25', dueDate: '2026-08-15', statementBalanceCents: 50_000, minimumPaymentCents: 5_000 },
    ],
  });
  const r4Checking = (
    await prisma.account.create({
      data: { userId: R4USER, provider: 'plaid', providerRef: 'r4-chk', name: 'Checking', type: 'CHECKING', currentBalanceCents: 300_000, currency: 'USD' },
    })
  ).id;
  await prisma.user.update({ where: { id: R4USER }, data: { paymentAccountId: r4Checking } });
  await link(R4USER, r4PredCard, r4SuccCard);

  // ── R4: reconciled LOAN (successor live, predecessor stale) ────────────────
  loanSucc = (
    await prisma.account.create({
      data: {
        userId: LOANUSER, provider: 'plaid', providerRef: 'ln-succ', name: 'Mortgage (live)', type: 'MORTGAGE',
        currentBalanceCents: 30_000_00, currency: 'USD', minimumPaymentCents: 200_000, dueDayOfMonth: 10,
      },
    })
  ).id;
  loanPred = (
    await prisma.account.create({
      data: {
        userId: LOANUSER, provider: 'simplefin', providerRef: 'ln-pred', name: 'Mortgage (old)', type: 'MORTGAGE',
        currentBalanceCents: 30_500_00, currency: 'USD', minimumPaymentCents: 190_000, dueDayOfMonth: 5,
      },
    })
  ).id;
  const loanChecking = (
    await prisma.account.create({
      data: { userId: LOANUSER, provider: 'plaid', providerRef: 'ln-chk', name: 'Checking', type: 'CHECKING', currentBalanceCents: 400_000, currency: 'USD' },
    })
  ).id;
  await prisma.user.update({ where: { id: LOANUSER }, data: { paymentAccountId: loanChecking } });
  await link(LOANUSER, loanPred, loanSucc);

  // ── F6: reconciled CHECKING funding account with a scheduled paycheck ──────
  f6Succ = (
    await prisma.account.create({
      data: { userId: F6USER, provider: 'plaid', providerRef: 'f6-succ', name: 'Checking (live)', type: 'CHECKING', currentBalanceCents: 250_000, currency: 'USD' },
    })
  ).id;
  f6Pred = (
    await prisma.account.create({
      data: { userId: F6USER, provider: 'simplefin', providerRef: 'f6-pred', name: 'Checking (old)', type: 'CHECKING', currentBalanceCents: 240_000, currency: 'USD' },
    })
  ).id;
  // The user's designated payment account is the OLD row — the remap case.
  await prisma.user.update({ where: { id: F6USER }, data: { paymentAccountId: f6Pred } });
  // A MONTHLY paycheck keyed to the predecessor — must re-key to the successor.
  await prisma.scheduledTransaction.create({
    data: { accountId: f6Pred, description: 'Paycheck', amountCents: 500_000, nextDate: '2026-07-01', cadence: 'MONTHLY', source: 'payroll-detected' },
  });
  await link(F6USER, f6Pred, f6Succ);

  // ── CLAIM 2: successor on the ESTIMATE path (no own statement) — the predecessor's
  //    current statement must re-key so the owed amount stays in the headline ──────────
  c2CardX = (
    await prisma.account.create({
      data: {
        userId: CLAIM2USER, provider: 'plaid', providerRef: 'c2-x', name: 'Other Visa', type: 'CREDIT',
        currentBalanceCents: 10_000, currency: 'USD', dueDayOfMonth: 10, cycleCloseDayOfMonth: 1,
      },
    })
  ).id;
  await prisma.statement.create({
    data: { accountId: c2CardX, cycleStart: '2026-06-15', cycleEnd: '2026-07-15', dueDate: '2026-08-10', statementBalanceCents: 10_000, minimumPaymentCents: 2_000 },
  });
  c2Succ = (
    await prisma.account.create({
      data: {
        userId: CLAIM2USER, provider: 'plaid', providerRef: 'c2-succ', name: 'Amex (live)', type: 'CREDIT',
        currentBalanceCents: 200_000, currency: 'USD', dueDayOfMonth: 25, cycleCloseDayOfMonth: 1,
        // deliberately NO statement row — a fresh reconnect that hasn't generated one yet.
      },
    })
  ).id;
  c2Pred = (
    await prisma.account.create({
      data: {
        userId: CLAIM2USER, provider: 'simplefin', providerRef: 'c2-pred', name: 'Amex (old)', type: 'CREDIT',
        currentBalanceCents: 200_000, currency: 'USD', dueDayOfMonth: 25, cycleCloseDayOfMonth: 1,
      },
    })
  ).id;
  // The predecessor's real CURRENT statement: $2000 due this cycle (>= today), unpaid.
  await prisma.statement.create({
    data: { accountId: c2Pred, cycleStart: '2026-05-26', cycleEnd: '2026-06-25', dueDate: '2026-07-25', statementBalanceCents: 200_000, minimumPaymentCents: 5_000 },
  });
  const c2Checking = (
    await prisma.account.create({
      data: { userId: CLAIM2USER, provider: 'plaid', providerRef: 'c2-chk', name: 'Checking', type: 'CHECKING', currentBalanceCents: 500_000, currency: 'USD' },
    })
  ).id;
  await prisma.user.update({ where: { id: CLAIM2USER }, data: { paymentAccountId: c2Checking } });
  await link(CLAIM2USER, c2Pred, c2Succ);

  // ── CLAIM 7: a valid same-currency pair AND a crafted cross-currency pair. The helper
  //    must supersede the valid predecessor but NOT the USD side of the cross-currency
  //    pair (its EUR "successor" is currency-withheld → the link is inert, assembler parity) ─
  const xcValidSucc = (
    await prisma.account.create({
      data: { userId: XCURRUSER, provider: 'plaid', providerRef: 'xc-vsucc', name: 'Valid live', type: 'CHECKING', currentBalanceCents: 100_000, currency: 'USD' },
    })
  ).id;
  xcValidPred = (
    await prisma.account.create({
      data: { userId: XCURRUSER, provider: 'simplefin', providerRef: 'xc-vpred', name: 'Valid old', type: 'CHECKING', currentBalanceCents: 90_000, currency: 'USD' },
    })
  ).id;
  xcEurSucc = (
    await prisma.account.create({
      data: { userId: XCURRUSER, provider: 'plaid', providerRef: 'xc-eur', name: 'Euro live', type: 'CHECKING', currentBalanceCents: 80_000, currency: 'EUR' },
    })
  ).id;
  xcUsdPred = (
    await prisma.account.create({
      data: { userId: XCURRUSER, provider: 'simplefin', providerRef: 'xc-usd', name: 'Dollar old', type: 'CHECKING', currentBalanceCents: 70_000, currency: 'USD' },
    })
  ).id;
  await link(XCURRUSER, xcValidPred, xcValidSucc);
  await link(XCURRUSER, xcUsdPred, xcEurSucc); // crafted cross-currency (confirm would refuse it)

  // ── R5: household whose PARTNER shares a reconciled pair (both sides shared) ─
  await prisma.household.create({
    data: {
      name: 'Casa Recon',
      members: { create: [{ userId: VIEWER, role: 'owner' }, { userId: PARTNER, role: 'partner' }] },
    },
  });
  const viewerChecking = (
    await prisma.account.create({
      data: { userId: VIEWER, provider: 'plaid', providerRef: 'v-chk', name: 'Viewer Checking', type: 'CHECKING', currentBalanceCents: 100_000, currency: 'USD' },
    })
  ).id;
  await prisma.user.update({ where: { id: VIEWER }, data: { paymentAccountId: viewerChecking } });
  partnerSucc = (
    await prisma.account.create({
      data: {
        userId: PARTNER, provider: 'plaid', providerRef: 'p-succ', name: 'Joint Checking (live)', type: 'CHECKING',
        currentBalanceCents: 300_000, currency: 'USD', mask: '4321', sharedToHousehold: true,
      },
    })
  ).id;
  partnerPred = (
    await prisma.account.create({
      data: {
        userId: PARTNER, provider: 'simplefin', providerRef: 'p-pred', name: 'Joint Checking (old)', type: 'CHECKING',
        currentBalanceCents: 290_000, currency: 'USD', mask: '4321', sharedToHousehold: true,
      },
    })
  ).id;
  partnerPredTxnId = (
    await prisma.transaction.create({
      data: { accountId: partnerPred, date: '2026-06-15', amountCents: -1_234, rawDescriptor: 'OLD COFFEE', categoryId: 'groceries', status: 'POSTED' },
    })
  ).id;
  await prisma.transaction.create({
    data: { accountId: partnerSucc, date: '2026-07-15', amountCents: -2_345, rawDescriptor: 'NEW COFFEE', categoryId: 'groceries', status: 'POSTED' },
  });
  await link(PARTNER, partnerPred, partnerSucc);
});

afterAll(async () => {
  await wipe();
  if (priorDemoToday === undefined) delete process.env.DEMO_TODAY;
  else process.env.DEMO_TODAY = priorDemoToday;
});

describe('R4: cash-needed uses the successor only', () => {
  it('a reconciled CREDIT card emits ONE obligation (successor); the predecessor never inflates the due', async () => {
    const cn = await getCashNeeded(R4USER, 'PAY_IN_FULL', 'mine');
    const cardIds = cn.result.cards.map((c) => c.cardId);
    expect(cardIds).toEqual([r4SuccCard]);
    expect(cardIds).not.toContain(r4PredCard);
    // Due total is the successor's statement only (60_000), never 60_000 + 50_000.
    const succCard = cn.result.cards.find((c) => c.cardId === r4SuccCard)!;
    expect(succCard.remainingDueCents).toBe(60_000);
    expect(cn.result.headline.requiredCents).toBe(60_000);
    expect(cn.result.headline.cardsDueCount).toBe(1);
  });

  it('no statement retains the predecessor’s account id — the successor covers this cycle (protects the coach cleared-streak)', async () => {
    // The predecessor's statement (cycleEnd 2026-05-25) is older than the successor's own
    // (2026-06-25), so the live successor owns the cycle and the stale copy is dropped —
    // no statement carries the predecessor's account id (re-keyed ones carry the successor's).
    const snap = await provider.getFinanceSnapshot(R4USER);
    expect(snap.statements.some((s) => s.accountId === r4PredCard)).toBe(false);
    expect(snap.statements.some((s) => s.accountId === r4SuccCard)).toBe(true);
  });

  it('CLAIM 2: a live successor on the ESTIMATE path inherits the predecessor’s current statement — the due stays in the headline', async () => {
    // c2Succ has no statement of its own (fresh reconnect); c2Pred's real $2000 due this
    // cycle re-keys onto it. Pre-fix (full-drop) the $2000 demoted to c2Succ's next-cycle
    // estimate and, because Other Visa has a real statement, dropped OUT of the headline.
    const cn = await getCashNeeded(CLAIM2USER, 'PAY_IN_FULL', 'mine');
    const cardIds = cn.result.cards.map((c) => c.cardId).sort();
    expect(cardIds).toEqual([c2CardX, c2Succ].sort());
    expect(cn.result.cards.some((c) => c.cardId === c2Pred)).toBe(false);
    // Other Visa $100 + the re-keyed $2000 = $2100, both REAL (not demoted to upcoming/estimate).
    expect(cn.result.headline.requiredCents).toBe(210_000);
    expect(cn.result.headline.cardsDueCount).toBe(2);
    const succCard = cn.result.cards.find((c) => c.cardId === c2Succ)!;
    expect(succCard.remainingDueCents).toBe(200_000);
    expect(succCard.isEstimated).toBe(false);
  });

  it('a reconciled LOAN emits ONE obligation (successor) in cash-needed AND the forecast — no phantom', async () => {
    const cn = await getCashNeeded(LOANUSER, 'PAY_IN_FULL', 'mine');
    expect(cn.loanObligations.map((o) => o.accountId)).toEqual([loanSucc]);

    const fc = await getCashFlowForecast(LOANUSER);
    const loanLabels = new Set(fc.forecast.upcoming.filter((e) => e.amountCents < 0).map((e) => e.label));
    expect(loanLabels.has('Mortgage (old)')).toBe(false);
    expect(loanLabels.has('Mortgage (live)')).toBe(true);
  });
});

describe('F6: predecessor scheduled rows re-key to the successor', () => {
  it('the paycheck re-keys from the predecessor onto the live successor in the snapshot', async () => {
    const snap = await provider.getFinanceSnapshot(F6USER);
    expect(snap.paymentAccountId).toBe(f6Succ); // remapped
    const paycheck = snap.scheduled.find((s) => s.description === 'Paycheck')!;
    expect(paycheck.accountId).toBe(f6Succ); // re-keyed
    // Nothing is left stranded on the zeroed predecessor.
    expect(snap.scheduled.some((s) => s.accountId === f6Pred)).toBe(false);
  });

  it('the forecast still projects the income (not silently dropped by the payment-account filter)', async () => {
    const fc = await getCashFlowForecast(F6USER);
    expect(fc.accountName).toBe('Checking (live)'); // anchored on the successor
    expect(fc.forecast.totalInflowCents).toBeGreaterThanOrEqual(500_000); // ≥ 1 paycheck lands in 90d
    expect(fc.forecast.upcoming.some((e) => e.label === 'Paycheck' && e.amountCents === 500_000)).toBe(true);
  });
});

describe('CLAIM 7: the household exclusion has EXACT assembler parity', () => {
  it('activeSupersededPredecessorIds supersedes the valid predecessor but NOT the inert cross-currency one', async () => {
    const superseded = await activeSupersededPredecessorIds([XCURRUSER]);
    // The same-currency link is effective → its predecessor is superseded.
    expect(superseded.has(xcValidPred)).toBe(true);
    // The cross-currency link's EUR successor is currency-withheld → the link is inert in
    // the assembler (the USD predecessor counts fully), so it must NOT be hidden here.
    expect(superseded.has(xcUsdPred)).toBe(false);
  });

  it('confirmReconciliationFor refuses a cross-currency link at the source', async () => {
    const res = await confirmReconciliationFor(
      XCURRUSER,
      { predecessorAccountId: xcUsdPred, successorAccountId: xcEurSucc, cutoverDate: CUTOVER, matchSignal: 'mask', confidence: 'high' },
      isoDate(TODAY),
    );
    expect(res).toEqual({ ok: false, error: 'Those accounts are in different currencies, so they can’t be the same account.' });
  });
});

describe('R5: household visibility follows the successor', () => {
  it('getSharedSnapshotSlice: the reconciled pair contributes the successor ONCE, predecessor + its rows absent', async () => {
    const slice = await getSharedSnapshotSlice(PARTNER);
    expect(slice.accounts.map((a) => a.id)).toEqual([partnerSucc]);
    expect(slice.transactions.some((t) => t.accountId === partnerPred)).toBe(false);
  });

  it('household cash-needed merges the pair once (successor only) — never the stale double', async () => {
    const cn = await getCashNeeded(VIEWER, 'PAY_IN_FULL', 'household');
    const partnerAccts = cn.snap.accounts.filter((a) => a.id === partnerPred || a.id === partnerSucc);
    expect(partnerAccts.map((a) => a.id)).toEqual([partnerSucc]);
  });

  it('getAccountSharingView: the successor appears once in “shared with you”, the predecessor never', async () => {
    actAs(VIEWER);
    const view = await getAccountSharingView();
    if (view.kind !== 'member') throw new Error('expected member view');
    const sharedIds = view.sharedWithMe.map((a) => a.id);
    expect(sharedIds).toContain(partnerSucc);
    expect(sharedIds).not.toContain(partnerPred);
  });

  it('getSharedTransactionsView: the predecessor’s stale rows never appear in the partner register', async () => {
    actAs(VIEWER);
    const view = await getSharedTransactionsView();
    if (view.kind !== 'member') throw new Error('expected member view');
    expect(view.rows.some((r) => r.accountId === partnerPred)).toBe(false);
    expect(view.rows.some((r) => r.accountId === partnerSucc)).toBe(true);
  });

  it('getHouseholdDigestContext: the reconciled predecessor is excluded from the mailed figures', async () => {
    const viewer = await resolveViewer(VIEWER);
    const ctx = await getHouseholdDigestContext(viewer, isoDate('2026-07-01'), isoDate(TODAY));
    expect(ctx).not.toBeNull();
    expect(Object.keys(ctx!.partnerAccountLabels)).toContain(partnerSucc);
    expect(Object.keys(ctx!.partnerAccountLabels)).not.toContain(partnerPred);
  });

  it('getHouseholdDuplicateCandidates: a reconciled pair is not offered as a household duplicate', async () => {
    const candidates = await getHouseholdDuplicateCandidates(VIEWER, [PARTNER]);
    const ids = candidates.map((c) => c.id);
    expect(ids).toContain(partnerSucc);
    expect(ids).not.toContain(partnerPred);
  });

  it('CLAIM 5: recategorizeSharedTransaction refuses a row on a superseded predecessor (write matches the hidden read)', async () => {
    actAs(VIEWER);
    // The register hides the predecessor's OLD COFFEE row; the write-guard must too —
    // else a member could mutate the categorization of an account they are never shown.
    const res = await recategorizeSharedTransaction({ transactionId: partnerPredTxnId, categoryId: 'dining' });
    expect(res).toMatchObject({ ok: false }); // guard excludes the superseded row → not found
    const txn = await prisma.transaction.findUnique({ where: { id: partnerPredTxnId }, select: { categoryId: true } });
    expect(txn?.categoryId).toBe('groceries'); // unchanged — the write was refused
  });
});
