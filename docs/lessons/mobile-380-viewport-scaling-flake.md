# mobile-380 Playwright project: viewport-scaling e2e flake (this machine)

> **CORRECTION 2026-07-09 (#193):** the recurring "full `VERIFY_E2E=1` can't exit 0 on
> this machine" reported across #183/#186/#187 was NOT this flake — it was a DETERMINISTIC
> failure hiding behind this lesson's name. #182 added a "Sign out of all devices" button
> (`revoke-sessions-submit`) on /settings whose accessible name contains "Sign out";
> `auth.spec.ts` ends its nav loop on /settings then clicked a bare
> `getByRole('button', {name:'Sign out'})` → strict-mode violation (2 elements), every run.
> Fixed by scoping to `getByTestId('sign-out-form')` (REGRESSION_LEDGER 2026-07-09). After
> the fix, the full suite (93 tests) went green and `VERIFY_E2E=1 bash scripts/verify.sh`
> exited 0 for the first time — across THREE full runs this session the viewport-interception
> flake below did **not** reproduce (0 `intercepts pointer events` failures). Likely defused
> by the #187 mobile-nav redesign (the failing clicks were on nav elements it restructured)
> and/or Playwright 1.60.0. The lesson is KEPT (not deleted) because intermittent flakes can
> recur and the diagnostic method is still valuable — but the standing assumption should now be
> "full e2e exits 0 here." **Do NOT reflexively blame a red `mobile-380` gate on this flake:**
> read the actual error signature first — `intercepts pointer events` is this flake; anything
> else (strict-mode, assertion, timeout on a non-nav element) is a real bug. That reflex is
> exactly what masked the auth regression for three sessions.

> **CORRECTION 2026-07-27 (O.2):** two claims in this file are falsified by measurement.
>
> **(1) `intercepts pointer events` is NOT a reliable signature of this flake.** The correction above tells
> the reader that this signature IS the environment artifact and "anything else is a real bug". A failure
> carrying exactly that signature — `transactions.spec.ts:357`, the #136 lock — was a real, deterministic,
> in-app geometry collision: it reproduced at `--workers=1` on a quiet machine and disappeared the moment one
> line was removed from the filter bar. The register's category menu is an `absolute z-50` overlay up to 288px
> tall (about four rows) whose open direction is chosen one-shot from `chipRect.top > window.innerHeight *
> 0.55`, so a spec clicking a row ADJACENT to the open menu is a hostage to the page's scroll position, and
> therefore to everything rendered above the register. The correct reflex is neither "flake" nor "real bug"
> from the signature alone — it is to PROBE: print the two boxes and ask `document.elementFromPoint` what is
> actually on top. One throwaway spec settled in a single run what a session of argument had not, and it
> falsified BOTH standing hypotheses (the prior session's "the menu covers the next row", and mine that the
> panel was in normal flow pushing rows down — it displaces nothing).
>
> **(2) The ~425×895 scaling claim did not hold on this machine on this date.** The probe printed
> `window.innerWidth/innerHeight` = **380/800** with `scrollY` 0 — the configured viewport exactly, no
> scale-up. So `0.55 * innerHeight` is **440**, not the ~492 the 425×895 figure implies. Whatever produced the
> original 11.8% mismatch is not present now. Do not carry those numbers into geometry arithmetic: measure
> `innerHeight` in the run you are debugging, because the whole lesson of this episode is that the geometry is
> knife-edge and a stale constant points you at the wrong side of the threshold.

**One-line summary:** on this Windows dev machine, the `mobile-380` Playwright project
(`devices['Pixel 5']` + `viewport: {width:380, height:800}`) actually renders at ~425×895 CSS
px — an ~11.8% mismatch — which makes clicks on the fixed bottom-nav bar and other
edge-of-viewport elements land on the wrong content; it is an environment artifact, not an
app bug, and reproduces identically on a clean `git stash` of any pending diff.

## Symptom

`VERIFY_E2E=1 bash scripts/verify.sh` (or a raw `npx playwright test`) intermittently-but-
reproducibly fails the SAME small set of `[mobile-380]` tests every run — always ones that
click a `bottom-nav-*` testid (or another element near a viewport edge) shortly after
navigating to `/dashboard`:

- `auth.spec.ts` — sign-up → onboarding → **sign out** (blocked on the Sign-out button)
- `phase2-triage.spec.ts` — clicking `bottom-nav-triage`
- `phase3-coach.spec.ts` — clicking `bottom-nav-coach`
- `phase4-features.spec.ts` — clicking `bottom-nav-calendar`
- `phase5-a11y.spec.ts` — a keyboard-only cash-needed assertion

Playwright's error always reads `<something> subtree intercepts pointer events`, naming an
unrelated card (e.g. the Cash Flow Radar card's description) or nav link as the blocker, and
the retry loop exhausts the full 60s timeout without ever resolving — this is NOT a one-frame
animation race (a race would clear within a few retries).

## Root cause (confirmed via a throwaway diagnostic spec, since deleted)

```js
const viewport = page.viewportSize();          // {width: 380, height: 800}  <- what Playwright thinks
const doc = await page.evaluate(() => ({ innerWidth: window.innerWidth, innerHeight: window.innerHeight }));
// {innerWidth: 425, innerHeight: 895}          <- what the page actually renders at
```

380×800 → 425×895 is a uniform ~1.118× scale-up. The app's CSS is not at fault: the fixed
bottom nav bar's `boundingBox()` correctly sits flush with the REAL viewport bottom (y+height
== innerHeight == 895), so `position: fixed; bottom: 0` is doing exactly the right thing
relative to what the browser actually rendered. The bug is that Playwright's own click-time
actionability/interception check does not consistently agree with that same real geometry —
whether because of the device-scale-factor 2.75 (`devices['Pixel 5']`) interacting with this
machine's OS-level display scaling, or a Chromium/Playwright version quirk on Windows, wasn't
pinned down further (out of scope to chase — see below).

## How this was confirmed as pre-existing / not-a-regression

`git stash` any pending diff, rerun the exact same failing spec files against a clean
`main` HEAD → the SAME tests fail with the SAME interception pattern. This is now the
standard control before blaming a diff for a `mobile-380`-only failure: stash, rerun, compare
the failing-test list. Reducing `--workers` (4 → 2 → 1) does **not** clear it, ruling out
parallel-worker resource contention as the cause.

## What to do when you hit this again

1. Don't assume your diff caused it — run the git-stash A/B control above first.
2. If the failing-test set matches this list (or is clearly the same bottom-nav-click shape),
   treat it as this known environment issue: report the real `tsc`/`eslint`/`vitest`/`build`
   state plus the honest e2e count, name this lesson file, and move on — don't burn a session
   trying to make `scripts/verify.sh` exit 0 by fighting Chromium's viewport emulation.
3. Actually fixing it (e.g. dropping `devices['Pixel 5']`'s `deviceScaleFactor`, or pinning a
   Chromium version, or investigating this machine's Windows display-scaling setting) is a
   real fix someone should eventually do, but it's a Playwright/environment investigation, not
   an app change — scope it as its own task rather than folding it into an unrelated feature
   or backlog session.
