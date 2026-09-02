/**
 * Per-user repeating-bill overlays. Names and off-plan keys. Overlay only —
 * detection identity is untouched. One loader per overlay so the plan figure
 * and the Fixed list cannot disagree.
 */
import { prisma } from '@/lib/db';

export async function getBillRenames(userId: string): Promise<Map<string, string>> {
  const rows = await prisma.billRename.findMany({
    where: { userId },
    select: { billKey: true, name: true },
  });
  const m = new Map<string, string>();
  for (const r of rows) {
    const name = r.name.trim();
    if (name) m.set(r.billKey, name);
  }
  return m;
}

/** billKeys the household took off the spending plan. Overlay only. */
export async function getBillOffPlanKeys(userId: string): Promise<Set<string>> {
  const rows = await prisma.billOffPlan.findMany({
    where: { userId },
    select: { billKey: true },
  });
  return new Set(rows.map((r) => r.billKey));
}
