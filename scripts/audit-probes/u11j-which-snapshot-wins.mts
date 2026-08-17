/**
 * U.11j — READ-ONLY: in a MIS-PAIRED component, whose balance does the trend actually keep?
 *
 * U.15 claims the net-worth trend "can carry an unrelated account's balance for a date",
 * because post-U.9 exactly one snapshot survives per (supersession component, date) and
 * production has components holding up to five accounts that are NOT the same account.
 * That is a prediction about the shipped ranking, not a measurement — so this runs the real
 * `applyReconciliationBoundary` over the owner's real rows and prints, per date, which
 * snapshot survived out of which candidates.
 *
 * Every statement is a SELECT. Writes nothing.
 *
 *   npx tsx scripts/audit-probes/u11j-which-snapshot-wins.mts
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { applyReconciliationBoundary } from '../../src/lib/engine/account/reconcile-boundary';

const env = readFileSync(new URL('../../.env.prod.tmp', import.meta.url), 'utf8');
const line = env.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='))!;
const url = line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
const c = new pg.Client({ connectionString: url });
await c.connect();

const money = (n: number) =>
  `${n < 0 ? '-' : ''}$${(Math.abs(n) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

const accounts = (
  await c.query(
    `SELECT id, "userId", name, type, currency, "currentBalanceCents" FROM "Account"`,
  )
).rows as {
  id: string;
  userId: string;
  name: string;
  type: string;
  currency: string | null;
  currentBalanceCents: number;
}[];
const byId = new Map(accounts.map((a) => [a.id, a]));

const links = (
  await c.query(
    `SELECT "userId", "predecessorAccountId", "successorAccountId", "cutoverDate"
       FROM "AccountReconciliation" WHERE "undoneAt" IS NULL`,
  )
).rows;
const txns = (
  await c.query(`SELECT "accountId", date FROM "Transaction" WHERE "isSplitParent" = false`)
).rows as { accountId: string; date: string }[];
const snaps = (
  await c.query(`SELECT "accountId", date, "balanceCents" FROM "BalanceSnapshot"`)
).rows as { accountId: string; date: string; balanceCents: number }[];

const userId = links[0].userId as string;
const userAccounts = accounts.filter((a) => a.userId === userId);
const ids = new Set(userAccounts.map((a) => a.id));

const out = applyReconciliationBoundary({
  paymentAccountId: null,
  accounts: userAccounts.map((a) => ({ ...a, feedDroppedAt: null })),
  links: links.filter((l) => l.userId === userId),
  transactions: txns.filter((t) => ids.has(t.accountId)),
  balanceSnapshots: snaps.filter((s) => ids.has(s.accountId)),
  statements: [],
  scheduled: [],
});

const kept = new Set(out.balanceSnapshots.map((s) => `${s.accountId}|${s.date}`));

// The components U.11e proved are mis-paired, named by their successor.
const MISPAIRED_SUCCESSORS = [
  'FINAN TEMPLETON DERMATOPATHOLOGY ASSOC PLAN Vanguard Retirement Plan Access',
  'Michael Lee - Roth IRA Brokerage Account - ****5351',
  'Michael Lee - Traditional IRA Brokerage Account - ****1548',
  'M. LEE',
];

console.log('='.repeat(78));
console.log('U.11j — WHICH SNAPSHOT THE TREND KEEPS IN A MIS-PAIRED COMPONENT');
console.log('='.repeat(78));

for (const sname of MISPAIRED_SUCCESSORS) {
  const succ = userAccounts.find((a) => a.name === sname);
  if (!succ) continue;
  const members = new Set<string>([succ.id]);
  for (const l of links) {
    if (l.successorAccountId === succ.id) members.add(l.predecessorAccountId as string);
  }
  const rows = snaps.filter((s) => members.has(s.accountId));
  const dates = [...new Set(rows.map((r) => r.date))].sort();

  console.log('\n' + '-'.repeat(78));
  console.log(`COMPONENT "${sname}" — ${members.size} accounts (they are NOT the same account)`);
  for (const d of dates) {
    const onDate = rows.filter((r) => r.date === d);
    const survivor = onDate.find((r) => kept.has(`${r.accountId}|${r.date}`));
    console.log(`  ${d}: ${onDate.length} recorded balances`);
    for (const r of onDate) {
      const win = kept.has(`${r.accountId}|${r.date}`);
      console.log(
        `      ${win ? '==> COUNTED ' : '    dropped '} ${money(r.balanceCents).padStart(14)}  ${byId.get(r.accountId)?.name}`,
      );
    }
    const realSum = onDate.reduce((t, r) => t + r.balanceCents, 0);
    if (survivor) {
      console.log(
        `      the trend plots ${money(survivor.balanceCents)} for this component; ` +
          `these ${onDate.length} rows describe accounts totalling ${money(realSum)}`,
      );
    }
  }
}

console.log('\n' + '='.repeat(78));
await c.end();
