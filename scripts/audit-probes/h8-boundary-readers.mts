/**
 * READ-ONLY production probe — H.8: six transaction readers skip the
 * reconciliation boundary (`getReconciliationTxnKeep`). Measure, for each, the
 * delta between what it reads TODAY (shipped) and what the app's own keep-rule
 * owns — rows, and dollars where the reader feeds a rendered figure. Every
 * statement is a SELECT; nothing is written.
 *
 * The six (TASKS H.8, verified 2026-08-05):
 *   1. spending-plan.ts:198  — LOAN/MORTGAGE inflows fed to the ±3d pair rule
 *                              (loanPaymentMerchantCanonicals) → the Fixed figure.
 *                              Its sibling demo.ts:120-133 EXCLUDES superseded
 *                              loan accounts; the live path does not.
 *   2. household-digest.ts:97 — mailed movement tally; uses the ACCOUNT-level
 *                              superseded exclusion instead of the windowed keep.
 *   3. self-audit.ts:61-62   — review-rate counts (a diagnostic that can
 *                              contradict the register it audits).
 *   4. keyword-rules.ts:261  — apply-to-history preview count + write set
 *                              (the preview count IS a rendered number).
 *   5. backfill.ts:82        — unresolved rows only; exposure is wasted LLM work
 *                              + a reported count inflated by invisible rows.
 *   6. rules.ts:95           — corrections joined by explicit id; exposure is a
 *                              hand decision counted twice via a duplicate copy.
 *
 * Verdict rule (from the TASKS row): only a reader whose delta reaches a
 * rendered number gets a fix.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { isoDate, addDays, type ISODate } from '../../src/lib/dates';
import {
  reconciliationTxnKeepFilter,
  effectiveReconciliationLinks,
} from '../../src/lib/engine/account/reconcile-boundary';
import { loanPaymentMerchantCanonicals, LOAN_ACCOUNT_TYPES } from '../../src/lib/engine/categorize/transfers';
import { summarizeSharedMovement } from '../../src/lib/engine/household/digest';
import { SPENDING_ACCOUNT_TYPES } from '../../src/lib/engine/transactions/query';
import { PAYMENT_ACCOUNT_TYPES } from '../../src/lib/engine/settings/dials';
import { isSupportedCurrency } from '../../src/lib/providers/currency';

const env = readFileSync(new URL('../../.env.prod.tmp', import.meta.url), 'utf8');
const line = env.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='))!;
const url = line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
const c = new pg.Client({ connectionString: url });
await c.connect();

const usd = (cents: number) => `$${(Math.abs(cents) / 100).toFixed(2)}`;
const SPEND = [...SPENDING_ACCOUNT_TYPES];

interface Acc {
  id: string;
  name: string;
  type: string;
  mask: string | null;
  currency: string | null;
  currentBalanceCents: number;
  sharedToHousehold: boolean;
  userId: string;
}
interface Txn {
  id: string;
  accountId: string;
  date: string;
  amountCents: number;
  rawDescriptor: string;
  isTransfer: boolean;
  needsReview: boolean;
  categoryId: string | null;
  status: string;
  isSplitParent: boolean;
  splitParentId: string | null;
  reviewPinned: boolean;
  excludeFromTotals: boolean;
}

async function loadAccounts(userIds: string[]): Promise<Acc[]> {
  const r = await c.query(
    `select id, name, type, mask, currency, "currentBalanceCents", "sharedToHousehold", "userId"
     from "Account" where "userId" = any($1::text[])`,
    [userIds],
  );
  return r.rows.map((a) => ({
    ...a,
    currentBalanceCents: a.currentBalanceCents === null ? 0 : Number(a.currentBalanceCents),
  }));
}

/** Build the shipped keep-rule + the account-level superseded set for ONE user. */
async function boundaryFor(userId: string, accs: Acc[]) {
  const links = await c.query<{ predecessorAccountId: string; successorAccountId: string; cutoverDate: string }>(
    `select "predecessorAccountId", "successorAccountId", "cutoverDate"
     from "AccountReconciliation" where "userId" = $1 and "undoneAt" is null`,
    [userId],
  );
  const spans = await c.query<{ accountId: string; first: string; last: string }>(
    `select "accountId", min(date) as first, max(date) as last from "Transaction"
     where "accountId" = any($1::text[]) group by "accountId"`,
    [links.rows.map((l) => l.predecessorAccountId)],
  );
  const keep = reconciliationTxnKeepFilter(accs, links.rows, spans.rows);
  // activeSupersededPredecessorIds parity (reconciliation.ts:391-406): supported
  // currencies only, then effective links' predecessors.
  const supported = accs.filter((a) => isSupportedCurrency(a.currency));
  const superseded = new Set(effectiveReconciliationLinks(supported, links.rows).map((l) => l.predecessorAccountId));
  return { keep, superseded, activeLinks: links.rows.length };
}

