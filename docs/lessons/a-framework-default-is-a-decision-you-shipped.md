# A framework default is a decision you shipped — and unset security config is the easiest kind to never see

**Summary:** Aimplifi kept people signed in for **30 days** across browser-close and power-off, on any
shared or stolen machine, because `src/auth.config.ts` said `session: { strategy: 'jwt' }` and nothing
about `maxAge`. Nobody chose 30 days; Auth.js did, at `@auth/core/lib/init.js:38`. The owner found it
on his own laptop ("the password appears persistent despite shutting down computer — this is
dangerous"), not the test suite, not a critic, not a review — because there was nothing to *look* at.
Every other defect in this ledger is a line of code that says the wrong thing. This one was an absent
line.

## Why it was invisible

The usual review reflexes all miss it:

- **Reading the diff** cannot show it — the vulnerability was never in a diff.
- **Reading the file** shows `session: { strategy: 'jwt' }`, which looks deliberate and complete. The
  fact that a second key was available, security-bearing, and defaulted to a month is only in the
  dependency's source.
- **The tests passed**, because no test asserted anything about session lifetime. A missing assertion
  and a correct one look identical from the summary line.
- **The docs were silent**, so nothing claimed a lifetime that could be falsified. (Contrast
  `new-egress-means-auditing-every-live-claim.md`: there, live *claims* went stale and could be
  grepped. Here there was no claim.)

## The rule

**For any config object that governs authentication, sessions, cookies, CORS, rate limits, crypto, or
data retention, enumerate the keys the library supports and write down a value or a reason for each
one — including the ones you are happy to leave alone.** An unset key is a value; the only question is
whether you picked it. Write the reason next to the key, because "we deliberately don't set this" and
"we never knew about it" are indistinguishable from the outside — see the `updateAge` comment in
`auth.config.ts`, which exists so the next reader doesn't add a no-op.

## Read the dependency's source, and read it for MECHANISM

Choosing 30 minutes was only safe because three facts held, none of which is in the API docs and all of
which are in the installed source:

1. `@auth/core/lib/actions/session.js`, `jwt` branch — re-signs the token and re-sets the cookie's
   `expires` on **every** session read, unconditionally. This is what makes `maxAge` an *idle* timeout
   rather than a hard cap.
2. The same file consults `session.updateAge` **only** in the database-strategy branch — so under
   `jwt` it is a no-op, and setting it would have implied a refresh throttle that does not exist.
3. `next-auth/lib/index.js` `handleAuth` — copies the `Set-Cookie` headers from that read onto the
   response middleware returns ("Preserve cookies from the session response"), and our middleware
   matches every app route, so every page load rolls the window.

Without (1) and (3), a 30-minute `maxAge` would have signed people out mid-task and the change would
have been a worse defect than the one it fixed. The same reading also killed a feature before it was
started: a "remember this device" checkbox is **not** expressible through Auth.js cookie config,
because the callsite hardcodes `expires` and spreads it *over* the configured options. One read
answered "is my fix safe", "is this key real", and "is that follow-up cheap".

## Corollaries

- **The number belongs in one constant that the enforcement, the UI copy, and the test all read.**
  A cookie that expires in 30 minutes beside a page that says 60 is a new lie, and it is the kind that
  survives for months. Here: `SESSION_IDLE_TIMEOUT_SECONDS`.
- **Bound it in the test rather than pinning it.** `session-timeout.test.ts` asserts 5 min ≤ window ≤
  30 min, so a deliberate retune stays cheap but a drift back to days has to delete an assertion whose
  comment explains what it is protecting.
- **Check the test harness's exposure before choosing the number.** Playwright was surveyed first: no
  spec uses `storageState`, 60 s per-test budget — so no e2e could outlive the new window. Had a suite
  reused a saved session, a correct fix would have looked like a broken one.
- **The remaining friction is real and belongs in the ledger, not in a reassurance.** Idle 30 minutes
  mid-form still loses a draft; the mitigation is a pre-expiry warning, recorded as the follow-up
  rather than hand-waved.
