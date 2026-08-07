/**
 * READ-ONLY production probe — "all I want is max Plaid data" (owner, 2026-08-07).
 *
 * Settles ONE question that no existing probe answers: for each Plaid Item, was it
 * created BEFORE `days_requested=730` shipped (2026-07-31)? Plaid applies
 * `days_requested` only where Transactions was not already initialized, so an Item
 * born before that date is pinned to Plaid's 90-day default forever and no amount
 * of syncing widens it.
 *
 * The three shapes this distinguishes, per item:
 *   (a) createdAt < 2026-07-31 AND oldest ≈ createdAt − 90d
 *       → the 90-day default IS the floor; a re-link is the only lever.
 *   (b) createdAt >= 2026-07-31 AND oldest ≈ createdAt − 90d
 *       → the 730 request is NOT taking effect. Re-linking would buy nothing and
 *         the bug is ours.
 *   (c) oldest ≈ createdAt − 730d
 *       → it worked; the bank simply holds no more.
 *
 * Also prints whether `historyBackfilledAt` was stamped at BIRTH (== createdAt,
 * the "complete by construction" branch at plaid.ts:549) or by a real backfill
 * run later — because a birth-stamped flag means the deep backfill NEVER RAN for
 * that item and never will.
 *
 * Timestamps are selected as ::text so the stored value is read verbatim: every
 * DateTime here is `timestamp without time zone` and node-pg would otherwise
 * re-parse it in the client's local zone (docs/lessons/a-driver-parsed-timestamp-
 * is-not-the-stored-value.md).
 *
 * Every statement is a SELECT; nothing is written.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';

const env = readFileSync(new URL('../../.env.prod.tmp', import.meta.url), 'utf8');
const line = env.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='))!;
const url = line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
const c = new pg.Client({ connectionString: url });
await c.connect();

/** The commit that set PLAID_DAYS_REQUESTED = 730. */
const FIX_SHIPPED = '2026-07-31';

const items = await c.query<{
  id: string;
  itemId: string;
  institution: string | null;
  createdAt: string;
  historyBackfilledAt: string | null;
  lastSyncedAt: string | null;
  oldest: string | null;
  newest: string | null;
  rows: string;
  accounts: string;
}>(
  `select i.id,
          i."itemId",
          i.institution,
          i."createdAt"::text            as "createdAt",
          i."historyBackfilledAt"::text  as "historyBackfilledAt",
          i."lastSyncedAt"::text         as "lastSyncedAt",
          min(t.date)                    as oldest,
          max(t.date)                    as newest,
          count(t.id)::text              as rows,
          count(distinct a.id)::text     as accounts
     from "PlaidItem" i
     left join "Account" a     on a."plaidItemId" = i."itemId"
     left join "Transaction" t on t."accountId"   = a.id
    group by i.id, i."itemId", i.institution, i."createdAt",
             i."historyBackfilledAt", i."lastSyncedAt"
    order by i."createdAt" asc`,
);

const dayGap = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

console.log(`\nPlaid Items: ${items.rowCount}   (days_requested=730 shipped ${FIX_SHIPPED})\n`);
for (const it of items.rows) {
  const born = it.createdAt.slice(0, 10);
  const preFix = born < FIX_SHIPPED;
  const depth = it.oldest ? dayGap(it.oldest, born) : null;
  const birthStamped =
    it.historyBackfilledAt !== null && it.historyBackfilledAt.slice(0, 10) === born;

  console.log(`${(it.institution ?? '(unnamed)').padEnd(22)} ${it.itemId.slice(0, 14)}…`);
  console.log(
    `   born=${born} ${preFix ? '← PRE-FIX (pinned to 90d)' : '← post-fix (asked for 730d)'}`,
  );
  console.log(
    `   history: oldest=${it.oldest ?? 'none'} newest=${it.newest ?? 'none'} ` +
      `rows=${it.rows} accounts=${it.accounts}`,
  );
  console.log(
    `   REACH BACK FROM LINK: ${depth === null ? 'n/a' : `${depth} days`}` +
      (depth === null ? '' : depth <= 120 ? '   ⇒ 90-DAY SHAPE' : depth >= 600 ? '   ⇒ 730-day shape' : '   ⇒ partial'),
  );
  console.log(
    `   backfill flag: ${it.historyBackfilledAt?.slice(0, 19) ?? 'NULL (will run next sync)'}` +
      (birthStamped ? '   ⚠ STAMPED AT BIRTH — the deep backfill never ran and never will' : ''),
  );
  console.log(`   lastSynced: ${it.lastSyncedAt?.slice(0, 19) ?? 'never'}\n`);
}

const fails = await c.query<{ createdAt: string; meta: string }>(
  `select "createdAt"::text as "createdAt", meta
     from "AuditLog"
    where action like 'plaid.item.history-backfill%'
    order by "createdAt" desc limit 20`,
);
console.log(`history-backfill audit rows: ${fails.rowCount}`);
for (const f of fails.rows) console.log(`   ${f.createdAt.slice(0, 19)}  ${f.meta}`);

const linkRows = await c.query<{ n: string; first: string; last: string }>(
  `select count(*)::text as n, min("createdAt")::text as first, max("createdAt")::text as last
     from "AuditLog" where action = 'plaid.item.link'`,
);
console.log(
  `\nplaid.item.link audit rows: ${linkRows.rows[0]?.n} ` +
    `(first ${linkRows.rows[0]?.first?.slice(0, 19)}, last ${linkRows.rows[0]?.last?.slice(0, 19)})`,
);

await c.end();
