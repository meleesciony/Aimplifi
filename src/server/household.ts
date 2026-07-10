/**
 * Household view assembly for /settings (TASKS 4.2 slice 1). Read path only.
 * Goes through `requireViewer()` so the §4.1 lazy repair runs on every
 * settings read — the self-heal's primary trigger point.
 */
import { prisma } from '@/lib/db';
import { partnerSharedAccountsWhere, requireViewer } from '@/server/authz';
import { normalizeEmail } from '@/lib/auth/validate';
import { isSupportedCurrency } from '@/lib/providers/currency';
import { isLiabilityType } from '@/lib/engine/transactions/query';
import {
  inviteEffectiveStatus,
  type HouseholdRole,
} from '@/lib/engine/household/membership';

export type HouseholdView =
  | {
      kind: 'none';
      /** Pending, unexpired invites addressed to MY sign-in email. */
      invites: Array<{
        id: string;
        householdName: string;
        invitedByName: string | null;
        expiresAt: string; // ISO — display only
      }>;
    }
  | {
      kind: 'member';
      householdId: string;
      name: string;
      role: HouseholdRole;
      members: Array<{
        userId: string;
        name: string | null;
        email: string;
        role: string;
        isSelf: boolean;
      }>;
      /** Pending, unexpired outgoing invites for this household. */
      pendingInvites: Array<{ id: string; email: string; expiresAt: string }>;
    };

/** A partner's shared account, read-only (TASKS 4.2 slice 2). Balance is copied
 * verbatim from the owner's row — no recomputation (no-fabrication). */
export type SharedAccountRow = {
  id: string;
  name: string;
  type: string;
  mask: string | null;
  currentBalanceCents: number;
  isLiability: boolean;
  /** Owner display label (name, else email) — attribution honesty (§4.4). */
  ownerLabel: string;
};

export type AccountSharingView =
  | { kind: 'none' }
  | {
      kind: 'member';
      householdName: string;
      /** The viewer's OWN accounts with their share flag — the toggle list.
       * Currency-supported only, matching every other surface's guard. */
      mine: Array<{
        id: string;
        name: string;
        type: string;
        mask: string | null;
        sharedToHousehold: boolean;
      }>;
      /** Accounts LIVE partners have shared — read-only, owner-badged. */
      sharedWithMe: SharedAccountRow[];
    };

/**
 * /accounts household-sharing view (TASKS 4.2 slice 2). DELIBERATELY a
 * separate query path from `getAccountsView` — the #192 cross-provider
 * duplicate detector's input must stay the viewer's OWNED set
 * (HOUSEHOLD_ARCHITECTURE §4.4 critic F10 / T9), so partner rows never enter
 * that function. The widened read goes through `partnerSharedAccountsWhere`
 * (§4.3 rule 2); no connection, sync, or credential fields are selected for
 * partner rows (T5).
 */
export async function getAccountSharingView(): Promise<AccountSharingView> {
  const viewer = await requireViewer();
  if (!viewer.household) return { kind: 'none' };

  const sharedWhere = partnerSharedAccountsWhere(viewer);
  const [mine, shared] = await Promise.all([
    prisma.account.findMany({
      where: { userId: viewer.userId },
      select: {
        id: true,
        name: true,
        type: true,
        mask: true,
        sharedToHousehold: true,
      },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    }),
    sharedWhere
      ? prisma.account.findMany({
          where: sharedWhere,
          select: {
            id: true,
            name: true,
            type: true,
            mask: true,
            currency: true,
            currentBalanceCents: true,
            user: { select: { name: true, email: true } },
          },
          orderBy: [{ type: 'asc' }, { name: 'asc' }],
        })
      : Promise.resolve([]),
  ]);

  return {
    kind: 'member',
    householdName: viewer.household.name,
    // Deliberately NOT currency-filtered (critic slice-2 F3): the toggle list
    // is consent management, not money aggregation — an owner must always be
    // able to SEE and REVOKE a share flag, even on an account the money
    // surfaces withhold. (Partner-side display below stays currency-guarded.)
    mine: mine.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      mask: a.mask,
      sharedToHousehold: a.sharedToHousehold,
    })),
    sharedWithMe: shared
      .filter((a) => isSupportedCurrency(a.currency))
      .map((a) => ({
        id: a.id,
        name: a.name,
        type: a.type,
        mask: a.mask,
        currentBalanceCents: a.currentBalanceCents,
        isLiability: isLiabilityType(a.type),
        ownerLabel: a.user.name ?? a.user.email,
      })),
  };
}

export async function getHouseholdView(): Promise<HouseholdView> {
  const viewer = await requireViewer();
  const now = new Date();

  if (!viewer.household) {
    const me = await prisma.user.findUnique({
      where: { id: viewer.userId },
      select: { email: true },
    });
    if (!me) return { kind: 'none', invites: [] };
    const rows = await prisma.householdInvite.findMany({
      where: { email: normalizeEmail(me.email), status: 'pending' },
      select: {
        id: true,
        expiresAt: true,
        status: true,
        invitedById: true,
        household: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const live = rows.filter((r) => inviteEffectiveStatus(r, now) === 'pending');
    // invitedById is a plain string (no FK) — resolve display names best-effort.
    const inviters = await prisma.user.findMany({
      where: { id: { in: [...new Set(live.map((r) => r.invitedById))] } },
      select: { id: true, name: true, email: true },
    });
    const inviterById = new Map(inviters.map((u) => [u.id, u.name ?? u.email]));
    return {
      kind: 'none',
      invites: live.map((r) => ({
        id: r.id,
        householdName: r.household.name,
        invitedByName: inviterById.get(r.invitedById) ?? null,
        expiresAt: r.expiresAt.toISOString(),
      })),
    };
  }

  const [members, invites] = await Promise.all([
    prisma.householdMember.findMany({
      where: { householdId: viewer.household.id },
      select: {
        userId: true,
        role: true,
        joinedAt: true,
        user: { select: { name: true, email: true } },
      },
      orderBy: { joinedAt: 'asc' },
    }),
    prisma.householdInvite.findMany({
      where: { householdId: viewer.household.id, status: 'pending' },
      select: { id: true, email: true, expiresAt: true, status: true },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  return {
    kind: 'member',
    householdId: viewer.household.id,
    name: viewer.household.name,
    role: viewer.household.role,
    members: members.map((m) => ({
      userId: m.userId,
      name: m.user.name,
      email: m.user.email,
      role: m.role,
      isSelf: m.userId === viewer.userId,
    })),
    pendingInvites: invites
      .filter((i) => inviteEffectiveStatus(i, now) === 'pending')
      .map((i) => ({ id: i.id, email: i.email, expiresAt: i.expiresAt.toISOString() })),
  };
}
