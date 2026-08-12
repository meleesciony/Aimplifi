/**
 * READ-ONLY production probe — O.20b.
 *
 * /reports' payload ships the rows behind every bar of the income-vs-spending
 * chart: `monthFlows` (built by `buildMonthFlowBreakdowns` in `getReports`,
 * src/server/reports.ts:190) carries six months of transaction rows instead of
 * the one month the feature predates. TASKS O.20b is the decision this probe
 * measures for: keep the six-month carry (the property panels reconcile
 * against the painted bar without a second query), trim `rawDescriptor`, or
 * fall back to a per-bar fetch (which would break the same-array guarantee).
 * The row says the payload is "unmeasured against a heavy real account" — this
 * probe measures it: composed byte size per component, row counts, the
 * one-month baseline the six-month carry is compared against, and the field
 * the row names as the trim candidate.
 *
 * WHAT IS MEASURED — and what is not. The probe composes the EXACT object
 * `getReports` returns (same engine calls, same arguments, same order) and
 * measures `JSON.stringify` byte sizes of the whole payload and of each
 * component. That is the DATA payload, the dominant term this row is about.
 * NOT measured: React Flight wire overhead, the page's other props (view
 * copy, chart config), `getWithheldAccountSummary` — none of which the row's
 * "six months of rows" question touches. 12- and 24-month windows are measured
 * too: they are SHIPPED reader choices on the same page (chart-range.ts), so a
 * decision that fits 6 months must state what it does to 12 and 24.
 *
 * REPLAY FIDELITY:
 *   - EXACT: row scope (spend accounts, currency null|USD), reconciliation
 *     boundary (`reconciliationTxnKeepFilter(accountId, date)` — TWO
 *     positional args; the o20a lesson: an object form silently disables the
 *     boundary), `window`/`ym`/`today` construction (byte-identical to
 *     `getReports`), the merchant JOIN for `registerDisplayName` (o20a did not
 *     need it — its numbers did not depend on the label — but byte SIZE does:
 *     `Merchant.canonical` is the register's own display rule, and a panel
 *     label that differs from the shipped rawDescriptor decides the dedup),
 *     and every predicate/engine call in `getReports`' assembly order.
 *   - APPROXIMATED: `categoryHrefs`' `linkable` set is built from the engine
 *     CATEGORY_BY_ID + the user's custom categories (the register picker's own
 *     vocabulary) WITHOUT the hidden-category filter — an UPPER BOUND, because
 *     a fenced `null` entry is shorter than the href strings this probe emits;
 *     and `loanPaymentRefusedCategories` runs empty (the C.25 exclusion set is
 *     empty on this corpus, established by o20a's fidelity note). `window` and
 *     `notCountedYetCents` are measured through the same composition.
 *   - OMITTED, NOT DISMISSED: `excludedFlowIds` (C.25) is passed as `undefined`
 *     exactly as o20a established it resolves on this corpus — empty either
 *     way, so the composed rows are byte-identical.
 *
 * Every statement is a SELECT; nothing is written.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { reconciliationTxnKeepFilter } from '../../src/lib/engine/account/reconcile-boundary';
import { SPENDING_ACCOUNT_TYPES } from '../../src/lib/engine/transactions/query';
import { monthlyFlows } from '../../src/lib/engine/fi/insights';
import { spendingByCategory, spentSoFarWindow } from '../../src/lib/engine/reports/reports';
import {
  buildCategoryBreakdowns,
  notCountedYetByCategory,
} from '../../src/lib/engine/glass-box/category-breakdown';
import { buildMonthFlowBreakdowns } from '../../src/lib/engine/glass-box/month-flow-breakdown';
import { registerDisplayName } from '../../src/lib/engine/transactions/display-name';
import { categoryWindowRegisterHref } from '../../src/lib/engine/transactions/links';
import { mergeCategoryMeta, CATEGORY_BY_ID } from '../../src/lib/engine/categorize/categories';
import { isoDate } from '../../src/lib/dates';
import { DEFAULT_AS_OF } from '../../src/lib/seed/build';
import { DEMO_USER_ID } from '../../src/lib/demo-user';

const env = readFileSync(new URL('../../.env.prod.tmp', import.meta.url), 'utf8');
const line = env.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='))!;
const url = line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
const c = new pg.Client({ connectionString: url });
await c.connect();

const SPEND = [...SPENDING_ACCOUNT_TYPES];
const KB = 1024;

const kb = (n: number) => `${(n / KB).toFixed(1)} KB`;

interface Txn {
  id: string;
  accountId: string;
  date: string;
  amountCents: number;
  rawDescriptor: string;
  isTransfer: boolean;
  status: string;
  categoryId: string | null;
  isSplitParent: boolean;
  splitParentId: string | null;
  excludeFromTotals: boolean;
  merchantCanonical: string | null;
}
interface Acc {
  id: string;
  type: string;
  currency: string | null;
  userId: string;
  currentBalanceCents: number;
}

async function loadAccounts(userIds: string[]): Promise<Acc[]> {
  const r = await c.query(
    `select id, type, currency, "userId", "currentBalanceCents" from "Account" where "userId" = any($1::text[])`,
    [userIds],
  );
  return r.rows;
}

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
  return reconciliationTxnKeepFilter(accs, links.rows, spans.rows);
}

/** The spend rows getReports' composition sees, with the merchant join
 * `registerDisplayName` reads — same row scope as o20a, plus the join. */
