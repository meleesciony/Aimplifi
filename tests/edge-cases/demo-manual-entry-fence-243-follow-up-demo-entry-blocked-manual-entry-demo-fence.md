## §Demo manual-entry fence (#243 follow-up — `DEMO_ENTRY_BLOCKED`, `manual-entry-demo-fence.test.ts`)

The typed/uploaded leg of the same shared-account rule: a demo visitor typing their REAL
figures (a house value, a payroll deposit, a pasted bank statement, a brokerage position)
into `user-demo` would show them to the next visitor. Owner confirmed the scope 2026-07-16:
the demo is read-only for visitor-BROUGHT data; playing with the seeded (fake) data stays open.

- `addManualAccount`, `createManualTransaction`, `importTransactionsCsv`, `addHolding` return
  their typed failure shape carrying `DEMO_ENTRY_BLOCKED` for `user-demo`, immediately after
  `requireUserId()` — before any DB lookup, DB write, or provider call (the typed descriptor
  never reaches the categorize LLM, on any deployment; proven with a fetch spy on a KEYED env).
- Load-bearing closure of the update/delete paths: the seed creates no `provider='manual'`
  accounts, so with `add` fenced, `ownedManualAccount` (which requires `provider === 'manual'`)
  can never match a demo-owned row — `updateManualAccountValue`/`deleteManualAccount` are
  unreachable for demo by construction.
- Deliberately NOT fenced: `removeHolding` and the manual delete paths (remove data, never
  ingest — remediation, like `disconnectSimplefin`); edits to SEEDED rows (recategorize,
  review) — that data is fake and exploring it is the demo's purpose.
- The fence is demo-specific: a real user passes it and hits the normal validation path.
- No-shame copy: "The demo is a shared account, so anything you add here would be visible to
  other visitors — create your own free account to enter your own data."
- **Destroy fence (#244 critic P1-3):** `deleteMyData` and `revokeOtherSessions` throw
  `DEMO_DESTROY_BLOCKED` for demo (one visitor must not wipe the shared demo or sign every
  concurrent visitor out); the settings UI renders honest shared-account notes instead of the
  controls. Locked by `demo-destroy-fence.test.ts` + `account-deletion.spec.ts`.
- **Owner-accepted residual (2026-07-16 — do NOT read this section as "demo is fully
  read-only"):** goals (free-text name + target figures), custom category names, money dials
  (incl. hourly wage), budget amounts, and scrubbed Ask-question capture remain open for demo —
  accepted to keep the demo explorable. The honest invariant: bank connections, manual/CSV/
  holding entry, and account destruction are fenced; playful feature input is not.