async function txns(where: string, params: unknown[]): Promise<Txn[]> {
  const r = await c.query(
    `select t.id, t."accountId", t.date, t."amountCents", t."rawDescriptor", t."isTransfer",
            t."needsReview", t."categoryId", t.status, t."isSplitParent", t."splitParentId",
            t."reviewPinned", t."excludeFromTotals"
     from "Transaction" t join "Account" a on a.id = t."accountId"
     where ${where} order by t.date asc`,
    params,
  );
  return r.rows;
}

const users = await c.query<{ id: string }>(
  `select distinct u.id from "User" u join "Account" a on a."userId" = u.id
   where a."providerRef" is not null order by u.id asc`,
);

for (const user of users.rows) {
  console.log(`\n===== user ${user.id} =====`);
  const accs = await loadAccounts([user.id]);
  const accById = new Map(accs.map((a) => [a.id, a]));
  const labelOf = (id: string) => {
    const a = accById.get(id);
    return a ? `${a.type}/${a.name.slice(0, 22)}${a.mask ? `..${a.mask}` : ''}` : `?${id}`;
  };
  const { keep, superseded, activeLinks } = await boundaryFor(user.id, accs);
  console.log(`accounts=${accs.length} activeLinks=${activeLinks} supersededAccounts=${superseded.size}`);
  if (activeLinks === 0) {
    console.log('no reconciliation links — every reader trivially agrees with the boundary; skipping.');
    continue;
  }
  const delta = (rows: Txn[]) => rows.filter((t) => !keep(t.accountId, t.date));
  const dollars = (rows: Txn[]) => rows.reduce((s, t) => s + Math.abs(t.amountCents), 0);

  // ---- 1. spending-plan loanSideInflows + the pair-rule replay --------------
  const loanShipped = await txns(
    `a."userId" = $1 and a.type = any($2::text[]) and (a.currency is null or a.currency = 'USD')
     and t."amountCents" > 0 and t.status = 'POSTED'`,
    [user.id, [...LOAN_ACCOUNT_TYPES]],
  );
  const loanBoundary = loanShipped.filter((t) => keep(t.accountId, t.date));
  const loanNoSuperseded = loanShipped.filter((t) => !superseded.has(t.accountId));
  // Cash side ~ snap.transactions' contribution: the pair rule only reads
  // transfer-flagged OUTFLOWS on PAYMENT accounts (transfers.ts:391-395), and the
  // snapshot is boundaried — so replay with keep() applied.
  const cashSide = (
    await txns(
      `a."userId" = $1 and a.type = any($2::text[]) and (a.currency is null or a.currency = 'USD')
       and t."isSplitParent" = false and t."isTransfer" = true and t."amountCents" < 0`,
      [user.id, [...PAYMENT_ACCOUNT_TYPES]],
    )
  ).filter((t) => keep(t.accountId, t.date));
  const typeById = new Map(accs.map((a) => [a.id, a.type]));
  const merchSet = (loanRows: Txn[]) =>
    loanPaymentMerchantCanonicals(
      [...cashSide, ...loanRows].map((t) => ({
        accountId: t.accountId,
        date: t.date,
        amountCents: t.amountCents,
        rawDescriptor: t.rawDescriptor,
        isTransfer: t.isTransfer,
      })),
      typeById,
    );
  const mShipped = merchSet(loanShipped);
  const mBoundary = merchSet(loanBoundary);
  const mNoSup = merchSet(loanNoSuperseded);
  const setDiff = (a: Set<string>, b: Set<string>) => [...a].filter((x) => !b.has(x));
  console.log(`\n[1] spending-plan loanSideInflows (feeds loanPaymentMerchantCanonicals -> Fixed):`);
  console.log(
    `    loan-side rows: shipped=${loanShipped.length} boundary=${loanBoundary.length} noSuperseded=${loanNoSuperseded.length}` +
      `  (dropped-by-boundary=${loanShipped.length - loanBoundary.length}, ${usd(dollars(delta(loanShipped)))})`,
  );
  console.log(`    merchant set shipped   = {${[...mShipped].join(', ')}}`);
  console.log(`    merchant set boundary  = {${[...mBoundary].join(', ')}}`);
  console.log(`    merchant set noSupersd = {${[...mNoSup].join(', ')}}`);
  const gained = setDiff(mShipped, mBoundary);
  const lost = setDiff(mBoundary, mShipped);
  console.log(
    gained.length || lost.length
      ? `    ** FIGURE-MOVING: shipped-only={${gained.join(', ')}} boundary-only={${lost.join(', ')}}`
      : `    figure unmoved on this corpus (sets identical).`,
  );
  for (const t of delta(loanShipped).slice(0, 10)) {
    console.log(`      dropped: ${t.date} ${usd(t.amountCents)} ${labelOf(t.accountId)} "${t.rawDescriptor.slice(0, 32)}"`);
  }

  // ---- 3. self-audit counts -------------------------------------------------
  const auditRows = await txns(
    `a."userId" = $1 and a.type = any($2::text[]) and (a.currency is null or a.currency = 'USD')
     and t."isSplitParent" = false and (t."isTransfer" = false or t."reviewPinned" = true)`,
    [user.id, SPEND],
  );
  const auditOwned = auditRows.filter((t) => keep(t.accountId, t.date));
  const nr = (rows: Txn[]) => rows.filter((t) => t.needsReview).length;
  console.log(`\n[3] self-audit counts (reviewNeeding/reviewTotal):`);
  console.log(
    `    shipped: ${nr(auditRows)}/${auditRows.length}   boundary: ${nr(auditOwned)}/${auditOwned.length}` +
      `   delta rows=${auditRows.length - auditOwned.length} deltaNeedsReview=${nr(auditRows) - nr(auditOwned)}`,
  );

  // ---- 4. keyword-rules matchable history (preview count + write set) -------
  const kwRows = await txns(
    `a."userId" = $1 and a.type = any($2::text[]) and (a.currency is null or a.currency = 'USD')
     and t."isSplitParent" = false and t."splitParentId" is null and t."isTransfer" = false
     and t."reviewPinned" = false`,
    [user.id, SPEND],
  );
  const kwDelta = delta(kwRows);
  console.log(`\n[4] keyword-rules matchable history (preview "N transactions" + write set):`);
  console.log(
    `    shipped=${kwRows.length} boundary=${kwRows.length - kwDelta.length} delta=${kwDelta.length} (${usd(dollars(kwDelta))} of rows invisible to the register)`,
  );

  // ---- 5. backfill (unresolved rows) ----------------------------------------
  const bfRows = await txns(
    `a."userId" = $1 and a.type = any($2::text[])
     and t."isSplitParent" = false and t."reviewPinned" = false and t."isTransfer" = false
     and (t."needsReview" = true or t."categoryId" is null or t."categoryId" = 'uncategorized')`,
    [user.id, SPEND],
  );
  const bfDelta = delta(bfRows);
  console.log(`\n[5] backfill unresolved set (reported count + LLM fan-out):`);
  console.log(`    shipped=${bfRows.length} boundary=${bfRows.length - bfDelta.length} delta=${bfDelta.length}`);

  // ---- 6. rules/loadCorrectionInputs (learned-rule evidence) ----------------
  const corr = await c.query<{ transactionId: string; accountId: string; date: string }>(
    `select cx."transactionId", t."accountId", t.date
     from "Correction" cx join "Transaction" t on t.id = cx."transactionId"
     join "Account" a on a.id = t."accountId" and a."userId" = $1
     where cx."userId" = $1`,
    [user.id],
  );
  const corrDelta = corr.rows.filter((r) => !keep(r.accountId, r.date));
  console.log(`\n[6] loadCorrectionInputs (learned rules): corrections=${corr.rows.length} on-disowned-rows=${corrDelta.length}`);

  // ---- 2. household digest movement -----------------------------------------
  const hh = await c.query<{ userId: string }>(
    `select hm2."userId" from "HouseholdMember" hm
     join "HouseholdMember" hm2 on hm2."householdId" = hm."householdId"
     where hm."userId" = $1`,
    [user.id],
  );
  const memberIds = [...new Set(hh.rows.map((r) => r.userId))];
  if (memberIds.length < 2) {
    console.log(`\n[2] household digest: no household (members=${memberIds.length}) — n/a for this user.`);
    continue;
  }
  const memberAccs = await loadAccounts(memberIds);
  // Per-member boundaries (keep + superseded), exactly as the app scopes them.
  const perMember = new Map<string, Awaited<ReturnType<typeof boundaryFor>>>();
  for (const m of memberIds) {
    perMember.set(m, await boundaryFor(m, memberAccs.filter((a) => a.userId === m)));
  }
  const sharedAll = memberAccs.filter((a) => a.sharedToHousehold);
  const supersededAny = new Set(memberIds.flatMap((m) => [...perMember.get(m)!.superseded]));
  const digestScope = sharedAll
    .filter((a) => !supersededAny.has(a.id))
    .filter((a) => isSupportedCurrency(a.currency))
    .filter((a) => SPEND.includes(a.type));
  const keepScope = sharedAll
    .filter((a) => isSupportedCurrency(a.currency))
    .filter((a) => SPEND.includes(a.type));
  for (const windowDays of [7, 30]) {
    const today = isoDate(new Date().toISOString().slice(0, 10));
    const since = addDays(today, -windowDays) as ISODate;
    const fetchRows = async (ids: string[]) =>
      ids.length
        ? txns(`t."accountId" = any($1::text[]) and t.date >= $2 and t.date <= $3`, [ids, since, today])
        : Promise.resolve([]);
    const shippedRows = await fetchRows(digestScope.map((a) => a.id));
    const keepRows = (await fetchRows(keepScope.map((a) => a.id))).filter((t) => {
      const owner = memberAccs.find((a) => a.id === t.accountId)!.userId;
      return perMember.get(owner)!.keep(t.accountId, t.date);
    });
    const sum = (rows: Txn[]) =>
      summarizeSharedMovement({
        rows: rows.map((r) => ({
          date: r.date as ISODate,
          amountCents: r.amountCents,
          isTransfer: r.isTransfer,
          status: r.status,
          isSplitParent: r.isSplitParent,
          excludeFromTotals: r.excludeFromTotals,
        })),
        accountCount: digestScope.length,
        since,
        today,
      });
    const s1 = sum(shippedRows);
    const s2 = sum(keepRows);
    const same = s1.transactionCount === s2.transactionCount && s1.outflowCents === s2.outflowCents && s1.inflowCents === s2.inflowCents;
    console.log(
      `\n[2] household digest movement, ${windowDays}d window [${since}..${today}]:` +
        `\n    shipped (account-level exclusion): n=${s1.transactionCount} out=${usd(s1.outflowCents)} in=${usd(s1.inflowCents)}` +
        `\n    keep-rule (windowed):              n=${s2.transactionCount} out=${usd(s2.outflowCents)} in=${usd(s2.inflowCents)}` +
        `\n    ${same ? 'IDENTICAL on this corpus.' : '** DIVERGE — the mailed tally disagrees with the register basis.'}`,
    );
  }
}

await c.end();
console.log('\ndone - read-only, nothing written.');
