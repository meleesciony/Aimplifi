# The local full-suite e2e flake is load-induced, and its symptom varies by page

**One-line summary:** on 2026-07-12 a full local `VERIFY_E2E=1` run failed `settings-dials.spec.ts`
with a *corrupted persisted value* (`Travel, Dining Out, ClimbingTravel`) — a signature none of the
existing flake notes covered, so it looked like a real data-integrity bug. It is not: a full verify on
**clean HEAD** (slice-7 work stashed) failed too, on a *different* test (`phase4-features.spec.ts`
goals, a 60s `locator.click` timeout), while the same specs pass standalone and the full suite passed
104/104 in a standalone `npx playwright test` run. Same machine, same commit, a different victim each
run: this is the `ci-e2e-timing-flake.md` pattern reproducing **locally** — and under load it can
corrupt a value rather than merely time out.

## Why this note exists (the trap it sets)

The two older notes train you to expect a *timeout* (`ci-e2e-timing-flake.md`) or a *pointer
intercept* (`mobile-380-viewport-scaling-flake.md`). A wrong **value** that survives a
`page.reload()` — so it genuinely reached the DB — reads like the `mutation-form-recipe.md` family
that has bitten this repo three times (#166/#170/#216). I wrote a lesson calling it a real bug before
finishing the diagnosis. It wasn't, and the premature note had to be rewritten (this file).

Mechanism: same root cause as the timeout. Under contention the page is slow, so Playwright's
`fill()` lands mid-hydration. On a *navigation* assertion that surfaces as a timeout; on a *form* it
surfaces as a mangled value. **One cause, two symptoms — the symptom depends on what the victim page
does, not on what is broken.**

## The proof, and the one-flag workaround

`npx playwright test --workers=1` on the same tree, same machine, same moment: **104/104 green**
(3.3m vs ~1.5m at the configured 4 workers). Four workers × Chromium, on a desktop that also has the
user's own browser open, is simply oversubscribed — the suite starves, pages hydrate late, and
whichever test happens to touch a slow page that run is the victim. Nothing is wrong with the code.

So: when a local full e2e fails a test your diff never touched, rerun with `--workers=1` before
anything else. Green at 1 worker + red at 4 = contention, full stop. (`playwright.config.ts` keeps
`workers: 4` deliberately for the single-writer SQLite harness — this is a local diagnostic flag, not
a config change to land.)

## The protocol that settles it (cost: one stashed run)

1. Rerun the spec alone. Passing alone ⇒ suspect the environment, but do not conclude yet.
2. **Run the full gate on a stashed / clean tree.** This is the step that pays for itself. If clean
   HEAD also fails — especially on a *different* test — the diff is exonerated and the machine is the
   problem. If clean HEAD is green and the working tree reproduces, it is yours: diagnose it.
3. Only then classify. Do not write the lesson before step 2.

## Standing guidance

- Do not run a full `VERIFY_E2E=1` gate concurrently with other heavy jobs (a critic subagent running
  its own `vitest`/`tsc`, a second verify). Contention is the trigger; serialize the gate.
- CI (GitHub Actions) remains the arbiter for e2e, per `ci-e2e-timing-flake.md`. A local
  one-random-test failure, on a tree whose typecheck/lint/unit/build are green and where clean HEAD
  fails the same way, is reported honestly as an environment flake — never laundered into a green
  claim, and never "fixed" by weakening the assertion.
- If a specific test ever fails twice with the SAME signature while clean HEAD passes, this note no
  longer applies: diagnose it as a real bug (for a corrupted form value, start from
  `mutation-form-recipe.md`).
