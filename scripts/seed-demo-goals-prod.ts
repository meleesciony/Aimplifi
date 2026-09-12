/**
 * Additive live-demo goal seeder (one-off, run by hand against the production DB).
 *
 * `prisma db seed` wipes every table and refuses Postgres unless --force-prod —
 * right on a DB that carries real users. GL.4's two demo goals are ADDITIVE rows
 * on the shared demo user (id 'user-demo'), so this script upserts exactly those
 * two rows and touches nothing else. Idempotent: run twice, still two rows.
 *
 * Usage (owner or a trusted operator, from a shell with the prod DATABASE_URL):
 *   DATABASE_URL="postgresql://…" npx tsx scripts/seed-demo-goals-prod.ts
 *
 * Node type: state-writer (additive, idempotent, demo-row only). Refuses to run
 * without a Postgres URL (never touches the local SQLite dev.db by accident).
 */
import { makeAdapter } from '../src/lib/db-adapter';
import { PrismaClient } from '../src/generated/prisma/client';

const url = process.env.DATABASE_URL ?? '';
if (!url.startsWith('postgres')) {
  console.error(
    'Refusing: set DATABASE_URL to the production Postgres URL. This script only writes the two demo goal rows.',
  );
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: makeAdapter(url) });

const GOALS = [
  {
    id: 'goal-demo-vacation',
    name: 'Vacation Fund',
    targetCents: 240000,
    savedCents: 80000,
    targetDate: null,
    monthlyContributionCents: 20000,
  },
  {
    id: 'goal-demo-car',
    name: 'New Car Fund',
    targetCents: 600000,
    savedCents: 60000,
    targetDate: '2027-06-01',
    monthlyContributionCents: 15000,
  },
];

async function main() {
  const demo = await prisma.user.findUnique({ where: { id: 'user-demo' }, select: { id: true } });
  if (!demo) {
    console.error('No user-demo row on this database — seed the demo account first (DEPLOY.md §6).');
    process.exit(1);
  }
  for (const g of GOALS) {
    const existing = await prisma.goal.findFirst({
      where: { id: g.id, userId: demo.id },
      select: { id: true },
    });
    if (existing) {
      await prisma.goal.update({
        where: { id: g.id },
        data: {
          name: g.name,
          targetCents: g.targetCents,
          savedCents: g.savedCents,
          targetDate: g.targetDate,
          monthlyContributionCents: g.monthlyContributionCents,
          kind: null,
        },
      });
      console.log('updated', g.id);
    } else {
      await prisma.goal.create({
        data: { ...g, userId: demo.id, kind: null },
      });
      console.log('created', g.id);
    }
  }
  const count = await prisma.goal.count({ where: { userId: demo.id, kind: null } });
  console.log('demo savings goals now:', count);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
