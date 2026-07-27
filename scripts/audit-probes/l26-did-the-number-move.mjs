// READ-ONLY production probe. No writes, no DDL. Answers one question:
// after the L.26 deploy, has a sync actually refilled ScheduledTransaction?
// Usage: node scripts/audit-probes/l26-did-the-number-move.mjs
import { readFileSync } from 'node:fs'
import pg from 'pg'

const env = readFileSync(new URL('../../.env.prod.tmp', import.meta.url), 'utf8')
const line = env.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='))
if (!line) throw new Error('DATABASE_URL not found in .env.prod.tmp')
const url = line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '')

const client = new pg.Client({ connectionString: url })
await client.connect()

const q = async (label, sql) => {
  const r = await client.query(sql)
  console.log(`\n--- ${label} ---`)
  console.table(r.rows)
}

await q(
  'ScheduledTransaction rows per user (the L.26 fix writes these)',
  `select a."userId", count(*)::int as rows,
          min(s."nextDate") as first_date, max(s."nextDate") as last_date,
          count(distinct s.source)::int as sources
     from "ScheduledTransaction" s join "Account" a on a.id = s."accountId"
    group by a."userId" order by rows desc`,
)

await q(
  'ScheduledTransaction — TOTAL rows in table',
  `select count(*)::int as total_rows from "ScheduledTransaction"`,
)

await q(
  'RecurringSeries per user (what detection found)',
  `select "userId", count(*)::int as series,
          sum(case when "isSubscription" then 1 else 0 end)::int as subs,
          max("lastSeenAt") as newest_seen
     from "RecurringSeries" group by "userId" order by series desc`,
)

await q(
  'PlaidItem sync bookkeeping (did a sync run, and when)',
  `select "userId", institution, "lastSyncedAt", "lastSyncAttemptAt",
          "lastSyncError"
     from "PlaidItem" order by "lastSyncAttemptAt" desc nulls last`,
)

await q(
  'Newest transaction per user (independent sync proxy)',
  `select a."userId", max(t.date) as newest_txn, count(*)::int as txns
     from "Transaction" t join "Account" a on a.id = t."accountId"
    group by a."userId" order by txns desc`,
)

await client.end()
