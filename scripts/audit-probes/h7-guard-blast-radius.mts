/**
 * READ-ONLY production probe — H.7 part 3: what would each candidate guard
 * actually change on the owner's corpus? Every statement is a SELECT.
 *
 * Parts 1-2 measured the harm. Before choosing semantics, measure the BLAST
 * RADIUS of each candidate rule over the WHOLE detected set (not just the
 * settled rows), so the fix is chosen on what it removes AND on what it costs.
 *
 * Candidate guards:
 *   A  IDENTITY — two accounts joined by an ACTIVE AccountReconciliation are
 *      the same real account, so a pair across them is the same-account case
 *      `transfers.ts:53` already refuses (a purchase and its own refund). The
 *      guard is exact: the link exists only on an explicit user confirm.
 *   B  DIRECTION — the OUTFLOW side must be an account money can leave
 *      (CHECKING/SAVINGS/INVESTMENT). An outflow on a CREDIT/LOAN/MORTGAGE line
 *      is a purchase or an interest charge, not money leaving for another
 *      account, so it cannot be one leg of a transfer.
 *
 * For every row a guard removes from detection, the probe reports whether the
 * DESCRIPTOR path still detects it — a row detected by descriptor loses
 * nothing, so that column is the false-negative cost of the guard.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { daysBetween, isoDate } from '../../src/lib/dates';
import { isIncomeCategoryId } from '../../src/lib/engine/categorize/categories';
import { normalizeMerchant } from '../../src/lib/engine/categorize/normalize';
import { detectTransfers, type TransferTxn } from '../../src/lib/engine/categorize/transfers';

const env = readFileSync(new URL('../../.env.prod.tmp', import.meta.url), 'utf8');
const line = env.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='))!;
const url = line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
const c = new pg.Client({ connectionString: url });
await c.connect();

interface Row {
  id: string;
  accountId: string;
  date: string;
  amountCents: number;
  rawDescriptor: string;
  isTransfer: boolean;
  needsReview: boolean;
  categoryId: string | null;
}

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const CAN_SEND = new Set(['CHECKING', 'SAVINGS', 'INVESTMENT']);

const users = await c.query<{ id: string; email: string }>(
  `select distinct u.id, u.email from "User" u join "Account" a on a."userId" = u.id
   where a."providerRef" is not null order by u.id asc`,
);

for (const user of users.rows) {
  console.log(`===== user ${user.id} =====`);
  const accounts = await c.query<{ id: string; name: string; type: string; mask: string | null }>(
    `select id, name, type, mask from "Account" where "userId" = $1`,
    [user.id],
  );
  const accById = new Map(accounts.rows.map((a) => [a.id, a]));
  const typeOf = (id: string) => accById.get(id)?.type ?? 'UNKNOWN';
  const labelOf = (id: string) => {
    const a = accById.get(id);
    return a ? `${a.type}/${a.name.slice(0, 20)}${a.mask ? `..${a.mask}` : ''}` : `?${id}`;
  };

  // Identity groups from ACTIVE reconciliations (union-find over the links).
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    const p = parent.get(x);
    if (p === undefined || p === x) return x;
    const r = find(p);
    parent.set(x, r);
    return r;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  const recon = await c.query<{ pre: string; suc: string; undone: string | null }>(
    `select "predecessorAccountId" as pre, "successorAccountId" as suc, "undoneAt"::text as undone
     from "AccountReconciliation" where "userId" = $1`,
    [user.id],
  );
  let active = 0;
  for (const r of recon.rows) {
    if (r.undone !== null) continue;
    active += 1;
    union(r.pre, r.suc);
  }
  console.log(`accounts=${accounts.rows.length} activeReconciliations=${active}`);

  const rows = await c.query<Row>(
    `select t.id, t."accountId", t.date, t."amountCents", t."rawDescriptor",
            t."isTransfer", t."needsReview", t."categoryId"
     from "Transaction" t join "Account" a on a.id = t."accountId"
     where a."userId" = $1 and t."isSplitParent" = false order by t.date asc`,
    [user.id],
  );
  const txns = rows.rows;
  const byId = new Map(txns.map((t) => [t.id, t]));
  const input = txns.map<TransferTxn>((t) => ({
    id: t.id,
    accountId: t.accountId,
    date: t.date,
    amountCents: t.amountCents,
    rawDescriptor: t.rawDescriptor,
  }));

  const isDescriptorTransfer = (d: string) => {
    const cat = normalizeMerchant(d).categoryId;
    return cat === 'transfer' || cat === 'auto-loan';
  };
  const descriptorSet = new Set(txns.filter((t) => isDescriptorTransfer(t.rawDescriptor)).map((t) => t.id));
  const shipped = detectTransfers(input);

  /** Re-run the engine's pair rule with the candidate guards applied. */
  function detectWith(opts: { identity: boolean; direction: boolean }): Set<string> {
    const out = new Set(descriptorSet);
    const byAmount = new Map<number, Row[]>();
    for (const t of txns) {
      const k = Math.abs(t.amountCents);
      const l = byAmount.get(k) ?? [];
      l.push(t);
      byAmount.set(k, l);
    }
    for (const [, group] of byAmount) {
      for (const a of group) {
        if (a.amountCents >= 0) continue; // a = the outflow leg
        if (opts.direction && !CAN_SEND.has(typeOf(a.accountId))) continue;
        for (const b of group) {
          if (b.amountCents <= 0 || b.accountId === a.accountId) continue;
          if (opts.identity && find(a.accountId) === find(b.accountId)) continue;
          if (Math.abs(daysBetween(isoDate(a.date), isoDate(b.date))) <= 3) {
            out.add(a.id);
            out.add(b.id);
          }
        }
      }
    }
    return out;
  }

  const variants: Array<[string, Set<string>]> = [
    ['shipped (no guard)', shipped],
    ['A identity only', detectWith({ identity: true, direction: false })],
    ['B direction only', detectWith({ identity: false, direction: true })],
    ['A+B', detectWith({ identity: true, direction: true })],
  ];

  console.log(`\ncorpus=${txns.length} rows; descriptor-detected=${descriptorSet.size}`);
  console.log(`variant                 detected  removed-vs-shipped  of-removed-still-descriptor`);
  for (const [name, set] of variants) {
    const removed = [...shipped].filter((id) => !set.has(id));
    const stillDesc = removed.filter((id) => descriptorSet.has(id)).length;
    console.log(
      `  ${name.padEnd(20)} ${String(set.size).padStart(8)} ${String(removed.length).padStart(18)} ${String(
        stillDesc,
      ).padStart(26)}`,
    );
  }

  // The population H.7 is about: settled rows under a non-transfer category.
  console.log(`\nSETTLED rows (needsReview=false, category<>'transfer') flagged by each variant:`);
  for (const [name, set] of variants) {
    const settled = txns.filter((t) => set.has(t.id) && !t.needsReview && t.categoryId !== 'transfer');
    const pairOnly = settled.filter((t) => !descriptorSet.has(t.id));
    const income = pairOnly.filter((t) => t.categoryId && isIncomeCategoryId(t.categoryId));
    console.log(
      `  ${name.padEnd(20)} settled=${String(settled.length).padStart(3)}  pair-only=${String(
        pairOnly.length,
      ).padStart(3)}  income=${String(income.length).padStart(2)}  ${usd(
        pairOnly.reduce((s, t) => s + Math.abs(t.amountCents), 0),
      ).padStart(13)}`,
    );
  }

  // What A+B GIVES UP: rows it stops detecting that no descriptor explains.
  const ab = detectWith({ identity: true, direction: true });
  const lost = [...shipped].filter((id) => !ab.has(id) && !descriptorSet.has(id)).map((id) => byId.get(id)!);
  console.log(`\nA+B stops pair-detecting ${lost.length} rows that no descriptor explains.`);
  console.log(`  (each line is a row that would go back to counting as ordinary income/spend)`);
  const lostByTopology = new Map<string, number>();
  for (const t of lost) {
    const k = `${typeOf(t.accountId)} ${t.amountCents < 0 ? 'outflow' : 'inflow'}`;
    lostByTopology.set(k, (lostByTopology.get(k) ?? 0) + 1);
  }
  for (const [k, n] of [...lostByTopology].sort((a, b) => b[1] - a[1])) console.log(`    ${k.padEnd(24)} ${n}`);
  console.log(`  sample (up to 30):`);
  for (const t of lost.slice(0, 30)) {
    console.log(
      `    ${t.date} ${usd(t.amountCents).padStart(12)} ${labelOf(t.accountId).padEnd(28)} "${t.rawDescriptor.slice(
        0,
        32,
      )}" cat=${t.categoryId ?? 'null'}${t.needsReview ? ' NEEDS-REVIEW' : ''}`,
    );
  }
}

await c.end();
console.log('\ndone - read-only, nothing written.');
