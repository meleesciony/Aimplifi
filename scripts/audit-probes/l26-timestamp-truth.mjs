// READ-ONLY. What is the AuditLog.createdAt column type, and what are the raw
// stored values? A `timestamp without time zone` is re-interpreted as LOCAL time
// by node-pg, which would shift every reading in this session's probes.
import { readFileSync } from 'node:fs'
import pg from 'pg'

const env = readFileSync(new URL('../../.env.prod.tmp', import.meta.url), 'utf8')
const line = env.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='))
const url = line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '')
const c = new pg.Client({ connectionString: url })
await c.connect()

const q = async (label, sql) => {
  const r = await c.query(sql)
  console.log(`\n--- ${label} ---`)
  console.table(r.rows)
}

await q(
  'session timezone + column type',
  `select current_setting('TimeZone') as session_tz,
          pg_typeof("createdAt")::text as createdat_type,
          now() as server_now_driverparsed,
          now()::text as server_now_text
     from "AuditLog" limit 1`,
)

await q(
  'newest 12 audit rows — RAW TEXT (no driver parsing)',
  `select action, "createdAt"::text as raw_text, "userId"
     from "AuditLog" order by "createdAt" desc limit 12`,
)

await q(
  'PlaidItem sync stamps (date strings, no parsing involved)',
  `select "lastSyncedAt", count(*)::int as items from "PlaidItem"
    group by "lastSyncedAt" order by "lastSyncedAt" desc`,
)

await c.end()
