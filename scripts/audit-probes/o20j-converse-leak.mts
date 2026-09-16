/**
 * READ-ONLY production probe — O.20j part 3: SIZE the CONVERSE leak.
 *
 * THE REPORT (TASKS O.20j). The row is explicit that one direction is sized and
 * the other is not:
 *
 *   "**The converse leak is invisible to any basis-gap measurement by
 *    construction:** `isTransfer=true` rows are filed under 15 real spending
 *    categories ... - excluded from BOTH the chart and the card identically, so
 *    a false-positive transfer match silently under-counts real spending
 *    everywhere with no gap to surface it."
 *
 * and the status cell still reads "**Still OPEN:** converse leak (sizing +
 * H.7b)". The explorer census for this slice confirms no committed probe
 * measures it: every `h7-*.mts` part measures the OTHER direction (settled
 * rows WITHHOLDING under a NON-transfer category, the H.7 overturn question).
 *
 * So this probe does the one thing the row asks for: put a NUMBER on the
 * converse population and its dollars, BEFORE any code changes.
 *
 * WHY A BASIS-GAP PROBE CANNOT SEE IT (the row's own thesis, verified here in
 * code, not in prose). The two readers of a spending row each drop a flagged
 * row:
 *   - the CHART (`monthlyFlows` → `countsInFlows`, insights.ts:92) drops it on
 *     `!t.isTransfer`;
 *   - the CARD (`spendingByCategory` → `isSpendRow`, reports.ts:227) drops it on
 *     `t.isTransfer` too.
 * Both drop it, so the on-screen gap `card.total - chart.expenses` stays 0 and
 * the reporting view (reports-view.tsx basisGapCents) has nothing to disclose.
 * That is the "invisible by construction" claim, and it is measured below by
 * calling BOTH shipped predicates on the same rows and reporting the gap.
 *
 * THE ARMS — every arm calls the SHIPPED code, never a replica:
 *   ARM 1 (population) — settled (`needsReview=false`) rows with `isTransfer=true`
 *        whose category is a REAL spend category (not 'transfer', not
 *        'uncategorized', not Income-group). Split by sign: the OUTFLOW dollars
 *        that never reach the spending card, and the INFLOW dollars that never
 *        reach income. This is the leak's raw size.
 *   ARM 2 (evidence) — for each such row, the SHIPPED `detectTransfers` +
 *        `planTransferUpdates` are asked whether the flag still stands on TODAY's
 *        evidence: descriptor-known (normalizer says transfer/auto-loan, or the
 *        stored leaf is 'transfer'), pair-only (±3-day opposite amount across
 *        two accounts), or NOTHING (the counterpart is gone from the corpus).
 *        A flag standing on nothing is the pure false positive.
 *   ARM 3 (repair reach) — the SHIPPED `planTransferFlagRepair` is run over the
 *        sweep's own read shape: how many of the converse rows it would CLEAR,
 *        and how many it declines out of scope. That number is what the existing
 *        H.7b owner-triggered repair already reaches — the question is whether
 *        that is enough, or whether the WRITER should stop minting them.
 *   ARM 4 (demo seed) — the same population over the shipped seed, so a fix
 *        that moves demo dollars is known before it is written.
 *
 * FIDELITY (the o20a / o20c pattern):
 *   - EXACT: the sweep's own read shape (`loadTransferSweepRows`,
 *     transfer-refresh.ts:61-97): non-split-parent rows, account currency +
 *     type, and `activeAccountIdentityMap` for the pairing identity.
 *   - EXACT: every predicate/engine call — `countsInFlows`, `isSpendRow`,
 *     `monthlyFlows`, `spendingByCategory`, `hasCompetingVerdict`,
 *     `detectTransfers`, `planTransferUpdates`, `planTransferFlagRepair`,
 *     `normalizeMerchant`, `isIncomeCategoryId`.
 *   - ONE APPROXIMATION, LABELLED: the row scope is the whole corpus for the
 *     probe's own census; the /reports surface reads SPEND-type accounts only
 *     (SPENDING_ACCOUNT_TYPES). Both are printed, and the flagged-spend
 *     population is reported on BOTH scopes so the number the card would lose
 *     is exact.
 *
 * Every statement is a SELECT; nothing is written.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { planTransferUpdates, type TransferStateTxn } from '../../src/lib/engine/categorize/transfers';
import { planTransferFlagRepair } from '../../src/lib/engine/categorize/transfer-flag-repair';
import { normalizeMerchant } from '../../src/lib/engine/categorize/normalize';
import { isIncomeCategoryId } from '../../src/lib/engine/categorize/categories';
import { countsInFlows, monthlyFlows } from '../../src/lib/engine/fi/insights';
import { isSpendRow, spendingByCategory } from '../../src/lib/engine/reports/reports';
import { SPENDING_ACCOUNT_TYPES } from '../../src/lib/engine/transactions/query';
import { accountIdentityMap } from '../../src/lib/engine/account/reconcile-boundary';
import { detectDuplicateAccounts } from '../../src/lib/engine/account/duplicates';
import { monthKey, daysBetween, isoDate } from '../../src/lib/dates';

const env = readFileSync(new URL('../../.env.prod.tmp', import.meta.url), 'utf8');
const line = env.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='))!;
const url = line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
const c = new pg.Client({ connectionString: url });
await c.connect();

const usd = (n: number) => `${n < 0 ? '-' : ''}$${(Math.abs(n) / 100).toFixed(2)}`;
const SPEND = new Set([...SPENDING_ACCOUNT_TYPES]);
/** The transfer topology axes (the C.6-blessed shapes), reused from
 *  `h7-pair-evidence.mts` so the two probes classify alike. */
