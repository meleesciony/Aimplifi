/**
 * U.11 — READ-ONLY production census: does the sibling shape exist, and when two
 * feeds of ONE real account overlap, do they agree row for row?
 *
 * U.11 asks a failure-direction question that must not be inherited:
 *   - de-duplicate sibling predecessors by CLAIM SPAN (cheap, symmetric with the
 *     snapshot rule) and a row only ONE feed ever saw is silently deleted;
 *   - de-duplicate by PROVEN MATCH and an unmatched genuine double stays visible.
 * The evidence that decides it is the agreement rate between two feeds inside an
 * overlap. That is measurable TODAY on the chains already confirmed in production,
 * because the shipped chain rule already drops the successor's rows inside the
 * predecessor's claim span — so its own loss rate is the same statistic.
 *
 * Reports, per supersession COMPONENT (U.9's unit — union-find over undirected
 * effective edges, sharing no logic with the engine):
 *   1. component shape (chain / sibling fan-in / mixed) and its accounts;
 *   2. per unordered pair of accounts in a component: the overlapping date range,
 *      row counts on each side, exact (date, amountCents) 1:1 matches, and the
 *      rows unique to each side — the loss a span rule would take;
 *   3. the same statistic restricted to the span the CURRENT rule already drops.
 *
 * Every statement is a SELECT. Writes nothing.
 *
 *   npx tsx scripts/audit-probes/u11-sibling-overlap-census.mts
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';

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

interface Link {
  id: string;
  userId: string;
  predecessorAccountId: string;
  successorAccountId: string;
  cutoverDate: string;
  undoneAt: Date | null;
}
interface Acct {
  id: string;
  userId: string;
  name: string;
  type: string;
  currency: string | null;
  provider: string | null;
}
interface Txn {
  id: string;
  accountId: string;
  date: string;
  amountCents: number;
  rawDescriptor: string;
  status: string;
  isSplitParent: boolean;
}

const links: Link[] = (
  await c.query(
    `SELECT id, "userId", "predecessorAccountId", "successorAccountId", "cutoverDate", "undoneAt"
       FROM "AccountReconciliation"`,
  )
).rows;
const live = links.filter((l) => l.undoneAt === null);

const acctRows: Acct[] = (
  await c.query(
    `SELECT a.id, a."userId", a.name, a.type, a.currency,
            CASE WHEN a."plaidItemId" IS NOT NULL THEN 'plaid' ELSE 'other' END AS provider
       FROM "Account" a`,
  )
).rows;
const acctById = new Map(acctRows.map((a) => [a.id, a]));

console.log('='.repeat(78));
console.log('U.11 SIBLING / OVERLAP CENSUS — production, read-only');
console.log('='.repeat(78));
console.log(
  `AccountReconciliation rows: ${links.length} total, ${live.length} live (undoneAt IS NULL)`,
);

// ---- union-find over undirected live edges (U.9's component unit) ---------
const parent = new Map<string, string>();
const find = (x: string): string => {
  if (!parent.has(x)) parent.set(x, x);
  let r = parent.get(x)!;
  while (r !== parent.get(r)!) r = parent.get(r)!;
  return r;
};
const union = (a: string, b: string) => {
  const ra = find(a);
  const rb = find(b);
  if (ra !== rb) parent.set(ra, rb);
};
for (const l of live) {
  union(l.predecessorAccountId, l.successorAccountId);
}

const components = new Map<string, string[]>();
for (const id of parent.keys()) {
  const root = find(id);
  if (!components.has(root)) components.set(root, []);
  components.get(root)!.push(id);
}

// fan-in census: how many DISTINCT live predecessors point at one successor
const predsOf = new Map<string, string[]>();
for (const l of live) {
  if (!predsOf.has(l.successorAccountId)) predsOf.set(l.successorAccountId, []);
  predsOf.get(l.successorAccountId)!.push(l.predecessorAccountId);
}
const siblingFanIns = [...predsOf.entries()].filter(([, ps]) => ps.length > 1);

console.log(`\nComponents (union-find over live edges): ${components.size}`);
console.log(
  `Successors with MORE THAN ONE live predecessor (the U.11 sibling shape): ${siblingFanIns.length}`,
);
for (const [succ, preds] of siblingFanIns) {
  const s = acctById.get(succ);
  console.log(`  successor ${succ} (${s?.name ?? '?'} / ${s?.type ?? '?'}) <- ${preds.length} predecessors`);
  for (const p of preds) {
    const a = acctById.get(p);
    const cut = live.find((l) => l.predecessorAccountId === p)!.cutoverDate;
    console.log(`      ${p} (${a?.name ?? '?'} / ${a?.type ?? '?'}) cutover ${cut}`);
  }
}

// ---- per-component detail ------------------------------------------------
const compList = [...components.entries()].sort((a, b) => b[1].length - a[1].length);
console.log(`\nComponent sizes: ${compList.map(([, ids]) => ids.length).join(', ')}`);

let pairsExamined = 0;
let pairsWithOverlapRows = 0;
let totalMatched = 0;
let totalUniqueA = 0;
let totalUniqueB = 0;
let totalUniqueCents = 0;

for (const [root, ids] of compList) {
  const compLinks = live.filter(
    (l) => ids.includes(l.predecessorAccountId) && ids.includes(l.successorAccountId),
  );
  const shape =
    compLinks.length > 1 && new Set(compLinks.map((l) => l.successorAccountId)).size < compLinks.length
      ? 'SIBLING FAN-IN'
      : compLinks.length > 1
        ? 'CHAIN'
        : 'PAIR';
  console.log('\n' + '-'.repeat(78));
  console.log(`Component ${root} — ${ids.length} accounts, ${compLinks.length} links — ${shape}`);
  for (const l of compLinks) {
    const p = acctById.get(l.predecessorAccountId);
    const s = acctById.get(l.successorAccountId);
    console.log(
      `  ${p?.name ?? '?'} [${l.predecessorAccountId.slice(-6)}] --cutover ${l.cutoverDate}--> ${s?.name ?? '?'} [${l.successorAccountId.slice(-6)}]`,
    );
  }

  // rows for every account in the component
  const txnsByAcct = new Map<string, Txn[]>();
  for (const id of ids) {
    const rows: Txn[] = (
      await c.query(
        `SELECT id, "accountId", date, "amountCents", "rawDescriptor", status, "isSplitParent"
           FROM "Transaction"
          WHERE "accountId" = $1 AND "isSplitParent" = false
          ORDER BY date`,
        [id],
      )
    ).rows;
    txnsByAcct.set(id, rows);
    const a = acctById.get(id);
    const dates = rows.map((r) => r.date);
    console.log(
      `    ${a?.name ?? '?'} [${id.slice(-6)}] ${rows.length} rows` +
        (rows.length ? ` [${dates[0]}..${dates[dates.length - 1]}]` : ''),
    );
  }

  // every unordered pair in the component
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const A = txnsByAcct.get(ids[i])!;
      const B = txnsByAcct.get(ids[j])!;
      if (!A.length || !B.length) continue;
      const loA = A[0].date;
      const hiA = A[A.length - 1].date;
      const loB = B[0].date;
      const hiB = B[B.length - 1].date;
      const lo = loA > loB ? loA : loB;
      const hi = hiA < hiB ? hiA : hiB;
      pairsExamined++;
      if (lo > hi) {
        console.log(
          `    pair [${ids[i].slice(-6)}]x[${ids[j].slice(-6)}]: NO date overlap (${loA}..${hiA} vs ${loB}..${hiB})`,
        );
        continue;
      }
      const inA = A.filter((r) => r.date >= lo && r.date <= hi);
      const inB = B.filter((r) => r.date >= lo && r.date <= hi);
      if (!inA.length && !inB.length) continue;
      pairsWithOverlapRows++;

      // greedy 1:1 exact (date, amountCents) matching
      const pool = new Map<string, Txn[]>();
      for (const r of inB) {
        const k = `${r.date}|${r.amountCents}`;
        if (!pool.has(k)) pool.set(k, []);
        pool.get(k)!.push(r);
      }
      let matched = 0;
      const unmatchedA: Txn[] = [];
      for (const r of inA) {
        const k = `${r.date}|${r.amountCents}`;
        const bucket = pool.get(k);
        if (bucket && bucket.length) {
          bucket.shift();
          matched++;
        } else {
          unmatchedA.push(r);
        }
      }
      const unmatchedB = [...pool.values()].flat();
      const uniqueCents =
        unmatchedA.reduce((s, r) => s + Math.abs(r.amountCents), 0) +
        unmatchedB.reduce((s, r) => s + Math.abs(r.amountCents), 0);
      totalMatched += matched;
      totalUniqueA += unmatchedA.length;
      totalUniqueB += unmatchedB.length;
      totalUniqueCents += uniqueCents;

      const pct = inA.length + inB.length ? ((matched * 2) / (inA.length + inB.length)) * 100 : 0;
      console.log(
        `    pair [${ids[i].slice(-6)}]x[${ids[j].slice(-6)}] overlap ${lo}..${hi}: ` +
          `A ${inA.length} rows, B ${inB.length} rows, ${matched} exact (date,amount) matches ` +
          `(${pct.toFixed(1)}% of rows paired), unique A ${unmatchedA.length}, unique B ${unmatchedB.length}, ` +
          `unique magnitude ${money(uniqueCents)}`,
      );
      for (const r of [...unmatchedA.slice(0, 5), ...unmatchedB.slice(0, 5)]) {
        console.log(
          `        UNIQUE ${r.date} ${money(r.amountCents)} ${r.rawDescriptor.slice(0, 46)} [${r.accountId.slice(-6)}]`,
        );
      }
    }
  }
}

console.log('\n' + '='.repeat(78));
console.log('TOTALS');
console.log(
  `  pairs examined ${pairsExamined}, with rows in the overlap ${pairsWithOverlapRows}\n` +
    `  exact (date, amount) matched pairs: ${totalMatched}\n` +
    `  rows unique to one side inside an overlap: ${totalUniqueA + totalUniqueB} (${money(totalUniqueCents)})`,
);
const denom = totalMatched * 2 + totalUniqueA + totalUniqueB;
console.log(
  `  agreement rate inside overlaps: ${denom ? (((totalMatched * 2) / denom) * 100).toFixed(1) : 'n/a'}% of rows had an exact counterpart`,
);
console.log('='.repeat(78));

await c.end();
