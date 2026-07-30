# A retry is not a second click — ask what the form does AFTER the failure

O.14b, the owner's *"it sometimes says wrong pw, I click it again, it works"*, survived four
sessions of hypotheses. What finally moved it was not a better theory about authentication. It was
noticing that the sentence describing the bug contained a claim nobody had checked.

## The claim inside the report

"I click it again, it works" was read, every session, as *the same bytes succeeded on the second
submit*. That reading is what made the bug look impossible: `verifyPassword` is scrypt over a
per-password salt with no pepper, no env var and no clock — deterministic in (plain, stored). A
retry succeeding with the same input cannot happen. So every session went looking for the
non-determinism, and there wasn't any.

One Playwright assertion killed the reading. React resets an uncontrolled `<form action>` once the
action returns, so a rejection **empties both fields** — and with `required` on the email, a literal
second click cannot even submit. The retry was therefore always a *fresh fill*, on a phone that
means re-invoking the password manager, and the real question had never been "why did the same bytes
verify the second time" but **"why did fill #1 and fill #2 deliver different bytes"**. Different
question, different candidate list, and every previous session's search space was malformed.

The transferable rule: when a report says "and then it works", establish **what the user actually
did the second time** before theorising about why it differed. Re-entry, a re-render, a reset, a
redirect and a cache miss are all hiding inside the word "again". Measure the widget, not the
backend.

## Corollaries from the same slice

**An error message is evidence only if the branches produce different messages.** Blocking on "the
EXACT sentence he sees" looked like pedantry and was the highest-value question available: "Invalid
email or password." and "Enter your email and password." come from different branches, and the one
he saw proved the password field arrived NON-EMPTY — which retired, in one word, every "the value
got cleared" mechanism, including the reveal toggle's submit-time `type` flip that had been the
leading suspect for two sessions. Copy that collapses several facts into one sentence is not just a
reader defect; it destroys your own instrumentation.

**A discriminator's job is to leave a DECIDABLE remainder, not to be minimal.** The v1 enum
(`no-user` | `bad-hash`) was correctly PII-free and it worked — `bad-hash` proved the address
arrived exactly as stored — and it immediately raised a question it could not answer: *how* were the
bytes wrong. Whitespace, a mis-filled email and a stale vault entry have three different fix sites.
Ship the next split with the fix, or the next occurrence costs another round trip through the owner.

**`next start` is not `next build`.** `playwright.config.ts` runs `npx next start -p 3100`, so the
e2e suite serves whatever is already in `.next`. Two runs this session measured stale code, and one
of them reported a *correct* fix as failing; the probe attribute reading `null` instead of its own
fallback string was the tell that the bundle predated the source. Build before you attribute an e2e
result to a source change. (The pre-change measurement survived only because measuring the OLD
behaviour was the point — which is luck, not method.)

**Restoring what the user typed is a diagnostic act, not only a courtesy.** A form that empties
itself on rejection forces a full re-entry, and re-entry is exactly where this defect lives. Echoing
the email back through the action state and restoring it via `defaultValue` — which is what React's
reset restores TO — removes half of the re-entry and one trip through the suspect. The password is
deliberately not echoed back.