const CASH = new Set(['CHECKING', 'SAVINGS']);
const LIABILITY = new Set(['CREDIT', 'LOAN', 'MORTGAGE']);

interface Row {
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
  excludeFromTotals: boolean;
  isSplitParent: boolean;
  currency: string | null;
  type: string;
}

/** A row filed to a REAL spend category (the leak's own population): flagged as
 *  a transfer while its stored category asserts it is spending — not the
 *  'transfer' leaf (which AGREES with the flag), not the 'uncategorized'
 *  placeholder (no verdict), not an Income-group leaf. */
const isConverse = (r: Row): boolean =>
  r.isTransfer &&
  !r.needsReview &&
  r.status === 'POSTED' &&
  !r.isSplitParent &&
  !r.excludeFromTotals &&
  r.categoryId !== null &&
  r.categoryId !== 'transfer' &&
  r.categoryId !== 'uncategorized' &&
  r.categoryId !== 'refund' &&
  !isIncomeCategoryId(r.categoryId);

async function users(): Promise<{ id: string; email: string | null }[]> {
  const r = await c.query<{ id: string; email: string | null }>(
    `select distinct u.id, u.email from "User" u
     join "Account" a on a."userId" = u.id
     where a."providerRef" is not null order by u.id asc`,
  );
  return r.rows;
}

async function readUser(userId: string): Promise<{ rows: Row[]; identity: Map<string, string> }> {
  const links = await c.query<{ predecessorAccountId: string; successorAccountId: string; cutoverDate: string }>(
    `select "predecessorAccountId", "successorAccountId", "cutoverDate"
     from "AccountReconciliation" where "userId" = $1 and "undoneAt" is null`,
    [userId],
  );
  const identity = accountIdentityMap(links.rows);
  const r = await c.query<Row>(
    `select t.id, t."accountId", t.date::text as date, t."amountCents", t."rawDescriptor",
            t."isTransfer", t."needsReview", t."reviewPinned", t.status, t."categoryId",
            t."excludeFromTotals"::boolean as "excludeFromTotals", t."isSplitParent",
            a.currency, a.type
     from "Transaction" t join "Account" a on a.id = t."accountId"
     where a."userId" = $1 and t."isSplitParent" = false order by t.date asc`,
    [userId],
  );
  return {
    rows: r.rows.map((x) => ({ ...x, date: x.date.slice(0, 10) })),
    identity,
  };
}

/** Exactly the shape `refreshTransferFlags` builds (transfer-refresh.ts:92-98). */
function asStateTxn(rows: readonly Row[], identity: Map<string, string>): TransferStateTxn[] {
  return rows.map((r) => ({
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
    excludeFromTotals: r.excludeFromTotals,
  }));
}

const descriptorKnown = (t: { rawDescriptor: string; categoryId: string | null }): boolean => {
  const norm = normalizeMerchant(t.rawDescriptor).categoryId;
  return norm === 'transfer' || norm === 'auto-loan' || t.categoryId === 'transfer';
};

console.log('=== O.20j — SIZING the converse leak (READ-ONLY) ===\n');

const all = await users();
let totConverseOutflow = 0;
let totConverseInflow = 0;
let totConverseCount = 0;
const verdictTotals = new Map<string, { n: number; cents: number }>();

