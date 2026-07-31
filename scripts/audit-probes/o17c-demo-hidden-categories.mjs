// READ-ONLY. O.17c: `setCategoryHidden` has no demo fence and the Settings copy on the
// shared demo row actively invites removal ("Remove the ones you don't use"), so any
// anonymous visitor can strip built-in categories out of the pickers for every visitor
// after them. The seed writes no HiddenCategory rows, so ANY row on `user-demo` in
// production was put there by a visitor.
//
// Prevention is not a remedy (docs/lessons/prevention-is-not-a-remedy.md): measure the
// damage that already exists before shipping the fence.
import { readFileSync } from 'node:fs'
import pg from 'pg'

const DEMO = 'user-demo'
const env = readFileSync(new URL('../../.env.prod.tmp', import.meta.url), 'utf8')
const url = env.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='))
  .slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '')

const c = new pg.Client({ connectionString: url })
await c.connect()
try {
  const demoUser = await c.query(`select id, email from "User" where id = $1`, [DEMO])
  console.log(`demo user row present: ${demoUser.rows.length === 1 ? 'YES' : 'NO'}`)

  const demoHidden = await c.query(
    `select "categoryId" from "HiddenCategory" where "userId" = $1 order by "categoryId"`, [DEMO])
  console.log(`\nHiddenCategory rows on the SHARED DEMO row: ${demoHidden.rows.length}`)
  for (const r of demoHidden.rows) console.log(`   - ${r.categoryId}`)

  // Context: is this a demo-only problem, or do real users use the feature at all?
  const all = await c.query(
    `select "userId", count(*)::int as n from "HiddenCategory" group by "userId" order by n desc`)
  console.log(`\nHiddenCategory rows across ALL users (${all.rows.length} user(s) with any):`)
  for (const r of all.rows) console.log(`   ${r.userId === DEMO ? '[DEMO] ' : '       '}${r.userId}  ${r.n}`)

  // The sibling overlay O.17 already fenced, as a control: if a visitor reached the
  // rename field before the fence landed, the same cleanup question applies there.
  const demoRenames = await c.query(
    `select "categoryId", name from "CategoryRename" where "userId" = $1 order by "categoryId"`, [DEMO])
  console.log(`\nCategoryRename rows on the demo row (O.17 fenced this): ${demoRenames.rows.length}`)
  for (const r of demoRenames.rows) console.log(`   - ${r.categoryId} -> ${JSON.stringify(r.name)}`)

  // And the custom-category door, fenced in the same slice.
  const demoCustom = await c.query(
    `select id, name from "Category" where "userId" = $1 order by name`, [DEMO])
  console.log(`\nCustom Category rows owned by the demo row (O.17 fenced this): ${demoCustom.rows.length}`)
  for (const r of demoCustom.rows) console.log(`   - ${r.id} ${JSON.stringify(r.name)}`)
} finally {
  await c.end()
}
