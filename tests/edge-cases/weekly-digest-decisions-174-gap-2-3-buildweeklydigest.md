## §Weekly Digest (DECISIONS #174 — Gap 2 §3, `buildWeeklyDigest`)

Pure composition over `getCoachData().review` (the Money Review) + `selectPaymentReminders` (7-day
dues); no number is computed here. today = `2026-06-10`; pinned in `tests/unit/digest.test.ts`.

### A. Composition
- Review + dues ⇒ subject `Your week with Aimplifi`; body contains `review.improvement`,
  `review.creep`, `review.nextAction` **verbatim** and each due rendered by the SHARED `reminderLine`
  (byte-identical to the reminder email), plus "…never moves your money".
- Review + NO dues ⇒ "Nothing due in the next 7 days — a clear week ahead." (no `•` bullets).
- NO review + dues ⇒ still sends (dues only; no savings-rate lines).
- NO review + NO dues ⇒ **null** (a brand-new user with no history and nothing due gets no digest).
- An estimated due carries `[estimated]` (same `reminderLine`).

### B. Week-key dedup (cron, `tests/unit/cron-digest.test.ts`)
- Key = `weekly_digest:<Monday>` where Monday = `addDays(today, -((dayOfWeek(today)+6)%7))`;
  dayOfWeek 0=Sun..6=Sat ⇒ Mon→−0, Sun→−6, Sat→−5, every weekday lands on the ISO Monday.
- Dormant (no RESEND) ⇒ digest composed, **nothing sent, nothing recorded** (activation later still
  delivers). A real send records the week key ONCE; a second run the same week is skipped
  (`already-sent-this-week`), no duplicate email.

### C. First-week user — no "Infinity" (critic #174 P2-1)
A user with a checking account but zero transactions ⇒ empty flows ⇒ `monthsOfRunway(_,0) = Infinity`.
`COACH_COPY.runway(Infinity)` and `reviewImprovementRunway(Infinity)` render the "runway fills in as
spending is tracked" line, NOT the literal "Infinity months" — so neither /coach nor the emailed
digest ever shows it.
