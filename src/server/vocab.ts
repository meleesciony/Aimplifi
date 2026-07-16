/**
 * Learned vocabulary — the I/O around the pure miner (TASKS 2.3 / DECISIONS #225).
 *
 * Prisma only: NO NextAuth in this import graph (the weekly cron imports it, and the
 * cron has no session — the #220 rule; DEMO_USER_ID therefore comes from the
 * NextAuth-free @/lib/demo-user). Every function takes an explicit userId and scopes
 * every query and every write by it: a phrase mined from one user's asks can never be
 * read, served, or retired by another. The user-facing server actions live in
 * server/vocab-actions.ts, which is where the session is resolved.
 */
import { prisma } from '@/lib/db';
import { DEMO_USER_ID } from '@/lib/demo-user';
import { aiAuditSink } from '@/server/ai-audit';
import { classifyIntentViaLLM } from '@/server/assistant-llm';
import {
  MAX_ENTRIES_PER_USER,
  SERVABLE_STATUSES,
  matchVocab,
  mineVocab,
  type ServableVocabEntry,
  type VocabEvidence,
  type VocabLedgerRow,
  type VocabMatch,
  type VocabStatus,
} from '@/lib/engine/vocab/vocab';

/** Ledger rows the miner reads per user. A year of heavy asking; the recent tail is
 *  what the gates actually turn on (held-out + served evidence). */
const MINING_WINDOW_ROWS = 2000;

/**
 * The demo account never learns.
 *
 * It is a credential-free ONE-CLICK login, so every anonymous visitor signs in as the
 * SAME user row. A learned phrase is text a visitor TYPED, stored durably and rendered
 * back on /settings and inside Ask answers — so on a shared account it would show one
 * stranger's words ("can melissa and i afford ivf…") to the next, under copy promising
 * it is shared with no one. The scrub masks emails, amounts and digits; it does not
 * mask names, employers, clinics, or lawyers. Household membership is fenced off the
 * demo user for the same reason (#210). Read-only demo DATA is fine to share; a demo
 * visitor's own INPUT is not. Guarded on every path — mine, serve, and list — so no
 * single call site is load-bearing.
 */
function learningDisabled(userId: string): boolean {
  return userId === DEMO_USER_ID;
}

export interface VocabMiningResult {
  minted: number;
  promoted: number;
  retired: number;
  updated: number;
  /** Retired by the weekly independent re-check (see auditServableEntries). */
  recheckRetired: number;
}

const NOTHING: VocabMiningResult = { minted: 0, promoted: 0, retired: 0, updated: 0, recheckRetired: 0 };

/** The entries the Ask path may serve (flagged + active). Ownership-scoped. */
export async function getServableVocab(userId: string): Promise<ServableVocabEntry[]> {
  if (learningDisabled(userId)) return [];
  const rows = await prisma.vocabEntry.findMany({
    where: { userId, status: { in: [...SERVABLE_STATUSES] } },
    select: { id: true, phrase: true, kind: true, status: true },
    take: MAX_ENTRIES_PER_USER,
  });
  return rows.map((r) => ({
    id: r.id,
    phrase: r.phrase,
    kind: r.kind,
    status: r.status as ServableVocabEntry['status'],
  }));
}

/**
 * Look up ONE question in this user's servable vocabulary. Returns the intent KIND
 * only — the caller re-derives every parameter from the question itself. Never
 * throws: a fault here must degrade to the existing LLM / `unknown` path, not break
 * the answer.
 */
export async function lookupVocab(userId: string, question: string): Promise<VocabMatch | null> {
  try {
    return matchVocab(question, await getServableVocab(userId));
  } catch {
    return null;
  }
}

/**
 * The weekly INDEPENDENT re-check — the loop's reversion gate (audit §4 constitution
 * (e): "reverted automatically on metric regression").
 *
 * Once an entry is served, it short-circuits the LLM, so no independent resolution of
 * that phrase is ever written to the ledger again: without this pass, a rule that
 * turned out to be wrong could never be contradicted by anything except a human
 * clicking undo, and it would still self-promote to `active` on its own serves (the
 * critic's #226 P1). So once a week, off the answer path, every SERVED phrase is
 * replayed against the classifier that is not allowed to see the rule. Disagreement
 * retires it.
 *
 * Fails safe in both directions: with no provider key (or on any error) the classifier
 * returns null and nothing is retired — the entry keeps serving exactly as it did,
 * which is disclosed. And a FALSE retire costs the user nothing: the question simply
 * goes back to the LLM/unknown route it had before it was ever learned. That asymmetry
 * is why one disagreement is enough.
 *
 * Only the scrubbed, normalized phrase is sent — strictly less than the raw question
 * the live LLM route already sends, and never any account data.
 */
async function auditServableEntries(userId: string): Promise<number> {
  const served = await prisma.vocabEntry.findMany({
    where: { userId, status: { in: [...SERVABLE_STATUSES] } },
    select: { id: true, phrase: true, kind: true },
    take: MAX_ENTRIES_PER_USER,
  });

  let retired = 0;
  for (const entry of served) {
    let verdict: string | null = null;
    try {
      verdict = await classifyIntentViaLLM(entry.phrase, aiAuditSink(userId, 'vocab_recheck')); // §3.2 trail
    } catch {
      continue; // no opinion → no change
    }
    if (!verdict || verdict === entry.kind) continue;
    const written = await prisma.vocabEntry.updateMany({
      where: { id: entry.id, userId, status: { in: [...SERVABLE_STATUSES] } },
      data: { status: 'retired', retiredAt: new Date() },
    });
    if (written.count === 0) continue;
    retired += written.count;
    // A machine-initiated reversal must not be silent — the constitution says every
    // adaptation is VISIBLE, and that has to include un-learning. The user-initiated
    // undo writes `vocab.retired`; this writes its own action, so the two are
    // distinguishable in the trail rather than looking identical at rest (#226 cycle 2).
    try {
      await prisma.auditLog.create({
        data: {
          userId,
          action: 'vocab.retired.recheck',
          meta: JSON.stringify({ entryId: entry.id, learnedKind: entry.kind, verdict }),
        },
      });
    } catch {
      /* an audit-write fault must not leave a disproven rule serving */
    }
  }
  return retired;
}

