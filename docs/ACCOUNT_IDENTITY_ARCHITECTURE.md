# Account identity — telling "two accounts that look alike" from "one account pulled twice"

> **Status: DESIGN (not built).** Authored 2026-07-24 from an owner instruction. Every code fact
> below was read this session and carries a `file:line`; every Plaid fact was fetched from
> plaid.com/docs this session and is marked. Nothing here has run against a live Plaid connection.
> Build queue: `TASKS.md` L.10. Supersedes nothing — it sits *upstream* of
> `docs/PROVIDER_RECONCILIATION_ARCHITECTURE.md`, which stays the answer for the cases this
> design deliberately cannot prove.

## 1. The owner's distinction, which is the right one

Two situations produce two rows that look alike, and they are not the same problem:

**(A) Two real accounts that resemble each other.** A husband and wife hold cards on the same
issuer with different numbers. Three Chase cards all named `CREDIT CARD`. A Roth IRA and a
Traditional IRA at Schwab. These are separate accounts and **both rows must exist**. The app's
job is to make them *tellable apart* — last-4 on every surface (#298), a user-supplied nickname
(L.7), an ordinal when nothing else differs (#297).

**(B) One real account pulled twice.** The user ran Plaid Link a second time on a bank they
already had — to fix a broken connection, or to add one newly-opened account and tapped *select
all*. **No new rows should exist.** This is a refresh.

Today the app answers both with the same mechanism: write everything the feed returns, then
*detect* the collision afterwards and print an advisory. That is the correct mechanism for (A)
and the wrong one for (B) — because in (B) the app can know the answer, and knowing it, should
never have created the second copy at all.

**The design principle: prevention where identity is provable, disclosure where it is not.**

## 2. Why the current code cannot tell them apart

Verified this session:

| Fact | Evidence |
|---|---|
| A Plaid account row is keyed on `(userId, provider, providerRef)`, where `providerRef` is Plaid's `account_id`. | `src/lib/providers/plaid.ts:356-358` |
| Plaid's `account_id` is **not stable across Items** — a deleted/replaced access token yields different `account_id`s. | plaid.com/docs/api/accounts (fetched 2026-07-24) |
| `PlaidItem` upserts on `itemId`, and a fresh Link session at the same bank returns a **new** `item_id`. | `src/lib/providers/plaid.ts:277-290` |
| Therefore: same real card, second Link session ⇒ new item ⇒ new `account_id` ⇒ **a brand-new Account row, by construction.** | the two rows above, composed |
| The app stores an institution **name** (best-effort, cosmetic) and no institution **id**. | `prisma/schema.prisma` `PlaidItem.institution`; `plaid.ts:268-273` |
| There is no `subtype` column, so a Roth and a Traditional IRA are both just `INVESTMENT`. | `prisma/schema.prisma` `Account.type` |
| Detection of the resulting pair is advisory only, and deliberately so. | `duplicates.ts:226-229`, `AccountReconciliation` model comment ("Always user-confirmed (never automatic)") |
| A merge is only ever *proposed* when exactly one side is dead (R3), so a both-live re-link has **no remedy at all** except deleting a row and its history. | `duplicates.ts:369-395`; L.6 |

So (B) is not a heuristic failure. It is structural: the app has no identifier that survives a
re-link, and no notion that "this bank is already connected."

## 3. The three Plaid facts that make a better design possible

All fetched from plaid.com/docs on 2026-07-24.

1. **`persistent_account_id`** — "a unique and persistent identifier ... to trace multiple
   instances of the same account across different Items." Stable across Items and access tokens.
   **Limited**: only institutions using Tokenized Account Numbers (Chase, PNC, US Bank), and
   documented *for depository accounts*. Useful where present; **never** the whole answer. (The
   owner's Chase *credit card* most likely gets nothing from it — his Chase *checking* would.)
2. **Plaid's own duplicate-detection recommendation**: compare `institution_id` + account `name`
   + account `mask`. With the explicit warning: never match a mask against an account number.
3. **Link update mode** — `/link/token/create` with the existing `access_token`, plus
   `update.account_selection_enabled: true`, lets the user add newly-available accounts **to the
   existing Item**. The `access_token` does not change and previously-selected accounts keep
   their `account_id`s. Plaid's stated remedy for exactly this situation: *use update mode to
   refresh the Item instead of creating a new one.* (Not available in the UK/EU — there the
   documented path is remove-and-relink.)

Point 3 is the important one. It converts case (B) from a detection problem into a routing
problem, and the app's existing upsert already handles the result correctly: same `account_id`
returns ⇒ `plaid.ts:356-368` takes the **update** branch ⇒ that *is* a refresh.

For reference, Quicken Simplifi solves this in the UI rather than the protocol: at link time each
discovered account offers *link to an existing account* / *add as new* / *ignore*, and its help
centre's remedy for a duplicate is to delete the row — which it warns is permanent and destroys
history ([Resolving Duplicate Accounts](https://support.simplifi.quicken.com/en/articles/5281170-resolving-duplicate-accounts),
[Adding Accounts](https://support.simplifi.quicken.com/en/articles/4295304-adding-accounts-in-quicken-simplifi)).
We can do better than that on both halves: prevent the duplicate, and never make history the price of fixing one.

## 4. The design — four layers, strongest first

### Layer 1 — Route by intent (prevention; the bulk of the value)

/accounts grows two distinct entry points instead of one:

* **Connect a new bank** — today's flow, unchanged.
* **Add or fix accounts at this bank** — per existing connection. Opens Link in **update mode**
  on that Item with `update.account_selection_enabled: true`.

The owner's third scenario ("a new account within a bank, I run Plaid again and select all")
becomes structurally incapable of duplicating: every already-linked account comes back with its
existing `account_id` and takes the update branch; the genuinely new account is the only new row.
No heuristic runs. No reconciliation link is created. Nothing to disclose, because nothing
changed shape.

This is also the repair path for a broken connection, which is what update mode is *for* — so it
replaces the current implicit advice of "link it again," which is what manufactures duplicates.

Extension point is clean: `createLinkToken` already delegates to a pure, unit-tested
`linkTokenParams(userId, redirectUri)` (`plaid.ts:246-254`), so update mode is an argument, not a
rewrite.

### Layer 2 — Collision interception (backstop for the fresh-Link path)

If the user goes through **Connect a new bank** anyway and picks a bank they already have,
intercept immediately after the token exchange and **before any account row is written**:

1. Resolve the new Item's `institution_id` (`/item/get`); persist it.
2. Find the user's other live Items at the same `institution_id`. None ⇒ normal path, done.
3. Compare the new Item's accounts against that Item's accounts using the identity ladder (§5).
4. Branch:
   * **At least one proven match** ⇒ this is a re-pull. `/item/remove` the just-created Item,
     write nothing, and hand the user an update-mode token for the Item they already have:
     *"You already have Chase connected. We'll refresh it and add anything new — no second
     copy."* With an escape: *"Actually, this is a different login — keep both."*
   * **No proven match** ⇒ genuinely a different login at the same bank (personal vs business).
     Keep both Items. Record the institution id on both. Say nothing.

The result is an invariant worth stating: **a user never ends a link flow with two live Items
whose account sets overlap.** Case (B) stops existing rather than getting detected.

Note what this branch deliberately does *not* do: it does not create rows and then merge them.
Merging would mean replaying the new Item's full transaction history under new
`transaction_id`s — the app dedupes transactions per `(accountId, providerRef)`, so a replay
double-posts every transaction, and the alternative (fuzzy amount/date dedup) was already
examined and rejected in the reconciliation work because its failure direction is *silent loss*.
Discarding the redundant Item costs the user one extra pass through Link and costs the data
nothing.

### Layer 3 — A real remedy for the duplicates that already exist

Layers 1 and 2 prevent new duplicates; they do not fix the owner's current Chase `····0977`
pair. For a both-live suspected duplicate the detector already finds, offer **"These are the
same account — combine them"**: disconnect the losing connection (the user's explicit choice,
defaulting to whichever synced least recently / carries a `lastSyncError`), then create the
reconciliation link through the shipped `confirmReconciliation` path.

R3 is honoured, not weakened — the losing side is genuinely stale by the time confirm runs — and
`confirmedByUserAt` stays honest, because the user did confirm. History, corrections and
categories survive on the predecessor row exactly as the boundary engine already guarantees.

This closes the gap L.6 recorded and L.8 inherits: today the *only* remedy the app can offer a
both-live duplicate is "delete the row," which is what Simplifi tells people to do and what
destroys their history.

### Layer 4 — Advisory, unchanged

Everything the ladder cannot prove stays exactly where it is: `#192`'s advisory card, dismissible,
figures never silently adjusted. Cross-provider (SimpleFIN ↔ Plaid) remains user-confirmed
forever — L.9 proved a last-4 is not comparable across providers, and nothing here changes that.

## 5. The identity ladder

Used **only within one provider and one institution**. Ordered; first hit wins.

| Tier | Rule | Verdict |
|---|---|---|
| **P** | `persistent_account_id` present on both sides and equal | **proven same account** |
| **A** | `mask` present on both and equal, **and** `type` equal, **and** `subtype` equal, **and** `currency` equal | **proven same account** |
| **V** | `mask` **present on both** and different — or `type` differs — or `subtype` **present on both** and different — or `currency` differs | **proven different** (veto; overrides everything) |
| — | anything else (mask absent on either side; names merely similar; balances merely equal) | **not proven** → Layer 4 advisory |

Three lines this ladder draws on purpose:

* **Mask inequality is a veto here and only here.** Within one provider at one institution both
  masks come from the same convention, so a difference means different accounts — this is what
  protects the husband-and-wife case from ever being auto-refreshed away. Across providers it is
  *not* a veto: SimpleFIN's `396` and Plaid's `5351` are the same Schwab account (owner-confirmed,
  L.9). Same comparison, opposite meaning, depending on the pair — so it must be scoped, not shared.
* **Equal balances never authorise an automatic action.** The existing detector rightly treats an
  identical non-zero balance as high confidence *for an advisory* — two cards on one account share
  one balance (`duplicates.ts:190-196`, the owner's E.LEE/M.LEE pair). But "one account, two
  cards" is a fact only the cardholder knows, so it may prompt and must never act.
* **Differing subtype vetoes.** This is the missing signal that makes a Roth propose against a
  Traditional (L.9). It needs a column.

* **A null is UNKNOWN, never "differs" — decided 2026-07-24, after slice 1.** Every veto in
  tier V requires a value on *both* sides; one side missing means the tier simply does not
  fire, and the pair falls through to Layer 4's advisory. A slice-1 critic showed why this has
  to be written down rather than settled inside slice 3: the rows most likely to carry a null
  are the stale sides of duplicates that already exist, so reading null as "differs" would veto
  exactly the pairs the feature is for, while reading it as a match would prove pairs nothing
  supports. Neither is a match nor a veto — it is an absence, and an absence is not evidence
  (the same rule as `docs/lessons/an-empty-set-is-not-a-fact-about-money.md`).

## 6. Schema additions (all nullable and additive; demo byte-identical)

* `PlaidItem.institutionId String?` — Plaid's stable `ins_*` id. Required by Layer 2; the app
  stores only a cosmetic name today. Backfill through the existing `syncInstitutions` sweep.
* `Account.subtype String?` — the provider's raw subtype (`checking`, `credit card`, `roth`,
  `traditional`). Serves tier A/V here **and** answers L.9's open decision (a).
* `Account.persistentAccountId String?` — tier P where the institution supports it.

No change to `AccountReconciliation`. Nothing in this design creates a link automatically, so its
"always user-confirmed" comment stays true.

## 7. Invariants to lock

| # | Invariant |
|---|---|
| D1 | After any successful link flow, no user has two live Items at one institution with an overlapping account set. **Held by construction since 2026-07-24 (TASKS L.17b):** the decision runs under a `PlaidLinkClaim` lease unique on `(userId, institutionId)`, because until then two concurrent Link sessions both read zero connections and both persisted — the invariant was enforced only by sequence. Still not absolute: a link whose institution never resolves takes no lease, and the lease fails open after 4s rather than timing out an exchange (see DECISIONS #299). |
| D2 | An account returned with a known `(provider, providerRef)` updates in place and never creates a row. |
| D3 | Mask inequality vetoes a match within one provider+institution, and never vetoes across providers. |
| D4 | Balance equality never triggers an automatic action — advisory or prompt only. |
| D5 | Differing `subtype` vetoes a match (Roth never matches Traditional). |
| D6 | Layer 2 writes no Account row before the collision decision is made. |
| D7 | Every collision prompt carries a "different login — keep both" escape, and choosing it is remembered. **AMENDED 2026-07-24 when layer 2 shipped — read D7a; the original is NOT what was built.** |
| D7a | **What layer 2 actually ships, and why.** There is no prompt: the exchange decides and acts in one server round-trip, so the escape is structural instead. A connection is discarded ONLY when every account it can reach is one the user already reaches through another connection *that answered over the wire in the same request* — so a different login carrying anything of its own is kept automatically, without asking. Two cases the original D7 covered and this does not: a second login whose account set is **entirely** shared (a spouse who sees only the joint account), and a tier-A collision where two genuinely different accounts share last-4, type, subtype and currency at one bank. Both end in a discarded connection with no prompt; both are recoverable — disconnect the kept connection and link again, which the flash names — and both leave an orphaned Account row behind. The residual (a real prompt with a remembered "keep both") is **TASKS L.16**. Recorded rather than dropped: an irreversible action shipped without the confirmation this invariant asked for, and that is a deliberate, argued trade, not an oversight. |
| D8 | `demo` and `manual` rows are never subject to any of this. |
| D9 | Every automatic refresh states what happened; no structural change is silent. |

## 8. Slices

1. **Schema + capture** — the three columns, written by the account mapper, `institutionId`
   backfilled by the institution sweep. No behaviour change. *(Opus)* — **BUILT 2026-07-24
   (#300, DECISIONS #292).** Identity is also captured at DISCONNECT, which a critic showed is
   the last moment those rows are ever reachable. `subtype` is written unconditionally (it is
   what `type` is derived from); `persistentAccountId` is preserve-on-null.
2. **Update mode** — `linkTokenParams` gains the update-mode arguments; per-connection "Add or fix
   accounts" on /accounts. This is Layer 1, and it is most of the value. *(Opus)* — **BUILT
   2026-07-24 (#301, DECISIONS #293).** Three fresh-context critics; 2 P0 + 6 P1 all fixed and
   locked. Known residual, deliberately deferred: account selection can DESELECT an account, and
   the app does not prune a row whose feed stops returning it — TASKS L.14.
3. **Identity ladder + collision interception** — pure engine module, then the `exchangePublicToken`
   branch and the prompt. Money-visible structure ⇒ *(Fable build)* — **LADDER BUILT 2026-07-24
   (#304, DECISIONS #297)**: `src/lib/engine/account/identity.ts`, with three rules added under
   critic pressure — it abstains when only ONE side carries an `ins_*` id (falling back to a human
   name that distinct banks share would match an identified row against an unidentified one); an
   unknown subtype is DISQUALIFYING for an INVESTMENT pair (the Roth-vs-Traditional case is
   exactly where a silent absence is too dangerous); and two rows returned by the SAME connection
   are vetoed by construction. **Collision interception still to build.**
4. **Combine a both-live pair** — Layer 3. Touches a money surface and the R3 direction guard ⇒
   *(Fable build)* — **BUILT 2026-07-24 (#304)**, ahead of slice 3's interception half because the
   owner was looking at a duplicate the app could not fix. Connection-level planner + a
   SERIALIZABLE claim (the row deletion IS the claim) + the shipped `confirmReconciliationFor`.
   **The rule this slice added to the design:** a date split deduplicates two feeds only where
   they agree, and two LIVE feeds are both partial in different places — so the combine now
   REFUSES any split that would drop a charge the surviving side does not also hold, naming the
   amount. §4's "its failure direction is silent loss" applies to the date line too, not only to
   fuzzy matching.
5. **Hostile critic** over D1–D9, lead adversarial target: a genuinely-separate second login at a
   bank the user already has, wrongly swallowed as a refresh. *(Fable)* — **RUN 2026-07-24 (#304)**
   for layers 3–4: three parallel fresh-context critics (money+boundary / destructive-action
   safety / false-merge+copy), 3 P0 + 6 P1 + 9 P2, all fixed and regression-locked. The
   lead target holds: a second login is admitted only when the ladder PROVES an overlap, and the
   spouse/Roth/three-`CREDIT CARD` cases are all locked as refusals. Re-run for interception.

## 9. What this deliberately does not do

* It does not auto-merge anything cross-provider. L.9 stands.
* It does not adjust a money figure on a heuristic. #192's stance holds: disclose, never
  silently assert two rows are one card.
* It does not dedupe transactions by amount and date. That failure direction is silent loss.
* It does not remove the need for L.7 (rename) or #298 (last-4 identity). Case (A) is a real,
  permanent situation, and the fix for it is legibility, not merging.
