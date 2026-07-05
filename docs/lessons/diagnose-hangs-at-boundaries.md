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
