# "Identical" copies are never identical — diff them before you extract, and keep each caller's decision at its call site

**One-line:** A redundancy cleanup is a behaviour-change risk in disguise: the copies you are
about to collapse have quietly drifted, so the extraction's real job is to find the drift and
decide it OUT LOUD — not to pick whichever copy you read first and silently re-round four other
engines' money.

## What happened (2026-07-21, #260 — the agent review's B wave)

Two of the five extractions in one cleanup slice turned out to be hiding a disagreement:

* **Five `medianOfSorted` copies disagreed on the even-count case** — three floored the average
  of the two middle values, one rounded it, one returned it raw. All five feed money figures
  (money-signature spread, anomaly MAD, merchant "typical" charge, FI half-over-half growth,
  recurring cadence). "Consolidate the median" read like a chore and was actually a proposal to
  change up to four engines' numbers by a cent.
* **Five copies of the LLM provider selection disagreed on the fallback guard** — two wrote
  `else if (anthropicKey)`, three wrote a bare `else` with `anthropicKey!`. Same behaviour today
  only because an earlier check guaranteed one key existed; the assertion was a trap waiting for
  the next caller.

## The rule

1. **Diff every copy against every other copy before writing the shared one.** Ask a
   reconnaissance pass for "the differences between the copies" explicitly — that is the finding,
   not the line count. Enumerate: rounding, guards, empty/zero handling, error mapping, what is
   read at module scope vs per call.
2. **Where the copies disagreed on a JUDGEMENT, the shared utility must not make it.** Export the
   exact/undecided value and leave the decision at each call site with a name that says it
   (`medianCents = Math.floor(medianOfSorted(...))`). One shared implementation, N explicit
   decisions — you removed the duplication without inheriting a hidden vote.
3. **Where they disagreed on a BUG, take the safe copy and say so** (the guarded `else if`).
4. **Preserve garbage-in behaviour deliberately.** All five medians returned `NaN` on empty input
   via `undefined + undefined`; the shared one returns `NaN` explicitly *because* they did.
   "Improving" it to a throw would have been an unrequested behaviour change inside a cleanup.
5. **Prove it with the callers' own suites at unchanged counts** — the extraction is correct when
   every engine's existing tests pass untouched, not when the new util's tests pass.
6. **Not every duplicate is duplication.** In the same slice, "the same" provider-configured check
   in three files differed on purpose (one also requires the encryption key because it stores
   tokens), and three UI confirm rows rendered genuinely different elements — collapsing those
   would have cost ~14 props to reproduce six markups. Extract the shared STATE MACHINE, leave
   the divergent surfaces alone, and record why.
