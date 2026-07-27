# The failing response body was already on disk — and the framework's shipped code answered it

One-line summary: three sessions called #287 "not diagnosed" while Playwright's own trace held the
exact HTML the browser received on the failing load, and the answer was in React's shipped `$RC`
reveal script — which defers the reveal behind `requestAnimationFrame` — not in anything the app
wrote.

## What happened

`getByTestId('reconcile-candidates') resolved to 2 elements` had been open since 2026-07-24 across
several sessions, carrying a structural *shape* explanation (a Suspense streaming reveal that leaves
the server's copy beside the client render) and an unconfirmed *trigger* (SQLite write contention).
Both the shape and the trigger were reasonable. The trigger was wrong, and the shape was one level
short of the cause.

The cause: React streams resolved Suspense content into `<div hidden id="S:0">` and emits
`$RC("B:0","S:0")` to move it into place. The shipped `$RC` does not move anything inline — it marks
the boundary pending, pushes onto a batch array `$RB`, and defers the real work to `$RV` via
`requestAnimationFrame`. Starve the renderer of frames and the staged copy is never moved, while
React's client render fills `#content` from the RSC payload. Two copies, no hydration error, forever.

## The transferable rules

1. **`trace: 'retain-on-failure'` already captures response bodies.** The failing document was sitting
   in `trace.zip → resources/<sha1>.html` the whole time; `0-trace.network` maps URL → sha1, and
   `0-trace.trace` carries `frame-snapshot` entries with the full serialized DOM, from which the
   ancestor chain of *both* copies falls out in one script. Nobody had to reproduce anything to read
   it. Before instrumenting a flake, check what the artifacts already hold.
2. **Read the framework's shipped code, not its docs.** No amount of reading about Suspense streaming
   would have surfaced `2===$RB.length` or the rAF deferral; twelve lines of minified `$RC` did. Same
   rule that made O.4's 30-minute session timeout safe to choose (read `@auth/core`'s source for
   mechanism) — the dependency's real behaviour lives in `node_modules`, not the changelog.
3. **A structural mechanism that explains the shape is not the cause.** "`(app)/loading.tsx` creates
   the Suspense boundary that creates the staging container" was clean, matched every observation, and
   was *false* — deleting it and rebuilding left the staging container present on 6/6 loads. That fix
   would have shipped as confident, reversed a deliberate product decision (#81), and fixed nothing.
   A/B a structural fix before believing it, especially when it costs a recorded decision.
4. **Check whether your fix is already the default before claiming it.** The three Chromium
   backgrounding flags are the textbook cure for starved rAF, and Playwright passes all three by
   default — the change was a measured no-op. One grep of `node_modules` beats one hopeful commit.
5. **Do not re-run the suite before copying the artifacts.** `npx playwright test --last-failed`
   cleared `test-results/` and destroyed the first reproduction's traces; the second reproduction cost
   a full extra suite run. Copy first, analyse second.
6. **Negative results are the deliverable when the fix isn't found.** Four eliminations, each executed
   (seeding race, `loading.tsx`, the flags, and any isolated reproduction across 96 instrumented
   loads) are worth more to the next session than a fifth hypothesis, because each one is a session
   somebody else no longer spends.

## The reproduction asymmetry worth remembering

The four specs passed 18/18 alone. A forced-slow page passed 4/4 at `--workers=1`. A probe under CPU
throttling, network throttling and 4-way concurrency produced zero duplications in 96 loads. The same
tree failed 5, then 1, then 6 under the full suite. When a flake resists every isolated condition you
can construct, stop trying to shrink the repro and instrument the full run instead — and measure any
candidate fix against a full run, because a green targeted run proves nothing about it.
