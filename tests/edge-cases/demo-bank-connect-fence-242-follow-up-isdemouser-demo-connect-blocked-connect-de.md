## §Demo bank-connect fence (#242 follow-up — `isDemoUser`/`DEMO_CONNECT_BLOCKED`, `connect-demo-fence.test.ts`)

The shared demo account is ONE row every anonymous visitor logs into, so it must never
ingest a real bank — one visitor's real data would be visible to the next. Fenced at every
ingest entrypoint, proven on a KEYED deployment (keys set, so the demo message is the only
possible refusal):

- `createPlaidLinkToken`, `linkPlaidAccount`, `connectSimplefin`, `syncSimplefinNow` all
  return `{ ok:false, error: DEMO_CONNECT_BLOCKED }` for `user-demo`, BEFORE any provider call
  (zero network) — so no PlaidItem / SimpleFinConnection row for demo can ever be created.
- The fence is demo-specific, not a global off-switch: a real user passes it and hits the
  normal path (the "not configured" refusal when keys are absent).
- `disconnectSimplefin` is intentionally NOT fenced — it removes data, never ingests, and is
  the remediation path for any pre-fence breach residual.
- Sync-path residual: the cron sweep excludes demo at the query (no sync, no `sync.cron` audit
  row); the Plaid webhook skips a demo-owned item — so even a connection created before the
  fence shipped stops ingesting.
- No-shame copy: "The demo is a shared account, so it can't connect a real bank — create your
  own free account to link securely."
- **Scope:** this covers the CONNECTED leg only. The typed/uploaded leg of the same rule
  (`addManualAccount`, `createManualTransaction`, `importTransactionsCsv`, `addHolding`) shipped
  as its own fence — see §Demo manual-entry fence below.
