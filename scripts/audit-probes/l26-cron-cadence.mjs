// READ-ONLY production probe. No writes. When does the sync cron actually fire?
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
  'sync.cron — every firing, newest first',
  `select "createdAt", left(meta, 70) as meta_head from "AuditLog"
    where action = 'sync.cron' order by "createdAt" desc limit 30`,
)

await q(
  'RecurringSeries for the owner — what detection currently holds',
  `select r.cadence, count(*)::int as n,
          sum(case when r."typicalAmountCents" < 0 then 1 else 0 end)::int as outflow_signed
     from "RecurringSeries" r
    where r."userId" = 'cmqisanqh000004l7wylnhrpd'
    group by r.cadence order by n desc`,
)

await c.end()
