/**
 * U.11c — READ-ONLY: what is the SHIPPED transaction rule dropping in production
 * right now that no other surviving row accounts for?
 *
 * U.11 was filed as a DOUBLE (a purchase counted twice because sibling predecessors
 * never de-duplicate against each other) and it prescribes deciding a failure
 * direction: span-based de-duplication risks "silently deleting a row only one feed
 * ever saw". This probe asks whether that silent loss is hypothetical or already
 * happening, by replaying the SHIPPED closure — `reconciliationTxnKeepFilter`, the
 * exact function the register, CSV export, budgets, recurring detection, triage,
 * tax and the shared assembler all call — over the owner's real accounts, real
 * links and real full-history spans.
 *
 * For every row the rule DROPS, it asks whether the component still holds a
 * surviving row with the same (date, amountCents). If yes the drop removed a true
 * duplicate and the rule did its job; if no, that money left every surface and
 * nothing replaced it.
 *
 * Every statement is a SELECT. Writes nothing.
 *
 *   npx tsx scripts/audit-probes/u11c-silent-loss-today.mts
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
import {
  reconciliationTxnKeepFilter,
  effectiveReconciliationLinks,
} from '../../src/lib/engine/account/reconcile-boundary';

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

interface Acct {
  id: string;
  userId: string;
  name: string;
  type: string;
  currency: string | null;
  currentBalanceCents: number;
}
interface Txn {
  id: string;
  accountId: string;
  date: string;
  amountCents: number;
  rawDescriptor: string;
}

const accounts: Acct[] = (
  await c.query(
    `SELECT id, "userId", name, type, currency, "currentBalanceCents" FROM "Account"`,
  )
).rows;
const links = (
  await c.query(
    `SELECT id, "userId", "predecessorAccountId", "successorAccountId", "cutoverDate",
            "matchSignal", confidence, "undoneAt"
       FROM "AccountReconciliation" WHERE "undoneAt" IS NULL`,
  )
).rows;

const byUser = new Map<string, Acct[]>();
for (const a of accounts) {
  if (!byUser.has(a.userId)) byUser.set(a.userId, []);
  byUser.get(a.userId)!.push(a);
}

console.log('='.repeat(78));
console.log('U.11c — WHAT THE SHIPPED R1 RULE DROPS TODAY (production, read-only)');
console.log('='.repeat(78));

let grandDropped = 0;
let grandCovered = 0;
let grandUncovered = 0;
let grandUncoveredCents = 0;

for (const [userId, userAccounts] of byUser) {
  const userLinks = links.filter((l) => l.userId === userId);
  if (!userLinks.length) continue;

  const eff = effectiveReconciliationLinks(userAccounts, userLinks);
  const linkedIds = new Set<string>();
  for (const l of eff) {
    linkedIds.add(l.predecessorAccountId);
    linkedIds.add(l.successorAccountId);
  }

  // FULL-history spans for every linked predecessor (the rule's required input)
  const spans = (
    await c.query(
      `SELECT "accountId", MIN(date) AS first, MAX(date) AS last
         FROM "Transaction"
        WHERE "accountId" = ANY($1::text[]) AND "isSplitParent" = false
        GROUP BY "accountId"`,
      [[...new Set(eff.map((l) => l.predecessorAccountId))]],
    )
  ).rows as { accountId: string; first: string; last: string }[];

  const keep = reconciliationTxnKeepFilter(userAccounts, userLinks, spans);

  const txns: Txn[] = (
    await c.query(
      `SELECT id, "accountId", date, "amountCents", "rawDescriptor"
         FROM "Transaction"
        WHERE "accountId" = ANY($1::text[]) AND "isSplitParent" = false`,
      [[...linkedIds]],
    )
  ).rows;

  // component key: walk to the terminal successor over effective links
  const succOf = new Map(eff.map((l) => [l.predecessorAccountId, l.successorAccountId]));
  const terminal = (id: string) => {
    const seen = new Set<string>();
    let cur = id;
    while (succOf.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      cur = succOf.get(cur)!;
    }
    return cur;
  };

  const kept = txns.filter((t) => keep(t.accountId, t.date));
  const dropped = txns.filter((t) => !keep(t.accountId, t.date));

  // surviving (component, date, amount) multiset
  const survivorKeys = new Map<string, number>();
  for (const t of kept) {
    const k = `${terminal(t.accountId)}|${t.date}|${t.amountCents}`;
    survivorKeys.set(k, (survivorKeys.get(k) ?? 0) + 1);
  }

  const uncovered: Txn[] = [];
  const pool = new Map(survivorKeys);
  for (const t of dropped) {
    const k = `${terminal(t.accountId)}|${t.date}|${t.amountCents}`;
    const n = pool.get(k) ?? 0;
    if (n > 0) pool.set(k, n - 1);
    else uncovered.push(t);
  }

  const acctName = new Map(userAccounts.map((a) => [a.id, a.name]));
  console.log(`\nuser ${userId}: ${eff.length} effective links, ${txns.length} rows on linked accounts`);
  console.log(
    `  kept ${kept.length} | dropped ${dropped.length} | of the dropped, ` +
      `${dropped.length - uncovered.length} had a surviving same-(date,amount) counterpart, ` +
      `${uncovered.length} did NOT`,
  );
  const uncoveredCents = uncovered.reduce((s, t) => s + Math.abs(t.amountCents), 0);
  if (uncovered.length) {
    console.log(`  *** ${uncovered.length} rows / ${money(uncoveredCents)} dropped with nothing replacing them ***`);
    const byAcct = new Map<string, Txn[]>();
    for (const t of uncovered) {
      if (!byAcct.has(t.accountId)) byAcct.set(t.accountId, []);
      byAcct.get(t.accountId)!.push(t);
    }
    for (const [id, rows] of byAcct) {
      const sum = rows.reduce((s, t) => s + Math.abs(t.amountCents), 0);
      console.log(`    ${acctName.get(id) ?? id} [${id.slice(-6)}] — ${rows.length} rows, ${money(sum)}`);
      for (const t of rows.slice(0, 8)) {
        console.log(`        ${t.date} ${money(t.amountCents)} ${t.rawDescriptor.slice(0, 48)}`);
      }
      if (rows.length > 8) console.log(`        … ${rows.length - 8} more`);
    }
  }

  grandDropped += dropped.length;
  grandCovered += dropped.length - uncovered.length;
  grandUncovered += uncovered.length;
  grandUncoveredCents += uncoveredCents;
}

console.log('\n' + '='.repeat(78));
console.log('TOTALS');
console.log(`  dropped by the shipped R1 rule: ${grandDropped}`);
console.log(`  of those, a true duplicate (a survivor carries the same date+amount): ${grandCovered}`);
console.log(
  `  of those, NOTHING replaces them — silent loss: ${grandUncovered} rows / ${money(grandUncoveredCents)}`,
);
console.log('='.repeat(78));

await c.end();
