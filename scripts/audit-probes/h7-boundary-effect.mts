/**
 * READ-ONLY production probe — H.7 part 4: the sweep is the ONLY transaction
 * read surface in the app that skips the reconciliation boundary. Measure what
 * applying the app's own canonical keep-rule does to it. Every statement is a
 * SELECT; nothing is written.
 *
 * `getReconciliationTxnKeep` (src/server/reconciliation.ts:446) is the R1
 * ownership filter the register, CSV export, budgets, recurring detection and
 * triage all apply: for a reconciled pair, the predecessor owns its history up
 * to the cutover and the successor owns the rest, so exactly ONE copy of a
 * duplicated row survives. `refreshTransferFlags` (transfer-refresh.ts:24-38)
 * reads every non-split row with no such filter — so it sees BOTH copies and
 * can pair a purchase against its own duplicate, which is precisely the
 * same-account case `transfers.ts:53` already refuses.
 *
 * This probe imports the PURE engine filter (`reconciliationTxnKeepFilter`) and
 * feeds it real rows, so the rule measured is the shipped rule, not a replica.
 *
 * Variants:
 *   shipped     — every non-split row (what the sweep does today)
 *   boundary    — rows the app's own keep-rule owns (what every other surface sees)
 *   boundary+D  — boundary, plus: a settled substantively-categorized row may be
 *                 overturned only by a DIRECTIONALLY COHERENT pair (the outflow
 *                 leg sits on an account money can actually leave).
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { daysBetween, isoDate } from '../../src/lib/dates';
import { reconciliationTxnKeepFilter } from '../../src/lib/engine/account/reconcile-boundary';
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

const users = await c.query<{ id: string }>(
  `select distinct u.id from "User" u join "Account" a on a."userId" = u.id
   where a."providerRef" is not null order by u.id asc`,
);

for (const user of users.rows) {
  console.log(`===== user ${user.id} =====`);

  const accounts = await c.query<{
    id: string;
    name: string;
    type: string;
    mask: string | null;
    currency: string | null;
    currentBalanceCents: string | number | null;
  }>(
    `select id, name, type, mask, currency, "currentBalanceCents" from "Account" where "userId" = $1`,
    [user.id],
  );
  const accRows = accounts.rows.map((a) => ({
    ...a,
    currentBalanceCents: a.currentBalanceCents === null ? null : Number(a.currentBalanceCents),
  }));
  const accById = new Map(accRows.map((a) => [a.id, a]));
  const typeOf = (id: string) => accById.get(id)?.type ?? 'UNKNOWN';
  const labelOf = (id: string) => {
    const a = accById.get(id);
    return a ? `${a.type}/${a.name.slice(0, 20)}${a.mask ? `..${a.mask}` : ''}` : `?${id}`;
  };

  const links = await c.query<{ predecessorAccountId: string; successorAccountId: string; cutoverDate: string }>(
    `select "predecessorAccountId", "successorAccountId", "cutoverDate"
     from "AccountReconciliation" where "userId" = $1 and "undoneAt" is null`,
    [user.id],
  );
  const spans = await c.query<{ accountId: string; first: string; last: string }>(
    `select t."accountId", min(t.date) as first, max(t.date) as last
     from "Transaction" t
     where t."accountId" = any($1::text[])
     group by t."accountId"`,
    [links.rows.map((l) => l.predecessorAccountId)],
  );
  const keep = reconciliationTxnKeepFilter(accRows, links.rows, spans.rows);
  console.log(`accounts=${accRows.length} activeLinks=${links.rows.length} predecessorSpans=${spans.rows.length}`);

  const rows = await c.query<Row>(
    `select t.id, t."accountId", t.date, t."amountCents", t."rawDescriptor",
            t."isTransfer", t."needsReview", t."categoryId"
     from "Transaction" t join "Account" a on a.id = t."accountId"
     where a."userId" = $1 and t."isSplitParent" = false order by t.date asc`,
    [user.id],
  );
  const all = rows.rows;
  const owned = all.filter((t) => keep(t.accountId, t.date));
  console.log(`rows: all=${all.length}  owned-by-the-boundary=${owned.length}  dropped=${all.length - owned.length}`);

  const isDescriptorTransfer = (d: string) => {
    const cat = normalizeMerchant(d).categoryId;
    return cat === 'transfer' || cat === 'auto-loan';
  };
  const toInput = (rs: Row[]) =>
    rs.map<TransferTxn>((t) => ({
      id: t.id,
      accountId: t.accountId,
      date: t.date,
      amountCents: t.amountCents,
      rawDescriptor: t.rawDescriptor,
    }));

  const detShipped = detectTransfers(toInput(all));
  const detBoundary = detectTransfers(toInput(owned));

  /** Directionally coherent pair: the OUTFLOW leg can actually send money. */
  function hasCoherentPair(t: Row, pool: Row[]): boolean {
    for (const o of pool) {
      if (o.id === t.id || o.accountId === t.accountId) continue;
      if (Math.sign(o.amountCents) === Math.sign(t.amountCents)) continue;
      if (Math.abs(o.amountCents) !== Math.abs(t.amountCents)) continue;
      if (Math.abs(daysBetween(isoDate(t.date), isoDate(o.date))) > 3) continue;
      const outAcc = t.amountCents < 0 ? t.accountId : o.accountId;
      if (CAN_SEND.has(typeOf(outAcc))) return true;
    }
    return false;
  }

  const settledSubstantive = (t: Row) =>
    !t.needsReview && t.categoryId !== null && t.categoryId !== 'transfer' && t.categoryId !== 'uncategorized';

  const report = (name: string, pool: Row[], det: Set<string>, direction: boolean) => {
    const flagged = pool.filter((t) => {
      if (!det.has(t.id)) return false;
      if (!direction) return true;
      if (isDescriptorTransfer(t.rawDescriptor)) return true;
      if (!settledSubstantive(t)) return true;
      return hasCoherentPair(t, pool);
    });
    const harm = flagged.filter((t) => settledSubstantive(t) && !isDescriptorTransfer(t.rawDescriptor));
    const income = harm.filter((t) => t.categoryId && isIncomeCategoryId(t.categoryId));
    console.log(
      `  ${name.padEnd(12)} detected=${String(flagged.length).padStart(3)}  settled-pair-only=${String(
        harm.length,
      ).padStart(3)}  income=${String(income.length).padStart(2)}  withheld=${usd(
        harm.reduce((s, t) => s + Math.abs(t.amountCents), 0),
      ).padStart(13)}`,
    );
    return harm;
  };

  console.log(`\nEFFECT ON THE SETTLED POPULATION H.7 IS ABOUT:`);
  report('shipped', all, detShipped, false);
  report('boundary', owned, detBoundary, false);
  const residue = report('boundary+D', owned, detBoundary, true);

  console.log(`\nRESIDUE under boundary+D — settled rows still overturned (these must be defensible):`);
  for (const t of residue) {
    console.log(
      `  ${t.date} ${usd(t.amountCents).padStart(12)} ${labelOf(t.accountId).padEnd(30)} "${t.rawDescriptor.slice(
        0,
        32,
      )}" cat=${t.categoryId}`,
    );
  }
}

await c.end();
console.log('\ndone - read-only, nothing written.');
