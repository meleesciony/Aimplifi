# PROGRESS archive — 2026-09-16 through 2026-09-17 (#742–#748) (rotated 2026-09-21)

Moved verbatim from `PROGRESS.md` so the live ledger stays under the ~40 KB ceiling.

## 2026-09-17 — O.20j residual (2): a Plaid side without `ins_*` does not fold on last-4 (DECISIONS #748)

**Picked up.** Owner: "continue." Tree clean on `471bbe4a` (#747 shipped). Queue scan: Wave 0 ops owner-blocked; M.4 owner-deferred; Wave 2/3/4 strategic; L.19 stored-figure residuals closed. Strongest open money-visible row: #744 critic P2-2 — two Plaid items with null `institutionId` still folded on last-4.

**Closed.** `institutionsConflict`: both ids present ⇒ differ; a Plaid side lacking `ins_*` fails closed against any counterpart; Plaid-with-id + SimpleFIN null still folds. Live 0977: both items `ins_56` via the join (account stamp null). Cycle 1 P1s (unmeasured premise; Plaid(null)+SimpleFIN fold) closed same-session.

**Gate.** `bash scripts/verify.sh` → VERIFY GREEN: tsc 0, probes tsc 0, eslint 0, unit **8534 passed + 1 expected fail + 1 skipped / 634 files + 1 skipped**, next build clean. FAIL-OLD: **5 failed | 72 passed**. Playwright mobile-380 `transfer-flag-repair` **1/1**.

**Critic (fresh context, `C:\dev\_critic_o20j_r2`): cycle 1 FAIL 2 P1 → cycle 2 PASS 0 P0 / 0 P1 / 2 P2.** Independently reproduced tsc 0, 77/77, FAIL-OLD 5|72, both-Plaid mutation, live 0977 `ins_56`.

**Ledgers.** DECISIONS #748 (+ index); REGRESSION_LEDGER one row; STATUS BUILT; TASKS O.20j note. P2s in STATUS (third-null over-veto; filing fixture vs live join).

**Ship.** `2f2f3e23` on `origin/main`. No `prisma/` schema diff. CI verify **35312463045 = SUCCESS** (14m57s, full `VERIFY_E2E=1`). Vercel Production `dpl_EWXhQSiTdZkkWiFhKn8dUdngvYjx` READY on that sha, aliases include `www.aimplifi.app`. Live unsigned `/` → 307 `/sign-in`. Server-only marker: `a Plaid side that lacks`.

## 2026-09-17 — L.19 residual (1) follow-up: the saved debt-free goal card names the extra / on-track line (DECISIONS #747)

**Picked up.** Owner: "continue" on delayed critic notifications for a JSON snapshot that a parallel session had already occupied as #746 (`frozenAtSave` date stamp, `956e6492`). Strongest open money-visible row: #746 critic P2-4 (Suggested / on-track still silent). Did not rebase the JSON named-debt blob (would duplicate #746); added a twin stamp on the landed design.

**Closed.** Additive nullable `Goal.frozenExtraAtSave`; monthly/clear writers; note names every still-stamped figure with "worked out from" on extra/on-track arms. Money byte-identical.

**Gate.** `bash scripts/verify.sh` (post-cycle-3 copy) → VERIFY GREEN: tsc 0, probes tsc 0, eslint 0, unit **8529 passed + 1 expected fail + 1 skipped / 634 files + 1 skipped**, next build clean. FAIL-OLD extra-stamp writes stripped: **2 failed | 15 passed**. Playwright mobile-380 `debt-plan-frozen` re-run this ship turn on the "worked out from" pin.

**Critic (fresh context, isolated worktree `C:\dev\_critic_l19e`): cycle 1 FAIL 1 P1 → cycle 2 FAIL 1 P1 → cycle 3 FAIL 1 P1 → cycle 4 PASS 0 P0 / 0 P1.** Pronoun-to-bank (two branches) then false "includes" on a monthly; all closed and FAIL-OLD'd by the critic. Cycle 4 independently reproduced tsc 0, eslint 0, full vitest 8529, four mutations each 1-failed.

**Ledgers.** DECISIONS #747 (+ index); REGRESSION_LEDGER two rows; STATUS BUILT + #746 residual (1) closed; TASKS L.19 row note. P2s in STATUS (card extra>0 pairing, combined-arm date, `/coach` extra, solver date, Suggested: over a typed monthly).

**Ship.** `e7b8b20d` on `origin/main`. Schema: `prisma/` diff — `frozenExtraAtSave`, `prisma db push` on deploy. CI verify **35281568662 = SUCCESS** (full VERIFY_E2E=1, 14m22s). Vercel Production `dpl_HurMKFK3JwStCo2J7UkPfNhqdcrQ` READY, aliased to `www.aimplifi.app`. Live `/goals` 307 `/sign-in`; note is server-rendered (demo abstains; speaking branch is e2e).

## 2026-09-17 — L.19 residual (1): the saved debt-free goal card names the frozen balance its total was computed from (DECISIONS #746)

**Picked up.** Owner: "Continue." Cloud agent (Cursor), branch `cursor/l19-saved-debt-goal-frozen-0408`; local main fast-forwarded to `07800184` (#745 shipped). Queue scan: Wave 0 ops owner-blocked; M.4 owner-deferred; Wave 2/3/4 strategic; O.10b latent (0 live instances). Strongest open money-visible row needing no owner input: the #745 session's own named next — L.19 residual (1), the saved debt-free goal card, which #745 declined because `Goal` has no `createdAt`. Explorer (fresh context) mapped the writer, every debt-free reader (only /goals), the Goal model, the seed and the #742 tests.

**Closed.** Additive nullable `Goal.frozenAtSave` (save-day date) stamped by `saveDebtFreeGoal` iff a solver-input debt carried `frozenSince`; `updateGoalTarget` clears it only when the total CHANGES; `frozenSavedDebtGoalNote` (one no-direction sentence, no bank, no remedy of its own) renders under the card body as `goal-debt-free-frozen`. Money byte-identical. Only writer of `kind: 'debt_free'` (planner button + Ask action both call it).

**Gate.** `bash scripts/verify.sh` (pre-critic) → VERIFY GREEN, exit 0: tsc 0, probes tsc 0, eslint 0, unit **8520 passed + 1 expected fail + 1 skipped / 634 files + 1 skipped** (8510 → 8520 = the new file), next build clean. FAIL-OLD: pre-slice writer **2 failed | 8 passed**; pre-slice page vs wiring lock **1 failed**; unconditional clear **1 failed | 10 passed**. Playwright mobile-380 on the fresh build: `debt-plan-frozen` **2/2** (both walks now run through the save). **Post-critic gate (run 3, settled tree) → VERIFY GREEN, exit 0: unit 8521 passed + 1 expected fail + 1 skipped / 634 files + 1 skipped**, next build clean; Playwright `debt-plan-frozen` 2/2 + `goal-progress` 1/1 on that build. Run 2 was RED on `ledger-decisions-index.test.ts` (2 failed) — a mid-edit race, not a defect: the gate read DECISIONS #746 before `ledger.ts reindex` had run, in the same tree (the gate-and-mutating-node lesson, re-learned); run 3 on the settled tree is the verdict.

**Critic (fresh context, isolated worktree `/tmp/_critic_l19sg`, node_modules symlinked, per-cwd test DB): cycle 1 PASS 0 P0 / 0 P1 / 6 P2 — four fixed same-session** (P2-1 ledgers; P2-2 page-wiring unit lock, a `goal.targetDate` mutation had survived the unit suite; P2-3 re-saving the unchanged pre-filled total cleared a still-true note; P2-5 audit meta). P2-4 (suggested-monthly scope) + P2-6 (server-local save date, inherited #58) recorded in STATUS. Critic independently reproduced tsc 0, eslint 0, 37/37, FAIL-OLD 2|8, killed 5/6 mutations.

**Env.** Playwright chromium was not installed on this VM (`npx playwright install chromium`, 113 MB); the e2e server needs `AUTH_SECRET` + `DEMO_TODAY` (the CI values) — the #742 lesson, re-applied.

**Ledgers.** DECISIONS #746 (+ index, 733 entries); REGRESSION_LEDGER two rows; STATUS BUILT + #745/#742 residual (1) closed; TASKS L.19 row note. Ceiling cut: PROGRESS 43.2 → 25.7 KB (the 2026-09-10 CI repair through the 2026-09-11 goals wave, six sessions, verbatim → `docs/archive/PROGRESS_ARCHIVE_2026-09-10_to_2026-09-11.md`); docs-lint clean (247 files). STATUS 40.1 → 26.9 KB (BUILT #737–#740 verbatim → `docs/archive/STATUS_ARCHIVE_2026-09-11_to_2026-09-12.md`). TASKS.md (132 KB) remains the standing next cut.

**Ship.** `e93c9642` + `5b8581d0` + `cc77ef9b` on PR #25, merged to `main` the same turn as **`956e6492`** (DECISIONS #636). `prisma/` diff = the one additive nullable `Goal.frozenAtSave` column; the Vercel build log shows `prisma db push` against Neon (`ep-proud-sound-atpgfoct`, db `pulse`): "Your database is now in sync with your Prisma schema. Done in 517ms" — no existing row touched. CI verify: 35272299484 (push) + 35272352630 (pull_request) = success on `cc77ef9b`; **35273843014 = SUCCESS on `956e6492` (`main`, full VERIFY_E2E=1, 14m59s, `scripts/ci-status.sh` exit 0)**. Vercel Production `dpl_7qq56Da5dQG6WSc2Yiv5px1xcHZi` **READY** on `956e6492`, aliases include `www.aimplifi.app`. Live probe (Playwright demo session on production): `/goals` 200, `demo-banner` 1, 30 `goal-*` elements render post-schema-change, `goal-debt-free` count **0** (the demo has no saved debt-free goal) and `goal-debt-free-frozen` count **0**, neither "When this goal was saved" nor "stopped sharing that balance" in the DOM — the ABSTENTION, the only branch production can show without writing a goal into the shared demo row (the shared-demo lesson). `git grep frozenAtSave 956e6492 -- src prisma` = 15 hits / 4 files vs **0 on the prior production sha `07800184`** — a marker no earlier build can serve. The speaking branch (a saved card that names the frozen balance) is proven by `debt-plan-frozen.spec.ts` locally and in CI; its live render is **UNVERIFIED** by construction.

## 2026-09-17 — O.20j identity: component veto + detector prereqs (owner unblocked)

**Picked up.** Owner: "continue and fix everything.....what do you need from me." Nothing needed. New critic budget. Named cycle-4 close: veto over the component `root()` would produce. New-budget cycle 1 critic FAIL 0 P0 + 3 P1: last-4-only wider than the advisory detector; unordered `findMany` picked which bridged group folded; cycle-3 `$237.08` claim stale.

**Closed in the tree (not yet on `main`).** `unionSameMaskColumnIdentity` skips a mask-group union when any pair in the current `root()` component is dismissed, same-connection, mixed-type, different present `institutionId`s, different currency (null=USD), or `registrationsConflict`. Missing `byId` records fail closed. Group keys sorted by `type|mask`. Cycle-3 `$237.08` claim downgraded; mixed-type over-veto named residual. Intended 0977 fold still holds when both Plaid copies share an institution and the SimpleFIN terminal has none. H.7b not auto-run.

**Gate.** `bash scripts/verify.sh` VERIFY GREEN: tsc 0, probes tsc 0, eslint 0, unit **8477 passed + 1 expected fail + 1 skipped / 631 files**, next build clean. FAIL-OLD (`git checkout HEAD -- transfers.ts`): **12 failed | 22 passed**. Playwright `transfer-flag-repair.spec.ts` mobile-380 **1/1**. Identity+filing files: **72 passed**.

**Critic (fresh context, isolated worktree `C:\dev\_critic_o20j2`, now removed).** Cycle 2 of the new budget: **PASS 0 P0 / 0 P1** (5 P2s named in STATUS). Independently reproduced verify 8477, FAIL-OLD 12|22, 44 own probes + 4,000-corpus fuzz. Cycle-4 back door closed first-hand.

**Shipped.** DECISIONS #744. PR #24 merged to `main` as `c3ff71b26`. CI verify **35188955926 = SUCCESS**. Vercel Production `dpl_CNL5qQfa7GigLhjvMPhbxWQzgFEW` READY on `www.aimplifi.app`. H.7b not auto-run.

## 2026-09-16 — O.20j converse-leak identity: critic budget exhausted (DECISIONS #743)

**Picked up.** Owner: "continue." Strongest open money-visible row: O.20j converse leak. Measured first (read-only Neon): 94 converse rows; 8 remaining WRONG flags ($237.08) are CREDIT CARD last-4 `0977` copies (two Plaid items) pairing a spend row with a filed `TRAVEL CREDIT`. Reader-side "count as spend" killed (~$180k of real transfers). H.7b never run. L.19 already occupies #742.

**Stopped at the human gate.** Maker built same-type + mask-COLUMN identity (not the advisory HIGH detector). Four critic cycles, last one 0 P0 + 1 P1: the veto walks the mask group while the union unifies `root()`, so a confirmed H.7 chain is an unguarded back door. Named fix is unevaluated (budget 4/4). **Did not land on `main`.** Code is on branch `o20j-mask-column-identity` (draft PR #24). `main` keeps L.19 (#742) plus this stop.

**Gates on the unshipped tree (not a ship).** `bash scripts/verify.sh` VERIFY GREEN: tsc 0, probes tsc 0, eslint 0, unit **8444 passed + 1 expected fail + 1 skipped / 629 files**, next build clean. FAIL-OLD: identity removed → `{ overturned: 1 }` vs expected 0. Playwright `transfer-flag-repair.spec.ts` mobile-380 **1/1**. Critic cycle 4 independently reproduced the 8444 count.

**Ledger landed.** `d2e146d1` on `origin/main` (docs only; #743 because L.19 occupies #742). CI verify **35151281286 = SUCCESS**. Vercel Production READY. Draft PR #24 retitled to #743 and rebased onto this sha (`71d22d54`); still draft — do not merge.

**Next.** Human gate, or a new session on the branch that closes P1-1 (veto over the `root()` component) before any ship.

## 2026-09-16 — L.19 (5): the debt-payoff path names a balance the bank stopped sharing (DECISIONS #742)

**Picked up.** Owner: "Continue building this out towards production." Tree clean, main even with origin (O.20c #741 shipped, CI 34886003435 success). Queue scan: Wave 0 ops owner-blocked; M.4 owner-deferred; Wave 2/3/4 strategic. Strongest open money-visible row: **L.19 (5)** — the debt-payoff path, the one surface DECISIONS #305 left printing a figure over a frozen balance; the TASKS row still read "(2), (3), (5) remain open" though #305 had closed (2) and (3). Plan node restated 7 acceptance assertions (A1–A7 in the critic brief).

**Closed.** `loadDebtAccounts` returns `DebtAccount extends DebtInput` carrying `kind` + `frozenSince`; the engine never reads them. `frozenDebtPlanNote` (own builder — a plan is not a total; the frozen balance is the amortisation's starting point) qualifies /goals' planner (above the save control) and both Ask debt answers, resolved against the rows each surface prints. Card: both directions. Loan: none. Mixed: one remedy.

**Critic (fresh context): cycle 1 FAIL 1 P1 + 8 P2 → cycle 2 ZERO P0/P1.** The P1 was mine: "a loan only ever goes down" — false for a line of credit (`plaid-map.ts` types it LOAN) and for accrued interest; fixed to claim no direction, pinned `not.toMatch(/may be lower/)`. P2s fixed same-session (repeated remedy; wrong figure label on the unreachable branch; source-grep test → jsdom render lock; float-derived expectation → `162_923`). Cycle 2 reproduced the gates, both fail-old probes (pre-slice component 1|1; filter inversion 2|0), the "Jan 2034" figure and the rotation byte-for-byte.

**Gate.** `bash scripts/verify.sh` → **VERIFY GREEN, exit 0**: tsc 0, probes tsc 0, eslint 0, unit **8,439 passed + 1 expected fail + 1 skipped / 630 files**, next build clean. Playwright mobile-380 on the fresh build: debt-plan-frozen + frozen-figure-surfaces + ask **35/35**. Env lesson re-learned: a live `next start` needs `AUTH_SECRET` (the CI value) or the password callback 500s with "server configuration"; and Playwright's `reuseExistingServer` will attach to a stale server whose `.next` a later build replaced — kill by PID, never by name.

**Ledgers.** DECISIONS #742; REGRESSION_LEDGER two rows; TASKS L.19 → [x]; STATUS BUILT entry with four named residuals (sharpest: the saved goal card is silent after save). Ceiling cut: DECISIONS #724–#736 → `docs/archive/DECISIONS_ARCHIVE_724_to_736.md` (44.6 → 36 KB), index regenerated.

**Ship.** `19152a3d` landed on `origin/main` (fast-forward of PR #23, same turn per DECISIONS #636; no `prisma/` diff — database untouched). CI verify: run 35113323242 = **success** on the branch push, 35113236398 = success on the PR, **35115110437 = SUCCESS on `main`** (full VERIFY_E2E=1, watched to conclusion via `scripts/ci-status.sh`). Vercel Production deployment 6484384476 = success ("Deployment has completed"). Live probe (demo session on www.aimplifi.app, 7/7): /goals planner renders with NO frozen note (the demo has nothing frozen — the abstention); the /goals client chunks carry the new loan sentence ("nothing about this loan has been confirmed since") and NOT the retracted "not taken off it" one — a marker no pre-slice build can serve; Ask's debt-free answer renders with no "stopped sharing" note.

**Next.** L.19 residual (1) — the saved debt-free goal card is silent after save (STATUS). Wave 2/3/4 rows per TASKS.md; Wave 0 ops owner-blocked; M.4 owner-deferred.
