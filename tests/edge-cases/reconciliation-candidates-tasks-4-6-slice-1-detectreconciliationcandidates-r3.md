## §Reconciliation Candidates (TASKS 4.6 slice 1 — `detectReconciliationCandidates`, R3)

The pure directional layer over the #192 detector: it turns a suspected duplicate pair into a
predecessor→successor *candidate* using each row's live-connection state. Advisory only — this
slice mutates nothing (schema, assembler boundary, and UI are slices 2–5).

**Direction rule (R3, spec §8).** A candidate exists only when **exactly one** side has a live
provider connection: that side is the `successor` (its live balance will continue the account),
the other the `predecessor` (goes historical). Both ambiguous cases yield **no** candidate:

- Both sides LIVE → a genuine active duplicate; never auto-linked. `detectReconciliationCandidates`
  returns `[]` while `detectDuplicateAccounts` still returns the pair (the advisory warning stays).
- Both sides DEAD → no live row to continue into → `[]` (advisory still fires).

**Payload.** `matchSignal` ∈ {`mask`,`balance`,`name`} is the strongest #192 signal that fired
(priority mask > balance > name), derived from the same booleans that build `reasons` — never
re-parsed. The canonical Plaid↔SimpleFIN pair matches on **name** (medium), because SimpleFIN
carries no last-4; a mask candidate needs both sides to carry an equal last-4 (e.g. plaid+manual).

**Liveness is an INPUT.** The engine stays pure; the caller (slices 2/5) derives `hasLiveConnection`
from the connection rows (`SimpleFinConnection`/`PlaidItem` presence). A never-synced **manual** row
is not live and is therefore predecessor-eligible against a live Plaid row for the same account.
Direction is decided by liveness, **not** input array order (regression-locked). Demo/seed rows are
excluded upstream (#192 `EXCLUDED_PROVIDERS`) and are never proposed.
