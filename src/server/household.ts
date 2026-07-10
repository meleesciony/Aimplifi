/**
 * Household view assembly for /settings (TASKS 4.2 slice 1). Read path only.
 * Goes through `requireViewer()` so the §4.1 lazy repair runs on every
 * settings read — the self-heal's primary trigger point.
 */
import { prisma } from '@/lib/db';
import { requireViewer } from '@/server/authz';
import { normalizeEmail } from '@/lib/auth/validate';
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
