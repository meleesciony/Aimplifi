# An e2e spec run tests the last `next build`, not your edit

`playwright.config.ts` starts the app with `npx next start -p 3100` and, locally,
`reuseExistingServer: !process.env.CI` is **true**. Both halves of that mean the
same thing: a targeted `npx playwright test tests/e2e/<spec>.ts` after a source
edit runs against **compiled output from an earlier build** (or against a server
already squatting on 3100), so the change under test is simply not there.

This burned a full diagnostic detour in #261. A new assertion failed, and the
failure was indistinguishable from a real defect — the assertion read the OLD
behaviour, exactly as if the fix had not worked. Two probe runs were spent
instrumenting the component to prove a `useEffect` "never ran" before the actual
cause surfaced: `next start` was serving the previous build. After one
`npx next build`, the same probe printed the expected values on the first try.

**The rule:** after editing anything under `src/`, run `npx next build` before any
targeted Playwright invocation.

**CORRECTION (2026-08-01, W.2 / DECISIONS #361).** This file used to continue: *"`bash
scripts/verify.sh` already builds, so the full gate never has this problem — it is only the
fast targeted loop that does."* **That is false, and it is false in the most dangerous
direction.** `reuseExistingServer: true` means Playwright will reuse a server *already
listening on 3100* — so if one has leaked from an earlier run, the fresh `next build` the gate
just performed is simply **ignored**, and the full gate tests old compiled output while
reporting a clean build. Building is necessary and not sufficient; **the port has to be free,
or the build does not matter.**

    netstat -ano | grep ":3100.*LISTENING"    # then taskkill //PID <pid> //F

Run that before believing any e2e failure, targeted or full.

**The tell:** the failure looks like "my change had no effect at all" rather than
"my change had the wrong effect". A `useEffect` that appears not to fire, a new
`data-testid` that is missing, a new prop that reads as `undefined` — none of
those are usually real. Rebuild first, then believe the failure.

**A SECOND tell, worse than the first (2026-08-01).** A leaked server can also serve a build
from a *mid-edit* state, and then the failure does not look like "no effect" at all — it looks
like a **P0 you just introduced**. In the W.2 slice three specs failed with the page rendering
its `Something went wrong` error boundary, on `/dashboard`, a route the change barely touched;
the natural reading is "my server change throws in production". The code was correct. One
`taskkill` turned all three green with no edit. So: an error boundary in an e2e, a route
failing that your diff has no business breaking, or a sudden cluster of failures after a run
that was green — check the port before you debug the diff.

**And do not let this contaminate a flake investigation.** TASKS V.1 (the rotating-e2e-failure
wave) had recorded "nothing is LISTENING on port 3100 between runs" as *evidence refuting* the
leaked-server hypothesis on this machine. It happens. That refutation was wrong, and it was
load-bearing for the V.1 analysis. Two different mechanisms live here and they have opposite
signatures: a **stale server** is deterministic, hits whole suites, and often kills routes
unrelated to the diff; the **V.1 flake** rotates its victim, hits one or two specs per run, and
passes in isolation. Diagnose which one you have before adding evidence to either pile.

Related: the same config comment warns that a stale server on 3100 also resolves
the `.env` default `file:./dev.db` instead of the relocated e2e database, so a
reused server can silently test the wrong data as well as the wrong code.
