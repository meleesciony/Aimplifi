## §Coach copy guardrails

`coach-copy.test.ts` asserts: no banned phrases (e.g., "you wasted", "stop buying",
"guilty", "shame", "you should have"), and every projection string matches
`/assum(es|ing|ptions)/i` or renders with an attached assumptions component.
Every function-valued `COACH_COPY` key has an `ALL_STRINGS` row (W.8; the
`KNOWN_UNSCANNED` pin is empty).
