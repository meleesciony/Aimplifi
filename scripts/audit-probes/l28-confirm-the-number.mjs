// READ-ONLY. The owner's scheduled rows now exist — confirm what they SUM to, rather
// than repeating the figure L.27's replay predicted.
import { readFileSync } from 'node:fs'
import pg from 'pg'

const OWNER = 'cmqisanqh000004l7wylnhrpd'
const env = readFileSync(new URL('../../.env.prod.tmp', import.meta.url), 'utf8')
const url = env.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='))
  .slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '')

// The spending plan's fixed term counts EXPENSES at a monthly rate. Same factors as
// engine/recurring monthlyRateCents: weekly x52/12, biweekly x26/12, annual /12, etc.
const PER_MONTH = { WEEKLY: [52, 12], BIWEEKLY: [26, 12], MONTHLY: [1, 1],
                    QUARTERLY: [1, 3], SEMIANNUAL: [1, 6], ANNUAL: [1, 12] }
const usd = (c) => `$${(c / 100).toFixed(2)}`

const c = new pg.Client({ connectionString: url })
await c.connect()
try {
  const { rows } = await c.query(
    `select s.description, s."amountCents", s.cadence, s.source, s."nextDate"
       from "ScheduledTransaction" s join "Account" a on a.id = s."accountId"
      where a."userId" = $1 order by s."amountCents" asc`, [OWNER])
  let expenseMonthly = 0
  for (const r of rows) {
    const [n, d] = PER_MONTH[r.cadence] ?? [1, 1]
    const monthly = Math.round((r.amountCents * n) / d)
    if (r.amountCents < 0) expenseMonthly += monthly
    console.log(`  ${String(r.cadence).padEnd(10)} ${usd(r.amountCents).padStart(12)}  ` +
                `→ ${usd(monthly).padStart(11)}/mo  next ${r.nextDate}  [${r.source}]  ${r.description}`)
  }
  console.log(`\n  rows: ${rows.length}`)
  console.log(`  EXPENSES at a monthly rate (the guilt-free "Fixed & recurring" term): ${usd(Math.abs(expenseMonthly))}`)
} finally {
  await c.end()
}