/**
 * Run the weekly mining pass for ONE user. Reads that user's UnknownQuestion ledger,
 * hands it to the pure miner with the user's existing entries, applies the decisions
 * verbatim, then re-checks everything it is already serving against an independent
 * resolver.
 *
 * Counts are OVERWRITTEN with the recomputed values (never incremented) and `retired`
 * is terminal — the no-ratchet rule, enforced in the engine and preserved here.
 */
export async function runVocabMining(userId: string): Promise<VocabMiningResult> {
  if (learningDisabled(userId)) return { ...NOTHING };

  const [ledger, entries] = await Promise.all([
    prisma.unknownQuestion.findMany({
      where: { userId },
      select: { scrubbedText: true, resolvedIntent: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: MINING_WINDOW_ROWS,
    }),
    prisma.vocabEntry.findMany({
      where: { userId },
      select: {
        id: true,
        phrase: true,
        kind: true,
        status: true,
        createdAt: true,
        evidenceThrough: true,
        supportCount: true,
        heldOutHits: true,
        heldOutMisses: true,
        servedCount: true,
      },
    }),
  ]);

  const rows: VocabLedgerRow[] = ledger.map((r) => ({
    scrubbedText: r.scrubbedText,
    resolvedIntent: r.resolvedIntent,
    at: r.createdAt.getTime(),
  }));
  const stored = new Map<string, VocabEvidence>(
    entries.map((e) => [
      e.id,
      {
        supportCount: e.supportCount,
        heldOutHits: e.heldOutHits,
        heldOutMisses: e.heldOutMisses,
        servedCount: e.servedCount,
      },
    ]),
  );

  const decisions = mineVocab(
    rows,
    entries.map((e) => ({
      id: e.id,
      phrase: e.phrase,
      kind: e.kind,
      status: e.status as VocabStatus,
      createdAt: e.createdAt.getTime(),
      // Pre-#226 rows carry no boundary; fall back to the mint time they were judged by.
      evidenceThrough: (e.evidenceThrough ?? e.createdAt).getTime(),
    })),
    stored,
  );

  const result: VocabMiningResult = { ...NOTHING };
  const now = new Date();

  for (const d of decisions) {
    if (d.op === 'mint') {
      try {
        await prisma.vocabEntry.create({
          data: {
            userId,
            phrase: d.phrase,
            kind: d.kind,
            status: d.status,
            evidenceThrough: new Date(d.evidenceThrough ?? now.getTime()),
            ...d.evidence,
          },
        });
        result.minted += 1;
      } catch (e) {
        // ONLY the documented race: unique [userId, phrase] — a concurrent run already
        // minted it. Anything else is a real fault and must not be swallowed silently.
        if ((e as { code?: string }).code !== 'P2002') throw e;
      }
      continue;
    }
    // `status: { not: 'retired' }` is load-bearing, not defensive: the miner READS,
    // then decides, then writes. A user who clicks "Not what I meant" inside that
    // window would otherwise have their rejection overwritten by a stale decision —
    // and the rejection lives nowhere else, so it would be gone for good (#226 P1).
    // A tombstone always wins the race. `userId` in the filter scopes the write too.
    const written = await prisma.vocabEntry.updateMany({
      where: { id: d.id, userId, status: { not: 'retired' } },
      data: {
        status: d.status,
        ...d.evidence,
        ...(d.changed && d.status === 'retired' ? { retiredAt: now } : {}),
        ...(d.changed && (d.status === 'flagged' || d.status === 'active') ? { promotedAt: now } : {}),
      },
    });
    if (written.count === 0) continue;
    if (!d.changed) result.updated += 1;
    else if (d.status === 'retired') result.retired += 1;
    else result.promoted += 1;
  }

  result.recheckRetired = await auditServableEntries(userId);
  return result;
}

export interface LearnedPhrase {
  id: string;
  phrase: string;
  kind: string;
  status: VocabStatus;
  supportCount: number;
  servedCount: number;
}

/** Every phrase Aimplifi has learned FOR THIS USER, for the AI-trust disclosure.
 *  Includes shadow (learned but not yet used) so nothing is hidden; excludes the
 *  retired tombstones, which are no longer part of the routing table. */
export async function listLearnedPhrases(userId: string): Promise<LearnedPhrase[]> {
  if (learningDisabled(userId)) return [];
  const rows = await prisma.vocabEntry.findMany({
    where: { userId, status: { not: 'retired' } },
    select: { id: true, phrase: true, kind: true, status: true, supportCount: true, servedCount: true },
    orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
    take: MAX_ENTRIES_PER_USER,
  });
  return rows.map((r) => ({ ...r, status: r.status as VocabStatus }));
}

/**
 * Forget a learned phrase. Terminal by design: `retired` tombstones the phrase so the
 * next mining run cannot resurrect it from the very evidence the user just rejected.
 * Ownership-scoped in the filter — a foreign id simply matches nothing.
 */
export async function retireVocabEntry(userId: string, entryId: string): Promise<boolean> {
  const written = await prisma.vocabEntry.updateMany({
    where: { id: entryId, userId, status: { not: 'retired' } },
    data: { status: 'retired', retiredAt: new Date() },
  });
  return written.count > 0;
}
