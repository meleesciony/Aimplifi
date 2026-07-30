# "Alive" is not "progressing" — and a long-running gate needs a progress check, not a liveness check

**One line:** asked whether a 40-minute e2e gate was healthy, I checked that the Playwright
processes existed, answered "nothing is wrong with the run itself", and was wrong — the run
had been frozen for 63 minutes and two failure artifacts were already on disk, findable with
one `ls`.

## What happened

O.15 slice 1's full gate (`VERIFY_E2E=1 bash scripts/verify.sh`) was started in the
background. The owner asked twice whether it was done.

* **First ask.** I ran `Get-CimInstance Win32_Process` and found `npx playwright test`, a
  worker, and `next start -p 3100` all running. I reported the gate was "alive and in its
  Playwright phase… Nothing is wrong with the run itself."
* **Second ask, ~40 minutes later.** I finally listed `test-results/` and checked file
  mtimes. Last write: **15:18:28**. Clock: **16:21**. The run had produced nothing for 63
  minutes, and `test-results/` had held two failure directories since 15:15:55 and 15:18:28
  — i.e. they already existed, unread, when I said everything was fine.

The owner had waited on a reassurance I had not earned.

## The mistake, precisely

**A process table answers "does this exist", never "is this making progress".** Those are
different questions and a hung process answers the first one exactly like a healthy one —
which is what makes liveness the *seductive* check: it is easy, it always returns something,
and its answer is always "yes". Every hang in history passes a liveness check.

Compounding it: I had piped the run through `grep`, which buffers, so the log file sat at 0
bytes and I could not see progress even when I looked at it. I treated "the log is empty"
as "the log is buffered" (true) and stopped there, instead of asking what else could be
measured. Two independent progress signals were available the whole time and cost one
command each: **file mtimes under `test-results/`**, and **the mere existence** of that
directory, which Playwright only writes on failure.

## The rules

1. **To report on a long-running job, measure MOVEMENT: `now - mtime(newest output)`.** A
   process list is not evidence of health. If nothing has been written in several multiples
   of the expected step time, it is hung — say so.
2. **Never pipe a long run through `grep`/`head`.** Write the full log to a file and filter
   on READ. A buffering pipe destroys the only progress signal you have, and it destroys it
   for the entire duration, not just at the end.
3. **`test-results/` existing is itself a finding.** Playwright writes it only on failure
   (`retain-on-failure`). Check it BEFORE reporting status — a green-looking run with three
   entries in there is not green. This is the same lesson as
   `the-evidence-was-in-the-trace.md`, one step earlier: check the artifacts before
   theorising, and here, before reassuring.
4. **A status answer inherits rule 0.** "It's fine" is a claim about a system's state and
   needs evidence like any other. Under uncertainty the honest answer is "the process is up
   but it hasn't written anything in N minutes — let me look", never a confident "no
   problem". The reassuring direction is the expensive one to get wrong: the owner stops
   watching.
5. **Copy `test-results/` before re-running**, then kill and re-run clean. (Already recorded
   in `the-evidence-was-in-the-trace.md`; it held again here.)

## The likely cause of the hang, and the second-order lesson

37 stray `node` processes were alive, across several `next start` servers left over from
earlier targeted spec runs, contending for port 3100. **Repeated targeted `playwright test`
invocations leak servers**; the suite reuses an existing one locally (see
`e2e-runs-a-stale-build.md`), so the leaks accumulate silently and the machine eventually
wedges. Kill stray Aimplifi/playwright node processes before a full gate, and prefer one
full run to many partial ones when the tree is nearly final.

## Reading the failures that were sitting there

Both artifacts matched known signatures, and both were still worth reading rather than
assuming:

* `budget-targets … toHaveCount` timeout — the exact signature in
  `ci-e2e-timing-flake.md`; the slice touched nothing under `/budgets`.
* `mobile-overflow … waitForURL` timeout on WebKit — **not** the `intercepts pointer events`
  signature that `mobile-380-viewport-scaling-flake.md` says is the flake, so per that
  lesson it had to be treated as real until cleared. It clicks `txn-detail-link`, which the
  slice never touched, and the same suite had passed 232/232 in 2.6 minutes earlier in the
  session on nearly the same tree.

Neither was written off on the strength of its name; each was cleared on the strength of
what it clicked and what the diff touched.
