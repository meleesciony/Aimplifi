/**
 * Additive live-demo tag seeder (one-off, run by hand against the production DB).
 *
 * Same shape as `seed-demo-goals-prod.ts` (GL.4): `prisma db seed` wipes every
 * table and refuses Postgres without --force-prod — right on a DB that carries
 * real users. O.11d's two demo tags are ADDITIVE rows on the shared demo user
 * (`user-demo`), so this script upserts exactly those rows plus their six join
 * rows and touches nothing else. Idempotent: run twice, still 2 tags / 6 joins.
 *
 * The join targets are NOT hardcoded: they are read from `buildSeedData('2026-06-10')`
 * (the same deterministic selection SEED_SPEC §Tags documents), and every join is
 * VERIFIED against the production rows before anything is written — if the live
 * demo was ever seeded with a different asOf (different transaction ids), the
 * script reports the mismatch and writes NOTHING rather than guess.
 *
 * Usage (owner or a trusted operator, from a shell with the prod DATABASE_URL):
 *   DATABASE_URL="postgresql://…" npx tsx scripts/seed-demo-tags-prod.ts
 *
 * Node type: state-writer (additive, idempotent, demo-row only). Refuses to run
 * without a Postgres URL (never touches the local SQLite dev.db by accident).
 */
import { makeAdapter } from '../src/lib/db-adapter';
import { PrismaClient } from '../src/generated/prisma/client';
import { buildSeedData } from '../src/lib/seed/build';

const url = process.env.DATABASE_URL ?? '';
if (!url.startsWith('postgres')) {
  console.error(
    'Refusing: set DATABASE_URL to the production Postgres URL. This script only writes the two demo tag rows and their joins.',
  );
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: makeAdapter(url) });

const seed = buildSeedData('2026-06-10');

async function main() {
  const demo = await prisma.user.findUnique({ where: { id: 'user-demo' }, select: { id: true } });
  if (!demo) {
    console.error('No user-demo row on this database — seed the demo account first (DEPLOY.md §6).');
    process.exit(1);
  }

  // Verify every assignment points at a transaction the live demo user owns.
  // Read-only until every check passes — a half-applied seed is worse than none.
  for (const a of seed.tagAssignments) {
    const txn = await prisma.transaction.findFirst({
      where: { id: a.transactionId, account: { userId: demo.id } },
      select: { id: true },
    });
    if (!txn) {
      console.error(
        `Refusing to write: seed assignment ${a.id} points at transaction ${a.transactionId}, which the live demo user does not own. The live demo was likely seeded with a different asOf — re-derive the selection against the live rows instead of forcing this script.`,
      );
      process.exit(1);
    }
  }

  for (const t of seed.tags) {
    const existing = await prisma.tag.findFirst({ where: { id: t.id, userId: demo.id }, select: { id: true } });
    if (existing) {
      await prisma.tag.update({ where: { id: t.id }, data: { name: t.name } });
      console.log('updated tag', t.id, `(${t.name})`);
    } else {
      await prisma.tag.create({ data: { id: t.id, userId: demo.id, name: t.name } });
      console.log('created tag', t.id, `(${t.name})`);
    }
  }

  for (const a of seed.tagAssignments) {
    const existing = await prisma.transactionTag.findFirst({
      where: { tagId: a.tagId, transactionId: a.transactionId },
      select: { id: true },
    });
    if (existing) {
      console.log('join exists', a.id);
    } else {
      await prisma.transactionTag.create({
        data: { id: a.id, tagId: a.tagId, transactionId: a.transactionId },
      });
      console.log('created join', a.id);
    }
  }

  const tagCount = await prisma.tag.count({ where: { userId: demo.id } });
  const joinCount = await prisma.transactionTag.count({
    where: { tag: { userId: demo.id } },
  });
  console.log('demo tags now:', tagCount, '| demo tag joins now:', joinCount);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
