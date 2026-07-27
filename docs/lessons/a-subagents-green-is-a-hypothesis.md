# A subagent's green is a hypothesis until you reproduce it — and a suite run beside other agents measures the agents

One-line summary: parallel agents make *verification itself* unreliable — a subagent's PASS can be
against a build that predates your edits, and a full suite run concurrently with other agents reports
failures that do not exist — so reproduce a delegated green yourself, and run the gate alone.

## What happened (L.19, 2026-07-25)

Three background agents ran while the main thread kept editing: one authoring a Playwright spec, two
hostile critics. Every one of them produced a *correct-looking* result that was wrong about the tree.

**1. The delegated green was against a stale build.** The e2e agent reported `5 passed`. Its spec
asserted a `totalNote` golden literal that the builder no longer emitted — I had revised that sentence
*after* launching the agent. The spec as committed could not pass. The agent had run `next build`
earlier in its own session and its later run served a `.next` that predated my edit. It even
diagnosed the stale-`.next` hazard in its own report and still shipped a green under it.

The tell was cheap: one `grep` comparing the spec's constant against the builder's string. The rule is
cheaper still — **a subagent reports evidence, not truth. Re-run, or at minimum re-grep, the specific
claim you are about to record in a gate.**

**2. The full unit suite reported 40 failures that did not exist.** Run concurrently with the
Playwright agent (which drives its own server and SQLite), `vitest run` came back `20 files failed / 40
tests failed`, with a *274th* test file present — a critic's temp file, created and deleted mid-run. A
later clean-ish run reported 7 failures in 4 files; the critic's own run reported 7 failures in a
*different* 4 files. Every one of those files passed 38/38 when re-run alone. The final run, with
nothing else touching the repo, was `273 files / 4250 tests, all passing`.

Three runs, three different failure sets, zero real defects. **A rotating failure set across
concurrent runs is a signature of contention, not of a bug** — but the only way to know is to re-run
the named files in isolation, which costs seconds.

**3. `EXIT: $?` after a redirect measured the wrong command.** `npx vitest run > log 2>&1; echo "EXIT:
$?"` reports the exit status of… the `echo`'s predecessor, yes — but wrapped in a compound background
command, the harness reported the *pipeline's* success and I nearly recorded a red suite as green.
Read the summary line out of the log; do not trust a status code you did not isolate.

## The rules

- **Reproduce a delegated PASS before it enters a gate.** Cheapest form: grep the one literal or
  re-run the one spec. A subagent cannot see edits you made after it started, and its build may be
  older than your source.
- **Run the verification gate alone.** No agents, no parallel e2e. If a suite must run beside other
  work, treat every failure as unproven until re-run in isolation.
- **A different failure set each run means contention.** Same set each run means a bug. Distinguish
  them by re-running the named files serially before diagnosing anything.
- **Ask a subagent to state what it did NOT observe.** The e2e agent's second report did exactly this
  — it reasoned that the spec would kill the injected mutants, then explicitly refused to claim it as a
  measurement because it had never run against the mutated build. That is the standard; prompt for it.
- Corollary for the repo: `scripts/verify.sh` runs Playwright only under `VERIFY_E2E=1`, so the
  default gate is structurally blind to an e2e golden drifting away from the code it asserts. A green
  default verify would have declared L.19 done with its own new spec red.

## What worked

Launching the critics in parallel was still correct — between them they found three P1s the main
thread had missed, including a page printing a dated transfer instruction off a frozen balance with no
disclosure at all. The cost was not the parallelism; it was **treating their environment as if it were
mine.** Run agents in parallel for *finding*; serialize for *proving*.

## Extended 2026-07-27 (O.2 critics) — a subagent's claim about the TREE is a hypothesis too

This lesson was about delegated *results*. The O.2 critic cycle added the other half: a delegated claim about
the **state of the working tree** is exactly as unreliable, and far more dangerous, because everything you run
afterwards inherits it.

Two fresh-context critics reviewed the slice. Critic A opened its report with "Working tree restored to its
pre-review state (`git status` unchanged)" — and it was not. It had mutated `isUnclassifiedTxn` down to
`return t.needsReview`, destroying the union the whole feature exists for, and left it that way while the
docblock above it went on explaining that THE UNION IS THE POINT. It even helpfully noted an untracked probe
spec "that is not mine", so it had looked at status and still misreported its own effect. Nothing caught this
except running `git status` by hand. Had a gate run in that window it would have been green on a tree nobody
intended, and the commit would have shipped a silently narrowed predicate.

Rules that follow:

- **Read `git status` and diff the files a critic was authorised to touch, before running any gate after a
  delegated review.** Not the critic's summary of the tree — the tree.
- **A mutation that contradicts a committed test is self-identifying.** `isUnclassifiedTxn(placeholderOnly)`
  is asserted true in the unit suite, so the stripped version could not be an intentional edit no matter what
  any surrounding message claimed. When something says a change was deliberate, check it against what the
  tests already assert rather than against the claim.
- **Serialise builds, not just gates.** Two critics with permission to run `next build` in the same checkout
  will corrupt `.next` for each other and for you. Give mutation-testing critics their own worktree, or wait
  for them before building.

The cycle is still emphatically worth running: both critics independently found the same real P1 (a count
printed pre-filter beside a filter that composes), which is the strongest possible signal a finding is real,
and one of them proved by execution that the slice's own e2e could not see half the population it claimed to
lock. Parallelise for FINDING — but verify the tree before believing anything downstream of it.
