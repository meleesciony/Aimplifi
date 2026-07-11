# Session Context / Handoff — 2026-06-26 (session "aimplifi")

> **UPDATE (2026-06-26, resumed session):** Plaid PRODUCTION questionnaire is **SUBMITTED ✅** (owner) — Thread 2
> below is now historical. Since then: REC-2 income-raise fix (DECISIONS #118) + production HSTS (#119) + privacy-doc
> accuracy shipped as **3 local commits** (72a37e8 docs, 8700202 REC-2, 55cf790 security), verified green +
> hostile-critic clean (0 P0/P1). **DEPLOYED ✅** — pushed to main; Vercel production build `dpl_856aSb6f…` (551ac97)
> reached READY; aimplifi.app now serves the income-raise fix + the HSTS header. PROGRESS.md's latest entry is the
> authoritative state.

Self-contained context to resume after a chat clear. Files persist on disk; clearing
the conversation does not delete anything. Point a new session at this file.

## TL;DR

App = **Aimplifi** (formerly "Pulse Finance"). Production is **live** on the custom
domain **https://aimplifi.app**; latest production deploy `050ee1d` is READY. Two threads
this session: (1) verified + hostile-critic'd the two empty-state commits; (2) prepared
the **Plaid production security questionnaire** and its required **Data Retention &
Disposal Policy** document. The questionnaire is finalized but **not yet submitted** (the
user submits it in Plaid's dashboard — I can't type into it).

## Git / repo state

- Branch `main`, HEAD `050ee1d` (pushed). 
- **Uncommitted (created this session):** `docs/DATA_RETENTION_AND_DISPOSAL.md`,
  `docs/SESSION_CONTEXT_2026-06-26.md` (this file). Nothing pushed → prod unaffected.
- Pushing `main` triggers a Vercel production build (docs-only commits still rebuild).

## Thread 1 — empty-state commits (`c594eb1`, `050ee1d`): VERIFIED

- `VERIFY_E2E=1 bash scripts/verify.sh` → **GREEN**: 92 files / 1133 unit, build clean,
  **54/54 e2e**, exit 0.
- Hostile-critic workflow (4 dimensions + adversarial verify): **0 P0, 0 P1, 17 P2.**
  Change is sound; demo/seed path byte-identical (golden-safe).
- The 17 P2s are NOT yet written to STATUS.md, and these two commits are NOT yet logged
  in PROGRESS.md. Notable P2s if revisited: REC-2 (income raises shown as price-increase
  warnings — pre-existing; engine fix + golden recheck), COPY-1 (no-income + savings-goal
  user sees red "over plan"), A11Y-2 (no axe scan on the new empty states), E2E-1/2/3/4
  (test hardening of the new auth.spec flow), GOLD-1 (headline testids now conditional →
  coupled to the pinned demo date).

## Thread 2 — Plaid PRODUCTION security questionnaire (main task)

Context: user has Plaid production now and runs Plaid + SimpleFIN "half/half" to save cost
until scaling. This is the live production account's security diligence. Two prior solo
attempts bounced; an assisted attempt went through.

**Final answers (enter these in the Plaid form):**

- **Q1** contact: Michael Lee, independent developer, michael.lee.p@gmail.com — keep.
- **Q2** documented infosec program: **No** + improved explanation (personal/invite-only,
  no formal program, but documented + code-enforced controls; cites the Retention policy
  and the privacy policy). Improved text is in `docs/PLAID_Q2_ANSWER.md` if saved, else
  regenerate (see "Verified facts").
- **Q3** access controls: **Role-based access control (RBAC)** — keep.
- **Q4** consumer MFA: **No** + explanation — keep.
- **Q5** MFA on critical systems: **CHANGE to Yes** — after enabling MFA on the admin
  accounts for **Neon, Vercel, GitHub** (the systems holding consumer data). Explanation:
  "Access to the systems that store and process consumer financial data — the Neon
  PostgreSQL database, Vercel (hosting and deployment), and the GitHub source repository —
  is protected by multi-factor authentication on each provider account." (Biggest
  strengthener in the form.)
- **Q6** TLS in transit: **Yes** — keep.
- **Q7** encrypt ALL consumer data at rest: **Yes** — keep; now backed by the v1.2 doc
  (Neon storage-layer encryption + AES-256-GCM on tokens).
