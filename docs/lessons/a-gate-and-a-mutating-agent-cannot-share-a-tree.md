# A verification gate and a mutating agent cannot share a working tree

**One line:** I ran the full `VERIFY_E2E=1` gate while a hostile-critic subagent was reverting `src/` to
HEAD and dropping scratch test files in the same directory; seven tests reddened, none of them a defect,
and for a few minutes I had a "failing gate" that proved nothing in either direction.

## What happened

U.33 was a read-path consolidation on a money-persisted path, so it wanted a fresh-context critic
(LOOP_ENGINEERING: "prefer a fresh-context verifier subagent over self-critique"). I launched the critic
and, to use the wall-clock, started the full gate in parallel. Both ran in `C:\dev\Aimplifi`.

The critic did exactly what a good critic does: to measure old-vs-new behavior it ran
`git checkout -- src/server/{reconciliation,recurring,tax}.ts` twice, restoring within ~15 seconds each
time, and it created three probe files under `tests/unit/` (which vitest globs) that wrote fixtures into
the same shared SQLite test database my gate was using.

Result: `Test Files 2 failed | 425 passed (428)` — a file count two higher than the tree has, which was
the tell. Seven failures: five in the file under test (fixture collision on the shared database) and two
in a `_tmp_u33_order_probe.test.ts` I had never written. A previous, quiet run of the same tree had been
green, and the re-run after the critic finished was green again.

## Why it matters more than "oops, contention"

The dangerous version of this is not the red gate — it is the **green** one. Had the critic's revert
window overlapped `next build` or the typecheck instead of the unit run, the gate would have compiled
HEAD and reported success for code that was not in the tree. That is `e2e-runs-a-stale-build` and the
V.3 leaked-server false-P0 with a new cause: not a stale server, but a working tree being edited
underneath the thing measuring it. A gate's whole value is that its inputs are fixed while it runs.

It also wastes the expensive thing. A red gate under contention has to be discarded entirely — you
cannot triage which failures were real, because the mechanism that produced them is indiscriminate.
The re-run costs the full ~12 minutes you were trying to save by overlapping.

## The rule

**While a gate is running, nothing else may touch the tree; while a mutating agent is running, no gate.**
LOOP_ENGINEERING rule 9 ("one agent, one directory") already says this — the failure was reading it as a
rule about *parallel makers* rather than about *anything that writes*. A read-only explorer subagent is
safe to overlap. A critic is not, because a serious critic mutates: it reverts, sabotages, and probes.
That is the job.

Ways to overlap safely, cheapest first:
- Sequence them: critic first, then the gate on its findings. Usually right, since the critic's findings
  change the code the gate must measure anyway — the overlapped gate was going to be superseded.
- Give the mutating agent its own `git worktree` (`isolation: "worktree"`), which is what that option is
  for.
- If a red gate does land under contention: check `Test Files (N)` against the tree's real count and
  `git status --untracked-files=all` before reading a single assertion. A file count that does not match
  the tree means the run is void, not failing.

## The tell, in one line

A test file you did not write appearing in your own gate output is not a flake and not a defect — it is
proof that something else was writing to the tree while you measured it.
