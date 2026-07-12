/**
 * E2E fixture for the learned-vocabulary loop (TASKS 2.3 / DECISIONS #225).
 *
 * Nothing is learned until a user repeats a question, and the shared demo account
 * never learns at all (#226). To drive the real UI through a learned answer, this
 * script plants the evidence a REAL signed-up user would generate and then runs the
 * REAL miner over it — no entry is inserted by hand, so the e2e exercises the actual
 * promotion gates:
 *
 *   3 independent (LLM-rescued) asks of one phrasing  → mine → `shadow`
 *   2 more asks AFTER the mint (the held-out replay)  → mine → `flagged` (served)
 *
 * Idempotent: re-running resets that user's ledger + vocabulary first. Invoked by
 * tests/e2e/ask.spec.ts with DATABASE_URL pointed at the e2e database and
 * VOCAB_FIXTURE_EMAIL set to the account the spec just signed up.
 */
import { prisma } from '../src/lib/db';
import { runVocabMining } from '../src/server/vocab';

/** Parser-unroutable slang; the phrase key the miner will derive from it. */
const SCRUBBED = 'whats the damage on groceries';

async function main() {
  // This script DELETES a user's ledger. Run against a dev/production database by
  // accident and it destroys real rows, so it refuses to run anywhere but the
  // throwaway e2e file (#226 P3).
  if (!(process.env.DATABASE_URL ?? '').includes('test-e2e')) {
    throw new Error(
      `refusing to run: DATABASE_URL is not the e2e database (got ${process.env.DATABASE_URL ?? 'unset'})`,
    );
  }
  // A REAL signed-up account, never the demo user: the shared demo login does not
  // learn (server/vocab.ts), precisely so one visitor's typed words never surface in
  // the next visitor's settings. The spec signs up first and passes the email here.
  const email = process.env.VOCAB_FIXTURE_EMAIL;
  if (!email) throw new Error('VOCAB_FIXTURE_EMAIL is required (the signed-up e2e user)');
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  const USER_ID = user.id;

  await prisma.vocabEntry.deleteMany({ where: { userId: USER_ID } });
  await prisma.unknownQuestion.deleteMany({ where: { userId: USER_ID } });

  // /ask onboards a zero-account user instead of rendering the assistant, so give the
  // fresh account ONE account. Deliberately no transactions: the learned answer then
  // reads $0.00, which is exactly the point — the RULE routed the question, and the
  // ENGINE produced the figure.
  if ((await prisma.account.count({ where: { userId: USER_ID } })) === 0) {
    await prisma.account.create({
      data: {
        userId: USER_ID,
        provider: 'demo',
        name: 'Everyday Checking',
        type: 'CHECKING',
        currency: 'USD',
        currentBalanceCents: 100_000,
      },
    });
  }

  const now = Date.now();
  for (const minutesAgo of [50, 40, 30]) {
    await prisma.unknownQuestion.create({
      data: {
        userId: USER_ID,
        scrubbedText: SCRUBBED,
        llmGuessKind: 'spend_by_category',
        resolvedIntent: 'spend_by_category',
        createdAt: new Date(now - minutesAgo * 60_000),
      },
    });
  }

  const minted = await runVocabMining(USER_ID);
  const entry = await prisma.vocabEntry.findFirstOrThrow({ where: { userId: USER_ID } });
  if (entry.status !== 'shadow') throw new Error(`expected shadow, got ${entry.status}`);

  // Held-out: asks that arrived AFTER the rule existed, routed independently of it.
  for (const offset of [1, 2]) {
    await prisma.unknownQuestion.create({
      data: {
        userId: USER_ID,
        scrubbedText: SCRUBBED,
        llmGuessKind: 'spend_by_category',
        resolvedIntent: 'spend_by_category',
        createdAt: new Date(entry.createdAt.getTime() + offset * 1_000),
      },
    });
  }

  const promoted = await runVocabMining(USER_ID);
  const flagged = await prisma.vocabEntry.findFirstOrThrow({ where: { userId: USER_ID } });
  if (flagged.status !== 'flagged') throw new Error(`expected flagged, got ${flagged.status}`);

  console.log(JSON.stringify({ minted, promoted, status: flagged.status, phrase: flagged.phrase }));
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
