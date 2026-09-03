/**
 * Per-user payee display-name overlay. One loader so the register, the
 * detail view, and every panel that paints a payee cannot disagree.
 */
import { prisma } from '@/lib/db';

export async function getPayeeRenames(userId: string): Promise<Map<string, string>> {
  const rows = await prisma.payeeRename.findMany({
    where: { userId },
    select: { payeeKey: true, name: true },
  });
  const m = new Map<string, string>();
  for (const r of rows) {
    const name = r.name.trim();
    if (name) m.set(r.payeeKey, name);
  }
  return m;
}
