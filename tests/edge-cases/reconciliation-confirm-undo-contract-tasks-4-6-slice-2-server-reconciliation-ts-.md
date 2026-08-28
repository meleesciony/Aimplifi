## §Reconciliation confirm/undo contract (TASKS 4.6 slice 2 — `server/reconciliation.ts`, R7/R9/R10)

The link-table mutation. No money figure changes here (the balance-exclusion + date-split is the
assembler, slice 3); this slice records the user's confirmed decision and locks the ACTION contract.

**Direction re-checked at confirm time (R3 boundary).** The detector proposes a direction, but the
confirm action re-derives liveness inside the transaction and refuses any direction that isn't
predecessor=stale / successor=live: `!isAccountLive(successor)` → "nothing live to reconcile to";
`isAccountLive(predecessor)` (⇒ both live) → "disconnect the old one first". This is the money guard —
zeroing a still-live balance (slice 3) on a wrong direction would fabricate a net worth. `isAccountLive`
is the SAME helper the slice-5 caller feeds the detector (one derivation, cannot disagree).

**Cutover bounds.** `cutoverDate` must be a valid `isoDate`, **≤ today**, and **≥ the predecessor's
first transaction date** (a cutover before the first row would strand pre-cutover history nothing owns).
The half-open ownership split (`predecessor ≤ cutover`, `successor > cutover`) is tested in slice 3.

**Idempotent + reversible (R9).** Confirm is an **upsert on `predecessorAccountId @unique`**: re-confirming
(including after an undo) updates the one row and clears `undoneAt` — same row id, never a duplicate, no
unique crash. Undo sets `undoneAt` (row kept, inert); undoing an already-inert link is a no-op not-found
(`where: undoneAt: null`). Round-trip: confirm → `getActiveReconciliations` has it → undo → empty → re-confirm → active again.

**Authz (R10) + inert-on-delete (R7).** Every account id is re-resolved `where: { id, userId }` inside the
tx (a foreign id is an indistinguishable "Account not found."); undo is scoped `where: { id, userId }`. No
FK to `Account` is declared, so deleting an underlying account leaves the link row intact — the assembler
ignores the dangling ref (proven in slice 3). The demo user is fenced in the core (defense in depth; demo
rows are never proposed anyway).