- **Q8** vuln management: **None of the above** + explanation — keep (verify Dependabot
  alerts are actually enabled on the repo).
- **Q9** privacy policy: **CHANGE to Yes** + link **https://aimplifi.app/privacy**
  (verified live + publicly readable, no login).
- **Q10** consumer consent: **Yes** — keep.
- **Q11** retention policy (REQUIRES upload): **Yes** + attach
  **`C:\Users\micha\Downloads\Aimplifi-Data-Retention-Policy.docx`** (v1.2). Prior version
  saved as `...-v1.1-backup.docx`.

**Data Retention & Disposal Policy:**
- v1.2 docx regenerated this session (in Downloads). Edits vs v1.1: §5 now states
  DB storage-layer at-rest encryption (Neon) + app-layer token encryption (backs Q7);
  §6 now lists Neon as a data subprocessor; version/date bumped to v1.2 / 2026-06-26.
- Repo source-of-truth created: `docs/DATA_RETENTION_AND_DISPOSAL.md` (was referenced by
  `src/lib/legal/privacy-policy.ts:17` but missing). Keep the docx and this md in sync.

## Verified facts (ground truth — don't re-derive)

- Encryption at rest: `src/lib/crypto.ts` AES-256-GCM (12-byte random IV + auth tag,
  32-byte key from `DATA_ENCRYPTION_KEY`). Tokens in `PlaidItem.accessToken` /
  `SimpleFinConnection.accessUrl` (ciphertext, never logged).
- Password hashing: scrypt, salted per password, constant-time verify
  (`src/lib/auth/password.ts`).
- Prod DB: **Neon Postgres** (DEPLOY.md); encrypts at rest at the storage layer.
- Security headers (`next.config.ts`): CSP (no third-party scripts), X-Frame-Options DENY,
  nosniff, Referrer-Policy strict-origin-when-cross-origin, Permissions-Policy. **No HSTS**
  (gap — see Pending).
- Auth: middleware returns 401 for unauth API; invite-only allowlist on password + Google;
  per-user query scoping (`src/server/authz.ts`).
- Plaid webhook: ES256 + request-body SHA-256 + freshness verified before any DB work.
- SSRF guards on SimpleFIN outbound (`assertHttpsPublic` + `safeFetch`, per-hop, drops
  Authorization on cross-host redirect).
- Deletion: typed-confirm → Plaid `/item/remove` revoke → cascade delete incl. audit rows
  (`onDelete: Cascade` throughout schema).
- `/privacy` is public (middleware excludes it); live at https://aimplifi.app/privacy.
- Vercel: project `aimplifi` (`prj_Zr3x9TKUklr2LRswwc1rqZR4lcRO`), team `reiforge`
  (`team_pk5Bl46h1HAtdlfO5ASqydxE`). Domains: aimplifi.app, www.aimplifi.app,
  aimplifi-reiforge.vercel.app.

## Pending / next steps

1. **Plaid (user action):** enable MFA on GitHub/Vercel/Neon → flip **Q5** to Yes; set
   **Q9** link; attach **Q11** docx; paste improved **Q2** text; submit.
2. **Optional security:** add HSTS header to `next.config.ts`
   (`Strict-Transport-Security: max-age=63072000; includeSubDomains`), update the
   security-headers e2e assertion, verify, commit + deploy. **Deliberately NOT done**
   (prod deploy, not required by the form).
3. **Doc hygiene:** `docs/PRIVACY.md` still says "in-memory, single-instance" rate
   limiting — stale; the real limiter is durable DB-backed (STATUS #48). Update to match.
4. **Commit** the new docs (and this file) when ready (pushing `main` deploys prod).
5. **Lower priority:** log the empty-state commits + 17 P2s in PROGRESS.md/STATUS.md;
   consider the E2E-1/2/3/4 + A11Y-2 test-hardening batch.

## Naming note

"Aimplifi" everywhere user-facing (package.json, metadata, manifest, README, domain,
Vercel project). "Pulse Finance" survives only in the folder name, docs, a prisma comment,
and the seed RNG string `pulse-finance-seed` + demo email `demo@pulse.finance` (in
`src/lib/seed/build.ts`). **Do NOT change the seed string / demo email** — they feed the
deterministic PRNG that pins the golden test values. Working copy is under OneDrive (known
SQLITE_BUSY flake source; the canonical `C:\dev\Pulse Finance` copy is stale/abandoned).
