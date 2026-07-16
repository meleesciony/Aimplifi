# A fence copied per call site will miss call sites — make the guarded thing obtainable only through a fencing constructor

**One-line hook:** #242's demo fence was added as a one-line ternary at each LLM call site; the
cycle-2 critic found two sites the sweep missed (Plaid/SimpleFIN ingest) — the fix was to make
`categorizeSuggestFor(userId)` the ONLY way any path obtains the suggest function, so the fence
holds by construction and ONE executed test covers every site, present and future.

## What happened

Trust Center (#242) required "the shared demo account never consults a model, on any deployment."
Cycle-1 fix: grep the call sites, add `userId === DEMO_USER_ID ? null : …` at each. Five
categorize sites existed; the sweep fenced three (manual, CSV, backfill) plus assistant/coach —
and missed plaid.ts/simplefin.ts, even though *this same slice had just edited those exact lines*
to add the audit sink. A fresh-context critic falsified the page's headline claim with them: a
demo visitor connects a bank (connect actions have no demo fence), and every subsequent sync
egresses descriptors under the demo id — invisibly, because the audit sink also no-ops for demo.

## The lesson

- A guard invariant of the form "X never happens for principal P" must not be implemented as N
  copies of a conditional at N call sites. Every copy is a site a future refactor (or the same
  session's own sweep) silently drops, and greps run by the person who wrote the fence miss the
  sites they weren't thinking about — the critic proved the author's sweep and the author's tests
  agree on the same blind spot.
- Instead, centralize: make the capability (here, the LLM suggest function) obtainable ONLY from a
  constructor that takes the principal and applies the fence + any cross-cutting instrumentation
  (the audit sink) internally. Call sites can then not be wrong. One executed test on the
  constructor covers all sites, including ones that don't exist yet.
- Related but distinct from [a-guard-must-read-what-it-guards](a-guard-must-read-what-it-guards.md)
  (share the guarded input) and the #221 grep-the-data-class rule (sweep when you find one
  instance): this is the *structural* prevention — after the sweep, collapse the copies so the
  next instance can't be created.
