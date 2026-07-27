// READ-ONLY. Answers the ONE question the L.27 watcher's STILL-0 alarm leaves open:
// its trigger is `max("createdAt")` over ANY AuditLog row, and its own text says
// "IF that activity was a Plaid sync". So: what was it?
//
// Timestamps as ::text throughout — these are `timestamp without time zone` and the
// driver re-reads them in the prober's local zone
// (docs/lessons/a-driver-parsed-timestamp-is-not-the-stored-value.md).
import { readFileSync } from 'node:fs'
import pg from 'pg'

const OWNER = 'cmqisanqh000004l7wylnhrpd'
const env = readFileSync(new URL('../../.env.prod.tmp', import.meta.url), 'utf8')
const url = env.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='))
  .slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '')

const c = new pg.Client({ connectionString: url })
await c.connect()
try {
  console.log('now (db clock):', (await c.query(`select now()::text as t`)).rows[0].t)

  console.log('\n--- last 15 AuditLog rows for the owner (action + stored text time) ---')
  for (const r of (await c.query(
    `select "createdAt"::text as at, action from "AuditLog"
      where "userId" = $1 order by "createdAt" desc limit 15`, [OWNER])).rows) {
    console.log(`  ${r.at}  ${r.action}`)
  }

  console.log('\n--- counts that decide whether the fix has run ---')
  const q = async (label, sql) =>
    console.log(`  ${label}: ${JSON.stringify((await c.query(sql, [OWNER])).rows[0])}`)
  await q('ScheduledTransaction (owner)',
    `select count(*)::int as n from "ScheduledTransaction" s
       join "Account" a on a.id = s."accountId" where a."userId" = $1`)
  await q('RecurringSeries (owner)', `select count(*)::int as n from "RecurringSeries" where "userId" = $1`)
  await q('Transaction (owner)',
    `select count(*)::int as n, max(date) as newest from "Transaction" t
       join "Account" a on a.id = t."accountId" where a."userId" = $1`)

  console.log('\n--- per-item Plaid sync state (lastSyncedAt is written by the app as a value) ---')
  for (const r of (await c.query(
    `select "itemId", "lastSyncedAt"::text as synced, "lastSyncAttemptAt"::text as attempted,
            "lastSyncError" from "PlaidItem" where "userId" = $1`, [OWNER])).rows) {
    console.log(`  item ${r.itemId}: synced=${r.synced} attempted=${r.attempted} err=${r.lastSyncError ?? 'none'}`)
  }
} finally {
  await c.end()
}
