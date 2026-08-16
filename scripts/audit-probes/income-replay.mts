/**
 * READ-ONLY production replay — "the monthly income is wrong" (owner, 2026-08-02).
 *
 * Every statement is a SELECT. Nothing is written.
 *
 * Method (o12 / three-sessions-of-hypothesis-one-query-of-evidence): reproduce the
 * CONSUMER's whole where-clause and print the count after each clause, then run the
 * REAL engine functions over the real rows — never a re-implementation, because a
 * re-implementation measures the probe, not the app.
 *
 * The consumer is getSpendingPlan (src/server/spending-plan.ts:96-113):
 *   incomeAccountIds = payment account when CHECKING|SAVINGS, else EVERY CHECKING
 *   incomeTxns       = snap.transactions filtered to those accounts
 *   trailing         = monthlyGuiltFreeIncomeCents(incomeTxns), complete months, last 3
 *   income           = planIncomeOverrideCents ?? median(trailing) ?? series ?? none
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
import {
  monthlyGuiltFreeIncomeCents,
  isEarnedIncomeRow,
  isGenericIncomePayRow,
  isFallbackGuiltFreeIncomeRow,
  isUntouchableIncomeRow,
} from '../../src/lib/engine/spending-plan/income-pattern';
import { countsInFlows, type TxnLike } from '../../src/lib/engine/fi/insights';
import { applyReconciliationBoundary } from '../../src/lib/engine/account/reconcile-boundary';

const env = readFileSync(new URL('../../.env.prod.tmp', import.meta.url), 'utf8');
const line = env.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='))!;
const url = line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
const c = new pg.Client({ connectionString: url });
await c.connect();

const money = (cents: number) =>
  `${cents < 0 ? '-' : ''}$${Math.abs(cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  (await c.query(sql, params)).rows as T[];

const head = (s: string) => console.log(`\n${'='.repeat(72)}\n${s}\n${'='.repeat(72)}`);

// ---------------------------------------------------------------- who
const users = await q<{ id: string; email: string; txns: number }>(
  `select u.id, u.email,
          (select count(*)::int from "Transaction" t
             join "Account" a on a.id = t."accountId" where a."userId" = u.id) as txns
     from "User" u order by txns desc`,
);
head('USERS');
console.table(users);
const OWNER = process.env.OWNER_ID ?? users[0].id;
console.log(`OWNER = ${OWNER} (${users.find((u) => u.id === OWNER)?.email})`);

// ---------------------------------------------------------------- the dials
const [user] = await q<{
  paymentAccountId: string | null;
  planIncomeOverrideCents: number | null;
  savingsTargetBps: number | null;
}>(
  `select "paymentAccountId", "planIncomeOverrideCents", "savingsTargetBps"
     from "User" where id = $1`,
  [OWNER],
);
head('USER DIALS (an override wins over every measurement below)');
console.log({
  paymentAccountId: user.paymentAccountId,
  planIncomeOverrideCents: user.planIncomeOverrideCents,
  planIncomeOverride: user.planIncomeOverrideCents == null ? '(unset)' : money(user.planIncomeOverrideCents),
  savingsTargetBps: user.savingsTargetBps,
});

// ---------------------------------------------------------------- accounts
const accounts = await q<{
  id: string; type: string; name: string; currency: string | null;
  currentBalanceCents: number; provider: string | null; mask: string | null;
  feedDroppedAt: string | null;
}>(
  `select id, type, name, currency, "currentBalanceCents", provider, mask,
          "feedDroppedAt" as "feedDroppedAt"
     from "Account" where "userId" = $1 order by type, name`,
  [OWNER],
);
head('ACCOUNTS');
console.table(
  accounts.map((a) => ({
    id: a.id.slice(-6), type: a.type, name: a.name.slice(0, 30), ccy: a.currency,
    balance: money(a.currentBalanceCents), provider: a.provider, mask: a.mask,
    frozen: a.feedDroppedAt ?? '', isPayment: a.id === user.paymentAccountId ? 'PAYMENT' : '',
  })),
);

// Reconciliation links: with zero links the boundary is provably inert (R8).
const links = await q(
  `select "predecessorAccountId", "successorAccountId", "cutoverDate", "undoneAt"::text as undone
     from "AccountReconciliation" where "userId" = $1 and "undoneAt" is null`,
  [OWNER],
);
console.log(`\nActive reconciliation links: ${links.length}` +
  (links.length === 0 ? '  → the snapshot boundary is inert (R8), raw rows == snapshot rows' : ''));
if (links.length) console.table(links);

// ------------------------------------------------- the consumer's account scope
const paymentAcct = accounts.find((a) => a.id === user.paymentAccountId);
const incomeAccountIds = new Set(
  paymentAcct && (paymentAcct.type === 'CHECKING' || paymentAcct.type === 'SAVINGS')
    ? [paymentAcct.id]
    : accounts.filter((a) => a.type === 'CHECKING').map((a) => a.id),
);
head('INCOME ACCOUNT SCOPE (spending-plan.ts:100-104)');
console.log(
  paymentAcct
    ? `payment account IS set and is ${paymentAcct.type} → scope = {${paymentAcct.name}}`
    : `payment account NOT set (or not CHECKING/SAVINGS) → scope = EVERY CHECKING`,
);
console.table(
  accounts.filter((a) => incomeAccountIds.has(a.id)).map((a) => ({ id: a.id.slice(-6), type: a.type, name: a.name })),
);

// ---------------------------------------------------------------- the rows
const rows = await q<{
  id: string; accountId: string; date: string; amountCents: number; rawDescriptor: string;
  categoryId: string | null; status: string; isTransfer: boolean; isSplitParent: boolean;
  excludeFromTotals: boolean;
}>(
  `select t.id, t."accountId", t.date, t."amountCents", t."rawDescriptor", t."categoryId",
          t.status, t."isTransfer", t."isSplitParent", t."excludeFromTotals"
     from "Transaction" t join "Account" a on a.id = t."accountId"
    where a."userId" = $1 and t."amountCents" > 0
    order by t.date`,
  [OWNER],
);
const toTxn = (r: (typeof rows)[number]): TxnLike & { accountId: string } => ({
  date: r.date, amountCents: r.amountCents, rawDescriptor: r.rawDescriptor,
  accountId: r.accountId, isTransfer: r.isTransfer, status: r.status,
  categoryId: r.categoryId, isSplitParent: r.isSplitParent, excludeFromTotals: r.excludeFromTotals,
});

// ---- the boundary the snapshot applies ONCE before any engine sees a row ----
// (providers/demo.ts:97 — a predecessor keeps only its own span; the successor
//  keeps everything OUTSIDE that span. Rows keep their own accountId.)
const rawTxns = rows.map(toTxn);
const boundary = applyReconciliationBoundary({
  paymentAccountId: user.paymentAccountId,
  accounts: accounts.map((a) => ({ id: a.id, type: a.type, currency: a.currency, currentBalanceCents: a.currentBalanceCents })),
  transactions: rawTxns,
  balanceSnapshots: [] as Array<{ accountId: string; date: string }>,
  statements: [] as Array<{ accountId: string; cycleEnd: string }>,
  scheduled: [] as Array<{ accountId: string }>,
  links: links as Array<{ predecessorAccountId: string; successorAccountId: string; cutoverDate: string }>,
});
head('RECONCILIATION BOUNDARY (applied once in the snapshot, before any engine)');
console.log({
  rawPositiveRows: rawTxns.length,
  afterBoundary: boundary.transactions.length,
  dropped: rawTxns.length - boundary.transactions.length,
  supersededAccounts: boundary.supersededAccountIds.length,
  paymentAccountRemapped: boundary.paymentAccountId !== user.paymentAccountId,
  paymentAccountAfterBoundary: boundary.paymentAccountId,
});
const superseded = new Set(boundary.supersededAccountIds);
console.log('\nSuperseded (predecessor) accounts — their rows survive, their ids do NOT:');
console.table(
  accounts.filter((a) => superseded.has(a.id)).map((a) => ({
    id: a.id.slice(-6), type: a.type, name: a.name.slice(0, 34), provider: a.provider,
  })),
);

head('CLAUSE-BY-CLAUSE: every positive row, narrowed the way the consumer narrows');
const all = boundary.transactions as Array<TxnLike & { accountId: string }>;
const inScope = all.filter((t) => incomeAccountIds.has(t.accountId));
const flows = inScope.filter(countsInFlows);
console.table([
  { clause: 'positive rows, all accounts', n: all.length },
  { clause: '… in the income account scope', n: inScope.length },
  { clause: '… countsInFlows (POSTED, !transfer, !splitParent, !excluded)', n: flows.length },
  { clause: '… isEarnedIncomeRow (paycheck|bonus|side-income)', n: inScope.filter(isEarnedIncomeRow).length },
  { clause: '… isGenericIncomePayRow (categoryId === income)', n: inScope.filter(isGenericIncomePayRow).length },
  { clause: '… isFallbackGuiltFreeIncomeRow', n: inScope.filter(isFallbackGuiltFreeIncomeRow).length },
  { clause: '… isUntouchableIncomeRow (interest/investment/mobile-deposit)', n: inScope.filter(isUntouchableIncomeRow).length },
]);

head('WHY EACH POSITIVE ROW IN SCOPE IS OR IS NOT INCOME (last 40)');
console.table(
  inScope.slice(-40).map((t) => ({
    date: t.date,
    amount: money(t.amountCents),
    category: t.categoryId ?? '(null)',
    descriptor: (t.rawDescriptor ?? '').slice(0, 38),
    flows: countsInFlows(t) ? 'y' : `NO(${t.status !== 'POSTED' ? t.status : t.isTransfer ? 'transfer' : t.isSplitParent ? 'splitParent' : 'excluded'})`,
    earned: isEarnedIncomeRow(t) ? 'Y' : '',
    generic: isGenericIncomePayRow(t) ? 'Y' : '',
    fallback: isFallbackGuiltFreeIncomeRow(t) ? 'Y' : '',
    untouch: isUntouchableIncomeRow(t) ? 'Y' : '',
  })),
);

// ------------------------------------------- the engine's own per-month answer
const today = (await q<{ d: string }>(`select to_char(current_date,'YYYY-MM-DD') as d`))[0].d;
const ym = today.slice(0, 7);
head(`THE ENGINE'S ANSWER — monthlyGuiltFreeIncomeCents (today=${today}, current month ${ym} is incomplete)`);

const perMonthScoped = monthlyGuiltFreeIncomeCents(inScope);
console.table(
  perMonthScoped.map((m) => ({
    month: m.month,
    income: money(m.incomeCents),
    complete: m.month < ym ? 'yes' : 'NO — excluded',
  })),
);

const trailing = perMonthScoped.filter((m) => m.month < ym).slice(-3).map((m) => m.incomeCents);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return 0;
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
head('WHAT THE PLAN PRINTS');
console.log({
  trailingMonthsUsed: perMonthScoped.filter((m) => m.month < ym).slice(-3).map((m) => m.month),
  trailingValues: trailing.map(money),
  medianOfTrailing: money(Math.round(median(trailing))),
  override: user.planIncomeOverrideCents == null ? '(none)' : money(user.planIncomeOverrideCents),
  FIGURE_SHOWN: money(
    user.planIncomeOverrideCents != null ? user.planIncomeOverrideCents : Math.round(median(trailing)),
  ),
  basis: user.planIncomeOverrideCents != null ? 'user-set' : trailing.length ? 'trailing-median' : 'series-or-none',
});

// ------------------------------------------------- the counterfactual: scope
head('COUNTERFACTUAL — the same engine over WIDER account scopes (scope is the suspect)');
// Terminal successor map, the same idea countedExpenseSeriesForPlan already applies
// to detected SERIES (spending-plan.ts:385-387) but which the income filter does not.
const directSucc = new Map<string, string>(
  (links as Array<{ predecessorAccountId: string; successorAccountId: string }>).map((l) => [
    l.predecessorAccountId,
    l.successorAccountId,
  ]),
);
const terminalOf = (id: string): string => {
  let cur = id;
  for (let i = 0; i < 16 && directSucc.has(cur); i++) cur = directSucc.get(cur)!;
  return cur;
};
const rekeyed = all.map((t) => ({ ...t, accountId: terminalOf(t.accountId) }));

const scopes: Array<[string, Set<string>]> = [
  ['consumer scope (as shipped)', incomeAccountIds],
  ['every CHECKING', new Set(accounts.filter((a) => a.type === 'CHECKING').map((a) => a.id))],
  ['every CHECKING + SAVINGS', new Set(accounts.filter((a) => a.type === 'CHECKING' || a.type === 'SAVINGS').map((a) => a.id))],
  ['every account', new Set(accounts.map((a) => a.id))],
];
const rowsFor = (label: string, ids: Set<string>, set: typeof all) => {
  const per = monthlyGuiltFreeIncomeCents(set.filter((t) => ids.has(t.accountId)));
  const tr = per.filter((m) => m.month < ym).slice(-3);
  return {
    scope: label,
    accounts: ids.size,
    months: tr.length,
    trailing: tr.map((m) => `${m.month}:${money(m.incomeCents)}`).join('  '),
    median: money(Math.round(median(tr.map((m) => m.incomeCents)))),
  };
};
console.table([
  ...scopes.map(([label, ids]) => rowsFor(label, ids, all)),
  rowsFor('★ consumer scope + successor RE-KEY (the candidate fix)', incomeAccountIds, rekeyed),
]);

// ------------------------------------------------- per-account income census
head('PER-ACCOUNT: where does income actually land? (complete months only)');
console.table(
  accounts.map((a) => {
    const per = monthlyGuiltFreeIncomeCents(all.filter((t) => t.accountId === a.id));
    const tr = per.filter((m) => m.month < ym).slice(-3);
    return {
      id: a.id.slice(-6), type: a.type, name: a.name.slice(0, 28),
      inScope: incomeAccountIds.has(a.id) ? 'YES' : '',
      months: tr.length,
      lastThree: tr.map((m) => `${m.month}:${money(m.incomeCents)}`).join('  '),
    };
  }),
);

// ---------------------------------------------------------------- C.22 sibling
// radar committed-merchant detection on the payment account. The income remap
// concatenates two feeds into one detectRecurring call and was measured at
// 9 → 4. C.22 detects each payment-component account on its own and unions
// the canonicals (DECISIONS #480). Re-run this block after any change.
{
  const { detectRecurring } = await import('../../src/lib/engine/recurring/detect');
  const { committedMerchantCanonicals } = await import('../../src/lib/engine/radar/committed');
  const posted = await q<{
    accountId: string; date: string; amountCents: number; rawDescriptor: string; isTransfer: boolean;
  }>(
    `select t."accountId", t.date, t."amountCents", t."rawDescriptor", t."isTransfer"
       from "Transaction" t join "Account" a on a.id = t."accountId"
      where a."userId" = $1 and t.status = 'POSTED' and t."isSplitParent" = false`,
    [OWNER],
  );
  const mk = (rekey: boolean) =>
    posted
      .filter((r) => (rekey ? terminalOf(r.accountId) : r.accountId) === user.paymentAccountId)
      .map((r, i) => ({
        id: String(i), accountId: r.accountId, date: r.date,
        amountCents: r.amountCents, rawDescriptor: r.rawDescriptor, isTransfer: r.isTransfer,
      }));
  const asShipped = mk(false);
  const withRekey = mk(true);
  const component = posted
    .filter((r) => terminalOf(r.accountId) === user.paymentAccountId)
    .map((r, i) => ({
      id: String(i), accountId: r.accountId, date: r.date,
      amountCents: r.amountCents, rawDescriptor: r.rawDescriptor, isTransfer: r.isTransfer,
    }));
  const terminalMap = new Map<string, string>();
  for (const r of posted) {
    const to = terminalOf(r.accountId);
    if (to !== r.accountId) terminalMap.set(r.accountId, to);
  }
  const paymentId = user.paymentAccountId ?? '';
  head('C.22 SIBLING — radar.ts committed-merchant detection on the payment account');
  console.table([
    { path: 'as shipped (live id only)', rows: asShipped.length, seriesDetected: detectRecurring(asShipped, today as never, []).length },
    { path: 'with successor re-key (rejected)', rows: withRekey.length, seriesDetected: detectRecurring(withRekey, today as never, []).length },
    { path: 'C.22 per-account union', rows: component.length, seriesDetected: committedMerchantCanonicals(component, paymentId, today as never, [], terminalMap).size },
  ]);
}

await c.end();
