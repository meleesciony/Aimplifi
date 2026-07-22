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
4. **Rebuild before you run them.** `playwright.config.ts` starts the app with `npx next start`
   and `reuseExistingServer` locally, so a spec run serves the LAST `next build` — your edits are
   invisible to it. Bit #257 once and #260 again: both times a brand-new assertion failed against
   a stale bundle and read exactly like a real product bug (a click that "didn't work", an element
   that "isn't there"). Run `npx next build` first, or just run the whole gate with
   `VERIFY_E2E=1 bash scripts/verify.sh`, which builds before it tests. A first-run failure on
   code you JUST wrote is a stale-bundle suspect before it is a bug.
