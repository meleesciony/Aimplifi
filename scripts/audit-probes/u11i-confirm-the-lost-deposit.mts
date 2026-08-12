/**
 * U.11i — READ-ONLY: confirm the one genuinely lost row, directly.
 *
 * U.11c replayed the shipped keep rule and found exactly one dropped transaction with no
 * surviving counterpart: a $2,086.40 "Deposit Mobile Banking" on the LIVE "Investor Checking"
 * account, dated 2026-07-21 — the cutover date itself. Before that becomes a reported defect
 * it gets checked without the engine in the way: does the retired Schwab side hold ANY row of
 * that amount, on any date, matched or not?
 *
 * Every statement is a SELECT. Writes nothing.
 *
 *   npx tsx scripts/audit-probes/u11i-confirm-the-lost-deposit.mts
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';

const env = readFileSync(new URL('../../.env.prod.tmp', import.meta.url), 'utf8');
const line = env.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='))!;
const url = line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
const c = new pg.Client({ connectionString: url });
await c.connect();

const money = (n: number) =>
  `${n < 0 ? '-' : ''}$${(Math.abs(n) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

const link = (
  await c.query(
    `SELECT r."predecessorAccountId", r."successorAccountId", r."cutoverDate",
            p.name AS pred_name, s.name AS succ_name
       FROM "AccountReconciliation" r
       JOIN "Account" p ON p.id = r."predecessorAccountId"
       JOIN "Account" s ON s.id = r."successorAccountId"
      WHERE r."undoneAt" IS NULL AND s.name = 'Investor Checking'`,
  )
).rows[0];

console.log('='.repeat(78));
console.log('U.11i — CONFIRMING THE ONE LOST ROW');
console.log('='.repeat(78));
console.log(`retired: ${link.pred_name}\nlive   : ${link.succ_name}\ncutover: ${link.cutoverDate}`);

const AMOUNT = 208640;

for (const [label, id] of [
  ['LIVE (successor)', link.successorAccountId],
  ['RETIRED (predecessor)', link.predecessorAccountId],
] as const) {
  const rows = (
    await c.query(
      `SELECT date, "amountCents", "rawDescriptor", status, "isSplitParent"
         FROM "Transaction" WHERE "accountId" = $1 AND ABS("amountCents") = $2 ORDER BY date`,
      [id, AMOUNT],
    )
  ).rows;
  console.log(`\n${label}: ${rows.length} row(s) of ${money(AMOUNT)} on ANY date`);
  for (const r of rows) {
    console.log(`   ${r.date}  ${money(r.amountCents)}  ${r.rawDescriptor}  [${r.status}]`);
  }
}

// Everything either side reported on/around the cutover, so the day is visible in full.
for (const [label, id] of [
  ['LIVE (successor)', link.successorAccountId],
  ['RETIRED (predecessor)', link.predecessorAccountId],
] as const) {
  const rows = (
    await c.query(
      `SELECT date, "amountCents", "rawDescriptor"
         FROM "Transaction"
        WHERE "accountId" = $1 AND date BETWEEN '2026-07-18' AND '2026-07-24'
        ORDER BY date`,
      [id],
    )
  ).rows;
  console.log(`\n${label} — every row 2026-07-18..2026-07-24 (${rows.length}):`);
  for (const r of rows) console.log(`   ${r.date}  ${money(r.amountCents).padStart(13)}  ${r.rawDescriptor}`);
}

console.log('\n' + '='.repeat(78));
await c.end();
