// READ-ONLY production probe. No writes. Why does refreshRecurringForUser
// still write 0 ScheduledTransaction rows after the L.26 deploy?
import { readFileSync } from 'node:fs'
import pg from 'pg'

const OWNER = 'cmqisanqh000004l7wylnhrpd'
const env = readFileSync(new URL('../../.env.prod.tmp', import.meta.url), 'utf8')
const line = env.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='))
const url = line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '')
const c = new pg.Client({ connectionString: url })
await c.connect()

const q = async (label, sql, params = []) => {
  const r = await c.query(sql, params)
  console.log(`\n--- ${label} ---`)
  console.table(r.rows)
  return r.rows
}

await q(
  'AccountReconciliation links (activeTerminalSuccessorMap reads undoneAt IS NULL)',
  `select r.id, r."predecessorAccountId" as pred, r."successorAccountId" as succ,
          r."cutoverDate", r."undoneAt",
          p.type as pred_type, p.name as pred_name, p.currency as pred_ccy,
          s.type as succ_type, s.name as succ_name, s.currency as succ_ccy
     from "AccountReconciliation" r
     left join "Account" p on p.id = r."predecessorAccountId"
     left join "Account" s on s.id = r."successorAccountId"
    where r."userId" = $1 order by r."cutoverDate"`,
  [OWNER],
)

await q(
  'Cash accounts (CHECKING/SAVINGS) — the scope expenses project onto',
  `select id, type, name, currency, "currentBalanceCents", "feedDroppedAt"
     from "Account" where "userId" = $1 and type in ('CHECKING','SAVINGS')
    order by type, name`,
  [OWNER],
)

await q(
  'User.paymentAccountId',
  `select "paymentAccountId" from "User" where id = $1`,
  [OWNER],
)

await q(
  'Account type census',
  `select type, count(*)::int as n, sum(case when currency is null or currency = 'USD'
       then 0 else 1 end)::int as non_usd
     from "Account" where "userId" = $1 group by type order by n desc`,
  [OWNER],
)

await q(
  'POSTED txns feeding detection, per cash account (last charge date)',
  `select a.id, a.type, a.name, count(*)::int as posted_txns,
          min(t.date) as first, max(t.date) as last
     from "Transaction" t join "Account" a on a.id = t."accountId"
    where a."userId" = $1 and a.type in ('CHECKING','SAVINGS')
      and t.status = 'POSTED' and t."isSplitParent" = false
    group by a.id, a.type, a.name order by posted_txns desc`,
  [OWNER],
)

await c.end()
