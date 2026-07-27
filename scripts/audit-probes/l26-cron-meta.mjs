// READ-ONLY production probe. No writes. What does the sync cron report doing?
import { readFileSync } from 'node:fs'
import pg from 'pg'

const env = readFileSync(new URL('../../.env.prod.tmp', import.meta.url), 'utf8')
const line = env.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='))
const url = line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '')
const c = new pg.Client({ connectionString: url })
await c.connect()

const r = await c.query(
  `select action, "userId", "createdAt", meta from "AuditLog"
    where action in ('sync.cron.plaid','plaid.item.sync.failed')
    order by "createdAt" desc limit 8`,
)
for (const row of r.rows) {
  console.log(`\n[${row.action}] ${row.createdAt.toISOString()} user=${row.userId}`)
  console.log(row.meta)
}

await c.end()
