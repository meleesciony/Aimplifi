import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { checkCronBearer } from '@/lib/cron-auth';
import { runVocabMining } from '@/server/vocab';

/**
 * Weekly vocabulary mining (TASKS 2.3 / DECISIONS #225). For each user: recompute
 * their learned phrases from their OWN UnknownQuestion ledger — mint the repeated
 * phrasings an independent resolver agreed on, promote the ones that held up on
 * asks the rule never influenced, and retire the ones a later resolution
 * contradicted. Per-user by construction; nothing is pooled across users.
 *
 * Reads and writes nothing a money engine ever touches, so the demo/golden dataset
 * stays byte-identical. A per-user fault is logged and the sweep continues.
 */
/**
 * The only cron that makes outbound calls (the weekly independent re-check, one per
 * SERVED phrase, ≤200 per user). Sequential per user, so give it real headroom rather
 * than dying mid-sweep and leaving later users unmined (#226 cycle 2, P3). Per-user
 * try/catch means a truncated sweep is a liveness gap, never an inconsistent state:
 * the next run recomputes everything from the ledger anyway.
 */
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!checkCronBearer(request.headers.get('authorization'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const users = await prisma.user.findMany({ select: { id: true } });
  const results: Array<Record<string, unknown>> = [];
  let minted = 0;
  let promoted = 0;
  let retired = 0;

  for (const user of users) {
    try {
      const r = await runVocabMining(user.id);
      minted += r.minted;
      promoted += r.promoted;
      retired += r.retired;
      results.push({ userId: user.id, ...r });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'unknown';
      try {
        await prisma.auditLog.create({
          data: { userId: user.id, action: 'vocab.cron.failed', meta: JSON.stringify({ message }) },
        });
      } catch {
        /* never abort the sweep on an audit write failure */
      }
      results.push({ userId: user.id, reason: 'error', message });
    }
  }

  return NextResponse.json({ usersChecked: users.length, minted, promoted, retired, results });
}
