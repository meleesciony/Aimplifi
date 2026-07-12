/**
 * Household viewer/scope resolution — deliberately Prisma-only, NO import of
 * `@/auth` (next-auth). `@/server/authz.ts` re-exports everything here for
 * session-based callers; server functions that already hold a vetted userId
 * (never from a request session — e.g. `getCashNeeded`/`getDashboardData`,
 * cron routes) import directly from this module so pulling in the finance
 * layer never drags the full NextAuth instance into unrelated import graphs
 * (a cron test suite that doesn't mock `@/auth` would otherwise load the real
 * next-auth module and fail on module resolution — caught in TASKS 4.2 slice 4).
 */
import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/db';
import {
  householdRepairAction,
  type HouseholdRole,
} from '@/lib/engine/household/membership';

export type Viewer = {
  userId: string;
  household: null | {
    id: string;
    name: string;
    /** The VIEWER's role, post-repair. */
    role: HouseholdRole;
    memberIds: string[];
    /** userId → display name (name ?? email), same fallback as the slice 2/3
     *  owner-badge precedent (`src/server/household.ts`). Additive (TASKS 4.2
     *  slice 5): lets a caller badge which partner a shared card/account
     *  belongs to without a second query. */
    memberNames: Record<string, string>;
  };
};

/**
 * Resolves a (trusted) userId to viewer identity + household context in one
 * query (HOUSEHOLD_ARCHITECTURE §4.3). Membership is evaluated per request
 * against the DB, so removal/leave takes effect on the next query with no
 * JWT work.
 *
 * SELF-HEAL (§4.1 lazy repair, T11): if the resolved household has members but
 * no owner (the owner left, was deleted, or a crash interrupted bookkeeping),
 * the deterministic promotion target (earliest joinedAt, tie-break lowest
 * userId — pure `householdRepairAction`) is promoted idempotently here, at
 * read. Concurrent readers compute the SAME target, so the updateMany
 * converges. A zero-member household is unreachable through this path (the
 * viewer IS a member) and is reaped opportunistically by the household actions.
 */
export async function resolveViewer(userId: string): Promise<Viewer> {
  const membership = await prisma.householdMember.findUnique({
    where: { userId },
    select: {
      household: {
        select: {
          id: true,
          name: true,
          members: {
            select: {
              userId: true,
              role: true,
              joinedAt: true,
              user: { select: { name: true, email: true } },
            },
          },
        },
      },
    },
  });
  if (!membership) return { userId, household: null };

  let members = membership.household.members;
  const repair = householdRepairAction(members);
  if (repair.kind === 'promote') {
    await prisma.householdMember.updateMany({
      where: { householdId: membership.household.id, userId: repair.userId },
      data: { role: 'owner' },
    });
    members = members.map((m) =>
      m.userId === repair.userId ? { ...m, role: 'owner' } : m,
    );
  }

  const mine = members.find((m) => m.userId === userId);
  // Guaranteed present (members came from the same query snapshot as the
  // viewer's own membership row) — the guard exists for type narrowing and
  // fails CLOSED to "no household" if that invariant is ever broken.
  if (!mine) return { userId, household: null };

  return {
    userId,
    household: {
      id: membership.household.id,
      name: membership.household.name,
      role: mine.role as HouseholdRole,
      memberIds: members.map((m) => m.userId),
      // `||`, not `??` (slice-8 critic F-8): a persisted empty-string display
      // name must still fall back to the email — an empty label downstream
      // would let a partner-owned due fall through to second-person copy.
      memberNames: Object.fromEntries(members.map((m) => [m.userId, m.user.name || m.user.email])),
    },
  };
}

/** The viewer's household partners (member ids minus self). Empty without a household. */
export function partnerIdsOf(viewer: Viewer): string[] {
  if (!viewer.household) return [];
  return viewer.household.memberIds.filter((id) => id !== viewer.userId);
}

/**
 * The partner-shared slice of the visible set (TASKS 4.2 slice 2 —
 * HOUSEHOLD_ARCHITECTURE §4.3): accounts a LIVE household partner has flagged
 * `sharedToHousehold`. Returns null when the viewer has no partners, so callers
 * can skip the query entirely — a `userId: { in: [] }` where matches nothing,
 * but null makes the degenerate case explicit and unqueryable by accident.
 *
 * Liveness is inherited from `resolveViewer()`: `memberIds` is resolved from
 * the DB per request, so a departed partner (T2/T4) drops out of this predicate
 * on the next read even if their share flags were somehow left set.
 */
export function partnerSharedAccountsWhere(viewer: Viewer): Prisma.AccountWhereInput | null {
  const partnerIds = partnerIdsOf(viewer);
  if (partnerIds.length === 0) return null;
  return { sharedToHousehold: true, userId: { in: partnerIds } };
}

/**
 * THE single widened read scope (§4.3 rule 2) — hand-rolled OR clauses in
 * fetchers are a review-rejectable defect; compose this instead. With no
 * household, or a household with no partners, it MUST degenerate to exactly
 * `{ userId }` (T6 — unit-locked by deep equality, not just equivalent
 * semantics), so every existing surface that adopts it stays byte-identical
 * for solo users and the demo user.
 *
 * SANCTIONED PREDICATE SITES (slice-8 critic B-3). Exactly four widened-read
 * predicates exist; anything else hand-rolling a share clause is a defect:
 *   1. this helper + `partnerSharedAccountsWhere` above (viewer-relative);
 *   2. `household-finance.ts` — `{ userId: partnerId, sharedToHousehold: true }`
 *      per PARTNER slice (the aggregate helper can't express a per-partner read);
 *   3. `household-digest.ts` — `{ userId: { in: memberIds }, sharedToHousehold:
 *      true }` — SYMMETRIC (includes the viewer's own shared rows) by design;
 *      copying it into a viewer-relative surface would be wrong;
 *   4. `household.ts` consent/read views via `partnerSharedAccountsWhere`.
 * If you need a new shape, add it HERE and to this list in the same commit.
 */
export function visibleAccountsWhere(viewer: Viewer): Prisma.AccountWhereInput {
  const shared = partnerSharedAccountsWhere(viewer);
  if (!shared) return { userId: viewer.userId };
  return { OR: [{ userId: viewer.userId }, shared] };
}
