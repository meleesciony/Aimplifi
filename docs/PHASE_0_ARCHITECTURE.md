# Phase 0 — Architecture & Project Plan (COMPLETE)

Status: ✅ Complete. Claude Code starts at Phase 1.
All decisions below are binding unless a phase surfaces a concrete reason to revise;
revisions go in `docs/DECISIONS.md` with rationale.

## 0. Name

Working name stays **Pulse Finance**. Candidate alternative if branding matters later:
**Runway** (evokes "months of runway" / room-for-error framing). Do not spend build time
on naming.

## 1. Repo structure

```
pulse-finance/
├── CLAUDE.md
├── prisma/
│   ├── schema.prisma
│   └── seed.ts                  # builds the full SEED_SPEC dataset deterministically
├── src/
│   ├── app/                     # Next.js 15 App Router
│   │   ├── (auth)/sign-in, sign-up
│   │   ├── (app)/dashboard, accounts, transactions, triage, cards,
│   │   │         calendar, coach, goals, budgets, settings
│   │   └── api/                 # route handlers (sync, export, webhooks)
│   ├── components/              # shadcn/ui + feature components
│   ├── lib/
│   │   ├── money.ts             # Cents type, parse/format/sum — the ONLY money utils
│   │   ├── dates.ts             # date-only math: addDays, businessDayAdjust, cycles
│   │   ├── engine/
│   │   │   ├── cash-needed/     # Phase 1 — pure functions + tests
│   │   │   ├── categorize/      # Phase 2 — normalization, rules, confidence
│   │   │   ├── recurring/       # Phase 2 — subscription/cadence detection
│   │   │   └── fi/              # Phase 3 — savings rate, FI math, opportunities
│   │   ├── providers/
│   │   │   ├── types.ts         # DataProvider interface
│   │   │   ├── demo.ts          # reads seeded DB / fixture JSON
│   │   │   └── plaid.ts         # Plaid sandbox/production
│   │   └── db.ts                # Prisma client singleton
│   └── server/                  # server actions, auth config, audit logging
├── tests/
│   ├── unit/                    # vitest — engine tests, money/date tests
│   └── e2e/                     # playwright — per-phase user flows
├── scripts/verify.sh
└── docs/                        # this folder, plus DECISIONS.md and STATUS.md as built
```

## 2. Core principles baked into the architecture

- **Engines are pure.** `src/lib/engine/**` contains zero I/O: functions take typed
  snapshots (accounts, statements, scheduled transactions, "today") and return typed
  results. This makes every edge case in `docs/EDGE_CASES.md` a trivial unit test and
  makes the math auditable.
