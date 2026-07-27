// READ-ONLY. Whose syncs were the post-deploy ones, and did any sync-failure
// audit row fire today?
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
  'Post-deploy audit rows (after 2026-07-27T02:12:52Z, the L.26 deploy) with userId',
  `select action, "userId", "createdAt" from "AuditLog"
    where "createdAt" > timestamp '2026-07-27 02:12:52' order by "createdAt"`,
)

await q(
  'Has any transaction-sync failure EVER fired?',
  `select action, count(*)::int as n, max("createdAt") as newest from "AuditLog"
    where action like '%sync%failed%' or action like '%transactions.failed%'
    group by action order by newest desc`,
)

await q(
  'Every distinct audit action (full list, no limit)',
  `select action, count(*)::int as n, max("createdAt") as newest
     from "AuditLog" group by action order by newest desc`,
)

await c.end()
