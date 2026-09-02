/**
 * Per-user repeating-bill display names. Overlay only — detection identity
 * is untouched. One loader so the plan page and Settings Fixed card cannot
 * disagree.
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
