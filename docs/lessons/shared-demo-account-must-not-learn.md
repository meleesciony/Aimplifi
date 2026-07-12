# The demo account is one shared row — anything that learns from a user's INPUT must fence it off

**Summary:** the one-click demo login is credential-free, so every anonymous visitor signs in as the
SAME `user-demo` row. Any feature that stores what a user *typed* and later shows it back is therefore
showing one stranger's words to the next. Read-only demo *data* is safe to share; a demo visitor's own
*input* is not.

## Where it has bitten

- **#210 (household):** a demo membership would have handed every anonymous visitor a seat in a real
  user's household. Fenced off at every entry point (create / accept / be invited).
- **#226 (learned vocabulary):** the weekly miner would have learned the demo user's repeated Ask
  phrasings — free text a visitor typed about their own life — and rendered them on the next visitor's
  Settings → AI trust panel, under copy that says "Nothing here is shared with anyone else." Caught by a
  fresh-context critic, not by any test: every unit test used a synthetic user, and the demo path only
  differs by *who* the row belongs to.

Two instances make a rule. Expect a third.

## The test that catches it

Ask of any new feature: **does it persist something the user authored, and render it back?** (A learned
phrase, a household seat, a saved note, a custom label, a search history.) If yes, the shared demo
account must be excluded — and excluded at *every* path (write, read, list, cron), not just one, so no
single call site is load-bearing.

```ts
function learningDisabled(userId: string): boolean {
  return userId === DEMO_USER_ID;   // mine, serve, AND list
}
```

## Two traps in the fix itself

1. **PII scrubbing is not anonymization.** `scrubQuestionText` masks emails, amounts and digits. It does
   NOT mask names, employers, clinics, or lawyers — "can melissa and i afford ivf at boston fertility"
   passes through completely unchanged. A scrubbed string is still the user's own sentence. Never reason
   "it's scrubbed, so it's safe to pool or display."
2. **`DEMO_USER_ID` lived in `auth.config.ts`, which imports NextAuth.** Importing it into a
   Prisma-only server module would have dragged Auth.js into the cron import graph (the #220 rule). It now
   lives in `src/lib/demo-user.ts` and `auth.config.ts` re-exports it — every existing import is unchanged.
   When a constant needs to be known by both the auth layer and a cron-safe module, put it in neither: put
   it in a leaf module they both import.
