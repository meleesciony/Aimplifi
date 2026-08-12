/**
 * U.11d — READ-ONLY: what do production's name-matched supersessions cost net worth?
 *
 * The U.11 census found 5 successors carrying more than one live predecessor. Their
 * transaction agreement inside the overlap is 0% in every case, while every genuine
 * one-account-two-feeds pair in the same database agrees 98-100%; their account names
 * and mask digits differ (three Schwab 529 plans onto one Vanguard 401k; three Schwab
 * IRAs onto one Vanguard Roth IRA); and every one of them was proposed by
 * `matchSignal='name'` at `confidence='medium'`, while every genuine pair was proposed
 * by 'mask' or 'balance' at 'high'.
 *
 * `applyReconciliationBoundary` R2 zeroes a predecessor's balance. So this replays the
 * SHIPPED boundary over the owner's real accounts and links twice — as production has
 * them, and with only the name/medium links treated as undone — and reports the
 * difference. That difference is money the owner holds and the app does not show him.
 *
 * Every statement is a SELECT. Writes nothing.
 *
 *   npx tsx scripts/audit-probes/u11d-networth-cost-of-mispairs.mts
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { applyReconciliationBoundary } from '../../src/lib/engine/account/reconcile-boundary';

const env = readFileSync(new URL('../../.env.prod.tmp', import.meta.url), 'utf8');
const line = env.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='))!;
const url = line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
const c = new pg.Client({ connectionString: url });
await c.connect();

const money = (cents: number) =>
  `${cents < 0 ? '-' : ''}$${(Math.abs(cents) / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const LIABILITY = new Set(['CREDIT', 'LOAN', 'MORTGAGE']);

interface Acct {
  id: string;
  userId: string;
  name: string;
  type: string;
  currency: string | null;
  currentBalanceCents: number;
}

const accounts: Acct[] = (
  await c.query(
    `SELECT id, "userId", name, type, currency, "currentBalanceCents" FROM "Account"`,
  )
).rows;
const links = (
  await c.query(
    `SELECT id, "userId", "predecessorAccountId", "successorAccountId", "cutoverDate",
            "matchSignal", confidence
       FROM "AccountReconciliation" WHERE "undoneAt" IS NULL`,
  )
).rows;

const txns = (
  await c.query(
    `SELECT "accountId", date FROM "Transaction" WHERE "isSplitParent" = false`,
  )
).rows as { accountId: string; date: string }[];
const snaps = (
  await c.query(`SELECT "accountId", date, "balanceCents" FROM "BalanceSnapshot"`)
).rows as { accountId: string; date: string; balanceCents: number }[];

const netWorth = (accts: readonly Acct[]) =>
  accts.reduce(
    (t, a) => t + (LIABILITY.has(a.type) ? -Math.abs(a.currentBalanceCents) : a.currentBalanceCents),
    0,
  );

console.log('='.repeat(78));
console.log('U.11d — NET-WORTH COST OF NAME-MATCHED SUPERSESSIONS (production, read-only)');
console.log('='.repeat(78));

const suspect = links.filter((l) => l.matchSignal === 'name' && l.confidence === 'medium');
const genuine = links.filter((l) => !(l.matchSignal === 'name' && l.confidence === 'medium'));
console.log(
  `live links ${links.length}: ${genuine.length} by mask/balance/persistent, ` +
    `${suspect.length} by NAME at MEDIUM confidence`,
);

const byUser = new Map<string, Acct[]>();
for (const a of accounts) {
  if (!byUser.has(a.userId)) byUser.set(a.userId, []);
  byUser.get(a.userId)!.push(a);
}

for (const [userId, userAccounts] of byUser) {
  const userLinks = links.filter((l) => l.userId === userId);
  if (!userLinks.length) continue;
  const ids = new Set(userAccounts.map((a) => a.id));
  const input = {
    paymentAccountId: null as string | null,
    accounts: userAccounts,
    transactions: txns.filter((t) => ids.has(t.accountId)),
    balanceSnapshots: snaps.filter((s) => ids.has(s.accountId)),
    statements: [] as { accountId: string; cycleEnd: string }[],
    scheduled: [] as { accountId: string }[],
  };

  const asShipped = applyReconciliationBoundary({ ...input, links: userLinks });
  const withoutName = applyReconciliationBoundary({
    ...input,
    links: userLinks.filter((l) => !(l.matchSignal === 'name' && l.confidence === 'medium')),
  });

  const nwNow = netWorth(asShipped.accounts as Acct[]);
  const nwFixed = netWorth(withoutName.accounts as Acct[]);

  console.log(`\nuser ${userId} — ${userAccounts.length} accounts`);
  console.log(`  net worth as production computes it today : ${money(nwNow)}`);
  console.log(`  net worth with the NAME/MEDIUM links undone: ${money(nwFixed)}`);
  console.log(`  DIFFERENCE (money the owner holds, not shown): ${money(nwFixed - nwNow)}`);
  console.log(
    `  superseded (balance zeroed) today: ${asShipped.supersededAccountIds.length} accounts; ` +
      `after: ${withoutName.supersededAccountIds.length}`,
  );

  const nowSup = new Set(asShipped.supersededAccountIds);
  const thenSup = new Set(withoutName.supersededAccountIds);
  const freed = userAccounts.filter((a) => nowSup.has(a.id) && !thenSup.has(a.id));
  if (freed.length) {
    console.log(`  accounts whose balance would return to net worth:`);
    for (const a of freed.sort((x, y) => y.currentBalanceCents - x.currentBalanceCents)) {
      console.log(`      ${money(a.currentBalanceCents).padStart(14)}  ${a.type.padEnd(11)} ${a.name}`);
    }
  }

  console.log(
    `  transactions kept today ${asShipped.transactions.length} / after ${withoutName.transactions.length} ` +
      `(+${withoutName.transactions.length - asShipped.transactions.length} rows return)`,
  );
}

console.log('\n' + '='.repeat(78));
await c.end();
