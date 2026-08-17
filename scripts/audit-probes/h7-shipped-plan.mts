/**
 * READ-ONLY production probe — H.7 part 5: run the SHIPPED code, not a replica.
 * Every statement is a SELECT. Nothing is written.
 *
 * Parts 1-4 chose the semantics using probes that re-implemented the candidate
 * rules alongside the real detector. That is exactly the gap
 * `docs/lessons/a-guard-must-read-what-it-guards` warns about: the thing measured
 * was not the thing shipped. This probe closes it by importing the shipped
 * `planTransferUpdates` and the shipped `reconciliationTxnKeepFilter`, feeding
 * them the owner's real rows in the same shape `refreshTransferFlags` builds, and
 * reporting the plan the deployed code would actually produce.
 *
 * What it must show, if the slice's claims are true:
 *   - `overturnIds` (settled substantive rows the sweep would still reverse) is
 *     the SMALL, defensible set: brokerage fundings, card autopays, the mortgage;
 *   - the rows the pre-H.7 sweep flagged and this plan declines are the ones the
 *     STATUS residual calls the repair set;
 *   - nothing in `flagIds` carries a competing verdict (that is the invariant the
 *     write's re-assertion depends on).
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { accountIdentityMap, terminalSuccessorMap } from '../../src/lib/engine/account/reconcile-boundary';
import { isIncomeCategoryId } from '../../src/lib/engine/categorize/categories';
import {
  hasCompetingVerdict,
  planTransferUpdates,
  type TransferStateTxn,
} from '../../src/lib/engine/categorize/transfers';

const env = readFileSync(new URL('../../.env.prod.tmp', import.meta.url), 'utf8');
const line = env.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='))!;
const url = line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
const c = new pg.Client({ connectionString: url });
await c.connect();

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

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
  }>(`select id, name, type, mask, currency, "currentBalanceCents" from "Account" where "userId" = $1`, [
    user.id,
  ]);
  const accRows = accounts.rows.map((a) => ({
    ...a,
    currentBalanceCents: a.currentBalanceCents === null ? 0 : Number(a.currentBalanceCents),
  }));
  const accById = new Map(accRows.map((a) => [a.id, a]));
  const labelOf = (id: string) => {
    const a = accById.get(id);
    return a ? `${a.type}/${a.name.slice(0, 22)}${a.mask ? `..${a.mask}` : ''}` : `?${id}`;
  };

  const links = await c.query<{ predecessorAccountId: string; successorAccountId: string; cutoverDate: string }>(
    `select "predecessorAccountId", "successorAccountId", "cutoverDate"
     from "AccountReconciliation" where "userId" = $1 and "undoneAt" is null`,
    [user.id],
  );
  // Cycle 2: identity, not a filtered read — the sweep must SEE every row. And
  // identity reads EVERY live link, not the money boundary's effective subset
  // (cycle-2 critic P1-1), so the probe must do the same or it is measuring a
  // rule the code does not run. The two are compared here, because a gap between
  // them is exactly the population that would silently pair with itself.
  const identity = accountIdentityMap(links.rows);
  const moneyBasis = terminalSuccessorMap(accRows, links.rows);
  console.log(
    `identity entries=${identity.size}  money-boundary entries=${moneyBasis.size}` +
      (identity.size !== moneyBasis.size
        ? `  <-- ${identity.size - moneyBasis.size} link(s) the money boundary treats as INERT`
        : '  (no inert links today)'),
  );

  // Exactly the shape refreshTransferFlags builds (transfer-refresh.ts).
  const rows = await c.query<{
    id: string;
    accountId: string;
    date: string;
    amountCents: number;
    rawDescriptor: string;
    isTransfer: boolean;
    needsReview: boolean;
    reviewPinned: boolean;
    status: string;
    categoryId: string | null;
    currency: string | null;
    type: string;
  }>(
    `select t.id, t."accountId", t.date, t."amountCents", t."rawDescriptor",
            t."isTransfer", t."needsReview", t."reviewPinned", t.status, t."categoryId",
            a.currency, a.type
     from "Transaction" t join "Account" a on a.id = t."accountId"
     where a."userId" = $1 and t."isSplitParent" = false order by t.date asc`,
    [user.id],
  );
  const byId = new Map(rows.rows.map((r) => [r.id, r]));
  const txns: TransferStateTxn[] = rows.rows
    .map((r) => ({
      id: r.id,
      accountId: r.accountId,
      date: r.date,
      amountCents: r.amountCents,
      rawDescriptor: r.rawDescriptor,
      isTransfer: r.isTransfer,
      needsReview: r.needsReview,
      reviewPinned: r.reviewPinned,
      status: r.status,
      currencySupported: r.currency === null || r.currency === 'USD',
      categoryId: r.categoryId,
      accountType: r.type,
      accountIdentityId: identity.get(r.accountId) ?? r.accountId,
    }));

  console.log(`rows: ${txns.length} (all of them — identity replaces the filtered read); reconciled accounts: ${identity.size}`);

  const plan = planTransferUpdates(txns);
  console.log(
    `SHIPPED PLAN on the live corpus: flagIds=${plan.flagIds.length} overturnIds=${plan.overturnIds.length} fileIds=${plan.fileIds.length}`,
  );

  // Invariant the flag write's re-assertion rests on.
  const byIdState = new Map(txns.map((t) => [t.id, t]));
  const violators = plan.flagIds.filter((id) => hasCompetingVerdict(byIdState.get(id)!));
  console.log(`INVARIANT flagIds carry no competing verdict: violations=${violators.length}`);

  // On a corpus the sweep has already swept, an empty plan is the CORRECT and
  // expected answer — it is the idempotence the integration tests assert.
  console.log(`(an empty plan here means the live sweep is at fixpoint, not that the rule is inert)`);

  // THE REPAIR SET needs a different question than the plan above answers.
  // `planTransferUpdates` only proposes rows that are not already flagged, and
  // the live sweep reached fixpoint long ago — so on this corpus the plan is
  // empty by construction and proves nothing about which existing flags the new
  // rule endorses. Ask the rule from scratch instead: replay it with every
  // `isTransfer` cleared, so it must justify each flag on today's evidence.
  const fromScratch = planTransferUpdates(txns.map((t) => ({ ...t, isTransfer: false })));
  console.log(
    `\nFROM-SCRATCH replay (isTransfer cleared, so every flag must be re-justified): flagIds=${fromScratch.flagIds.length} overturnIds=${fromScratch.overturnIds.length}`,
  );
  console.log(`  overturnIds — settled verdicts the shipped rule still endorses reversing:`);
  for (const id of fromScratch.overturnIds) {
    const t = byIdState.get(id)!;
    console.log(
      `    ${t.date} ${usd(t.amountCents).padStart(12)} ${labelOf(t.accountId).padEnd(28)} "${t.rawDescriptor.slice(
        0,
        34,
      )}" cat=${t.categoryId}`,
    );
  }

  const wouldFlagNow = new Set([...fromScratch.flagIds, ...fromScratch.overturnIds]);
  const currentlyFlaggedSettled = rows.rows.filter(
    (r) => r.isTransfer && !r.needsReview && r.categoryId !== null && r.categoryId !== 'transfer' && r.categoryId !== 'uncategorized',
  );
  const repair = currentlyFlaggedSettled.filter((r) => !wouldFlagNow.has(r.id));
  const repairIncome = repair.filter((r) => r.categoryId && isIncomeCategoryId(r.categoryId));
  console.log(
    `\nREPAIR SET (flagged today, this plan declines): ${repair.length} rows  ${usd(
      repair.reduce((s, r) => s + Math.abs(r.amountCents), 0),
    )}  of which INCOME-categorised: ${repairIncome.length}`,
  );
  console.log(`  NOTE: not repaired by H.7 — flags are add-only; see STATUS residual 3.`);
  void byId;
}

await c.end();
console.log('\ndone - read-only, nothing written.');
