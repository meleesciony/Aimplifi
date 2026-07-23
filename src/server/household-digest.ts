/**
 * Joint household digest — the server read (TASKS 4.2 slice 7, DECISIONS
 * #201(2) / #220). Like `household-finance.ts` this is Prisma-only and takes an
 * already-vetted `Viewer`: the digest runs in a CRON route with no session, so
 * importing the session-bound `@/server/authz` (and through it NextAuth) here
 * would drag the whole auth module into the cron import graph.
 *
 * Confidentiality is the QUERY SCOPE, never a fetch-then-filter (§4.3 rule 2,
 * critic F5): the account set is `{ userId in memberIds, sharedToHousehold: true }`
 * — every row it can return is one BOTH partners already see on /accounts and in
 * the register. A partner's unshared row never enters process memory (T1), and
 * because `memberIds` is DB-fresh from `resolveViewer`, a departed partner's rows
 * drop out on the next sweep (T2/T4).
 *
 * Note the account set is deliberately SYMMETRIC (every member's shared accounts,
 * including the viewer's own) — this is the one section of the joint digest that
 * is identical in both partners' emails. The WINDOW is symmetric too, but only
 * because every live member resolves the same business day: `businessToday` bends
 * only for the demo user (or a global DEMO_TODAY pin, which moves everyone alike),
 * and the demo user cannot hold a membership (T6 guard). If a per-user clock ever
 * lands, two members could summarize different windows — honest per recipient, but
 * no longer byte-identical, and the claim above would need to be retired.
 */
import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/db';
import type { ISODate } from '@/lib/dates';
import { detectHouseholdDuplicateAccounts } from '@/lib/engine/account/duplicates';
import type { HouseholdDigestContext } from '@/lib/engine/digest/build';
import { summarizeSharedMovement } from '@/lib/engine/household/digest';
import { SPENDING_ACCOUNT_TYPES } from '@/lib/engine/transactions/query';
import { isSupportedCurrency } from '@/lib/providers/currency';
import { partnerIdsOf, type Viewer } from '@/server/household-authz';
import { getHouseholdDuplicateCandidates } from '@/server/household-finance';
import { activeSupersededPredecessorIds } from '@/server/reconciliation';

/**
 * Shared-account context for the joint digest, or null when there is no joint
 * digest to build (no household, or a household of one — a solo member's
 * household scope IS 'mine', so they keep the personal digest verbatim, T6).
 *
 * `since`/`today` bound an INCLUSIVE window.
 */
export async function getHouseholdDigestContext(
  viewer: Viewer,
  since: ISODate,
  today: ISODate,
): Promise<HouseholdDigestContext | null> {
  if (!viewer.household) return null;
  if (partnerIdsOf(viewer).length === 0) return null;

  // Every shared account in the household, of ANY type — NOT just the spending
  // types. The owner-label map must cover a partner's shared LOAN too: loan dues
  // reach the digest via `loanObligations`, and an unlabeled one would fall back
  // to the second-person `reminderLine` (critic F1).
  const sharedWhere: Prisma.AccountWhereInput = {
    userId: { in: viewer.household.memberIds },
    sharedToHousehold: true,
  };

  // R5 (slice 4): a superseded reconciliation predecessor (any member's) is not part
  // of the shared set — dropping it here keeps the mailed dues/movement from
  // double-counting a member's reconciled pair, the same money-integrity rule the
  // interactive household surfaces apply.
  const [allShared, supersededIds] = await Promise.all([
    prisma.account.findMany({
      where: sharedWhere,
      select: { id: true, userId: true, currency: true, type: true },
    }),
    activeSupersededPredecessorIds(viewer.household.memberIds),
  ]);
  const accounts = allShared.filter((a) => !supersededIds.has(a.id));

  // accountId → owner name, for PARTNER-owned shared accounts only. The viewer's
  // OWN cards keep the personal second-person line, byte-identical. `|| 'Partner'`
  // unconditionally (slice-8 critic F-8): an absent or empty-string display name
  // must never leave a partner account unlabeled — an unlabeled partner due would
  // fall through to the second-person `reminderLine`, the exact F1 bug.
  const memberNames = viewer.household.memberNames;
  const partnerAccountLabels: Record<string, string> = {};
  for (const a of accounts) {
    if (a.userId === viewer.userId) continue;
    partnerAccountLabels[a.id] = memberNames[a.userId] || 'Partner';
  }

  // Currency guard (DECISIONS #135 parity): a non-USD shared account is withheld
  // from every money surface, the joint digest included — but COUNTED, so the
  // withhold is disclosed rather than silent (critic F3).
  const supported = accounts.filter((a) => isSupportedCurrency(a.currency));
  const withheldAccountCount = accounts.length - supported.length;
  // Movement is a transaction tally, so it spans the SPENDING accounts only —
  // the same set `getSharedSnapshotSlice` pulls transactions from.
  const accountIds = supported
    .filter((a) => SPENDING_ACCOUNT_TYPES.includes(a.type))
    .map((a) => a.id);

  const rows = accountIds.length
    ? await prisma.transaction.findMany({
        where: { accountId: { in: accountIds }, date: { gte: since, lte: today } },
        select: {
          date: true,
          amountCents: true,
          isTransfer: true,
          status: true,
          isSplitParent: true,
        },
      })
    : [];

  // Same-real-account-connected-twice disclosure (slice-8 critic F-5): the set
  // is the viewer's own accounts + partners' shared — exactly what the mailed
  // dues/movement are computed over. Advisory count only; nothing is adjusted.
  const duplicatePairCount = detectHouseholdDuplicateAccounts(
    await getHouseholdDuplicateCandidates(viewer.userId, partnerIdsOf(viewer)),
  ).length;

  return {
    name: viewer.household.name,
    partnerAccountLabels,
    withheldAccountCount,
    // ALL supported shared accounts, of any type (slice-8 critic F-4): the
    // "is anything shared at all?" branch must count a shared LOAN too — a
    // loan-only household must never read "no accounts are shared" beside
    // that loan's own due line.
    sharedAccountCount: supported.length,
    duplicatePairCount,
    movement: summarizeSharedMovement({
      rows: rows.map((r) => ({ ...r, date: r.date as ISODate })),
      accountCount: accountIds.length,
      since,
      today,
    }),
  };
}
