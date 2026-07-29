/**
 * READ-ONLY production replay (owner report 2026-07-29: "I don't see the
 * categorization proposals"). Pulls the owner's UNFILED rows and his full
 * correction history straight from production, then runs the SHIPPED ladder
 * (`registerSuggestionFor`) over them and counts what it returns.
 *
 * Pure-function replay: no Prisma, no writes, no server code — the same engine
 * the register calls, fed the same two inputs the server hands it.
 * CREDENTIALS: reads `.env.prod.tmp` (gitignored). Delete it when done.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { registerSuggestionFor } from '@/lib/engine/categorize/register-suggestion';
import type { LearnedCorrectionInput } from '@/lib/engine/categorize/learn';

async function main() {
  const env = readFileSync('.env.prod.tmp', 'utf8');
  const url = env.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='))!
    .slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  const OWNER = 'cmqisanqh000004l7wylnhrpd';

  const corrRows = (await c.query(
    `select cr."transactionId", cr."toCategoryId", cr."undoesId",
            t."rawDescriptor", t."amountCents"
       from "Correction" cr join "Transaction" t on t.id = cr."transactionId"
      where cr."userId"=$1 order by cr."createdAt" asc`, [OWNER])).rows;
  const corrections: LearnedCorrectionInput[] = corrRows.map((r, i) => ({
    transactionId: r.transactionId, toCategoryId: r.toCategoryId,
    isUndo: r.undoesId != null, seq: i,
    rawDescriptor: r.rawDescriptor, amountCents: Number(r.amountCents),
  }));

  const unfiled = (await c.query(
    `select t."rawDescriptor", t."amountCents", t."isTransfer", t."reviewPinned",
            t."providerCategoryId", t."categoryId"
       from "Transaction" t join "Account" a on a.id=t."accountId"
      where a."userId"=$1 and t."needsReview"=true`, [OWNER])).rows;
  await c.end();

  const tally: Record<string, number> = { ruleset: 0, provider: 0, history: 0, NONE: 0 };
  const noneSamples: string[] = [];
  for (const t of unfiled) {
    const s = registerSuggestionFor(
      {
        currentCategoryId: t.categoryId ?? 'uncategorized',
        isTransfer: t.isTransfer,
        reviewPinned: t.reviewPinned,
        // The pipeline verdict needs the user's rules; this replay isolates the
        // tiers BELOW it, so it asks: with no ruleset hit, does anything else fire?
        pipelineCategoryId: 'uncategorized',
        providerCategoryId: t.providerCategoryId,
        txn: { rawDescriptor: t.rawDescriptor, amountCents: Number(t.amountCents) },
      },
      corrections,
    );
    if (s === null) {
      tally.NONE += 1;
      if (noneSamples.length < 12) noneSamples.push(t.rawDescriptor);
    } else tally[s.kind] += 1;
  }

  console.log(`\ncorrections loaded : ${corrections.length}`);
  console.log(`unfiled rows       : ${unfiled.length}\n`);
  console.table(tally);
  console.log('\nrows the ladder returns NOTHING for (sample):');
  for (const d of noneSamples) console.log('  ' + d);

}
void main();
