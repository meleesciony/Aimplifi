# A driver-parsed timestamp is not the stored value — and it nearly shipped a false P0

**One line:** every `DateTime` column in this schema is Postgres `timestamp without time zone`, which
node-pg re-interprets as the *client's local* zone, so a probe run from a UTC−4 machine reads every
production timestamp **four hours late** — enough to move a sync from "35 minutes before the deploy"
to "3 hours after it" and turn a working fix into a fabricated P0.

## What happened

L.26 shipped the re-key that makes a re-linked account's bills reach the money, and was verified
deployed (`vercel inspect` → the newest production deployment is aliased to `www.aimplifi.app`, and
its build log reads `2026-07-27T02:12:53.113Z Cloning … Commit: 17fed6f`). The owner's
`ScheduledTransaction` table was still empty afterwards, so the session set out to find out why.

Reading `AuditLog` through node-pg, the last app-triggered Plaid sync appeared to be
`2026-07-27T05:37:46.641Z` — comfortably **after** the 02:12 UTC deploy. Every `syncLiabilities`
caller runs `syncTransactions` immediately before it, and `syncTransactions` ends by calling
`refreshRecurringForUser` (`plaid.ts:1508`) inside a bare `catch {}`. The chain looked airtight:
the fixed code had run twice in production and written nothing, and the swallowing catch explained
the silence. That is a P0, and it was wrong.

The tell was a query that disagreed with itself: `where "createdAt" > timestamp '2026-07-27 02:12:52'`
returned **zero rows** while an unfiltered listing of the same table showed rows stamped `05:37`.
Both readings cannot be true. Asking Postgres for the raw text instead of the driver's object
settled it:

```sql
select pg_typeof("createdAt")::text, "createdAt"::text from "AuditLog" order by "createdAt" desc
-- timestamp without time zone | 2026-07-27 01:37:46.641
```

The stored value is `01:37 UTC`. The driver had added four hours. The last sync ran **35 minutes
before the deploy**, no sync has run since, and L.26 has simply never executed in production — the
inert-until-a-sync state its own STATUS OPEN #2 predicted. Replaying the deployed function against
the production database confirmed the code is right: 21 series detected, 20 re-keyed, **8 scheduled
rows** computed, and a rolled-back write proved all four statements commit cleanly.

## Rules

1. **Probe timestamps as text, never as driver objects.** `select "createdAt"::text` costs nothing
   and is the only reading that is the stored value. A `Date` printed with a `Z` is a claim by the
   client library about a column that carries no zone, not a fact from the database.
2. **A comparison that disagrees with a listing of the same table is a measurement bug, not data.**
   The instinct is to fix the WHERE clause and move on; the disagreement is the evidence. Stop and
   ask which of the two readings is the artifact before spending it on a diagnosis.
3. **Anchor to a timestamp that carries its own zone.** Vercel's build log (`…T02:12:53.113Z`) and
   `now()::text` (`…+00`) are unambiguous; correlate against those, never between two naive columns.
4. **Prefer a stamp the app itself wrote in its own vocabulary.** `PlaidItem.lastSyncedAt` is a
   `YYYY-MM-DD` string written by `businessToday()`; no parser sits between it and the truth. Where a
   probe has the choice, read the string column.
5. **The same shift is in every earlier probe.** This repo's `DateTime` columns are all naive. Any
   past session's production reading taken through node-pg from a US machine is off by the local
   offset, in the direction that makes events look *later* than they were.

## Corollary — the deploy/sync gap is real, and it is not a defect

"Deployed" and "in effect" are different states for anything computed at ingest. `ScheduledTransaction`
refills only when `refreshRecurringForUser` runs, which happens on the nightly `/api/cron/sync`
(`0 11 * * *`, observed firing at 11:4x UTC) or on a full page load via `AutoSync` → `syncPlaidNow`
(15-minute throttle) — the irregular sync bursts at 19:21, 20:07, 23:52 and 01:37 UTC are the owner
opening the app. So the correct claim after shipping a detection fix is not "the number moved", and
not "the user must wait for the cron" either: it is *the number moves on his next sync, whichever
comes first*. Verify it there, and say which event you are waiting for.

## Extended O.12e (2026-07-29) — the instrument can be blind to the very rung it is measuring

The same disease, one layer over: a replay probe called the shipped per-row suggestion ladder to count how
many inbox rows already carry a suggestion, and passed `providerCategoryId: null` for every row — because
`TriageGroup['rows']` is a `Pick` that DROPS that column, and `tsx` does not type-check. The provider rung
was therefore untestable by construction, and the probe reported **9** where the answer was **21** (12 of
the missing ones being an entire group whose premise in the task queue was "can never be categorized").

Three transferable rules:

1. **A measurement is only as wide as the fields it can see.** Before believing a replay, ask which inputs
   of the thing under test you actually supplied, and which you defaulted to null/absent. A defaulted input
   silently converts "this rung found nothing" into "this rung was never asked".
2. **Run the probe through the type checker.** `next build`'s `tsc` pass caught this in a file that had
   already RUN successfully and produced numbers written into three documents. Probes live in the repo and
   the repo has a type gate — use it before quoting the output, not after.
3. **A biased number presented as exact is worse than no number**, because it gets copied into task rows
   and scopes the next slice. The first figure had already been written into TASKS, PROGRESS and a commit
   message before the gate caught it; all three needed correcting.

Corollary from the same session, different instrument: **verify the reported EXAMPLE, not just the reported
problem.** The owner asked for keyword rules because `tjmaxx 0181 0966` "always changes" — and executing the
shipped normalizer showed both of his descriptors already resolve to the known merchant `Tjmaxx` and
auto-file correctly. The capability gap was real; his example was not an instance of it. The genuine
instance was two rows down his own screenshot (`Tst*mirko Pasta Buckhead` vs `MIRKO PASTA` → two canonicals,
two categories, two review states), and it became the locking test. Building on the unverified example would
have shipped a feature whose regression test could not fail.
