# Never guess — verify or say you're unsure; and write every user instruction for a first-timer

**One-line hook:** A live Plaid env-var + password-reset support session went badly because
of abbreviated, guessed-at instructions and unverified diagnoses — the fix is behavioral
(now in CLAUDE.md rule 0) plus the concrete Plaid/env facts below, verified from source.

## What went wrong (the incident)

Helping the owner configure Plaid on Vercel and debug the reset flow, the assistant: gave
shorthand "go to settings and change it" steps that assumed knowledge the user didn't have;
described Vercel/Plaid screens it had never seen; and asserted causes ("probably X")
without pulling the real error. The user deleted and re-entered env variables by hand,
`PLAID_ENV` ended up mismatched with the pasted secret, and enabling `DATA_PROVIDER=plaid`
with not-yet-working production creds crashed the deployed app into its error boundary.
Behavioral rules are in **CLAUDE.md → Non-negotiable operating rules → rule 0**. Keep the
technical facts here so the next session doesn't re-derive them.

## Plaid env config — verified from source

Names the code reads (case-sensitive): `DATA_PROVIDER`, `PLAID_CLIENT_ID`, `PLAID_SECRET`,
`PLAID_ENV`, `DATA_ENCRYPTION_KEY`.

- `src/lib/providers/demo.ts` → `getProvider()` returns `DemoProvider` unless
  `DATA_PROVIDER=plaid`, and **throws** if `DATA_PROVIDER=plaid` but `PLAID_CLIENT_ID`
  or `PLAID_SECRET` is missing. So flipping `DATA_PROVIDER=plaid` makes every page that
  loads financial data depend on live Plaid working — a bad/unapproved prod cred there
  surfaces as a full-page "Something went wrong" crash, not a Plaid-screen error.
  Fastest recovery = set `DATA_PROVIDER=demo` and redeploy (reversible; doesn't touch auth).
- `src/lib/providers/plaid.ts` → `plaidEnv()` maps `PLAID_ENV` to a host: `sandbox` →
  `https://sandbox.plaid.com`, `production` → `https://production.plaid.com`; unset defaults
  to `sandbox`.

### `INVALID_API_KEYS` from `/link/token/create` = env↔secret mismatch

There is ONE `PLAID_SECRET` field. You store the secret matching `PLAID_ENV`, never both:
`sandbox`→Sandbox secret, `production`→Production secret. Switching environments means
EDITING those two existing fields in place, not adding new ones. A production secret sent
to the sandbox host (or the reverse) returns `INVALID_API_KEYS`. Other causes of the same
error: a secret with the wrong format (an `sk_live_…` value is a **Stripe** key, not Plaid —
Plaid secrets have no prefix), stray quotes/whitespace, or `PLAID_CLIENT_ID`/`PLAID_SECRET`
swapped. Real bank linking on `production` also needs Plaid to have **approved the account
for Production access** — no env value substitutes for that approval.

### Vercel operational facts (verified against the owner's project)

- Env vars marked **Sensitive** cannot be revealed; non-sensitive ones (`PLAID_ENV`,
  `PLAID_CLIENT_ID`) show their value via the eye icon.
- **Saving an env var does nothing to the running site — you must redeploy** (Deployments →
  top row → ··· → Redeploy) for the change to take effect.

## Reset flow (context for the crash — the reset code itself was not the bug)

`src/server/password-reset-actions.ts` returns error state and wraps audit writes in
try/catch, so a crash during the reset walk points at the environment/deploy (here, the
`DATA_PROVIDER=plaid` provider throw), not the reset logic. Confirm the crashing route
(the browser URL on the error page) before blaming a layer.

## Open UX gap noted during the incident

Password inputs (`src/components/auth/reset-password-form.tsx` and the sign-in form) have
**no show/hide reveal button** — standard UX, still missing. Add it when next in that code.