async function spendTxns(userId: string): Promise<Txn[]> {
  const r = await c.query(
    `select t.id, t."accountId", t.date::text as date, t."amountCents", t."rawDescriptor",
            t."isTransfer", t.status, t."categoryId", t."isSplitParent", t."splitParentId",
            t."excludeFromTotals", m.canonical as "merchantCanonical"
     from "Transaction" t
     join "Account" a on a.id = t."accountId"
     left join "Merchant" m on m.id = t."merchantId"
     where a."userId" = $1 and a.type = any($2::text[])
       and (a.currency is null or a.currency = 'USD')
     order by t.date asc, t.id asc`,
    [userId, SPEND],
  );
  return r.rows.map((x: Txn & { date: string }) => ({ ...x, date: x.date.slice(0, 10) }));
}

async function categoryMetaFor(userId: string) {
  const custom = (
    await c.query<{ id: string; name: string; group: string | null; discretionary: boolean }>(
      `select id, name, "group", discretionary from "Category"
       where "userId" = $1 and "isSystem" = false order by name asc`,
      [userId],
    )
  ).rows.map((r) => ({
    id: r.id,
    name: r.name,
    group: r.group ?? 'Transfers & Other',
    discretionary: r.discretionary,
  }));
  const renames = new Map(
    (
      await c.query<{ categoryId: string; name: string }>(
        `select "categoryId", name from "CategoryRename" where "userId" = $1`,
        [userId],
      )
    ).rows
      .filter((r) => CATEGORY_BY_ID.has(r.categoryId))
      .map((r) => [r.categoryId, r.name] as const),
  );
  return mergeCategoryMeta(custom, renames);
}

/**
 * The composition of `getReports` (src/server/reports.ts:124-222), replicated
 * call for call with the probe's own rows: happened filter, series slice,
 * `spentSoFarWindow`, `spendingByCategory`, the named array
 * (`registerDisplayName`), `buildCategoryBreakdowns`, `buildMonthFlowBreakdowns`
 * (asOf = today), `notCountedYetByCategory`, and the hrefs via
 * `categoryWindowRegisterHref`. `excludedFlowIds` passes undefined (empty on
 * this corpus, per o20a's established measurement).
 */
function composePayload(
  allTxns: readonly Txn[],
  today: string,
  meta: ReturnType<typeof mergeCategoryMeta>,
  linkable: ReadonlySet<string>,
  months: number,
) {
  const ym = today.slice(0, 7);
  const happened = allTxns.filter((t) => t.date <= today);
  const series = monthlyFlows(happened)
    .map((f) => ({ month: f.month, incomeCents: f.incomeCents, expensesCents: f.expensesCents }))
    .sort((a, b) => (a.month < b.month ? -1 : 1))
    .slice(-months);
  const window = spentSoFarWindow(ym, today);
  const breakdown = spendingByCategory(allTxns, window, meta);
  const named = allTxns.map((t) => ({
    ...t,
    merchantName: registerDisplayName(t),
  }));
  const breakdowns = buildCategoryBreakdowns(
    named,
    window,
    new Map(breakdown.byCategory.map((c) => [c.categoryId, c.amountCents])),
    meta,
  );
  const monthFlows = buildMonthFlowBreakdowns(named, series, undefined, today);
  const notCountedYetCents = notCountedYetByCategory(named, window, meta).totalCents;
  const categoryHrefs: Record<string, string | null> = {};
  for (const c of breakdown.byCategory) {
    categoryHrefs[c.categoryId] = categoryWindowRegisterHref(
      { categoryId: c.categoryId, window, amountCents: c.amountCents },
      linkable,
    );
  }
  return { ym, window, categoryHrefs, notCountedYetCents, months: series, breakdown, breakdowns, monthFlows };
}

