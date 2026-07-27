// READ-ONLY watcher. Polls production until the L.26 fix actually runs.
//
// Emits a line ONLY on an outcome worth acting on:
//   MOVED    — ScheduledTransaction rows appeared (the fix worked end to end)
//   STILL-0  — a sync ran AFTER the L.26 deploy and wrote nothing (the real defect)
//   ERROR    — the probe itself failed
// Timestamps are read as ::text: these columns are `timestamp without time zone`
// and the driver would otherwise shift them by the local offset
// (docs/lessons/a-driver-parsed-timestamp-is-not-the-stored-value.md).
import { readFileSync } from 'node:fs'
import pg from 'pg'

const OWNER = 'cmqisanqh000004l7wylnhrpd'
const DEPLOY_UTC = '2026-07-27 02:12:53' // L.26 (17fed6f) began serving traffic
const INTERVAL_MS = 15 * 60 * 1000

const env = readFileSync(new URL('../../.env.prod.tmp', import.meta.url), 'utf8')
const line = env.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='))
const url = line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '')

const say = (s) => { process.stdout.write(s + '\n') }

let reportedStill0 = false

async function poll() {
  const c = new pg.Client({ connectionString: url })
  await c.connect()
  try {
    const { rows: [n] } = await c.query(
      `select count(*)::int as scheduled from "ScheduledTransaction" s
         join "Account" a on a.id = s."accountId" where a."userId" = $1`,
      [OWNER],
    )
    const { rows: [t] } = await c.query(
      `select max("createdAt")::text as newest from "AuditLog" where "userId" = $1`,
      [OWNER],
    )
    if (n.scheduled > 0) {
      say(`MOVED: ScheduledTransaction for the owner = ${n.scheduled} rows (was 0). The L.26 fix has run — "Fixed & recurring expenses" should now read $684.31/mo instead of $0.00. Last activity ${t.newest} UTC.`)
      return true
    }
    if (t.newest && t.newest > DEPLOY_UTC && !reportedStill0) {
      reportedStill0 = true
      say(`STILL-0: activity at ${t.newest} UTC is after the ${DEPLOY_UTC} deploy, yet ScheduledTransaction is still 0. If that activity was a Plaid sync, the fix ran and wrote nothing — investigate refreshRecurringForUser (its failure is swallowed at plaid.ts:1509).`)
    }
    return false
  } finally {
    await c.end()
  }
}

for (;;) {
  try {
    if (await poll()) break
  } catch (e) {
    say(`ERROR: probe failed — ${e instanceof Error ? e.message : String(e)}`)
  }
  await new Promise((r) => setTimeout(r, INTERVAL_MS))
}