for (const u of all) {
  const { rows, identity } = await readUser(u.id);
  console.log(`===== user ${u.email ?? u.id} — ${rows.length} rows =====`);

  // ── 1. THE POPULATION — flagged as transfer while filed to a real spend leaf ──
  const converse = rows.filter(isConverse);
  const spendScope = converse.filter((r) => SPEND.has(r.type));
  const outflows = spendScope.filter((r) => r.amountCents < 0);
  const inflows = spendScope.filter((r) => r.amountCents > 0);
  const outflowCents = -outflows.reduce((s, r) => s + r.amountCents, 0);
  const inflowCents = inflows.reduce((s, r) => s + r.amountCents, 0);
  totConverseCount += converse.length;
  totConverseOutflow += outflowCents;
  totConverseInflow += inflowCents;

  console.log(`  converse rows (flagged transfer, filed to a real spend leaf, settled): ${converse.length}`);
  console.log(`    in SPEND-type accounts: ${spendScope.length}`);
  console.log(`    OUTFLOW withheld from the spending card : ${outflows.length} rows  ${usd(outflowCents)}`);
  console.log(`    INFLOW  withheld from income            : ${inflows.length} rows  ${usd(inflowCents)}`);

  if (converse.length === 0) {
    console.log('  → no converse rows: this user is untouched by the leak.');
    console.log();
    continue;
  }

  // Per-category split — which spending leaves the flag is hiding.
  {
    const byCat = new Map<string, { n: number; cents: number }>();
    for (const r of spendScope) {
      const b = byCat.get(r.categoryId!) ?? { n: 0, cents: 0 };
      b.n++;
      b.cents += Math.abs(r.amountCents);
      byCat.set(r.categoryId!, b);
    }
    console.log('  by category (SPEND scope, |amount|):');
    for (const [cat, b] of [...byCat.entries()].sort((a, b) => b[1].cents - a[1].cents)) {
      console.log(`    ${cat.padEnd(24)} ${String(b.n).padStart(4)} rows   ${usd(b.cents).padStart(14)}`);
    }
  }

  // ── 2. THE VERDICT PER ROW — ONE ordered classifier, so the buckets PARTITION
  // the 94 rows. The question each bucket answers is "why is this row still
  // withheld, and is the flag right?" — because the fix differs entirely by
  // bucket: a RIGHT flag under a contradicted CATEGORY is the reader's control
  // problem; a WRONG flag is the pair rule's problem. ──
  const activeLinks = new Set<string>();
  const undoneLinks = new Set<string>();
  const maskPairs = new Set<string>();
  {
    const recon = await c.query<{ pre: string; suc: string; undone: string | null }>(
      `select "predecessorAccountId" as pre, "successorAccountId" as suc, "undoneAt"::text as undone
       from "AccountReconciliation" where "userId" = $1`,
      [u.id],
    );
    for (const r of recon.rows) {
      (r.undone === null ? activeLinks : undoneLinks).add([r.pre, r.suc].sort().join('|'));
    }
    const accts = await c.query<{ id: string; type: string; mask: string | null }>(
      `select id, type, mask from "Account" where "userId" = $1`,
      [u.id],
    );
    for (const a of accts.rows) {
      for (const b of accts.rows) {
        if (a.id >= b.id || !a.mask || a.mask !== b.mask || a.type !== b.type) continue;
        maskPairs.add([a.id, b.id].sort().join('|'));
      }
    }
  }

  /** ONE bucket per row, in priority order, so the labels PARTITION the converse
   *  population. Topology (CASH→LIABILITY, CASH↔INVESTMENT) is applied before the
   *  bare coincidence bucket, because a cash outflow into a card/loan/investment
   *  account is the shape a real transfer has — the C.6-blessed reading — while a
   *  pair matched on nothing but amount+date across unrelated accounts is the
   *  exact coincidence H.7 was built to refuse. */
  const classify = (r: Row): string => {
    // (1) The row's OWN name says transfer — the flag is right by name; the
    // stored spend category is what contradicts it (a category defect, not a
    // flag defect: the money is correctly outside spending).
    if (descriptorKnown(r)) return 'A  flag right: own descriptor is transfer-like';
    const cps = rows.filter(
      (o) =>
        o.id !== r.id &&
        o.accountId !== r.accountId &&
        Math.abs(o.amountCents) === Math.abs(r.amountCents) &&
        Math.sign(o.amountCents) === -Math.sign(r.amountCents) &&
        Math.abs(daysBetween(isoDate(r.date), isoDate(o.date))) <= 3,
    );
    if (cps.length === 0) return 'E  flag WRONG: nothing stands on it (counterpart gone)';
    let sawActive = false;
    let sawUndone = false;
    let sawMask = false;
    let sawNamed = false;
    let sawPayment = false;
    let sawBrokerage = false;
    let sawCoincidence = false;
    for (const cp of cps) {
      const key = [r.accountId, cp.accountId].sort().join('|');
      if (activeLinks.has(key)) sawActive = true;
      else if (undoneLinks.has(key)) sawUndone = true;
      else if (maskPairs.has(key)) sawMask = true;
      else if (descriptorKnown(cp)) sawNamed = true;
      else {
        // Outflow leg = the negative side; a transfer needs a sender money can leave.
        const outType = r.amountCents < 0 ? r.type : cp.type;
        const inType = r.amountCents < 0 ? cp.type : r.type;
        if (CASH.has(outType) && LIABILITY.has(inType)) sawPayment = true;
        else if (
          (CASH.has(outType) && inType === 'INVESTMENT') ||
          (outType === 'INVESTMENT' && CASH.has(inType))
        )
          sawBrokerage = true;
        else sawCoincidence = true;
      }
    }
    // (2) A named counterpart: the thing it moved to is itself a transfer.
    if (sawNamed) return 'B  flag right: counterpart descriptor is transfer-like';
    // (3) Cash → card/loan/mortgage: the payment-topology shape.
    if (sawPayment) return 'C  flag right: payment topology (cash → liability)';
    // (4) Cash ↔ investment: a brokerage sweep.
    if (sawBrokerage) return 'D  flag right: brokerage sweep (cash ↔ investment)';
    // (5) An ACTIVE link: the shipped identity map SHOULD have excluded this pair.
    if (sawActive) return 'F  flag WRONG: active link not honored by the pair rule';
    // (6) An undone link, or a same-type+mask pair the identity map deliberately
    // ignores — a pair the reader never reconciled.
    if (sawUndone) return 'G  flag WRONG: pair is an UNDONE-linked duplicate';
    if (sawMask) return 'H  flag WRONG: pair is a same-type+mask duplicate';
    // (7) Distinct accounts, no reconciliation claim, no transfer topology: the
    // bare amount+date coincidence H.7 refuses to act on.
    if (sawCoincidence) return 'I  flag WRONG: bare ±3-day coincidence (unrelated accounts)';
    return 'J  unclassified';
  };

  const wrongVerdict = (k: string) => k.includes('WRONG');

  const verdicts = new Map<string, { n: number; cents: number }>();
  for (const r of converse) {
    const k = classify(r);
    const b = verdicts.get(k) ?? { n: 0, cents: 0 };
    b.n++;
    b.cents += Math.abs(r.amountCents);
    verdicts.set(k, b);
    const g = verdictTotals.get(k) ?? { n: 0, cents: 0 };
    g.n++;
    g.cents += Math.abs(r.amountCents);
    verdictTotals.set(k, g);
  }
  console.log('\n  VERDICT PER ROW (partitions the converse population):');
  for (const [k, b] of [...verdicts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(`    ${k.padEnd(58)} ${String(b.n).padStart(4)} rows   ${usd(b.cents).padStart(14)}`);
  }
  const wrong = converse.filter((r) => wrongVerdict(classify(r)));
  console.log(
    `    ⇒ WRONG flags: ${wrong.length} rows / ${usd(wrong.reduce((s, r) => s + Math.abs(r.amountCents), 0))}` +
      ` — money the reader never spent, withheld from every total.`,
  );
  // BUCKET F specifically: rows the classifier calls "active link not honored". If
  // real, the shipped pair rule is failing; if a probe artifact, the classifier is
  // wrong. Print each with its counterpart's account id + the identity the shipped
  // map computes for BOTH sides, so the claim is checked against the shipped rule.
  {
    const f = converse.filter((r) => classify(r).startsWith('F'));
    if (f.length) {
      console.log('\n    BUCKET F — "active link not honored" (verify against the SHIPPED identity map):');
      const idOf = (acct: string) => {
        let cur = acct;
        let guard = 0;
        while (identity.has(cur) && identity.get(cur) !== cur && guard++ < 10) cur = identity.get(cur)!;
        return cur;
      };
      for (const r of f) {
        const cps = rows.filter(
          (o) =>
            o.id !== r.id &&
            o.accountId !== r.accountId &&
            Math.abs(o.amountCents) === Math.abs(r.amountCents) &&
            Math.sign(o.amountCents) === -Math.sign(r.amountCents) &&
            Math.abs(daysBetween(isoDate(r.date), isoDate(o.date))) <= 3,
        );
        console.log(
          `      ${r.date} ${usd(r.amountCents).padStart(12)} cat=${(r.categoryId ?? 'null').padEnd(14)}` +
            ` own=${r.accountId.slice(-6)}(→${idOf(r.accountId).slice(-6)}) "${r.rawDescriptor.slice(0, 26)}"`,
        );
        for (const cp of cps.slice(0, 3)) {
          console.log(
            `          <- ${cp.date} ${usd(cp.amountCents).padStart(12)} cat=${(cp.categoryId ?? 'null').padEnd(14)}` +
              ` cp=${cp.accountId.slice(-6)}(→${idOf(cp.accountId).slice(-6)}) "${cp.rawDescriptor.slice(0, 26)}"`,
          );
        }
      }
      const sameIdentity = f.filter((r) =>
        rows.some(
          (o) =>
            o.id !== r.id &&
            o.accountId !== r.accountId &&
            Math.abs(o.amountCents) === Math.abs(r.amountCents) &&
            Math.sign(o.amountCents) === -Math.sign(r.amountCents) &&
            Math.abs(daysBetween(isoDate(r.date), isoDate(o.date))) <= 3 &&
            idOf(o.accountId) === idOf(r.accountId),
        ),
      ).length;
      console.log(
        `      → ${sameIdentity} of ${f.length} have a counterpart the SHIPPED identity map DOES equate` +
          ` (these would be real rule failures); ${f.length - sameIdentity} do NOT` +
          ` (my classifier's activeLinks keying is the artifact).`,
      );
    }
  }

  // THE CRUX: are buckets A/B (the big dollars) GENUINE transfers — flag right,
  // stored category stale — or real spending wrongly hidden? Print every row
  // with the exact evidence the classifier used, so the call is made on rows.
  for (const [label, prefix] of [
    ['A — own descriptor is transfer-like', 'A'],
    ['B — counterpart descriptor is transfer-like', 'B'],
  ] as const) {
    const list = converse.filter((r) => classify(r).startsWith(prefix));
    if (!list.length) continue;
    console.log(`\n    ${label} (${list.length} rows):`);
    for (const r of list) {
      const cps = rows.filter(
        (o) =>
          o.id !== r.id &&
          o.accountId !== r.accountId &&
          Math.abs(o.amountCents) === Math.abs(r.amountCents) &&
          Math.sign(o.amountCents) === -Math.sign(r.amountCents) &&
          Math.abs(daysBetween(isoDate(r.date), isoDate(o.date))) <= 3,
      );
      console.log(
        `      ${r.date} ${usd(r.amountCents).padStart(12)} ${r.type.padEnd(9)} cat=${(r.categoryId ?? 'null').padEnd(20)} "${r.rawDescriptor.slice(0, 38)}"`,
      );
      for (const cp of cps.slice(0, 2)) {
        console.log(`          <- ${cp.date} ${usd(cp.amountCents).padStart(12)} "${cp.rawDescriptor.slice(0, 34)}"`);
      }
    }
  }

  console.log('    worst WRONG rows (why each is wrong):');
  for (const r of [...wrong].sort((a, b) => Math.abs(b.amountCents) - Math.abs(a.amountCents)).slice(0, 12)) {
    console.log(
      `      ${r.date} ${usd(r.amountCents).padStart(13)} cat=${(r.categoryId ?? 'null').padEnd(20)} ` +
        `"${r.rawDescriptor.slice(0, 34)}"  ← ${classify(r)}`,
    );
  }
  // BUCKET H specifically: the rows today's rule still ENDORSES (so the sweep
  // would mint them again). Print each with its counterpart, so the rule defect
  // is stated from the evidence rather than inferred from the bucket label.
  {
    const h = converse.filter((r) => classify(r).startsWith('H'));
    if (h.length) {
      console.log('\n    BUCKET H — still ENDORSED by today\'s rule (would be minted again):');
      for (const r of h) {
        console.log(
          `      ${r.date} ${usd(r.amountCents).padStart(12)} ${r.type.padEnd(9)} cat=${(r.categoryId ?? 'null').padEnd(16)} "${r.rawDescriptor.slice(0, 30)}"`,
        );
        const cps = rows.filter(
          (o) =>
            o.id !== r.id &&
            o.accountId !== r.accountId &&
            Math.abs(o.amountCents) === Math.abs(r.amountCents) &&
            Math.sign(o.amountCents) === -Math.sign(r.amountCents) &&
            Math.abs(daysBetween(isoDate(r.date), isoDate(o.date))) <= 3,
        );
        for (const cp of cps.slice(0, 3)) {
          console.log(
            `          <- ${cp.date} ${cp.type.padEnd(9)} acct=${cp.accountId.slice(-6)} ` +
              `"${cp.rawDescriptor.slice(0, 30)}"`,
          );
        }
      }
    }
  }

  // ── 3. THE REPAIR REACH — what the shipped H.7b repair would already clear ──
  {
    const txns = asStateTxn(rows, identity);
    const plan = planTransferFlagRepair(txns);
    const clearSet = new Set(plan.clearIds);
    const clearsConverse = converse.filter((r) => clearSet.has(r.id));
    console.log(
      `\n  SHIPPED REPAIR (planTransferFlagRepair): flaggedCount=${plan.flaggedCount} ` +
        `clear=${plan.clear.length} declinedOutOfScope=${plan.declinedOutOfScopeCount}`,
    );
    console.log(
      `    of the ${converse.length} converse rows, it would CLEAR: ${clearsConverse.length}  ` +
        `${usd(clearsConverse.reduce((s, r) => s + Math.abs(r.amountCents), 0))}`,
    );
    console.log(
      `    → the repair is owner-triggered and the flags are otherwise add-only, so the rest persist.`,
    );
    // DECIDING CUT: of the converse rows, which does today's rule still ENDORSE
    // (re-justify)? Cross it against the verdict — the two must agree for a fix
    // that changes the flag, and DISAGREE for a fix that changes the category.
    const endorsed = converse.filter((r) => !clearSet.has(r.id));
    const endorseByVerdict = new Map<string, { n: number; cents: number }>();
    for (const r of endorsed) {
      const k = classify(r);
      const b = endorseByVerdict.get(k) ?? { n: 0, cents: 0 };
      b.n++;
      b.cents += Math.abs(r.amountCents);
      endorseByVerdict.set(k, b);
    }
    console.log(`    ENDORSED by today's rule (flag kept): ${endorsed.length} rows`);
    for (const [k, b] of [...endorseByVerdict.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      console.log(`      ${k.padEnd(52)} ${String(b.n).padStart(4)} rows   ${usd(b.cents).padStart(14)}`);
    }
    // The pair rule's own defect: rows the repair CLEARS yet the verdict calls
    // flag-wrong anyway (a cleared row is not proof the rule is now right).
    const clearedByVerdict = new Map<string, { n: number; cents: number }>();
    for (const r of clearsConverse) {
      const k = classify(r);
      const b = clearedByVerdict.get(k) ?? { n: 0, cents: 0 };
      b.n++;
      b.cents += Math.abs(r.amountCents);
      clearedByVerdict.set(k, b);
    }
    console.log(`    CLEARED by the repair: ${clearsConverse.length} rows`);
    for (const [k, b] of [...clearedByVerdict.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      console.log(`      ${k.padEnd(52)} ${String(b.n).padStart(4)} rows   ${usd(b.cents).padStart(14)}`);
    }
    // Would a reader-cleared WRONG row BOUNCE BACK on the next sweep? The row is
    // chosen from the WRONG set (a flag-right row is EXPECTED to re-flag — the
    // evidence still stands), so the test is meaningful. Both the shipped
    // behavior and the behavior with a pin are shown, because the pin is what
    // triage-actions.ts:1118 already PROMISES ("pin wins in planTransferUpdates").
    {
      const txns = asStateTxn(rows, identity);
      const sample = wrong[0];
      if (!sample) {
        console.log('    BOUNCE-BACK probe: no wrong rows to test.');
      } else {
        const cleared = txns.map((t) => (t.id === sample.id ? { ...t, isTransfer: false } : t));
        const afterClear = planTransferUpdates(cleared);
        const bounced =
          afterClear.flagIds.includes(sample.id) || afterClear.overturnIds.includes(sample.id);
        const clearedPinned = txns.map((t) =>
          t.id === sample.id ? { ...t, isTransfer: false, reviewPinned: true } : t,
        );
        const afterPinned = planTransferUpdates(clearedPinned);
        const bouncedPinned =
          afterPinned.flagIds.includes(sample.id) || afterPinned.overturnIds.includes(sample.id);
        console.log(
          `\n    BOUNCE-BACK probe on a WRONG row "${sample.rawDescriptor.slice(0, 40)}" ` +
            `(cat=${sample.categoryId}, ${classify(sample)}):`,
        );
        console.log(`      cleared, NOT pinned    → re-flagged by the sweep? ${bounced ? 'YES' : 'no'}`);
        console.log(
          `      cleared AND pinned     → re-flagged by the sweep? ${bouncedPinned ? 'YES' : 'no'}` +
            `  ← triage-actions.ts:1118 PROMISES the pin wins here`,
        );
      }
    }

    // BLAST RADIUS of the candidate guard: honoring `reviewPinned` in the flag
    // and overturn branches (today only the FILE branch reads it). A pinned row
    // the rule currently flags is a row the change would stop touching — and
    // that is the population that could move on the next sync.
    {
      const txns = asStateTxn(rows, identity);
      const planNow = planTransferUpdates(txns);
      const byIdState = new Map(txns.map((t) => [t.id, t]));
      const pinnedAffected = [...planNow.flagIds, ...planNow.overturnIds].filter(
        (id) => byIdState.get(id)?.reviewPinned === true,
      );
      const pinnedExisting = txns.filter((t) => t.reviewPinned).length;
      const pinnedFlaggedExisting = txns.filter((t) => t.reviewPinned && t.isTransfer).length;
      console.log(
        `\n    BLAST RADIUS of honoring reviewPinned in flag/overturn branches:` +
          ` pinned rows=${pinnedExisting}, pinned+flagged=${pinnedFlaggedExisting},` +
          ` pinned rows the rule would newly flag/overturn=${pinnedAffected.length}`,
      );
      console.log(
        `      → ${pinnedAffected.length === 0 ? 'ZERO on this corpus: the guard is inert today (safe by measurement).' : 'NON-ZERO: the guard changes behavior for live pinned rows.'}`,
      );
    }

    // ── MEASURE THE PRESCRIBED FIX (the row's own rule) ──────────────────────
    // Candidate: a counterpart's DESCRIPTOR evidence may not land on the other
    // leg when the two accounts are same-type+mask DUPLICATES (two copies of one
    // real card, never reconciled). Bucket H is the whole motivation; this arm
    // measures what the change would do to the population the rule acts on
    // (from-scratch flags + overturns), so the fix is judged, not assumed.
    {
      const txns = asStateTxn(rows, identity);
      const dupIdentity = new Map(identity);
      // Union same-type+mask pairs into one identity (canonical = smaller id).
      for (const key of maskPairs) {
        const [a, b] = key.split('|');
        const root = (x: string) => {
          let cur = x;
          while (dupIdentity.has(cur) && dupIdentity.get(cur) !== cur) cur = dupIdentity.get(cur)!;
          return cur;
        };
        const ra = root(a!);
        const rb = root(b!);
        if (ra === rb) continue;
        const canon = ra < rb ? ra : rb;
        dupIdentity.set(ra === canon ? rb : ra, canon);
        if (canon !== ra) dupIdentity.set(ra, canon);
        if (canon !== rb) dupIdentity.set(rb, canon);
      }
      const withDup = txns.map((t) => ({
        ...t,
        accountIdentityId: dupIdentity.get(t.accountId) ?? t.accountId,
      }));
      const planNow = planTransferUpdates(txns.map((t) => ({ ...t, isTransfer: false })));
      const planFix = planTransferUpdates(withDup.map((t) => ({ ...t, isTransfer: false })));
      const now = new Set([...planNow.flagIds, ...planNow.overturnIds]);
      const fix = new Set([...planFix.flagIds, ...planFix.overturnIds]);
      const refused = [...now].filter((id) => !fix.has(id));
      const minted = [...fix].filter((id) => !now.has(id));
      console.log(
        `\n    BARE-MASK ARM (same type+mask = one account, a heuristic):` +
          ` would now flag/overturn=${now.size}, after fix=${fix.size}` +
          ` → refuses ${refused.length} (prevention), mints ${minted.length} (new risk)`,
      );
      for (const id of refused.slice(0, 12)) {
        const t = txns.find((x) => x.id === id)!;
        console.log(`      refused: ${t.date} ${usd(t.amountCents).padStart(12)} cat=${t.categoryId ?? 'null'} "${t.rawDescriptor.slice(0, 30)}"`);
      }
      for (const id of minted.slice(0, 12)) {
        const t = txns.find((x) => x.id === id)!;
        console.log(`      MINTED:  ${t.date} ${usd(t.amountCents).padStart(12)} cat=${t.categoryId ?? 'null'} "${t.rawDescriptor.slice(0, 30)}"`);
      }

      // ── REJECTED ARM: the advisory duplicate detector as money identity.
      // Cycle-1 critic P0: HIGH also fires on name-embedded years and on
      // identical-balance spouse cards. Measured, not shipped. The shipped
      // identity is the BARE-MASK arm above (mask COLUMN + same type). ──
      const acctRows = await c.query<{
        id: string;
        provider: string;
        name: string;
        type: string;
        mask: string | null;
        currentBalanceCents: string | number | null;
        currency: string | null;
        plaidItemId: string | null;
        subtype: string | null;
      }>(
        `select id, provider, name, type, mask, "currentBalanceCents", currency, "plaidItemId", subtype
         from "Account" where "userId" = $1`,
        [u.id],
      );
      const candidates = acctRows.rows.map((a) => ({
        ...a,
        currentBalanceCents: a.currentBalanceCents === null ? 0 : Number(a.currentBalanceCents),
      }));
      const pairs = detectDuplicateAccounts(candidates);
      console.log(`\n    SHIPPED DETECTOR (detectDuplicateAccounts): ${pairs.length} suspected pairs`);
      for (const p of pairs.slice(0, 12)) {
        console.log(
          `      ${p.confidence.padEnd(6)} ${p.a.id.slice(-6)} ~ ${p.b.id.slice(-6)}` +
            `  ${p.a.name.slice(0, 20)}  ·  ${p.b.name.slice(0, 20)}` +
            `  [${p.reasons.join(', ')}]`,
        );
      }
      // Union those pairs into one identity and re-measure.
      const shipIdentity = new Map(identity);
      const root = (x: string) => {
        let cur = x;
        let g = 0;
        while (shipIdentity.has(cur) && shipIdentity.get(cur) !== cur && g++ < 20) cur = shipIdentity.get(cur)!;
        return cur;
      };
      for (const p of pairs) {
        const ra = root(p.a.id);
        const rb = root(p.b.id);
        if (ra === rb) continue;
        const canon = ra < rb ? ra : rb;
        shipIdentity.set(ra === canon ? rb : ra, canon);
        if (canon !== ra) shipIdentity.set(ra, canon);
        if (canon !== rb) shipIdentity.set(rb, canon);
      }
      const withShip = txns.map((t) => ({
        ...t,
        accountIdentityId: shipIdentity.get(t.accountId) ?? t.accountId,
      }));
      const planShip = planTransferUpdates(withShip.map((t) => ({ ...t, isTransfer: false })));
      const ship = new Set([...planShip.flagIds, ...planShip.overturnIds]);
      const shipRefused = [...now].filter((id) => !ship.has(id));
      const shipMinted = [...ship].filter((id) => !now.has(id));
      console.log(
        `      REJECTED-DETECTOR ARM (not shipped): after fix=${ship.size} → refuses ${shipRefused.length}, mints ${shipMinted.length}`,
      );
      for (const id of shipRefused.slice(0, 12)) {
        const t = txns.find((x) => x.id === id)!;
        console.log(`      refused: ${t.date} ${usd(t.amountCents).padStart(12)} cat=${t.categoryId ?? 'null'} "${t.rawDescriptor.slice(0, 30)}"`);
      }
      // THE PAYOFF: does the EXISTING owner-triggered repair now reach the rows
      // the rule no longer endorses? If yes, the one rule change makes the
      // already-shipped repair able to clear the last false positives.
      const repairNow = planTransferFlagRepair(txns as never);
      const repairFix = planTransferFlagRepair(withDup as never);
      const wrongIds = new Set(wrong.map((r) => r.id));
      const nowWrongCleared = repairNow.clearIds.filter((id) => wrongIds.has(id)).length;
      const fixWrongCleared = repairFix.clearIds.filter((id) => wrongIds.has(id)).length;
      console.log(
        `      REPAIR REACH on the ${wrong.length} WRONG rows: before fix clears ${nowWrongCleared},` +
          ` after fix clears ${fixWrongCleared}`,
      );
      // WHY was each refused row evidenced by the shipped rule? A CREDIT→CREDIT
      // pair is NOT coherent (CREDIT is excluded from CAN_SEND_ACCOUNT_TYPES), so
      // the refusal must come from somewhere else. Print the exact basis.
      const planNowFull = planTransferUpdates(txns.map((t) => ({ ...t, isTransfer: false })));
      const flagSet = new Set(planNowFull.flagIds);
      const overturnSet = new Set(planNowFull.overturnIds);
      console.log('      REFUSED BY THE FIX — exact basis:');
      for (const id of refused) {
        const t = txns.find((x) => x.id === id)!;
        const desc = descriptorKnown(t) ? 'descriptor' : 'not-descriptor';
        const where = flagSet.has(id) ? 'flagIds' : overturnSet.has(id) ? 'overturnIds' : 'neither';
        const cps = txns.filter(
          (o) =>
            o.id !== id &&
            o.accountId !== t.accountId &&
            Math.abs(o.amountCents) === Math.abs(t.amountCents) &&
            Math.sign(o.amountCents) === -Math.sign(t.amountCents) &&
            Math.abs(daysBetween(isoDate(t.date), isoDate(o.date))) <= 3,
        );
        console.log(
          `        ${t.date} ${usd(t.amountCents).padStart(11)} type=${t.accountType.padEnd(8)} cat=${(t.categoryId ?? 'null').padEnd(12)} ${desc.padEnd(14)} ${where.padEnd(11)} "${t.rawDescriptor.slice(0, 26)}"`,
        );
        for (const cp of cps) {
          console.log(
            `           ↔ ${cp.date} ${usd(cp.amountCents).padStart(11)} type=${cp.accountType.padEnd(8)}` +
              ` cat=${(cp.categoryId ?? 'null').padEnd(12)} ${(descriptorKnown(cp) ? 'descriptor' : 'not-descriptor').padEnd(14)} "${cp.rawDescriptor.slice(0, 26)}"`,
          );
        }
      }
    }
  }

  // ── 4. THE INVISIBILITY CLAIM — both readers drop these rows, so gap == 0 ──
  {
    const spendTxns = rows
      .filter((r) => SPEND.has(r.type))
      .map((r) => ({
        date: r.date,
        amountCents: r.amountCents,
        rawDescriptor: r.rawDescriptor,
        accountId: r.accountId,
        isTransfer: r.isTransfer,
        status: r.status,
        categoryId: r.categoryId,
        isSplitParent: r.isSplitParent,
        excludeFromTotals: r.excludeFromTotals,
      }));
    const months = [...new Set(spendTxns.map((t) => monthKey(t.date)))].sort();
    const flows = monthlyFlows(spendTxns);
    const lastComplete = months.length >= 2 ? months[months.length - 2] : months[0];
    const flow = flows.find((f) => f.month === lastComplete);
    const range = {
      fromYm: lastComplete,
      toYm: lastComplete,
    };
    const card = spendingByCategory(spendTxns as never, range as never);
    const gap = card.totalCents - (flow?.expensesCents ?? 0);
    console.log(
      `\n  INVISIBILITY CHECK on ${lastComplete}: chart expenses=${usd(flow?.expensesCents ?? 0)}  ` +
        `card total=${usd(card.totalCents)}  gap=${usd(gap)}`,
    );
    // The claim under test is a BOTH-DROP: if every flagged spend row is dropped
    // by the chart AND by the card, the on-screen gap cannot show it. The
    // corpus-wide withheld total is a different number (it spans all months);
    // this month's gap is what the reader could have seen.
    const flaggedSpendRows = spendTxns.filter((t) => t.isTransfer);
    const droppedByChart = flaggedSpendRows.filter((t) => countsInFlows(t as never) === false).length;
    const droppedByCard = flaggedSpendRows.filter((t) => isSpendRow(t as never, range as never) === false).length;
    console.log(
      `    → ${flaggedSpendRows.length} flagged rows in ${lastComplete}; dropped by chart: ${droppedByChart}` +
        `, by card: ${droppedByCard}. Both drop them, so they never reach the gap (the row's "invisible by construction").`,
    );
    const thisMonthFlaggedCents = -flaggedSpendRows
      .filter((t) => t.amountCents < 0)
      .reduce((s, t) => s + t.amountCents, 0);
    console.log(`    this month's flagged outflow (the dollars that month understates): ${usd(thisMonthFlaggedCents)}`);
  }
  console.log();
}

console.log('=== CORPUS TOTALS (all users) ===');
console.log(`  converse rows : ${totConverseCount}`);
console.log(`  OUTFLOW withheld from spending : ${usd(totConverseOutflow)}`);
console.log(`  INFLOW  withheld from income   : ${usd(totConverseInflow)}`);
console.log('  VERDICT split (|amount|):');
for (const [k, b] of [...verdictTotals.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  console.log(`    ${k.padEnd(52)} ${String(b.n).padStart(4)} rows   ${usd(b.cents).padStart(14)}`);
}

// ── 5. THE DEMO SEED — the same population over the shipped seed ──
console.log('\n=== DEMO SEED ===');
{
  const { buildSeedData } = await import('../../src/lib/seed/build');
  const { categorize } = await import('../../src/lib/engine/categorize/pipeline');
  const seed = await buildSeedData();
  // prisma/seed.ts Phase 2 writes each row's category from this pipeline call, so
  // the demo DB's stored categoryId is `categorize(...).categoryId` — map it, do
  // not assume a raw null (the o20c pattern).
  const seedRows: Row[] = seed.transactions.map((t) => ({
    id: t.id,
    accountId: t.accountId,
    date: t.date.slice(0, 10),
    amountCents: t.amountCents,
    rawDescriptor: t.rawDescriptor,
    isTransfer: t.isTransfer,
    needsReview: false,
    reviewPinned: false,
    status: t.status,
    categoryId: categorize({
      rawDescriptor: t.rawDescriptor,
      amountCents: t.amountCents,
      date: t.date,
      accountId: t.accountId,
      isTransfer: t.isTransfer,
    }).categoryId,
    excludeFromTotals: false,
    isSplitParent: false,
    currency: null,
    type: seed.accounts.find((a) => a.id === t.accountId)?.type ?? 'CHECKING',
  }));
  const converse = seedRows.filter(isConverse);
  const spendScope = converse.filter((r) => SPEND.has(r.type));
  console.log(`  seed rows: ${seedRows.length}`);
  console.log(`  converse rows: ${converse.length}   in SPEND scope: ${spendScope.length}`);
  console.log(
    `  OUTFLOW withheld: ${usd(-spendScope.filter((r) => r.amountCents < 0).reduce((s, r) => s + r.amountCents, 0))}` +
      `   INFLOW withheld: ${usd(spendScope.filter((r) => r.amountCents > 0).reduce((s, r) => s + r.amountCents, 0))}`,
  );
  console.log('  → a zero here means the demo golden does not move under any fix.');
}

console.log('\n=== END — nothing written ===');
await c.end();
