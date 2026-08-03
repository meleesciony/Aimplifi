/**
 * Per-user Fixed vs guilt-free category overrides (DECISIONS #376).
 */
import { prisma } from '@/lib/db';

/** categoryId → isFixed. Empty map = every category uses the app suggestion. */
export async function getCategoryFixedOverrides(
  userId: string,
): Promise<Map<string, boolean>> {
  const rows = await prisma.categoryFixedOverride.findMany({
    where: { userId },
    select: { categoryId: true, isFixed: true },
  });
  return new Map(rows.map((r) => [r.categoryId, r.isFixed]));
}
