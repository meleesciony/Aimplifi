/**
 * READ-ONLY production probe — H.7 part 2: WHAT EVIDENCE does each pair-only
 * flip actually stand on? Every statement is a SELECT. Nothing is written.
 *
 * Part 1 (h7-transfer-sweep-exposure.mts) established the population: 92 settled
 * rows carry `isTransfer: true` under a NON-transfer category, 79 of them
 * explained by nothing but a pair. That is not by itself a defect — a genuine
 * brokerage funding or card autopay SHOULD be flagged. The semantics decision
 * needs the split: which of those 79 stand on real evidence and which on a
 * coincidence of amount and date.
 *
 * Evidence axes, all derived from DESCRIPTORS and ACCOUNT TOPOLOGY — never from
 * the stored `isTransfer`/`categoryId`, because both are set BY this sweep and
 * would be circular (the C.6 corollary, DECISIONS #401: all 11 false refunds
 * were already `isTransfer: true`):
 *
 *   D  descriptor-corroborated — either side normalizes to transfer/auto-loan;
 *   P  payment topology — cash outflow into a CREDIT/LOAN/MORTGAGE inflow
 *      (the C.6-blessed shape: counterpart must be CHECKING/SAVINGS);
 *   B  brokerage funding — cash <-> INVESTMENT;
 *   X  duplicate-account artifact — the two "different" accounts are the SAME
 *      account seen twice (reconciliation-linked, or same type+mask), which is
 *      how a SAME-account refund pair (excluded by design, transfers.ts:53)
 *      re-enters as a cross-account "pair";
 *   M  same normalized merchant on both sides (the refund shape);
 *   N  none of the above -> the flip rests on amount+date alone.
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
  confidenceBps: number | null;
}

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const CASH = new Set(['CHECKING', 'SAVINGS']);
const LIABILITY = new Set(['CREDIT', 'LOAN', 'MORTGAGE']);

const users = await c.query<{ id: string; email: string }>(
  `select distinct u.id, u.email from "User" u
   join "Account" a on a."userId" = u.id
   where a."providerRef" is not null order by u.id asc`,
);

for (const user of users.rows) {
  console.log(`===== user ${user.id} <${user.email}> =====`);

  const accounts = await c.query<{ id: string; name: string; type: string; mask: string | null }>(
    `select id, name, type, mask from "Account" where "userId" = $1`,
    [user.id],
  );
  const accById = new Map(accounts.rows.map((a) => [a.id, a]));
  const typeOf = (id: string) => accById.get(id)?.type ?? 'UNKNOWN';
  const labelOf = (id: string) => {
    const a = accById.get(id);
    return a ? `${a.type}/${a.name.slice(0, 22)}${a.mask ? `..${a.mask}` : ''}` : `?${id}`;
  };

  // Duplicate-account map: reconciliation links (ACTIVE only) + same type+mask.
  const recon = await c.query<{ pre: string; suc: string; undone: string | null }>(
    `select "predecessorAccountId" as pre, "successorAccountId" as suc, "undoneAt"::text as undone
     from "AccountReconciliation" where "userId" = $1`,
    [user.id],
  );
  const dupPairs = new Set<string>();
  const key2 = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  let activeRecon = 0;
  for (const r of recon.rows) {
    if (r.undone !== null) continue;
    activeRecon += 1;
    dupPairs.add(key2(r.pre, r.suc));
  }
  let maskDupes = 0;
  for (const a of accounts.rows) {
    for (const b of accounts.rows) {
      if (a.id >= b.id) continue;
      if (a.mask && a.mask === b.mask && a.type === b.type) {
        if (!dupPairs.has(key2(a.id, b.id))) maskDupes += 1;
        dupPairs.add(key2(a.id, b.id));
      }
    }
  }
  console.log(`accounts=${accounts.rows.length} activeReconciliations=${activeRecon} extraSameTypeMaskPairs=${maskDupes}`);

  const rows = await c.query<Row>(
    `select t.id, t."accountId", t.date, t."amountCents", t."rawDescriptor",
            t."isTransfer", t."needsReview", t."categoryId", t."confidenceBps"
     from "Transaction" t join "Account" a on a.id = t."accountId"
     where a."userId" = $1 and t."isSplitParent" = false order by t.date asc`,
    [user.id],
  );
  const txns = rows.rows;

  const detected = detectTransfers(
    txns.map<TransferTxn>((t) => ({
      id: t.id,
      accountId: t.accountId,
      date: t.date,
      amountCents: t.amountCents,
      rawDescriptor: t.rawDescriptor,
    })),
  );
  const isDescriptorTransfer = (d: string) => {
    const cat = normalizeMerchant(d).categoryId;
    return cat === 'transfer' || cat === 'auto-loan';
  };

  const byAbs = new Map<number, Row[]>();
  for (const t of txns) {
    const k = Math.abs(t.amountCents);
    const l = byAbs.get(k) ?? [];
    l.push(t);
    byAbs.set(k, l);
  }
  const counterparts = (t: Row) =>
    (byAbs.get(Math.abs(t.amountCents)) ?? []).filter(
      (o) =>
        o.id !== t.id &&
        o.accountId !== t.accountId &&
        Math.sign(o.amountCents) === -Math.sign(t.amountCents) &&
        Math.abs(daysBetween(isoDate(t.date), isoDate(o.date))) <= 3,
    );

  // The population: settled, flagged, non-transfer category, pair-only.
  const harm = txns.filter(
    (t) =>
      t.isTransfer &&
      !t.needsReview &&
      t.categoryId !== 'transfer' &&
      detected.has(t.id) &&
      !isDescriptorTransfer(t.rawDescriptor),
  );
  console.log(`pair-only settled rows under a non-transfer category: ${harm.length}\n`);

  const buckets = new Map<string, Row[]>();
  const add = (k: string, t: Row) => buckets.set(k, [...(buckets.get(k) ?? []), t]);

  for (const t of harm) {
    const cps = counterparts(t);
    if (cps.length === 0) {
      add('STALE (no counterpart in corpus today)', t);
      continue;
    }
    // Best available evidence across candidate counterparts.
    let best = 'N  amount+date only';
    for (const cp of cps) {
      const outAcc = t.amountCents < 0 ? t.accountId : cp.accountId;
      const inAcc = t.amountCents < 0 ? cp.accountId : t.accountId;
      const dup = dupPairs.has(key2(t.accountId, cp.accountId));
      const sameMerchant =
        normalizeMerchant(t.rawDescriptor).canonical === normalizeMerchant(cp.rawDescriptor).canonical;
      let verdict: string;
      if (dup) verdict = 'X  duplicate-account artifact';
      else if (sameMerchant) verdict = 'M  same merchant (refund shape)';
      else if (isDescriptorTransfer(cp.rawDescriptor)) verdict = 'D  descriptor-corroborated';
      else if (CASH.has(typeOf(outAcc)) && LIABILITY.has(typeOf(inAcc))) verdict = 'P  payment topology';
      else if (
        (CASH.has(typeOf(outAcc)) && typeOf(inAcc) === 'INVESTMENT') ||
        (typeOf(outAcc) === 'INVESTMENT' && CASH.has(typeOf(inAcc)))
      )
        verdict = 'B  brokerage funding';
      else verdict = 'N  amount+date only';
      const rank = (v: string) => 'XMDPBN'.indexOf(v[0]);
      if (rank(verdict) < rank(best)) best = verdict;
    }
    add(best, t);
  }

  console.log('EVIDENCE BUCKETS (best evidence any counterpart supplies):');
  for (const [k, list] of [...buckets].sort((a, b) => b[1].length - a[1].length)) {
    const cents = list.reduce((s, t) => s + Math.abs(t.amountCents), 0);
    const inc = list.filter((t) => t.categoryId && isIncomeCategoryId(t.categoryId)).length;
    console.log(
      `  ${k.padEnd(38)} n=${String(list.length).padStart(3)}  ${usd(cents).padStart(14)}${
        inc ? `   (${inc} INCOME)` : ''
      }`,
    );
  }

  for (const label of ['N  amount+date only', 'X  duplicate-account artifact', 'M  same merchant (refund shape)']) {
    const list = buckets.get(label) ?? [];
    if (list.length === 0) continue;
    console.log(`\n--- ${label} — every row ---`);
    for (const t of list) {
      const cps = counterparts(t);
      console.log(
        `  ${t.date} ${usd(t.amountCents).padStart(12)} ${labelOf(t.accountId).padEnd(30)} "${t.rawDescriptor.slice(
          0,
          30,
        )}" cat=${t.categoryId ?? 'null'}`,
      );
      for (const cp of cps.slice(0, 2)) {
        console.log(
          `      <- ${cp.date} ${labelOf(cp.accountId).padEnd(30)} "${cp.rawDescriptor.slice(0, 30)}" cat=${
            cp.categoryId ?? 'null'
          }`,
        );
      }
    }
  }
  console.log();
}

await c.end();
console.log('done - read-only, nothing written.');
