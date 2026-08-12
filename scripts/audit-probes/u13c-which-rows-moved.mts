/**
 * U.13c — READ-ONLY: reconcile the row-count delta exactly.
 *
 * u13b counted 10 successor rows sitting on a boundary day (9 with a counterpart on
 * the claiming side + the 1 lost $2,086.40 deposit). Releasing the boundary day
 * should therefore keep 10 more rows, but u11c measured kept 1517 -> 1526, i.e. +9.
 * An unexplained discrepancy in a money change is not something to wave through, so
 * this prints every boundary-day successor row and whether the SHIPPED filter keeps
 * it now — and for any it still drops, which OTHER predecessor's claim covers it.
 *
 * The expected answer is a transitive one: a successor can have several upstream
 * predecessors (siblings on one live account), and a row on predecessor P's claim
 * END can still sit STRICTLY INSIDE sibling Q's claim, which correctly drops it.
 *
 * Every statement is a SELECT. Writes nothing.
 *
 *   npx tsx scripts/audit-probes/u13c-which-rows-moved.mts
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

const accounts = (
  await c.query(`SELECT id, "userId", name, type, currency, "currentBalanceCents" FROM "Account"`)
).rows;
const links = (
  await c.query(
    `SELECT id, "userId", "predecessorAccountId", "successorAccountId", "cutoverDate",
            "matchSignal", confidence, "undoneAt"
       FROM "AccountReconciliation" WHERE "undoneAt" IS NULL`,
  )
).rows;

const byUser = new Map<string, typeof accounts>();
for (const a of accounts) {
  if (!byUser.has(a.userId)) byUser.set(a.userId, []);
  byUser.get(a.userId)!.push(a);
}

console.log('='.repeat(78));
console.log('U.13c — EVERY BOUNDARY-DAY SUCCESSOR ROW, AND WHETHER IT IS KEPT NOW');
console.log('='.repeat(78));

for (const [userId, userAccounts] of byUser) {
  const userLinks = links.filter((l) => l.userId === userId);
  if (!userLinks.length) continue;
  const eff = effectiveReconciliationLinks(userAccounts, userLinks);
  if (!eff.length) continue;

  const ids = new Set<string>();
  for (const l of eff) {
    ids.add(l.predecessorAccountId);
    ids.add(l.successorAccountId);
  }

  const spanRows = (
    await c.query(
      `SELECT "accountId", MIN(date) AS first, MAX(date) AS last
         FROM "Transaction"
        WHERE "accountId" = ANY($1::text[]) AND "isSplitParent" = false
        GROUP BY "accountId"`,
      [[...new Set(eff.map((l) => l.predecessorAccountId))]],
    )
  ).rows as { accountId: string; first: string; last: string }[];
  const keep = reconciliationTxnKeepFilter(userAccounts, userLinks, spanRows);

  const txns = (
    await c.query(
      `SELECT id, "accountId", date, "amountCents", "rawDescriptor"
         FROM "Transaction"
        WHERE "accountId" = ANY($1::text[]) AND "isSplitParent" = false ORDER BY date, id`,
      [[...ids]],
    )
  ).rows as { id: string; accountId: string; date: string; amountCents: number; rawDescriptor: string }[];
  for (const t of txns) t.date = String(t.date).slice(0, 10);

  const name = new Map(userAccounts.map((a) => [a.id, a.name]));
  const spanOf = new Map(spanRows.map((s) => [s.accountId, s]));
  const cutOf = new Map(eff.map((l) => [l.predecessorAccountId, String(l.cutoverDate).slice(0, 10)]));
  const claimOf = (p: string) => {
    const s = spanOf.get(p);
    const cut = cutOf.get(p);
    if (!s || !cut) return null;
    const first = String(s.first).slice(0, 10);
    const last = String(s.last).slice(0, 10);
    const end = last < cut ? last : cut;
    return end < first ? null : { first, end };
  };
  const predsOf = new Map<string, string[]>();
  for (const l of eff) {
    const arr = predsOf.get(l.successorAccountId) ?? [];
    arr.push(l.predecessorAccountId);
    predsOf.set(l.successorAccountId, arr);
  }
  const upstreamsOf = (id: string): string[] => {
    const out: string[] = [];
    const seen = new Set([id]);
    const stack = [...(predsOf.get(id) ?? [])];
    while (stack.length) {
      const cur = stack.pop()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      out.push(cur);
      for (const p of predsOf.get(cur) ?? []) stack.push(p);
    }
    return out;
  };

  let kept = 0;
  let still = 0;
  for (const l of eff) {
    const claim = claimOf(l.predecessorAccountId);
    if (!claim) continue;
    const succRows = txns.filter((t) => t.accountId === l.successorAccountId && t.date === claim.end);
    for (const t of succRows) {
      const isKept = keep(t.accountId, t.date);
      if (isKept) kept++;
      else still++;
      const blockers = upstreamsOf(t.accountId)
        .map((p) => ({ p, c: claimOf(p) }))
        .filter((x) => x.c && t.date >= x.c.first && t.date < x.c.end)
        .map((x) => `${name.get(x.p)} [${x.c!.first}..${x.c!.end})`);
      console.log(
        `  ${isKept ? 'KEPT   ' : 'DROPPED'} ${t.date} ${money(t.amountCents).padStart(12)} ` +
          `${name.get(t.accountId)} — ${t.rawDescriptor.slice(0, 34)}` +
          (isKept ? '' : `\n           still claimed STRICTLY INSIDE by: ${blockers.join('; ') || '(none — unexplained!)'}`),
      );
    }
  }
  console.log(`\n  boundary-day successor rows: ${kept + still} — kept now ${kept}, still dropped ${still}`);
}

console.log('='.repeat(78));
await c.end();
