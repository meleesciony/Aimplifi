/**
 * READ-ONLY follow-up probe — H.8 reader [6] (rules.ts loadCorrectionInputs).
 * The main probe found 146 of 827 corrections sit on rows the reconciliation
 * boundary disowns. Two very different meanings:
 *   (a) DUPLICATE-COPY: the same real-world decision also exists as a correction
 *       on the kept copy -> learned rules double-weight that evidence.
 *   (b) SOLE-COPY: the disowned row holds the ONLY record of the decision ->
 *       filtering the read would erase real evidence (the H.7 P1-3 shape).
 * Classify each disowned correction by whether a correction with the same
 * (canonical descriptor bucket, categoryId, |amount|, ±3d date) exists on a
 * kept row. Every statement is a SELECT; nothing is written.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
import {
  reconciliationTxnKeepFilter,
} from '../../src/lib/engine/account/reconcile-boundary';

const env = readFileSync(new URL('../../.env.prod.tmp', import.meta.url), 'utf8');
const line = env.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='))!;
const url = line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
const c = new pg.Client({ connectionString: url });
await c.connect();

const users = await c.query<{ id: string }>(
  `select distinct u.id from "User" u join "Account" a on a."userId" = u.id
   where a."providerRef" is not null order by u.id asc`,
);

const dayDiff = (a: string, b: string) =>
  Math.abs((Date.parse(a) - Date.parse(b)) / 86400000);
const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 24);

for (const user of users.rows) {
  const accs = await c.query<{ id: string; name: string; type: string; currency: string | null }>(
    `select id, name, type, currency from "Account" where "userId" = $1`,
    [user.id],
  );
  const links = await c.query<{ predecessorAccountId: string; successorAccountId: string; cutoverDate: string }>(
    `select "predecessorAccountId", "successorAccountId", "cutoverDate"
     from "AccountReconciliation" where "userId" = $1 and "undoneAt" is null`,
    [user.id],
  );
  if (links.rows.length === 0) continue;
  const spans = await c.query<{ accountId: string; first: string; last: string }>(
    `select "accountId", min(date) as first, max(date) as last from "Transaction"
     where "accountId" = any($1::text[]) group by "accountId"`,
    [links.rows.map((l) => l.predecessorAccountId)],
  );
  const keep = reconciliationTxnKeepFilter(accs.rows as never, links.rows, spans.rows);

  const corr = await c.query<{
    id: string; transactionId: string; toCategoryId: string; accountId: string;
    date: string; amountCents: string; rawDescriptor: string;
  }>(
    `select cx.id, cx."transactionId", cx."toCategoryId", t."accountId", t.date,
            t."amountCents", t."rawDescriptor"
     from "Correction" cx join "Transaction" t on t.id = cx."transactionId"
     where cx."userId" = $1`,
    [user.id],
  );
  const rows = corr.rows.map((r) => ({ ...r, amountCents: Number(r.amountCents), kept: keep(r.accountId, r.date) }));
  const keptRows = rows.filter((r) => r.kept);
  const disowned = rows.filter((r) => !r.kept);

  let dupCopy = 0;
  let soleCopy = 0;
  const soleSamples: string[] = [];
  const dupSamples: string[] = [];
  for (const d of disowned) {
    const twin = keptRows.find(
      (k) =>
        k.toCategoryId === d.toCategoryId &&
        Math.abs(k.amountCents) === Math.abs(d.amountCents) &&
        dayDiff(k.date, d.date) <= 3 &&
        norm(k.rawDescriptor) === norm(d.rawDescriptor),
    );
    if (twin) {
      dupCopy++;
      if (dupSamples.length < 5)
        dupSamples.push(`${d.date} ${d.toCategoryId} $${(Math.abs(d.amountCents) / 100).toFixed(2)} "${d.rawDescriptor.slice(0, 30)}"`);
    } else {
      soleCopy++;
      if (soleSamples.length < 8)
        soleSamples.push(`${d.date} ${d.toCategoryId} $${(Math.abs(d.amountCents) / 100).toFixed(2)} "${d.rawDescriptor.slice(0, 30)}"`);
    }
  }
  console.log(`user ${user.id}: corrections=${rows.length} kept=${keptRows.length} disowned=${disowned.length}`);
  console.log(`  duplicate-copy (twin correction on a kept row): ${dupCopy}`);
  console.log(`  sole-copy (only record of the decision):        ${soleCopy}`);
  console.log(`  dup samples:`);
  for (const s of dupSamples) console.log(`    ${s}`);
  console.log(`  sole samples:`);
  for (const s of soleSamples) console.log(`    ${s}`);
}
await c.end();
console.log('\ndone - read-only, nothing written.');
