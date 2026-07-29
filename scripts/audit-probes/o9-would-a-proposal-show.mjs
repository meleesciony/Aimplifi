// READ-ONLY production probe. No writes.
//
// Owner question (2026-07-29): "I don't see changes from the last day of work."
// O.9 shipped categorization PROPOSALS (triage inbox + register). They only
// render on rows still awaiting a category, and only where the learner has
// enough evidence. This asks the data whether either condition can be met.
//
// CREDENTIALS: reads `.env.prod.tmp` (gitignored), from `vercel env pull`.
// Delete that file when done — it holds the live production DATABASE_URL.
import { readFileSync } from 'node:fs'
import pg from 'pg'
const env = readFileSync(new URL('../../.env.prod.tmp', import.meta.url), 'utf8')
const url = env.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='))
  .slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '')
const c = new pg.Client({ connectionString: url })
await c.connect()
const OWNER = 'cmqisanqh000004l7wylnhrpd'
const q = async (l, s, p = []) => {
  const r = await c.query(s, p)
  console.log(`\n--- ${l} ---`)
  if (r.rows.length) console.table(r.rows)
  else console.log('(no rows)')
  return r.rows
}

await q('1. Rows still awaiting a category — what a proposal would appear ON',
  `select t."needsReview", t.status, count(*) as rows from "Transaction" t
    join "Account" a on a.id=t."accountId" where a."userId"=$1
    group by t."needsReview", t.status order by rows desc`, [OWNER])

await q('2. Corrections the learner reads (O.9a learns on the merchant CANONICAL)',
  `select count(*) as corrections, max("createdAt")::text as newest_correction
     from "Correction" where "userId"=$1`, [OWNER])

await q('3. Merchants corrected >=2 times with ONE agreed category — the evidence bar',
  `select m.canonical, count(*) as corrections,
          count(distinct cr."toCategoryId") as distinct_targets
     from "Correction" cr
     join "Transaction" t on t.id = cr."transactionId"
     join "Merchant" m on m.id = t."merchantId"
    where cr."userId"=$1
    group by m.canonical having count(*)>=2
    order by corrections desc limit 10`, [OWNER])

await c.end()
console.log('\nprobe complete — read-only, no writes issued')
