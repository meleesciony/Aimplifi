// READ-ONLY production probe. No writes. When did work actually run?
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
  'AuditLog — action kinds, newest first',
  `select action, count(*)::int as n, max("createdAt") as newest
     from "AuditLog" group by action order by newest desc limit 25`,
)

await q(
  'AuditLog — every row in the last 36 hours',
  `select action, "createdAt", left(meta, 80) as meta_head
     from "AuditLog" where "createdAt" > now() - interval '36 hours'
    order by "createdAt" desc limit 40`,
)

await q(
  'Transaction — newest rows by createdAt (sync write proxy)',
  `select max(t."createdAt") as newest_write, count(*)::int as written_24h
     from "Transaction" t join "Account" a on a.id = t."accountId"
    where t."createdAt" > now() - interval '24 hours'`,
)

await c.end()
