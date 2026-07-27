# Ask the stored state what changed, not the writers — a predicate that enumerates side-effects rots by construction

L.28: `AutoSync` re-rendered the page only when a sync reported a change, and that predicate — living
in a `'use client'` file with no test in the repo — read two counters, `added` and `statementsWritten`.
Everything else a sync writes was invisible to it. On the owner's live data L.26's re-keying turned 0
stored scheduled rows into 8 ($684.31/month) during syncs reporting `added: 0`, so the page load that
**repaired** his guilt-free breakdown re-painted its stale $0.00 and only the *next* load showed the
money. Four sessions of "did it work?" would have ended on a page saying no on the very load that
made it yes.

**The transferable finding is that my first fix made the same mistake one level up.** I replaced two
counters with seven — transactions, `modified`, `removed`, statements, holdings, institution names,
plus a new `derivedChanged` — and a hostile critic proved by probe that the single biggest writer in
the sync was still missing: `syncAccountsForItem` rewrites every balance, credit limit, name, type
and mask on EVERY sync, creates whole new `Account` rows, and returns `void`. An INVESTMENT or LOAN
account has **no transactions at all**, so its balance is the only thing that ever moves — the exact
accounts where the counters can never speak. A longer enumeration is still an enumeration.

The rule: **when the question is "did anything change", read the stored state before and after and
compare it. Do not sum what the writers claim.** A state comparison needs no list, cannot be
out-of-date with respect to a writer added later, and — with no `select` at all — covers columns
added to the model years from now without anyone remembering this file exists.

Corollaries, each paid for:

- **Compare VALUES, not counts.** The cheap version (compare row counts before/after) passes the
  obvious tests and misses the case that matters: a bill whose amount moves changes every figure on
  the page while changing no count. Make that a test; mutating the digest down to counts must turn it
  red.
- **Exclude the row's own id, keep the foreign keys.** A full delete-then-create mints a new cuid per
  row per sync, so an id-bearing comparison answers "changed" every time — as useless as never
  answering, in the opposite direction. But `merchantId`/`accountId` are stable and load-bearing: a
  series re-keyed onto the live account IS the change L.26 exists to make. "Ids are excluded" was a
  sentence in my own docblock that would have told the next maintainer to delete the signal.
- **Read both sides through the same driver.** Diffing hand-built rows against stored ones lets an
  `undefined` where the column holds `null` pose as a change. Two reads cost two queries and remove a
  whole class of false positive. Say what they cost — "no extra round trip" was false; it is four
  queries per refresh.
- **Move the predicate to where a test can reach it.** The enumeration was wrong partly because it
  lived in a client component nothing in the repo asserts on. Computing it in the server action put
  every branch under test and made the next side-effect one `||` away from being seen.
- **A change to a THIRD table is the one thing a row digest cannot see.** Retiring a resumed
  income-pause confirmation was invisible to the projection digest, and it was also committed
  *outside* the replace transaction — so a throw destroyed the user's consent permanently while both
  providers' catch blocks asserted "a throw means the transaction rolled back, so nothing changed".
  Put such a write inside the same transaction as the rows it accompanies, and make the comment true
  rather than aspirational.
- **A green lock is a hypothesis.** My first test for that consent bug passed — and passed against
  the old code, because the fixture resolved to `inert` and never reached the retirement branch at
  all. Only the mutation exposed it. Rebuild the fixture until the mutation kills it, then keep the
  note about why the easy fixture was not hard.
- **Failure direction decides the default.** A missed refresh leaves a stale money figure in front of
  a reader; a spurious refresh costs a re-render. So read the change flag *without* an `ok` guard — a
  sync whose transaction half failed can still have stored a card statement — and where the
  accumulator is out of scope, say "we cannot say" rather than claiming nothing was written.
- **Enumerating routes is the same disease.** My shared `revalidatePath` list started as a judgement
  about which pages a sync touches, and the judgement was wrong twice in one sitting (`/settings`
  renders account lists and live counts; `/trust` renders an accuracy sample ingested rows feed).
  Replaced with every route under the app group, checked against the filesystem in both directions.
- **Don't amplify a critic's unverified causal claim.** One critic implied the missing
  `/spending-plan` revalidation caused the stale render. Every route there is authenticated and
  dynamic, so it cannot have. The list fix is hygiene and is now written down as scope, not as a
  cause — a fix that claims the wrong mechanism is the next session's false lead.