function measure(
  label: string,
  p: ReturnType<typeof composePayload>,
  today: string,
): void {
  const total = JSON.stringify(p).length;
  const mf = JSON.stringify(p.monthFlows).length;
  const bds = JSON.stringify(p.breakdowns).length;
  const bd = JSON.stringify(p.breakdown).length;
  const ms = JSON.stringify(p.months).length;
  const hrefs = JSON.stringify(p.categoryHrefs).length;
  const rest = total - mf - bds - bd - ms - hrefs;

  const allRows = Object.values(p.monthFlows).flatMap((b) => b.rows);
  const rawPresent = allRows.filter((r) => r.rawDescriptor !== null);
  const rawChars = rawPresent.reduce((s, r) => s + (r.rawDescriptor?.length ?? 0), 0);
  const labelChars = allRows.reduce((s, r) => s + r.label.length, 0);

  // The one-month baseline: what the payload would carry if only the CURRENT
  // month's two bars shipped rows (the shape this feature predates). The 6×
  // claim in the task row is measured, not assumed.
  const ym = today.slice(0, 7);
  const oneMonth = Object.fromEntries(
    Object.entries(p.monthFlows).filter(([k]) => k.startsWith(`${ym}:`)),
  );
  const oneMonthBytes = JSON.stringify(oneMonth).length;

  const rowCount = allRows.length;
  const maxBar = Math.max(...Object.values(p.monthFlows).map((b) => b.rows.length));

  console.log(`  ${label} (${p.months.length} months):`);
  console.log(
    `    payload ${kb(total)}  ·  monthFlows ${kb(mf)} (${Math.round((100 * mf) / total)}%)  ` +
      `· breakdowns ${kb(bds)} · breakdown ${kb(bd)} · months ${kb(ms)} · hrefs ${kb(hrefs)} · rest ${kb(rest)}`,
  );
  console.log(
    `    monthFlows: ${rowCount} rows across ${Object.keys(p.monthFlows).length} bars, largest bar ${maxBar} rows` +
      `  ·  rawDescriptor present on ${rawPresent.length}/${rowCount} rows (${rawChars} chars; dropping the field entirely would save ~${kb((rawChars + 18 * rawPresent.length))})`,
  );
  console.log(
    `    label bytes ${labelChars} across ${rowCount} rows · ` +
      `one-month baseline ${kb(oneMonthBytes)} — this window ships ${(mf / Math.max(1, oneMonthBytes)).toFixed(1)}× its rows`,
  );
}

const users = await c.query<{ id: string; email: string | null }>(
  `select id, email from "User" order by id asc`,
);

// Same today-resolution contract as o20a: DEMO_TODAY if set (production
// deliberately has none — docs/DEPLOY.md:91), else DEFAULT_AS_OF for the demo
// user, else the wall clock.
const demoToday =
  env
    .split(/\r?\n/)
    .find((l) => l.startsWith('DEMO_TODAY='))
    ?.slice('DEMO_TODAY='.length)
    .trim()
    .replace(/^["']|["']$/g, '') ?? DEFAULT_AS_OF;

for (const u of users.rows) {
  const isDemo = u.id === DEMO_USER_ID;
  console.log(`\n===== user ${u.id}${isDemo ? ' (DEMO)' : ''} =====`);
  const today = isoDate(isDemo ? demoToday : new Date().toISOString().slice(0, 10));

  const accs = await loadAccounts([u.id]);
  const keep = await boundaryFor(u.id, accs);
  const allTxns = (await spendTxns(u.id)).filter((t) => keep(t.accountId, t.date));
  if (allTxns.length === 0) {
    console.log('  no spend-account transactions — nothing to measure.');
    continue;
  }
  const meta = await categoryMetaFor(u.id);
  const linkable = new Set<string>([...CATEGORY_BY_ID.keys(), ...meta.keys()]);
  console.log(`  today=${today}${isDemo ? ' (DEMO_TODAY, pinned)' : ''}  spend rows=${allTxns.length}`);

  for (const months of [6, 12, 24]) {
    measure(`${months}-month window`, composePayload(allTxns, today, meta, linkable, months), today);
  }
}

console.log(`\ndone — users: ${users.rows.length}. read-only, nothing written.`);
await c.end();
