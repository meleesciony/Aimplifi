/**
 * AI Trust Center — touchpoint recorder + ledger read (AI plan §3.2, DECISIONS
 * #242).
 *
 * Deliberately NOT `import 'server-only'`: this module rides the same import
 * graph as vocab.ts/authz.ts, which the weekly-vocab cron fixture and other tsx
 * scripts load OUTSIDE the Next runtime (where `server-only` throws at import).
 * It is server-side by placement and by its prisma dependency, like authz.ts. Persists one AuditLog row per ATTEMPTED provider call, action
 * `ai.<touchpoint>.<outcome>`, meta already validated closed-set by the calling
 * module (see AiOutcomeSink's contract in engine/ai-audit/describe.ts).
 *
 * Demo fence (shared-demo lesson, #210/#226): the demo account is ONE shared
 * row, so nothing a visitor triggers may persist — the demo's ledger stays
 * honestly empty and the page discloses why. DEMO_USER_ID lives in the leaf
 * `@/lib/demo-user` module precisely so server modules like this can import it
 * without dragging in auth.
 *
 * Failure posture: recording is strictly subordinate to answering. Every write
 * is wrapped — a database fault degrades to an unrecorded touchpoint, never a
 * broken categorization/answer/recap. (The inverse trade — failing the user
 * action because the audit write failed — would punish the user to keep our
 * bookkeeping perfect.)
 */
import { prisma } from '@/lib/db';
import { DEMO_USER_ID } from '@/lib/demo-user';
import {
  type AiActionCount,
  type AiAuditEntry,
  type AiOutcomeSink,
  type AiTouchpointId,
  parseAiAuditRow,
} from '@/lib/engine/ai-audit/describe';

/**
 * Build the outcome sink for one touchpoint call. Pass the result as the
 * `onOutcome` argument of any `*ViaLLM` function.
 */
export function aiAuditSink(userId: string, touchpoint: AiTouchpointId): AiOutcomeSink {
  return async (outcome, meta) => {
    if (userId === DEMO_USER_ID) return; // shared demo account: never persist
    try {
      await prisma.auditLog.create({
        data: { userId, action: `ai.${touchpoint}.${outcome}`, meta: JSON.stringify(meta) },
      });
    } catch {
      // recording is subordinate to answering — swallow (posture in header)
    }
  };
}

/** Most-recent-first `ai.*` ledger entries for the Trust Center page. */
export async function getAiTrail(userId: string, take = 50): Promise<AiAuditEntry[]> {
  const rows = await prisma.auditLog.findMany({
    where: { userId, action: { startsWith: 'ai.' } },
    orderBy: { createdAt: 'desc' },
    take,
    select: { action: true, meta: true, createdAt: true },
  });
  return rows
    .map((r) => parseAiAuditRow({ action: r.action, meta: r.meta, createdAt: r.createdAt.toISOString() }))
    .filter((e): e is AiAuditEntry => e !== null);
}

/**
 * All-time COUNT of this user's `ai.*` AuditLog rows, grouped by action, for the
 * Trust Center's per-touchpoint track record (tallyTouchpoints turns it into
 * per-touchpoint stats). A COUNT of persisted rows — no model, and no windowing:
 * distinct from getAiTrail's most-recent-50 ledger, this is the lifetime tally.
 * The demo account persists no trail (aiAuditSink fences it), so this returns [].
 */
export async function getAiTouchpointCounts(userId: string): Promise<AiActionCount[]> {
  const groups = await prisma.auditLog.groupBy({
    by: ['action'],
    where: { userId, action: { startsWith: 'ai.' } },
    _count: { _all: true },
  });
  return groups.map((g) => ({ action: g.action, count: g._count._all }));
}
