# A red count is a floor, and the gate nobody reads is not a gate

**One-line summary:** K.6 was filed as "the last two reds"; the file held three, because a
failure in a `mode:'serial'` spec ABORTS everything behind it — and while the loop argued about
those two tests, `.github/workflows/verify.yml` had been running the same full gate on every
push and FAILING on every push for days, on four unit tests nobody had ever seen fail, because
nothing in the loop reads CI.

## What happened

`phase2-triage.spec.ts:132` and `:184` were attributed to O.17's demo fence on
`createCustomCategory` and recorded as "the last two reds in the full-suite gate." Both
attributions were right. The count was not.

A full-file serial run reports:

```
✘ 3 phase2-triage.spec.ts:132   Expected: "10"  Received: "11"
- 4 :184   - 5 :314   - 6 :385   - 7 :394
```

**Four tests did not run.** The prior session had confirmed `:184` and stopped. Inverting the
grep on both fenced tests exposed a third, independent red: `:394` (`Skip for now`, #374) opens
by requiring a card, and it is declared AFTER `review cost`, which drains the queue to empty by
design. Run alone, `:394` passes in 2.1s. It had therefore never once run green in a full-file
run since it was added — its failure was pure declaration order, and it was invisible because
the two fenced tests always aborted the file first.

Then, checking the row's headline claim ("until this closes, `VERIFY_E2E=1` cannot go green"),
`gh run list` returned `failure` for every recent push. Grouped over the last 100 runs
(2026-08-02 → 2026-08-06): **50 `failure`, 49 `cancelled`, 0 `success`.** Not one green CI run
in the whole window. The latest CI run failed **four unit tests that pass locally**. Root cause, reproduced not inferred: `businessToday()` reads
`process.env.DEMO_TODAY` first; `.env` sets it to `2026-06-10` but **vitest does not load
`.env`**, while GitHub Actions declares it as a job-level env var present in `process.env` for
every step. So the identical suite answers as of August locally and as of June in CI.
`DEMO_TODAY=2026-06-10 npx vitest run` reproduces all four byte-identically.

## Why it survived

Every session ended on a real, honestly-run local `verify.sh`. None of them was lying. But:

- A serial file reports the FIRST failure and the COUNT of what it skipped — never the verdicts
  of what it skipped. "2 failed, 4 did not run" was read as "2 reds."
- Rule 5 (commit, push, deploy, prove it's live) proves a DEPLOY reached `READY`. Nothing in it
  proves the gate that guards `main` is green. The CI job existed, ran on every push, and was
  red the whole time; no step in the loop ever looked.
- A local gate whose result depends on ambient environment is not measuring the code. `.env`
  loaded for `next build` and not for vitest is enough to make "6,167 passed" a claim about one
  machine.

## The rules

1. **A red count taken from a serial run is a FLOOR, never a total.** Before claiming "the last
   N reds", re-run with the known failures inverted (`--grep-invert`) until nothing is skipped.
   `did not run` is an unknown, not a pass.
2. **Read CI before claiming a gate is green.** `gh run list` is one call. A green local run and
   a green build are different facts, and only one of them guards `main`.
3. **A gate that reads ambient environment is not deterministic.** If `.env`, `TZ`, or the wall
   clock can change the verdict, the suite is measuring the machine. Pin it, or make every test
   that reads the clock pin its own date.
4. When a test needs a capability a fenced user lacks, **change the FIXTURE, never the fence and
   never the assertion** — and give the fixture a self-check on arrival, so a drifted premise
   fails loudly at the top instead of deep inside a flow.

## Also settled here

The prior row proposed "a cheap grep-level guard for demo-driven writes in specs." **Assessed
and rejected — do not re-propose.** A spec file mixes demo and throwaway users per TEST, so a
file-level grep cannot tell which sign-in a given test used; run against the suite it flagged
`transactions.spec.ts`, which already uses throwaway users for both write-in tests and carries
an explicit demo-fence test at `:529`. The guard was never missing. It was unread.
