# Diagnose hangs by probing boundaries, not by correlating with load

**One-line:** A hang that "roams with machine load" invites blaming the storage/infra layer; only
paired probes at each boundary (client send / response headers / body finished × server entry / exit ×
page render) can say WHICH segment hung — and in the 2026-07-05 triage-stall case they acquitted every
suspect (SQLite, live LLM keys) and convicted an unexpected one (React transition-lane entanglement
after Next aborted a superseded action's response stream).

Why it mattered here: two sessions of controlled A/B runs (tree × solo/sequence) had proven the
phase2-triage stall pre-existing and load-correlated, and the conclusion pattern-matched to the
repo's documented SQLite write-stall flake. Both fixes suggested by that theory (busy_timeout — already
present; hermetic LLM keys — good hygiene anyway) left the stall reproducing 4/4. Twenty minutes of
temporary `TEMP-STALL-PROBE` console.log lines (client `page.on('request'/'response'/'requestfinished'/
'requestfailed')` in the spec + entry/exit logs in the two server actions + `stdout: 'pipe'` on the
Playwright webServer) produced a timeline that settled it in one failing run: action committed in ~5ms,
response stream even FINISHED, yet `useTransition.pending` never cleared.

Corollary learned the same session: an always-failing test MASKS every defect behind its failure
point. The moment the stall was fixed, two deterministic test-ordering bugs surfaced that had been
invisible for weeks as "did not run". After fixing a chronic blocker, re-run everything downstream of
it before declaring the tail healthy.

**2026-07-05 (#166) — confirmed and extended twice in one session:**
1. The same action-application race turned out to be app-wide, not triage-specific: budgets/goals
   mutations committed server-side while the page stayed stale ~50% of plain-paced probe runs — on
   BOTH Next 15.5.19 and 16.2.10, with and without the service worker, prefetch storm, or device
   emulation. Each of those suspects was convicted by correlation and acquitted by a controlled A/B;
   the durable fix was making confirmation structurally unable to lie (own busy flag + withDeadline +
   full reload), not curing the layer-of-the-day.
2. **E2E-green is not health.** The 75/75 suite passed for months over this defect because
   Pixel-5-paced specs outran the race; plain-paced probes (and real users) lost it half the time.
   The prior "load-correlated e2e flakes" (#16/#17, phase4:13) were this bug wearing an
   environment costume — the SECOND time this repo pattern-matched a real product defect to
   "environment flake". A flake that only bites at human pacing is a race, and it is shipping.
3. Probe-protocol hygiene is part of the diagnosis: mid-investigation I reseeded the DB under a live
   server and left residue between probe runs, which manufactured an "alternating" failure pattern
   that sent an hour into a service-worker rabbit hole. Reset state cold between A/B runs, or the
   experiment lies.
