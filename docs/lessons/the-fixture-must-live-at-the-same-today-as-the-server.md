# The fixture must live at the same "today" as the server under test

The e2e server's clock is NOT the wall clock. `next start` loads `.env`, which
pins `DEMO_TODAY=2026-06-10`, and `businessToday()` gives the pin TOP
precedence for EVERY user — throwaway e2e accounts included (DECISIONS #58
precedence 1). The suite's own specs document this ("the e2e server pins
DEMO_TODAY=2026-06-10 for every user", "the compared month is May"), but the
fixed-setup spec seeded its fixture relative to the real clock anyway.

**What happened (measured, not theorized).** The fixture's intent was exact —
AUTO in-basis + convertible, GYM/INTERNET covered, $130.00, reconciles. A
direct engine probe of the seeded rows computed exactly that. The page —
computed by the server living at 2026-06-10, whose rollup window is
March/April/May — rendered $200.00 with every status covered and no lever.
The engine is deterministic and the rows immutable, so the probe and the page
could not both be "the current state"; three failed runs and several
forensics cycles were spent on stale-server, stale-build, and
different-DB-file hypotheses before the pin was even on the table.

**Why the divergence hides.** Determinism inverts the debugging sign: when the
same function gives two answers, the difference must be an INPUT — and the
hardest input to see is the one the code reads from the environment at
runtime. The probe (tsx, no .env loading) used the real clock; the server used
the pin. Same code, same rows, different `today` → different window → every
status flips. The correct instrument was reproducing the server's env
(`DEMO_TODAY=2026-06-10 npx tsx …`), which reproduced the page's numbers
exactly, to the cent.

**The rule.** Any fixture that seeds date-bearing rows for an e2e run must be
cut against the same "today" the server computes — for this suite, the pin,
hard-coded like every sibling spec's date assertions. A clock-relative fixture
and a pinned engine can never agree about which months the rollup window
holds, and the disagreement surfaces as a page that "renders different
numbers" with a clean engine probe. Related: [[proof-is-the-full-output]] —
read the whole failure list; this one needed the engine probe + the pinned
probe side by side.