- **Money = integer cents.** `type Cents = number` with branded-type discipline
  (`type Cents = number & { __brand: 'cents' }` via helper constructors). `bigint` only
  if a computed sum can exceed 2^53 (it can't for personal finance; document this).
  Interest/compound math may use floats internally for rates but rounds to cents at
  every materialized step with a documented rounding rule (banker's rounding not
  required; round-half-away-from-zero, applied consistently, tested).
- **Dates are calendar dates.** Business logic uses `YYYY-MM-DD` strings + the
  `dates.ts` utility (comparison, add days/months, weekend/holiday adjustment with a US
  federal holiday table). Timestamps exist only for audit/created-at fields.
- **Provider abstraction.** Everything downstream consumes the `DataProvider` interface;
  demo vs. Plaid is a runtime switch (`DATA_PROVIDER=demo|plaid`).

## 3. Data model (Prisma schema draft)

This is the binding draft; Phase 1 may refine field names but not the shape. All money
fields are `Int` cents. All business dates are `String @db.VarChar(10)` (YYYY-MM-DD) or
Prisma `DateTime @db.Date` — pick ONE in Phase 1 and document it (recommendation:
date-only `DateTime @db.Date`, converted to/from `YYYY-MM-DD` at the data layer).

```prisma
model User {
  id            String   @id @default(cuid())
  email         String   @unique
  name          String?
  hourlyWageCents Int?           // YMOYL life-energy view (after-tax effective)
  swrBps        Int @default(400) // safe withdrawal rate, basis points (4.00%)
  expectedReturnBps Int @default(700) // for opportunity-cost compounding
  moneyDials    Json?            // user's "spend lavishly here" categories
  paymentAccountId String?       // designated checking account for card payments
  accounts      Account[]
  // ... auth fields via Auth.js adapter
}

model Account {
  id          String  @id @default(cuid())
  userId      String
  provider    String              // 'demo' | 'plaid'
  providerRef String?             // plaid account_id
  name        String
  type        AccountType         // CHECKING SAVINGS CREDIT INVESTMENT LOAN
  mask        String?             // last 4 only — never full numbers
  currentBalanceCents   Int       // sign convention: liabilities stored POSITIVE,
  availableBalanceCents Int?      // type determines asset vs liability in net worth
  creditLimitCents      Int?
  aprBps      Int?                // credit cards/loans, basis points
  autopay     AutopayConfig?
  statements  Statement[]
  transactions Transaction[]
  scheduled   ScheduledTransaction[]
  user        User @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model AutopayConfig {
  id        String @id @default(cuid())
  accountId String @unique
  mode      AutopayMode  // STATEMENT_BALANCE | MINIMUM | FIXED_AMOUNT
  fixedAmountCents Int?
  // autopay pulls from the user's payment account on the due date —
  // it changes WHO must act, not WHETHER cash must be present.
}

model Statement {
  id            String @id @default(cuid())
  accountId     String
  cycleStart    DateTime @db.Date
  cycleEnd      DateTime @db.Date     // statement close
  dueDate       DateTime @db.Date     // raw issuer due date (pre weekend-adjust)
  statementBalanceCents Int
  minimumPaymentCents   Int
  isEstimated   Boolean @default(false) // statement not yet generated → projected
  payments      CardPayment[]          // payments applied against this statement
  @@unique([accountId, cycleEnd])
}

model CardPayment {
  id          String @id @default(cuid())
  statementId String
  date        DateTime @db.Date
  amountCents Int
  source      String   // 'manual' | 'autopay' | 'detected-from-transactions'
}

model Transaction {
  id            String @id @default(cuid())
  accountId     String
  providerRef   String?
  date          DateTime @db.Date
  amountCents   Int          // sign convention: outflow negative, inflow positive
  rawDescriptor String       // "SQ *BLUE BOTTLE 0042 OAK"
  merchantId    String?      // → Merchant after normalization
  categoryId    String?
  confidenceBps Int?         // categorization confidence, 0–10000
  status        TxStatus     // PENDING | POSTED
  needsReview   Boolean @default(false)
  splitParentId String?      // splits reference parent
  @@index([accountId, date])
}

model Merchant {
  id        String @id @default(cuid())
  canonical String @unique      // "Blue Bottle Coffee"
  patterns  MerchantPattern[]   // matched raw-descriptor patterns
  defaultCategoryId String?
}

model MerchantPattern {
  id         String @id @default(cuid())
  merchantId String
  pattern    String   // normalized matcher (see categorize engine)
  kind       PatternKind // PREFIX | CONTAINS | REGEX
}

model Category { id String @id; name String; parentId String?; icon String?; isSystem Boolean }

model CategorizationRule {
  id         String @id @default(cuid())
  userId     String
  merchantId String?
  // contextual conditions — all optional, ANDed:
  minAmountCents Int?
  maxAmountCents Int?
  weekendOnly   Boolean?
  weekdayOnly   Boolean?
  accountId     String?
  categoryId    String
  priority      Int      // user rules beat merchant defaults beat ML suggestion
  createdFrom   String?  // correction id — provenance
}

model Correction {       // every manual fix, feeds rule proposals + metrics
  id            String @id @default(cuid())
  userId        String
  transactionId String
  fromCategoryId String?
  toCategoryId  String
  becameRuleId  String?
  createdAt     DateTime @default(now())
}

model RecurringSeries {
  id          String @id @default(cuid())
  userId      String
  merchantId  String
  cadence     Cadence   // WEEKLY | BIWEEKLY | MONTHLY | ANNUAL | IRREGULAR
  typicalAmountCents Int
  lastAmountCents    Int
  priceChangedAt     DateTime? @db.Date
  lastSeenAt         DateTime @db.Date   // drives "unused 90+ days"
  nextExpectedAt     DateTime? @db.Date
  isSubscription     Boolean
}

model ScheduledTransaction {  // known future inflows/outflows for projection
  id          String @id @default(cuid())
  accountId   String
  description String
  amountCents Int        // signed
  nextDate    DateTime @db.Date
  cadence     Cadence?
  source      String     // 'payroll-detected' | 'user' | 'autopay' | 'recurring'
}

model Goal { id String @id; userId String; name String; targetCents Int; savedCents Int;
             targetDate DateTime? @db.Date; monthlyContributionCents Int? }

model Budget { id String @id; userId String; categoryId String; monthCents Int }

model AuditLog { id String @id; userId String; action String; meta Json;
                 createdAt DateTime @default(now()) }
```

Notes:
- **The obligation timeline is NOT a stored model.** It is computed on demand by the
  cash-needed engine from Statements + AutopayConfig + ScheduledTransactions + pending
  Transactions + balances. Caching, if ever needed, is a later optimization.
- **Sign conventions are documented in `money.ts` and enforced in tests.** Transactions:
  outflow negative. Account balances: stored positive; `type` determines net-worth sign.
  Getting this wrong is the #1 source of fintech bugs — write the convention test first.

## 4. Cash-Needed Engine — interface contract (Phase 1 builds this)

```ts
// src/lib/engine/cash-needed/types.ts
interface CashNeededInput {
  today: ISODate;
  paymentAccount: { balanceCents: Cents; pending: PendingTx[] };
  cards: CardSnapshot[];          // statement (real or estimated), autopay, payments made
  scheduled: ScheduledItem[];     // payroll in, rent out, etc., with dates
  scenario: 'PAY_IN_FULL' | 'MINIMUM';
  holidayTable: ISODate[];        // US federal holidays, injected (testable)
}

interface CashNeededResult {
  perDueDate: ObligationPoint[];  // sorted; each: date, cards due, cumulative need,
                                  // projected balance, surplus/shortfall
  headline: {                     // "the answer"
    requiredCents: Cents; byDate: ISODate;
    shortfallCents: Cents | 0;
    recommendation?: TransferSuggestion;  // amount rounded UP to next $50, by date-1
  };
  intraPeriodMinimum: { date: ISODate; balanceCents: Cents }; // lowest projected point
  minimumPathInterestCents?: Cents;  // when scenario=MINIMUM
  assumptions: string[];          // every estimate labeled
}
```

Engine rules (binding):
- Effective due date = issuer due date adjusted per `dates.ts` weekend/holiday rule
  (if due date falls Sat/Sun/holiday, payment must arrive by the prior business day —
  conservative; document as assumption).
- Autopay cards are **included in cash required** (the money must be present) but
  **excluded from "you must act" recommendations**; mode determines amount. Never
  double-count: an autopaid statement contributes once, at its autopay amount.
- Mid-cycle payments reduce remaining due: `remaining = statementBalance − Σ payments
  applied to that statement`, floored at 0 (overpayment → credit, contributes $0 due).
- No statement yet: estimate = current balance projected to cycle close; result carries
  `isEstimated`, surfaced in `assumptions` and UI.
- The projection walks **day by day** from today to the horizon; the shortfall check is
  against the running minimum, not only due-date endpoints.
- Minimum-path interest: average daily balance method, APR/365, compounded monthly at
  cycle close, rounded to cents per cycle; tested against the hand-computed values in
  `docs/EDGE_CASES.md` (which also documents the exact formula so test values and code
  share one definition).

## 5. Categorization engine — pipeline contract (Phase 2)

```
rawDescriptor
  → normalize()          // strip SQ*/TST*/PAYPAL */AMZN Mktp prefixes, store codes,
                         // city/state suffixes, POS terminal ids → candidate string
  → matchMerchant()      // pattern table → canonical Merchant (create if new)
  → applyRules()         // user CategorizationRules by priority (contextual conditions)
  → suggest()            // heuristic/ML scorer → (category, confidenceBps)
  → route()              // confidence ≥ 9000: auto-apply silently
                         // 7000–8999: auto-apply, flagged subtle "AI" badge
                         // < 7000: needsReview = true → triage inbox
```
Thresholds are constants in one file, tuned in Phase 2 until the seed dataset hits the
<5% review-rate target — tune by improving normalization/rules first, thresholds last.
Every correction writes a `Correction` row and offers a one-tap rule
("Always / Just this once"); "apply to all N similar" creates one rule + batch update,
fully undoable (corrections are reversible events, not destructive writes).

## 6. FI engine — formulas (Phase 3, binding definitions)

- **Savings rate** = (after-tax income − expenses) / after-tax income, monthly, where
  after-tax income = detected payroll + other inflows excluding transfers; transfers
  between own accounts are never income or expense (transfer-detection is part of
  Phase 2 recurring work and a known correctness risk — test it).
- **FI number** = annual expenses × (10000 / swrBps). Default 4% → 25×.
- **Years to FI**: iterative monthly simulation (not closed-form): portfolio grows at
  expectedReturnBps/12 monthly (geometric: (1+r)^(1/12)−1), plus monthly savings;
  stop when portfolio ≥ FI number. Deterministic, unit-tested against the hand-built
  table in `docs/EDGE_CASES.md` §FI.
- **Coast FI date**: earliest month M such that current portfolio compounding alone
  (no further contributions) reaches the FI number by target retirement age.
- **Opportunity cost** of $X/mo over N years at r: future value of a monthly annuity,
  monthly compounding, contributions end-of-month. Formula documented in code next to
  the test.
- Copy guardrails enforced by a lint-like test: a `coach-copy.test.ts` asserts no
  banned shame phrases appear in coach strings and every projection string includes its
  assumption suffix.

## 7. Provider abstraction

```ts
interface DataProvider {
  listAccounts(userId): Promise<AccountSnapshot[]>;
  syncTransactions(userId, cursor?): Promise<{ added; modified; removed; nextCursor }>;
  getStatements(accountId): Promise<StatementSnapshot[]>;   // demo: seeded; plaid:
                                                            // liabilities endpoint
}
```
- `DemoProvider` is backed entirely by the seeded DB; "sync" is a no-op that can
  optionally advance the simulated clock (useful for e2e tests).
- `PlaidProvider` (Phase 4): Link token flow, `/transactions/sync` cursor-based,
  `/liabilities/get` for card statement data, webhook handler for `SYNC_UPDATES_AVAILABLE`.
  Access tokens encrypted at rest (AES-256-GCM via a `DATA_ENCRYPTION_KEY`), never
  logged. Research current Plaid docs with web tools at Phase 4 start — do not build
  from memory.

## 8. Security architecture

- Auth.js v5 (NextAuth), email magic-link + Google OAuth. All app routes behind
  middleware auth; every server action re-verifies session + row ownership
  (`userId` scoping on every query — write a helper, use it everywhere).
- Secrets only in env; `.env.example` documents all. Plaid access tokens encrypted at
  rest; only masks (last 4) of account numbers ever stored or displayed.
- `AuditLog` rows for: login, account link/unlink, data export, data deletion, rule
  bulk-apply.
- Documented data-deletion path: settings → delete account → cascade delete (schema
  uses `onDelete: Cascade`) + Plaid `/item/remove` + audit entry; described in
  `docs/PRIVACY.md` (write in Phase 4).
- CSP headers, no third-party scripts, rate limiting on auth + API routes.

## 9. Testing strategy

- **Unit (vitest):** every engine function; `money.ts` and `dates.ts` get exhaustive
  tests first (sign conventions, rounding, weekend/holiday adjust, month-end cycle
  arithmetic incl. Jan 31 → Feb cycles). Target: every row of `docs/EDGE_CASES.md` is
  one or more named tests.
- **Integration:** provider → DB → engine snapshot assembly.
- **E2E (Playwright):** one golden flow per phase (see PHASES.md). Mobile viewport
  (380×800) projects for triage flows; tap-count and duration measured via test
  instrumentation and asserted (<15 taps, <60s logical steps — document how "60s" is
  simulated since CI time ≠ human time: count interactions × human-time budget table).
- **Determinism:** seed script takes a fixed `--asOf` date; engines take `today` as
  input. No test ever calls `Date.now()` in business logic.

## 10. Phase breakdown

See `docs/PHASES.md` for acceptance criteria. Order: 1) scaffold + seed + Cash-Needed
Engine, 2) categorization + triage UX, 3) FI Coach, 4) Plaid + security hardening +
calendar/budgets/goals/export/PWA, 5) final critic pass + deliverables.
