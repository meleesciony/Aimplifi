# HOUSEHOLD_ARCHITECTURE.md — household mode decision doc + schema design (TASKS 4.1)

*Status: DESIGN APPROVED-PENDING-OWNER-REVIEW · 2026-07-10 · Fable 5 spike (DECISIONS #200).
Scope of this doc: architecture decision + schema design ONLY — no product code ships with it.
MVP implementation is TASKS 4.2, sliced at the end of this doc.*

*Hostile-critic cycle 1 (fresh-context, refute-by-default, 2026-07-10): **FAIL — 5 P1 / 5 P2
/ 1 P3**, all confirmed against source and **fixed in this revision**: (F1/F2/F7) the
deletion/departure lifecycle could not run promotion inside the array-form `$transaction`
and had no cascade path to reap `Household` → replaced with deterministic lazy repair at
read; (F3) widening `getCategoryMeta` would have contaminated coach/reports/trends/recurring
→ replaced with per-row display resolution; (F4/F6) invite acceptance leaned on an unverified
signup email and a dormant-by-default allowlist, and `session.user.email` is not a guaranteed
primitive → out-of-band invite code + DB-row email binding; (F5) joint cash-needed filtered a
full cross-user snapshot in memory → query-level `getSharedSnapshotSlice`; plus honesty fixes
(F8 scope-param claim, F9 today-guard framing, F10 #192 hard constraint, F11 wording).
Cycle-2 self-check against each finding: no open P0/P1.*

Grounding: audit Persona B + §2b #4 (`docs/STRATEGIC_AUDIT_2026-07-09.md`), owner decision
DECISIONS #196 (household green-lit, "sooner rather than later — authz retrofit cost only
grows"). Recon evidence: schema ownership topology, the 41-action / 22-fetcher authz
inventory, and the engine-surface map (this session, 2026-07-10).

---

## 1. Decision summary

Household is modeled as a **new entity with explicit membership and per-account, owner-consented,
read-only sharing** — not as a tenant layer. Three additive tables (`Household`,
`HouseholdMember`, `HouseholdInvite`) plus one additive Boolean on `Account`
(`sharedToHousehold`, default `false`). Every existing row keeps its single owner; every
existing query keeps its `userId` scope; **no existing write gains cross-user reach in v1**.
The only new read reach is through one central, unit-tested helper (`visibleAccountsWhere`)
that a member's queries use to see partners' *shared* accounts. Joint cash-needed is a pure
snapshot **merge** in the assembly layer — the Cash-Needed Engine itself is already pure over
accounts/statements/transactions and does not change. Dials, coach, budgets, goals, digest,
and all personalization stay per-partner. The demo user joins no household, so every golden
value and demo byte is untouched by construction.

Why this shape: the codebase's uniform ownership discipline (every query already scopes to
`userId` or `account: { userId }`) means the cheapest safe household is *additive visibility*,
not *re-tenanting*. Persona B's ask — "can Jen see it, and what do WE need by Friday" — is a
read-and-compose problem. Write-sharing (partner triage on shared accounts) is the genuinely
hard part (two teachers for one learning system) and is explicitly deferred with its design
risks recorded, so v1 ships the 80% without destabilizing categorization, learning, or authz.

## 2. Requirements (from the audit + owner decision)

1. **Partner logins** — the partner is a real `User` (own credentials, own session, own audit
   trail). The first real household is the two owner-allowlisted accounts.
2. **Scoped account sharing** — share the joint checking, keep the personal card private.
   Per-account, owner-consented, revocable.
3. **Joint cash-needed** — one household-scope answer to "how much do we need and when."
4. **Per-partner money dials** — dials, wage, SWR, retirement assumptions stay individual.
5. **Authz across every server action** — an explicit model stating, per surface, what (if
   anything) household changes; a single helper for the widened read path.
6. Standing constitution: additive schema only (demo/golden byte-identical), engine-first,
   no fabrication, coaching guardrails (assumptions inline; no cross-partner shame).

## 3. Options considered

**A. Tenant household (`householdId` on User; queries scope to household).** Rejected.
Blast radius is all 41 actions + 22 fetchers at once; sharing becomes all-or-nothing
(violates requirement 2 — Persona B explicitly keeps separate cards); personalization
(corrections, rules, predictions, dials) must stay per-user anyway, so every query grows a
two-key system; migration must backfill a household for every existing user. Maximum cost,
worse semantics.

**B. Pure per-account ACL (`AccountShare` grants, no household entity).** Rejected.
Gives scoped sharing but no "we": joint cash-needed, invitations, membership lifecycle, and
future household surfaces (joint digest) have no anchor. Pairwise grants also generalize
badly (N×M) and leave revocation-on-separation as N cleanup steps.

**C. Shared login (partner uses the same User).** Rejected outright. Destroys the audit
trail (`AuditLog.userId` lies), session-epoch revocation semantics, per-partner dials
(requirement 4), and per-partner learning; violates the invite/allowlist model.

**D. Household entity + membership + per-account opt-in sharing (CHOSEN).** Minimal additive
schema, exact Persona-B semantics, one central visibility helper, and a natural anchor for
every future household surface. Details below.

## 4. Chosen architecture

### 4.1 Concepts and core invariants

- A **Household** is a named group. A **User belongs to at most one household** (v1
  simplifier, enforced by `@@unique` on membership `userId`): no household picker in the UI,
  `requireViewer()` resolves 0-or-1 household, `visibleAccountsWhere` stays simple. Relaxing
  to multi-household later is additive (drop the unique, add a picker).
- **Membership roles:** `owner` (creator) and `partner`. Both are full members for
  visibility. Owner can remove members and revoke pending invites; anyone can leave.
- **Departure/deletion lifecycle is LAZY-REPAIR, not transactional choreography** (critic
  cycle 1, F1/F2/F7): the existing `deleteMyData` is deliberately an array-form
  `$transaction` (DECISIONS #46 — interactive transactions timed out under parallel SQLite)
  and `Household` has no FK path from `User`, so promotion/cleanup CANNOT ride the deletion
  transaction. Instead the invariant is *recompute-from-scratch at read* (the learn.ts /
  tuning.ts idiom): `requireViewer()` self-heals — if the resolved household has members but
  no `owner`, the member with the earliest `joinedAt` (tie-break: lowest `userId`) is
  promoted idempotently at read; a household with ZERO members is unreachable by
  construction (every query enters via membership) and is reaped opportunistically
  (best-effort delete in household actions, the `maybePruneExpired` idiom — never a cron
  dependency). `leaveHousehold`/`removeMember` still do their own bookkeeping inline
  (consent-reset + reap-if-empty), but correctness never depends on it: concurrent
  departures, crashes between steps, and account deletion all converge to a repaired state
  on the next read, deterministically. "No orphan rows" is thus replaced by the honest,
  testable claim: *an ownerless household is repaired at next read; a memberless household
  is unreachable and lazily reaped.*
- **Sharing is per-account, owner-only, opt-in, and read-only (v1):**
  `Account.sharedToHousehold = true` set only by the account's owner via a new action. A
  shared account is *visible* (balances, statements, transactions, its role in joint
  cash-needed) to fellow members. It is never *mutable* by them: every existing mutation
  keeps its `userId` ownership scope unchanged.
- **Visibility requires BOTH the flag and live membership.** The Boolean deliberately does
  not name a household: an account is shared "into the owner's current household."
  Membership ends → visibility ends instantly, with no cleanup step that can be forgotten
  (contrast a `sharedHouseholdId` column, which dangles when the owner leaves — rejected for
  exactly that integrity hazard).
- **Leaving resets consent:** `leaveHousehold` / `removeMember` / household deletion also
  set the departing member's `sharedToHousehold` flags back to `false` in the same
  transaction. Rejoining (or joining a different household) requires re-sharing each
  account explicitly. Privacy-first: consent never survives the relationship that granted it.
- **Credentials are never shared.** `PlaidItem` / `SimpleFinConnection` (encrypted tokens)
  stay owner-only; sync remains owner-driven; a partner sees synced *data* of shared
  accounts, never the connection.

### 4.2 Schema design (additive only — verbatim Prisma)

```prisma
model Household {
  id        String   @id @default(cuid())
  name      String   // display name, e.g. "Our household"
  createdAt DateTime @default(now())

  members HouseholdMember[]
  invites HouseholdInvite[]
}

model HouseholdMember {
  id          String   @id @default(cuid())
  householdId String
  userId      String   @unique // v1: at most one household per user
  role        String   // 'owner' | 'partner'
  joinedAt    DateTime @default(now())

  household Household @relation(fields: [householdId], references: [id], onDelete: Cascade)
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([householdId])
}

model HouseholdInvite {
  id          String   @id @default(cuid())
  householdId String
  email       String   // normalized (normalizeEmail), the invitee's sign-in email
  codeHash    String   // hash of the one-time redemption code (never the code itself at rest)
  invitedById String   // acting member's userId (plain string, no FK — survives inviter deletion like DeletionRecord)
  status      String   @default("pending") // 'pending' | 'accepted' | 'declined' | 'revoked'
  attempts    Int      @default(0) // failed redemption attempts (hard cap → revoked)
  createdAt   DateTime @default(now())
  expiresAt   DateTime // operational timestamp (not a business date) — lazy-expired at read

  household Household @relation(fields: [householdId], references: [id], onDelete: Cascade)

  @@unique([householdId, email])
  @@index([email])
}

// Account gains ONE additive column (precedent: User.lastSeenDate, #195):
//   sharedToHousehold Boolean @default(false)
// User gains ONE relation (no column): householdMembership HouseholdMember?
```

Notes: `expiresAt`/`joinedAt`/`createdAt` are operational timestamps like
`NotificationSent.sentAt` — the calendar-date discipline governs *business/money* dates and
is not violated. There is deliberately **no** `expired` stored status: expiry is computed at
read (`status === 'pending' && expiresAt < now` ⇒ treated as expired), so no cron and no
clock-skew writes. `@@unique([householdId, email])` makes re-inviting an upsert and caps
duplicates per (household, address) — an address can still hold pending invites from
different households simultaneously (harmless: accepting one leaves the others to lazy
expiry; the membership `@@unique(userId)` blocks a second accept). Role/status as `String`
with documented values matches the schema's SQLite convention (`Transaction.status`,
`AutopayConfig.mode`).

### 4.3 The authz model

Two new central helpers in `src/server/authz.ts` (the ONLY place visibility logic lives):

```ts
// Resolves the session to viewer identity + household context in one query.
requireViewer(): Promise<{
  userId: string
  household: null | { id: string; role: 'owner' | 'partner'; memberIds: string[] }
}>

// The single widened read scope. With no household (or no partners) it MUST
// degenerate to exactly { userId } semantics — unit-locked.
visibleAccountsWhere(viewer): Prisma.AccountWhereInput
// ≈ { OR: [ { userId: viewer.userId },
//           { sharedToHousehold: true, userId: { in: viewer.partnerIds } } ] }
```

Rules, in order of importance:

1. **No existing write changes.** All 41 existing actions keep `requireUserId()` +
   ownership `where` untouched. Household adds ~7 new actions (below), each with its own
   explicit rule. This is what keeps the retrofit small: the audit's fear ("touches authz on
   every server action") is answered by *not* granting writes, so no existing action's authz
   changes at all in v1. Honesty note (critic F8): one existing READ, `getCashNeeded`, gains
   an optional `scope` param — cross-user reach exists behind that param, its default is
   `'mine'`, every existing caller (dashboard, reminders cron, assistant, goals solver)
   passes no scope, and a unit test locks the default so no caller drifts to household scope
   silently.
2. **Widened reads go through `visibleAccountsWhere` only.** Hand-rolled `OR` clauses in
   fetchers are a review-rejectable defect. The helper is unit-tested (degeneracy, no-flag,
   no-membership, departed-member) and hostile-critic'd once, then reused.
3. **v1 widens exactly four read surfaces** (each an MVP slice): `/accounts` (a "Shared with
   you" section), `/transactions` (rows from shared accounts, read-only, owner-badged),
   `/cards` + `/calendar` (household-scope dues), and dashboard cash-needed (joint scope
   toggle). Everything else — coach, trends, reports, budgets, goals, recurring,
   spending-plan, forecast, investments, ask, return-moment, digest, notifications, export —
   **stays per-user in v1** (see 4.5).
4. **New actions and their authz:**
   - `createHousehold(name)` — any user with no membership.
   - `inviteToHousehold(email)` — members only (v1: both roles may invite; cheap to
     restrict later); durable rate-limited (reuse `rateLimitDurable`, e.g. 5/day/user);
     invite recorded by normalized email; expiry ~14 days.
   - `acceptInvite(inviteId, code)` / `declineInvite(inviteId)` — accept requires BOTH
     factors (critic F4/F6): (i) the one-time code, generated at invite time, shown ONCE to
     the inviter for out-of-band handoff, stored only as `codeHash`, redemption attempts
     durable-rate-limited and hard-capped via `attempts` (cap → status `revoked`); and
     (ii) the accepter's email — resolved from the **DB user row for the session's
     `userId`** (`prisma.user.findUnique(...).email`), never from session claims, because
     `session.user.email` is not a guaranteed primitive in this codebase and password
     signup does not verify email — equals the invite email. Invite pending and unexpired;
     accept fails loudly if the accepter already has a membership ("leave your current
     household first" — the `@@unique(userId)` makes this a constraint, not a convention).
     The signup allowlist is explicitly NOT part of this trust model (it is dormant when
     unset and weak under `@domain` entries): even an attacker who registers the invited
     email cannot accept without the code.
   - `revokeInvite(inviteId)` — owner.
   - `leaveHousehold()` — any member (triggers consent-reset + owner-promotion/cleanup
     transaction per 4.1).
   - `removeMember(userId)` — owner, not on self (self uses leave).
   - `setAccountShared(accountId, shared)` — the account's OWNER only
     (`where: { id, userId }`), and requires a live membership to set `true`.
   All audited via the existing `auditLog(userId, action, meta)` with `householdId` in meta.
5. **Invitation trust model:** two factors — possession of the out-of-band code plus a
   DB-resolved email match (see the action spec above). No invite tokens in URLs, nothing
   to leak or forward; the code is hashed at rest and attempt-capped. Deliberately NOT
   trusted: the signup allowlist (dormant by default) and `session.user.email` (not
   guaranteed to be set).
6. **Sessions/revocation:** membership is evaluated per request against the DB
   (`requireViewer`), so removal/leave takes effect on the next query with no JWT
   invalidation needed. `sessionEpoch` semantics are untouched.
7. **Export stays own-data-only.** `/api/export` never includes a partner's rows, shared or
   not — your export is your data. (A household export is a v2 decision.)
8. **`deleteMyData` needs NO household logic in its transaction** (critic F1): the member
   row cascades with the User (existing array-form `$transaction` untouched — DECISIONS
   #46's SQLite constraint respected), and everything else is the lazy-repair invariant
   from §4.1: an ownerless household self-heals at next read; a memberless one is
   unreachable and lazily reaped. A best-effort share-flag reset MAY run before the delete
   (it's redundant — the flags become inert without membership — but keeps rows tidy).
   `DeletionRecord` stays PII-free and unchanged. A departed partner's data was never
   copied anywhere — visibility simply ends.

### 4.4 Joint cash-needed (the money surface)

- **The engine does not change.** `computeCashNeeded` is already pure over an assembled
  `CashNeededInput`; it has no user concept (recon-verified).
- **Scope parameter at the assembly layer:** `getCashNeeded(userId, scenario, scope)` where
  `scope: 'mine' | 'household'`. `'mine'` is byte-identical to today. `'household'`
  composes: the viewer's own snapshot (unchanged path) **plus a dedicated
  `getSharedSnapshotSlice(partnerId, viewer)` per partner whose every query carries the
  share predicate in its `where`** — accounts via
  `{ userId: partnerId, sharedToHousehold: true }`, and statements / transactions /
  scheduled / balance snapshots via `{ account: { userId: partnerId, sharedToHousehold:
  true } }`. This is a deliberate rejection of fetch-full-snapshot-then-filter (critic F5):
  the confidentiality boundary must be the query scope — the same defense class as every
  existing surface — so a partner's unshared rows **never enter process memory**, rather
  than depending on one in-memory filter remembering every dependent table. The slices are
  merged by a pure, unit-tested `mergeSnapshots()` (accounts/statements/transactions/
  scheduled are disjoint-by-account unions). The merge asserts equal `today` across inputs
  and fails loudly — today this is nearly vacuous (both partners' `businessToday` is the
  same server clock; only a request straddling midnight differs), so it is documented as a
  drift guard for future per-user-timezone work, not a present safety property. Honest
  footnote: household "today" is therefore the *server's* civil date, exactly as each
  partner's own view already is. No `DataProvider` interface change.
- **Payment account stays the viewer's own** (`paymentAccountId` is a per-user dial). The
  household answer is "cash needed across the household's shared cards, funded from *your*
  designated account." A true joint funding model (split contributions) is v2.
- **Assumptions stated inline (guardrail):** the joint answer carries copy equivalent to
  "Household scope: includes your accounts and accounts your partner has shared.
  Anything not shared isn't counted." The joint number must never silently imply
  completeness — a partner's private card debt is invisible by design, and the copy says so.
- **Attribution honesty:** a shared account's transactions display the *owner* badge (the
  account has one owner). True swipe-level attribution on a jointly-used card is
  impossible from provider data and is not claimed anywhere (no fabrication).
- This is a money-display surface: the joint-scope slice ends with a **Fable hostile-critic
  pass** (TASKS 4.2 routing), with hand-verified merge fixtures in `docs/EDGE_CASES.md`
  (two-partner union, overlap-impossible-by-construction proof, dedup-guard interaction
  with #192's cross-provider duplicate detector — a shared account seen via the partner
  must NOT trip the duplicate-accounts warning). On #192 specifically, a HARD implementation
  constraint (critic F10): the detector's input set is the viewer's OWNED accounts
  (`transactions.ts` builds it from `where: { userId }`) and must stay that way — the
  /accounts "Shared with you" section must be a **separate query path**, never a widening of
  `getAccountsView`'s account set, or a joint checking visible via both partners would trip
  a false duplicate warning. Locked by a unit asserting the detector input equals the owned
  set even for a household viewer (T9).

### 4.5 What stays personal in v1 — the relational-shame fix

The audit's relational failure mode ("the coach flags Jen's deliberate dial-up spending to
Dave") is fixed by **scope, not copy**: coach / Money Review / creep / life-energy / trends /
reports / budgets / goals / recurring / spending-plan / FI / forecast / investments / Ask /
return-moment / digest / push all remain computed over the viewer's OWN accounts and OWN
dials in v1. Nobody is ever coached about a partner's spending. Dials remain per-User fields
(requirement 4 satisfied by *not* moving them). Cron sweeps remain per-user; no household
digest in v1. Corrections, rules, predictions, tuning, hidden/custom categories: per-user,
untouched.

One deliberate consequence to document in UI copy: partner-shared accounts appear in the
joint cash-needed answer and the shared sections, but NOT in the viewer's reports/coach.
That asymmetry is the feature, not a bug — analysis is personal, obligations are shared.

Cross-cutting detail for the register slice: category *names* on shared rows must resolve
against the owner's category set (a shared transaction may be filed to the owner's custom
category, which the viewer's `getCategoryMeta(userId)` doesn't contain). **`getCategoryMeta`
itself must NOT be widened** (critic F3): it is the shared resolver behind coach, reports,
trends, recurring, and triage — union-ing member categories into it would leak the partner's
category *vocabulary* (including names used only on private transactions) into every surface
this section just promised stays personal. Instead, the register's shared-row assembly
resolves names via a dedicated lookup scoped to exactly the `categoryId`s that appear on
shared-account rows (`where: { id: { in: sharedRowCategoryIds } }`, name/group only). The
viewer thus sees only the labels that are inherently part of the shared data itself; pickers
and mutations keep the viewer's own set; `getCategoryMeta` and its six callers are untouched.

### 4.6 Threat model and privacy invariants (each becomes a locking test in 4.2)

| # | Invariant | Locking test (future) |
|---|-----------|----------------------|
| T1 | A member never sees a partner's UNSHARED account (any surface, any fetcher) | integration: partner with 1 shared + 1 private account → private absent from accounts/transactions/cards/calendar/joint cash-needed |
| T2 | A non-member never sees anything (flag set but membership absent/ended) | unit on `visibleAccountsWhere` + integration after `leaveHousehold` |
| T3 | No existing mutation can touch a partner's rows | grep-lock: every `*-actions.ts` mutation keeps `userId` scope; integration: partner attempting mutation on shared account → not found |
| T4 | Leaving/removal ends visibility immediately AND resets the departed member's share flags | integration: leave → flags false, queries empty |
| T5 | Credentials never cross: no Plaid/SimpleFIN token, connection row, or sync control is reachable for a partner's account | code-review lock + integration on /accounts connection sections |
| T6 | Demo/golden untouched: demo user has no membership; all new tables empty; `'mine'` scope byte-identical | existing full golden e2e suite + a `visibleAccountsWhere` degeneracy unit |
| T7 | Invite cannot be accepted by anyone but the addressed, signed-in email; expired/revoked invites inert | unit (lazy expiry) + integration (wrong-email accept fails) |
| T8 | Export contains only the exporter's own rows | extend existing export test with a household fixture |
| T9 | Joint answer never counts an account twice (self-share, both-partners-share-same-real-bank via different providers); #192 detector input stays the owned set for a household viewer | merge unit: disjoint-by-account-id proof + detector-input-set unit |
| T10 | After `deleteMyData` no partner retains any visibility into the deleted user's data, and the survivor's next read resolves a coherent household (repaired or reaped) | extend existing deletion integration test with a household fixture |
| T11 | Lazy repair is deterministic and idempotent: an ownerless household promotes exactly the earliest-joined member (tie-break lowest userId) on every concurrent read; a memberless household is invisible everywhere | pure membership-engine units + a concurrent-read integration probe |
| T12 | Invite redemption requires code possession: correct email + wrong/missing code always fails; attempts cap revokes; the plaintext code exists nowhere at rest | unit on the redemption gate + schema review (codeHash only) |

Abuse controls: invite creation rate-limited (durable), `@@unique([householdId, email])`
caps duplicates, expiry lazy-enforced. Enumeration: `acceptInvite` reveals nothing about
other households (lookup is by invite id + session email match).

### 4.7 Golden/demo safety and migration

- Migration is `prisma db push`-portable: 3 new tables + 1 Boolean column with
  `@default(false)`. No existing row changes value; no backfill required at all (contrast
  Option A's household-per-user backfill).
- Demo user: never seeded into a household; seed script untouched; all goldens
  byte-identical. Every new query path degenerates to today's exact semantics when
  membership is null — enforced by the T6 degeneracy unit, not by hope.
- Rollout: schema can land with the first MVP slice (membership CRUD) while every visible
  surface is still personal — the flag exists but nothing reads it until slice 2+. Each
  slice independently verify-green.

## 5. MVP slice plan (feeds TASKS 4.2 — each slice one session, engine-first, verify green)

1. **Membership core** — schema push; pure membership engine
   (`engine/household/membership.ts`: invite validation incl. lazy expiry + code-redemption
   gate, role rules, and the lazy-repair decisions — promotion pick, reap eligibility — as
   pure functions); `requireViewer()` with self-heal; the 7 actions (accept = code +
   DB-row-email binding); /settings "Household" section (create, invite showing the
   one-time code, accept via code entry, leave, remove). Opus build; **Fable critic on the
   membership/authz state machine** (T2, T4, T7, T10, T11, T12).
2. **`visibleAccountsWhere` + /accounts shared section** — the central helper + degeneracy
   units; read-only "Shared with you" account cards (balances, owner badge) as a SEPARATE
   query path from `getAccountsView` (the #192 constraint). (T1, T2, T6, T9-detector.)
3. **Shared transactions in the register** — read-only rows, owner badge, no triage
   affordances on partner rows; shared-row category names via the scoped-ids lookup, never
   a `getCategoryMeta` widening. (T1, T3.)
4. **Joint cash-needed** — `getSharedSnapshotSlice` (share predicate in every query) + pure
   `mergeSnapshots()` with hand-verified EDGE_CASES fixtures; dashboard scope toggle;
   assumptions copy. **Fable hostile critic (money surface).** (T9 + full pass.)
5. **Cards/calendar household scope + copy audit** — dues across shared cards; guardrail
   scan of all new household copy. Sonnet-lane.
6. **Full-surface hostile critic** — fresh-context Fable pass over T1–T10 with the
   integration fixtures in place; REGRESSION_LEDGER entries for anything found.

## 6. Open owner questions (none block slices 1–3)

1. **Partner triage (v2 fork):** should a partner eventually be able to categorize
   transactions on a shared account? V1 says no (two-teachers problem: whose corrections
   train whose rules; predictions are `transactionId @unique` per one user). If yes later,
   the recorded design direction is: corrections stay attributed to the acting user;
   ingest-time rule application stays owner-only; display prefers owner filing.
2. **Household digest:** per-partner digests (v1, already true) or one joint email
   covering shared accounts? Affects Vercel-Pro cron budget not at all (same sweep), but
   needs joint-copy guardrails.
3. **Naming/copy:** "Household" vs "Partner"/"Family" in UI copy (pure copy decision).

## 7. Explicitly deferred (v2+), with the reason

- Partner writes / shared triage (two-teachers learning problem — question 1).
- Multi-household membership (drop the `userId` unique + picker UI; additive later).
- Joint funding model for cash-needed (split "who pays" across two payment accounts).
- Household-scope coach/reports/goals (per-partner is the shame-guardrail default; any
  joint analysis surface needs its own copy design).
- Child/read-only roles beyond `partner` (role column is a string; additive).
- Household data export.
