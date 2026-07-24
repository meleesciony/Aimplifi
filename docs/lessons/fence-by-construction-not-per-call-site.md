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

## Extended #301 (L.10 slice 2) — centralising the WRITER is not the same as centralising the FACT

The Plaid update-mode flow needed the OAuth return page to tell two sessions apart: a NEW bank
(must exchange its public token) and an update of an existing one (must not). It was implemented
as a second `localStorage` key beside the token, with a single writer that always set-or-cleared
it — and the docstring claimed fence-by-construction on exactly that basis. A fresh-context critic
broke it in two directions and produced a **P0: a completed brand-new bank link was discarded
without being exchanged, while the user was redirected as though it had worked.**

Two things the "one writer" framing missed, and both generalise:

- **One writer of a key is not one writer of the state.** /accounts renders the update control
  beside the connect front door, and the front door pre-mints a link token on mount and after
  every exit — calling the same writer with no marker, which *cleared* a live update session's
  marker. Two components, one slot, no coordination. Count the *writers of the storage location*,
  not the functions in your own file.
- **A fact stamped when a thing is PREPARED describes a session that may never run.** The token
  was stashed at mint time, so the record described the most recently *minted* session while Link
  opened the most recently *clicked* one — and the front door's already-armed fast path called
  `open()` without writing at all, so a stale record survived into a different flow. Stamp state
  at the moment of the ACTION (immediately before `open()`), not at the moment of preparation.

The fix was a change of shape, not a stronger rule: **one atomic record holding both halves**
(`{token, updateItemId?}` in a single `setItem`), written by whoever is about to act. Two keys
also fail open — a partial write left a token with no marker, and the no-marker branch was the
dangerous one — so when two values are only meaningful together, store them together.

Also from the same critic pass, worth its own line: **when two columns are derived from each
other, they must refresh under the same rule.** `Account.type` is computed from Plaid's `subtype`
and was written unconditionally, while `subtype` was preserve-on-null — so a response omitting
subtype recomputed one and kept the other, and a row could settle at `type: LOAN` beside
`subtype: 'mortgage'`: two stored facts contradicting each other, on the very pair the identity
ladder compares as a unit. Preserve-on-null is a good default for an identifier nothing is derived
from, and a bug for one that something is.
