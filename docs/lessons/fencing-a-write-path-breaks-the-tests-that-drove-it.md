# Fencing a shared-demo write path breaks every e2e that drove it as demo — sweep tests in the SAME slice

**One-line:** When you fence a write path against the shared demo user (#243 connect, #244
manual entry), grep the e2e suite for specs that sign in as demo and drive that path BEFORE
declaring done — `scripts/verify.sh` skips Playwright by default (`VERIFY_E2E=1`), so a "verify
green" claim can honestly ship five red e2e tests the next runner discovers.

## What happened (2026-07-16, #244)

The four manual-entry demo fences shipped verify-green with a passing unit lock, but the
cycle-1 hostile critic ran the Playwright suite and found five transactions.spec tests failing:
each signed in via `demo-sign-in` and created data through the newly fenced actions (manual
asset, cash transaction, recat/write-in setup rows, CSV import). The fix was the existing
manual-card-statement.spec pattern: a THROWAWAY signup user per data-creating spec (also better
isolation — no demo-golden perturbation), plus a new spec asserting the fence's own refusal UX.

## The rule

1. A demo fence's definition of done includes: `grep -l "demo-sign-in" tests/e2e | xargs grep -l
   <fenced action's UI path>` and migrating or reworking every hit in the same slice.
2. Data-CREATING e2e specs should default to throwaway signup users regardless (the #166/#39
   isolation lesson); the shared demo user is for READ-ONLY golden assertions and for testing
   the fences themselves.
3. If the phase's DoD requires an e2e, "verify green" without `VERIFY_E2E=1` does not prove it —
   run the affected spec files explicitly and paste the output.
4. **A DELIBERATE behaviour change leaves stale expectations too, and a flake can hide them.**
   Same gap, different cause (2026-07-24, found during L.8): #305 changed /accounts from rendering
   NOTHING when it cannot combine two connections to rendering a card that says WHY. That is the
   intended new contract — but `duplicate-connections.spec.ts` still asserted
   `combine-connections-card` count 0, so `main` sat red. It shipped because verify.sh skips
   Playwright, and it stayed invisible because the SAME spec also hits the documented #287
   whole-page DOM duplication under load: the flake fires first, the run is written off as "the
   known flake", and a real stale expectation rides along underneath. #305's own session did the
   right thing — a stashed clean-tree run — and still mis-scoped it, because that run reproduced
   *a* failure and stopped there.
   The move: read the ERROR SIGNATURE of every failure, not just the test name. Two failures in
   one spec can have two different causes. Serialize (`--workers=1`) to strip the load-induced
   one, and whatever still fails deterministically is yours. Fix a stale expectation by asserting
   the NEW intended contract on the thing a user would actually reach (here: the
   `combine-connections-confirm` ACTION, not the presence of the explanation) — never by deleting
   the assertion.
5. **Rebuild before you run them.** `playwright.config.ts` starts the app with `npx next start`
   and `reuseExistingServer` locally, so a spec run serves the LAST `next build` — your edits are
   invisible to it. Bit #257 once and #260 again: both times a brand-new assertion failed against
   a stale bundle and read exactly like a real product bug (a click that "didn't work", an element
   that "isn't there"). Run `npx next build` first, or just run the whole gate with
   `VERIFY_E2E=1 bash scripts/verify.sh`, which builds before it tests. A first-run failure on
   code you JUST wrote is a stale-bundle suspect before it is a bug.
