// READ-ONLY production probe (TASKS O.8b). No writes.
//
// Question: does the `credit-card-payment` category actually reach a spending
// figure on live data, and when it does, is it a DOUBLE COUNT (the paid card is
// linked, so its own charges are already counted) or the ONLY TRACE of that
// money (the card is not linked)?
//
// `isSpendRow` (reports.ts:45-51) excludes isTransfer, the `transfer` id and the
// Income group — but NOT `credit-card-payment`, which Plaid assigns directly
// (plaid-map.ts:420) without going through the normalizer that feeds
// detectTransfers. The demo seed cannot answer this: it marks both sides of
// every card payment isTransfer:true, so they are already excluded there.
// CREDENTIALS: reads `.env.prod.tmp` (gitignored), produced by `vercel env pull
// .env.prod.tmp`. DELETE that file when you are done — it holds the live
// production DATABASE_URL, and nothing else in the repo needs it at rest.
import { readFileSync } from 'node:fs'
import pg from 'pg'

const env = readFileSync(new URL('../../.env.prod.tmp', import.meta.url), 'utf8')
const line = env.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='))
if (!line) throw new Error('DATABASE_URL not found in .env.prod.tmp')
const url = line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '')
const c = new pg.Client({ connectionString: url })
await c.connect()

const q = async (label, sql, params = []) => {
  const r = await c.query(sql, params)
  console.log(`\n--- ${label} ---`)
  if (r.rows.length === 0) console.log('(no rows)')
  else console.table(r.rows)
  return r.rows
}

await q(
  '1. Account types per user (is a CREDIT account linked at all?)',
  // No email column: this output lands in a transcript, and the user id answers
  // the question on its own. None of the sibling probes print PII either.
  `select u.id as user_id, a.type, count(*) as accounts,
          sum(case when a."plaidItemId" is not null then 1 else 0 end) as plaid_linked
     from "User" u join "Account" a on a."userId" = u.id
    group by u.id, a.type order by u.id, a.type`,
)

await q(
  '2. Every categoryId in Transfers & Other, with row counts and signed totals',
  `select t."categoryId", t."isTransfer", t.status, count(*) as rows,
          sum(t."amountCents") as signed_cents
     from "Transaction" t
    where t."categoryId" in ('transfer','credit-card-payment','cash','uncategorized')
    group by t."categoryId", t."isTransfer", t.status
    order by t."categoryId", t."isTransfer"`,
)

await q(
  '3. THE DEFECT SET — credit-card-payment rows that isSpendRow would COUNT',
  `select a."userId", a.type as account_type, a.name as account_name,
          t.status, count(*) as rows, sum(-t."amountCents") as spend_contribution_cents
     from "Transaction" t join "Account" a on a.id = t."accountId"
    where t."categoryId" = 'credit-card-payment'
      and t."isTransfer" = false and t."isSplitParent" = false
      and a.type in ('CHECKING','SAVINGS','CREDIT')
    group by a."userId", a.type, a.name, t.status
    order by spend_contribution_cents desc`,
)

await q(
  '4. Those same rows, most recent 15, verbatim (what would print as spending)',
  `select t.date, t."amountCents", t."rawDescriptor", t."providerCategoryId",
          a.name as account_name, a.type as account_type, t.status
     from "Transaction" t join "Account" a on a.id = t."accountId"
    where t."categoryId" = 'credit-card-payment'
      and t."isTransfer" = false and t."isSplitParent" = false
      and a.type in ('CHECKING','SAVINGS','CREDIT')
    order by t.date desc limit 15`,
)

await q(
  '5. Is the double count real? — current-month spend by category, top 12',
  `select t."categoryId", count(*) as rows, sum(-t."amountCents") as spend_cents
     from "Transaction" t join "Account" a on a.id = t."accountId"
    where t."isTransfer" = false and t."isSplitParent" = false
      and a.type in ('CHECKING','SAVINGS','CREDIT')
      and t."categoryId" is distinct from 'transfer'
      and substring(t.date from 1 for 7) = substring((now()::date)::text from 1 for 7)
    group by t."categoryId"
    having sum(-t."amountCents") > 0
    order by spend_cents desc limit 12`,
)

await q(
  '6. Do the CREDIT accounts carry their own charges? (if yes, a counted payment double-counts)',
  `select a.name, a.type, count(*) as txn_rows,
          min(t.date) as first_date, max(t.date) as last_date,
          sum(case when t."amountCents" < 0 then 1 else 0 end) as charge_rows
     from "Account" a left join "Transaction" t on t."accountId" = a.id
    where a.type = 'CREDIT'
    group by a.id, a.name, a.type order by txn_rows desc`,
)

await c.end()
console.log('\nprobe complete — read-only, no writes issued')
