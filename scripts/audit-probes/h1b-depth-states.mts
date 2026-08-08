/**
 * READ-ONLY production probe — H.1(b) "did the number move": replay the SHIPPED
 * depth engine over the owner's live corpus and print the state each connection
 * will actually render, so the critic findings are answered with the real
 * distribution rather than an argument about it.
 *
 * The question. Before the critic cycle, the depth read every supported account
 * of any type and every row of any kind. Two consequences were measured live:
 * FOUR connections rendered "No transactions yet." for accounts that can never
 * send a transaction (no `/investments/transactions` ingest exists in this app),
 * and a mortgage-only connection was one sync away from printing a date the
 * register denies. This replays the shipped rule — the register's own basis plus
 * the R1 keep closure — and reports the state per connection.
 *
 * Every statement is a SELECT; nothing is written.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { connectionHistoryDepth } from '../../src/lib/engine/account/connection-depth';
import { connectionDepthSentence } from '../../src/lib/engine/account/connection-depth-copy';
import { reconciliationTxnKeepFilter } from '../../src/lib/engine/account/reconcile-boundary';
import { isSupportedCurrency } from '../../src/lib/providers/currency';

const SPENDING = ['CHECKING', 'SAVINGS', 'CREDIT'];

const env = readFileSync(new URL('../../.env.prod.tmp', import.meta.url), 'utf8');
const line = env.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='))!;
const c = new pg.Client({ connectionString: line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '') });
await c.connect();

const users = await c.query<{ id: string; email: string }>(
  `select distinct u.id, u.email from "User" u join "Account" a on a."userId" = u.id order by u.email`,
);

for (const u of users.rows) {
  const accs = (
    await c.query(
      `select id, name, type, provider, currency, "currentBalanceCents", "plaidItemId" from "Account" where "userId" = $1`,
      [u.id],
    )
  ).rows as { id: string; name: string; type: string; provider: string; currency: string | null; currentBalanceCents: number | null; plaidItemId: string | null }[];
  const links = (
    await c.query(
      `select "predecessorAccountId", "successorAccountId", "cutoverDate" from "AccountReconciliation"
       where "userId" = $1 and "undoneAt" is null`,
      [u.id],
    )
  ).rows as { predecessorAccountId: string; successorAccountId: string; cutoverDate: string }[];
  const items = (
    await c.query(`select "itemId", institution from "PlaidItem" where "userId" = $1 order by institution nulls last`, [u.id])
  ).rows as { itemId: string; institution: string | null }[];

  // Full-history spans, exactly as the keep filter requires (never the windowed rows).
  const spans = (
    await c.query(
      `select t."accountId", min(t.date) as first, max(t.date) as last from "Transaction" t
       join "Account" a on a.id = t."accountId" where a."userId" = $1 group by t."accountId"`,
      [u.id],
    )
  ).rows as { accountId: string; first: string; last: string }[];

  // The REGISTER'S basis — the shipped `registerRowWhere` predicate, restated in SQL.
  const registerFloors = new Map(
    (
      await c.query(
        `select t."accountId", min(t.date) as first from "Transaction" t
         join "Account" a on a.id = t."accountId"
         where a."userId" = $1 and a.type = any($2) and (a.currency is null or a.currency = 'USD')
           and t."isSplitParent" = false
         group by t."accountId"`,
        [u.id, SPENDING],
      )
    ).rows.map((r: { accountId: string; first: string }) => [r.accountId, r.first] as const),
  );
  const registerDates = (
    await c.query(
      `select distinct t."accountId", t.date from "Transaction" t
       join "Account" a on a.id = t."accountId"
       where a."userId" = $1 and a.type = any($2) and (a.currency is null or a.currency = 'USD')
         and t."isSplitParent" = false`,
      [u.id, SPENDING],
    )
  ).rows as { accountId: string; date: string }[];

  const supported = accs.filter((a) => isSupportedCurrency(a.currency));
  const keeps = reconciliationTxnKeepFilter(supported, links, spans);
  const touched = new Set(links.flatMap((l) => [l.predecessorAccountId, l.successorAccountId]));
  const ownedFloor = new Map<string, string>();
  for (const r of registerDates) {
    if (!touched.has(r.accountId) || !keeps(r.accountId, r.date)) continue;
    const b = ownedFloor.get(r.accountId);
    if (b === undefined || r.date < b) ownedFloor.set(r.accountId, r.date);
  }
  const fact = (a: (typeof accs)[number]) => ({
    inRegisterBasis: SPENDING.includes(a.type) && isSupportedCurrency(a.currency),
    neverTransactional: !SPENDING.includes(a.type),
    earliestOwned: touched.has(a.id) ? ownedFloor.get(a.id) ?? null : registerFloors.get(a.id) ?? null,
    holdsRows: registerFloors.has(a.id),
  });

  console.log(`\n${'═'.repeat(78)}\nUSER ${u.email}   accounts=${accs.length} links=${links.length} items=${items.length}`);
  const tally: Record<string, number> = {};
  for (const it of items) {
    const mine = accs.filter((a) => a.plaidItemId === it.itemId);
    const depth = connectionHistoryDepth(mine.map(fact));
    tally[depth.state] = (tally[depth.state] ?? 0) + 1;
    console.log(
      `  ${(it.institution ?? '(unnamed)').padEnd(20)} ${String(depth.state).padEnd(18)} ${connectionDepthSentence(depth)}`,
    );
    console.log(`      accounts: ${mine.map((a) => `${a.name}[${a.type}]`).join(', ') || '(none)'}`);
  }
  const sf = accs.filter((a) => a.provider === 'simplefin');
  if (sf.length) {
    const d = connectionHistoryDepth(sf.map(fact));
    tally[d.state] = (tally[d.state] ?? 0) + 1;
    console.log(`  ${'SimpleFIN (feed)'.padEnd(20)} ${String(d.state).padEnd(18)} ${connectionDepthSentence(d)}`);
    console.log(`      ${sf.length} accounts`);
  }
  console.log(`  TALLY ${JSON.stringify(tally)}`);
}

await c.end();
