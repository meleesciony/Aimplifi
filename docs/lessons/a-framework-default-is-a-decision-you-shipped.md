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

## Extended #527 — remember-me is a JWT claim, not a cookie-config key

The same session.js read that made 30 minutes safe also said a "remember this device"
checkbox is not expressible through Auth.js cookie config: `expires` is hardcoded from
the single `session.maxAge`. That is still true. The opt-in (#527) does not fight that
callsite. `maxAge` is the 30-day ceiling (cookie `Expires` and JWT `exp` for every
session, including demo/Google). The default 30-minute window is `applySessionLifetime`
in the edge jwt callback, which returns `null` when a token without `remember: true`
has been idle past 30 minutes. Auth.js then runs `sessionStore.clean()` (verified
at `@auth/core/lib/actions/session.js`: `if (token !== null)` re-issues; `else`
clears). Granting the ceiling without that callback would be shipping the original
30-day default again.

## Extended W.13 — a column `@default` is the same defect, one layer down, and it leaves no evidence

An absent config key is a value you shipped. So is `Int @default(700)`. The database default is the
**worse** of the two, because it does not merely sit there being unread — it writes itself into
every row it touches, and from then on it is indistinguishable from an answer.

`User.expectedReturnBps` was `Int @default(700)`, **not nullable**, with a `required` pre-filled
/settings field. Six sentences across three cards therefore called 7.00% **"your return
assumption"**, and the wealth card said it outright — *"7.00% return is your setting; 2.50%
inflation is Aimplifi's default, which you haven't changed"* — one sentence attributing one dial
honestly and the other falsely, live on the demo, shipped alongside four consecutive slices whose
entire subject was that a possessive is a claim. The honest dial was honest for one reason: its
column is **nullable**, so "the reader never set this" was a fact the code could read. Nothing made
the two dials different except which shape someone reached for the day each was added.

- **Where no column records the choice, attribute by VALUE — and claim only what the equality
  proves.** `bps === DEFAULT_EXPECTED_RETURN_BPS` proves *this IS our default and IS the rate in
  use*. It does not prove *you have not changed it*, so that clause was **removed** rather than
  re-pointed at a different subject. A sentence carrying both dials has nowhere to hang a clause
  that is true of only one of them without the reader attaching it to both.
- **Adding the nullable column is the answer that feels right and is worth nothing.** Every row
  already in the database holds the default, so the new meaning would describe **none** of them —
  including the owner's, which is the row that reported the bug. Naming the direction each option
  errs in decided it in one paragraph: value-equality's single reachable error (a reader who
  deliberately typed 7 is told 7.00% is our default) *under-credits* them, where the shipped
  behaviour *invented a decision they never made*.
- **Pin a known imprecision, or the next session "fixes" it.** The trade-off above is a test with a
  comment, not a note in a doc — otherwise it reads as a bug to whoever finds it next.
- **Two adjacent positional booleans are a silent swap.** `boolean` is not distinguishable from
  `boolean` to tsc, and swapping these two puts each dial's possessive on the other dial's rate —
  the same defect with the operands exchanged. One named object (`DialOwnership`) makes the swap
  unspellable and makes tsc enumerate the call sites.
- **Assert the constant against the schema.** If the `@default` moves and the constant does not,
  every reader on the new default is told it is theirs, and both halves typecheck perfectly. The
  parity test reads `prisma/schema.prisma` and also fails if the column becomes nullable — at which
  point value-equality is the wrong rule and should stop being used.
- **A fixture's ownership flags are part of its reachability.** My own scan table paired inflation
  at 1000 with `inflationIsDefault: true` — impossible, the fallback IS 250 — directly under a
  comment I had just written claiming every row's rate agreed with its flags. A scan row pinning a
  sentence production can never print certifies nothing, and the confident comment is the tell.
- **The loop closes at the page the copy points at.** The inflation possessive was only defensible
  because /settings called the same 2.50% "our defaults". The return field said nothing of the kind,
  so it now does — a claim about provenance is only as good as the surface it defers to.
