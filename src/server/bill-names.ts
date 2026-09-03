/**
 * Per-user repeating-bill overlays. Names and off-plan keys. Overlay only —
 * detection identity is untouched. One loader per overlay so the plan figure
 * and the Fixed list cannot disagree.
 */
import { prisma } from '@/lib/db';
import { categoryName } from '@/lib/engine/categorize/categories';
import { overrideKey } from '@/lib/engine/recurring/override';
import { UNNAMED_BILL_LABEL } from '@/lib/engine/spending-plan/bill-rename';
import { RESERVE_KIND } from '@/lib/engine/spending-plan/reserves';

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

export type BillTakenOff = { billKey: string; label: string };

function labelForTakenOffBill(
  billKey: string,
  names: ReadonlyMap<string, string>,
): string {
  const overlay = names.get(billKey)?.trim();
  if (overlay) return overlay;
  if (billKey.startsWith('unnamed:')) {
    const rest = billKey.slice('unnamed:'.length);
    const lastColon = rest.lastIndexOf(':');
    const categoryId = lastColon >= 0 ? rest.slice(0, lastColon) : rest;
    if (categoryId) return `${UNNAMED_BILL_LABEL} (${categoryName(categoryId)})`;
    return UNNAMED_BILL_LABEL;
  }
  return billKey;
}

/**
 * Bills the household took off the spending plan (or marked NOT_BILL so they
 * left it). Converted reserves keep their NOT_BILL as half of the pair — they
 * are not "taken off". Empty keys skipped. Dedupe by billKey.
 */
export async function getBillsTakenOffPlan(userId: string): Promise<BillTakenOff[]> {
  const [offRows, notBillRows, names, linkedReserves] = await Promise.all([
    prisma.billOffPlan.findMany({ where: { userId }, select: { billKey: true } }),
    prisma.recurringOverride.findMany({
      where: { userId, decision: 'NOT_BILL' },
      select: { merchantCanonical: true },
    }),
    getBillRenames(userId),
    prisma.goal.findMany({
      where: { userId, kind: RESERVE_KIND, merchantCanonical: { not: null } },
      select: { merchantCanonical: true },
    }),
  ]);
  const linked = new Set(
    linkedReserves.map((g) => overrideKey(g.merchantCanonical as string)),
  );
  const keys = new Set<string>();
  for (const r of offRows) {
    const k = r.billKey.trim();
    if (!k) continue;
    if (linked.has(overrideKey(k))) continue;
    keys.add(k);
  }
  for (const r of notBillRows) {
    const k = r.merchantCanonical.trim();
    if (!k) continue;
    if (linked.has(overrideKey(k))) continue;
    keys.add(k);
  }
  return [...keys]
    .map((billKey) => ({ billKey, label: labelForTakenOffBill(billKey, names) }))
    .sort((a, b) => a.label.localeCompare(b.label) || a.billKey.localeCompare(b.billKey));
}
