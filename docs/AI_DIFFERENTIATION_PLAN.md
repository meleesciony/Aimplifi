# AI Differentiation Plan

*Plan doc. Status: the §5 recommended first build — the debt-free-by-date slice of **Plan in Words** (#1) — is now **BUILT + shipped (DECISIONS #125)**: a pure `solveDebtFreeByDate` bisection over the tested debt engine, an `Ask Aimplifi` `debt_free_by_date` intent (LLM extracts only the date), and a server-re-solved "save as a debt-aware goal" path. Everything else below stands as a proposal. Next slices (owner-gated): the arbitrary savings-goal-by-date, then retire-at-age; and the other Wave-1 concept, Cash Flow Radar (§1.2).*

---

## 1. North star

Every finance chatbot on the market hallucinates numbers, and on money that is the single most expensive defect there is. The industry's own figures are damning: 15–25% hallucination rates on financial tasks, an MIT finding that models use *more* confident language when they are wrong, and at least one robo-advisor that mislabeled high-risk bonds "conservative" across 2,847 portfolios for a $3.2M remediation. The whole premium-tracker field — Monarch, Copilot, Simplifi, Empower — has bolted a natural-language "ask your data" assistant onto an LLM that can fabricate a figure, and the agent-native entrants (Era, Copilot's MCP beta) are racing to hand the *entire* reasoning step to a general model over MCP, which maximizes the error surface precisely on transfers and money math. Cleo's defense — structured tool-calls, no free-text math — quietly proves the architecture works. **But no incumbent has made "our AI never originates a number" the brand promise.** That is the gap.

Aimplifi already has the rare thing the whole market is missing: an architecture where the LLM is structurally barred from originating a fact. The shipped categorization path (`parseLlmCategory` rejects any label outside a closed set) and the shipped assistant (`classifyIntentViaLLM → intentFromKind → validateIntent`, where the model picks a route and the engines produce every figure) are not aspirations — they are the two surfaces we run today. Our cardinal rule is currently an *internal* engineering discipline. The strategic move is to turn it into a *felt, marketable* product advantage: a "tap any number to see the rows it's made of" guarantee, an auditable record of every value AI touched, an assistant that says "I don't know — tell me" instead of inventing. Trustworthy, grounded, verifiable AI is a moat the incumbents cannot copy without rebuilding their fact-origination model from the studs.

The second half of the thesis is that grounding alone is table stakes once it's named; the durable edges layer *genuinely useful* proactive and predictive intelligence on top of engines we already own — the Cash-Needed engine (white space #1, unowned by every competitor), savings-rate FI coaching (white space #2, unowned), the forecast, the recurring detector, the retirement projection. The plan below sequences both: make grounding visible and marketable, and ship the proactive jobs that only a never-hallucinating app can responsibly proactively *push*. Note the table-stakes warning throughout: low-touch categorization is now matched by Copilot's per-user ML and Monarch's enhanced categorization, so it is a baseline quality bar in this plan, never a headline.

---

## 2. What we already have

Two AI surfaces ship today, and they are the foundation the entire plan stands on — not because they are flashy, but because each is a *worked example* of the LLM-never-originates-a-fact boundary.

- **LLM-assisted categorization** (`src/lib/engine/categorize/llm.ts`, `pipeline.ts`). The deterministic pipeline categorizes first; the LLM is consulted *only* for rows it was unsure about, and only wins when `confidenceBps ≥ AUTO_SILENT_BPS` (9000). `parseLlmCategory` rejects any category id outside the closed set and any out-of-range confidence — the model can label, never invent. Corrections feed a `Correction → CategorizationRule` learning loop, so the human stays the final fact-setter.

- **Grounded Ask Aimplifi** (`src/lib/engine/assistant/`, `src/server/assistant.ts`). The LLM's *entire* job is mapping an unrecognized phrase to a closed intent kind; `intentFromKind` then re-derives every parameter (timeframe, category) from the user's own words via `parseTimeframe`/`resolveSpendTarget`, and `validateIntent` re-checks the object. The LLM extracts zero numbers. Answers carry an `interpreted` flag and a standing "your account data is never sent to the model" disclosure. It is rate-limited, 7s-timed-out, and degrades to a deterministic parser with no key.

These two rails — *the model picks a route or a label from a closed set; tested pure engines produce every fact* — are the reusable substrate for almost everything that follows. Wave 1 barely extends them; Wave 2 clones them onto new surfaces; the riskier waves are mostly cases where that boundary has to be re-proven against a harder modality (open-valued document fields, generative prose) or a missing dataset.

---

## 3. The prioritized concepts, by wave

Each concept below is tagged with its **adjudicated verdict** from adversarial review (`build-now`, `build-later`, or `needs-rework`) — these are the verdicts after someone actively tried to break the strongest claim, not the optimistic self-scores. Effort uses the repo's S/M/L/XL scale.

### Wave 1 — highest leverage, build-now on existing engines + the grounded rails

These two are the only concepts that survived adversarial review as **build-now**. Both compose engines that already ship, both are the purest possible expression of the cardinal rule, and both target white-space jobs no competitor owns.

#### 1.1 Plan in Words — natural-language goal, engine-solved knob, honest feasibility *(rank #1 — the strongest concept in the entire set)*

**Job-to-be-done.** Let me state a goal or life plan in a sentence — "be debt-free by next December," "retire at 60," "buy a house in ~3 years" — and have the app tell me exactly what I'd need to change, whether it's realistic *for me*, and what it does to my timeline. Crucially: ask me for the numbers I didn't give instead of making them up.

**Why it beats incumbents.** Mint, Simplifi, and Monarch make you hand-build a goal in a form and then show a static forward projection. Even our own `retirement-whatif.ts` is forward (change a knob, see the result). This is *inverse* planning: parse a target, **solve** the engine for the required input, sanity-check it against real safe-to-spend, and refuse to invent a dollar figure the user didn't state. That inversion plus the refusal-to-fabricate is genuinely novel; no tracker does it.

**Engines/read-paths reused.** `src/lib/engine/solve/` (new), `debt/payoff.ts`, `fi/fi.ts` (`monthsToFI`, `savingsRateBps`), `investments/retirement.ts`, `goals.ts` (`goalFIImpact`), `spending-plan/plan.ts`, `settings/dials.ts` (`DIAL_LIMITS`), `dates.ts`, `src/server/goal-actions.ts`. All eight reused engines exist; no new storage.

**AI vs deterministic code.** The LLM extracts *only* the target (a calendar date or age) and the goal-type, and only populates a dollar amount when the user literally stated one; any missing amount is emitted as an explicit "needs your input" slot. It computes nothing and cannot emit the answer figure. A new pure bisection solver does all the math.

**Grounding design.** The required figure is the output of a bounded, integer-cent, monotone bisection over the existing engines — the *exact* pattern `coastFI` (`fi/fi.ts:75-87`) already ships: a 60-iteration binary search for the required level contribution over the monotone `monthsToFI` step function. Debt-by-date (`planDebtPayoff`, monthsToDebtFree non-increasing in `extraMonthlyCents`) is the cleanest monotone case. The answer is then expressed as a *share of real `getSpendingPlan` safe-to-spend*. Two hard rails the writeup must honor: (1) the LLM now escalates from pure route-picker to slot-extractor, so any echoed amount must be **code-verified to appear verbatim** in the user's text before use (a string match owned by `validateIntent` + a deterministic regex tier), or it becomes a fabrication vector; (2) the "typical range, please confirm" hint library for missing amounts must be a **hardcoded deterministic table**, clearly labeled and user-confirmed — if those ranges ever come from the LLM, the cardinal rule breaks. Infeasible targets return an honest "not reachable by that date at these assumptions," never a fabricated yes. Uncertainty routes to the human as a question; the user confirms every parsed goal and amount before anything is created.

**Guardrails.** "Illustration, not advice"; return/inflation/APR assumptions printed inline; the required change is information, not an instruction; no-shame copy when infeasible; no securities (`expectedReturnBps` is a user-set dial, same posture as the already-shipped #122/#123 retirement work).

**Effort / impact.** L / high.

**Adversarial verdict: build-now**, conditioned on sequencing. The reviewer tried to break the monotone-bisection claim and could not — the foundation is proven in-tree, all engines and the grounding boundary exist, no new storage, constitution fit is "essentially the purest possible expression of LLM-never-originates-a-fact." Rework is execution-scope, not viability: ship **goal-type by goal-type** — debt-free-by-date first (cleanest monotonicity), arbitrary savings goal second, retire-at-age (accumulation + decumulation, success criterion pinned as `endBalance ≥ 0 at endAge`) last. Each goal type needs its own pinned success criterion in `EDGE_CASES.md` (zero-interest debt, goal-already-met, non-convergence, vague-date confirmation). One honest data constraint that is *itself the selling point*: debt-by-date needs per-debt `aprBps`, which is "as entered" and frequently null — so the demo's auto loan likely needs a user-entered APR, which degrades gracefully into the concept's own "ask, don't invent" mechanic. The gap is the differentiator, not a defect.

#### 1.2 Cash Flow Radar — predict the dip, name the colliding card, propose the timed cover-transfer *(rank #2)*

**Job-to-be-done.** Warn me *before* checking goes negative, tell me which card causes it and the exact amount to move by when, and show me the realistic end-of-month balance including the gas/groceries/takeout I always buy — without me opening a forecast or doing math.

**Why it beats incumbents.** Mint/Simplifi low-balance alerts are static thresholds that fire *after* the fact. Monarch/Copilot project a single optimistic line that models zero discretionary spend and stop at "you may run low." None compute the minimum top-up that keeps the curve non-negative, none forward-simulate the interaction between multiple statement due dates and the checking balance, and none show an honest typical-vs-heavy band. This is the Cash-Needed white-space job (#1) extended forward.

**Engines/read-paths reused.** `forecast/forecast.ts` (`computeForecast`, `expandScheduled`), `cash-needed/engine.ts` + `assemble.ts`, `reports/reports.ts` (single spend definition), `trends/trends.ts` (`computePace`), `spending-plan/plan.ts`, `reminders/select.ts`, `src/server/forecast.ts`, `dates.ts` (`previousBusinessDay`, `addMonthsClamped`), `money.ts` (`roundUpToNext50Dollars`, `roundHalfAwayFromZero`), `api/cron/reminders/route.ts`. The cover-transfer math is already prototyped at `cash-needed/engine.ts:266-281` (worst dip rounded up to next $50, dated to `previousBusinessDay(firstNegativeDate)`, never past-dated).

**AI vs deterministic code.** The AI does **zero math**. `computeForecast` finds the first-negative and lowest point; a new `computeCoverTransfer` finds the smallest transfer on the earliest safe date; a new burn-rate module derives median + low-percentile daily discretionary outflow from history. Optional key-gated AI is *only* the existing assistant router ("am I short before rent?") plus template framing whose every $-token is substituted from engine output and string-checked.

**Grounding design.** Every cent and date comes from `forecast.ts` + the cash-needed engine over the same `getFinanceSnapshot` the dashboard reads, so the radar *cannot* disagree with `/cards` or `/forecast`. Three lines render with explicit basis: committed-only (exactly today's forecast, additive, never a silent overwrite), expected (burn line showing "based on your last 8 weeks: ~$X/day"), and conservative-low. Future cycles beyond the next generated statement carry `isEstimated` with an inline "statement not generated yet" note. New users with <4 weeks get committed-only plus a "learning your pace" label.

**Guardrails.** "Aimplifi never moves money — this is a proposal," shown explicitly. Every line labeled with its assumption. No shame if the low line dips. Deterministic always-push floor only when the *committed-only* first-negative is within 7 days. **Surplus/source accounts must be restricted to CHECKING/SAVINGS** — sourcing a cover transfer from the demo's ~$142k brokerage would imply liquidating securities (a tax + advice edge); scope it to deposit accounts.

**Effort / impact.** L (realistically M) / high.

**Adversarial verdict: build-now**, with three conditions. The reviewer confirmed every cited engine and the cover-transfer prototype exist, and that the trustworthy *alarm* is gated on the committed-only line (hard scheduled flows + card obligations, **no** burn estimate) — so alarm trust does *not* rest on the un-back-testable burn model; the burn "realistic" line ships as a labeled band, which the constitution permits. The genuine hidden scope the self-score under-counted: `forecast.ts` is completely card-blind and cash-needed is single-cycle, so the "90-day walk of every card due date" spans 2-3 cycles/card and future cycles need *both* due dates and statement amounts estimated. Conditions: (1) gate the proactive push on committed-only and ship burn as a labeled band; (2) restrict transfer sources to deposit accounts; (3) label all future-cycle card due dates/amounts as estimated. Effort is realistically M, not L.

---

### Wave 2 — thin new engines on data we already hold

These are **build-later** (or rework-then-build) concepts that need only small new *pure* modules — no new data pipeline, no schema migration of consequence. They deepen trust and proactivity. Lead is the Glass-Box Assistant because it converts the cardinal rule directly into a felt UI guarantee.

#### 2.1 Glass-Box Assistant — tap any AI number to see the rows, the reconciliation, the assumptions *(rank #5 — Wave 2 lead)*

**Job-to-be-done.** When the assistant says "you spent $612 on groceries," let me tap it and see the actual line items that add up to it, know what's solid fact vs a projection and what it assumed, and fix a misread routing in one tap.

**Why it beats incumbents.** Monarch/Copilot/Rocket/Cleo hand you a number with at best a link to a filtered list you eyeball; none *prove* the sum reconciles, none refuse to show what they can't prove, and none let you re-route a misread question in one tap. "Our AI shows a number only if it can prove it" becomes a tappable guarantee — impossible to copy without engine-derived numbers carrying row provenance.

**Engines reused.** New pure modules `assistant/trace.ts`, `assistant/uncertainty.ts`, `assistant/explain-routing.ts`; plus `assistant/answer.ts`, `assistant/intent.ts`, `reports/reports.ts`, `trends/trends.ts`, `cash-needed/engine.ts` + `types.ts`, `recurring/summary.ts`, `src/server/assistant.ts`, `ask-view.tsx`.

**AI vs deterministic code.** The LLM does nothing to the number; its only job stays mapping an unrecognized phrase to a closed intent kind. Everything in the drawer — which engine ran, the rows, the arithmetic, the known/estimated basis, the routing evidence — is deterministic code reading the *same* `getFinanceSnapshot` the answer used. Correction chips dispatch a fully-specified intent straight to `buildAnswer`, bypassing the LLM entirely.

**Grounding design.** `trace.ts` asserts `sum(citedRows) === headlineCents` to the penny and renders "I can't fully reconcile this — open /reports" on failure; `uncertainty.ts` reads `CashNeededResult.assumptions` / `CardObligation.isEstimated` and surfaces a *qualitative* basis, never a fabricated confidence percentage; `explain-routing.ts` shows the matched token from `resolveSpendTarget`/`parseTimeframe`, with a test pinning explanation === answered-intent. Derived intents (savings_rate, debt_payoff) show the derivation chain, not a row sum.

**Guardrails.** Pure recomputation, no advice; "here's exactly what this number is made of"; inherits "transfers/income excluded" notes; refuses a fake confidence %; keeps the "your account data is never sent" disclosure.

**Effort / impact.** L (realistically L/M) / high.

**Adversarial verdict: build-later**, gated on scoping the headline honestly. The narrow claim holds — `trace.ts` can re-derive contributing rows and prove the sum byte-identical to `spendingByCategory`. But "tap **any** number to see the rows AND a sum self-check" is structurally false for 5 of 13 intents (net_worth, forecast, cash_needed, savings_rate, debt_payoff are derivation chains, not row sums) — including the JTBD's own flagship "you'll dip negative July 14," which is a forecast with no transaction rows that add up to it. Required rework before build: (1) scope the "any number" framing down or design a separate derivation-chain UX for the 5 non-row-sum intents; (2) accept that per-intent trace shapes push effort toward L/M; (3) guard against the sharp failure mode — a **false-negative reconciliation** where `trace.ts` drifts from the engine and renders "can't reconcile" on a *correct* number, the trust feature undermining trust. This demands permanent lockstep discipline with the engines. Constitution-exemplary and zero-key; just lower-frequency (trust-building/dispute moments) than a daily driver.

#### 2.2 Smart Notification & Nudge Engine — escalate only what needs a human, learn what you act on *(rank #7)*

**Job-to-be-done.** Don't bury me in alerts. Push the one thing that needs me today, keep the rest in a feed, stay silent on anything autopay handles, and stop showing me the suggestion I keep ignoring.

**Why it beats incumbents.** Incumbent alerts are hand-tuned dumb thresholds that fire identically regardless of whether you ever act; none rank by deterministic severity, none de-dupe against autopay, and none close the loop on revealed responsiveness per insight type.

**Engines reused.** `reminders/select.ts` (already carries `autopayCovered`/`autopayCents` and de-dupes by `reminderKey`), `forecast/forecast.ts`, `cash-needed/engine.ts`, `recurring/detect.ts`, `fi/insights.ts` (`findOpportunities`), `fi/coach-copy.ts`, `api/cron/reminders/route.ts` (already quiet-by-default: email-gated, `dormant:true`, with an AuditLog "would-have-sent" record), `src/server/authz.ts` (`rateLimitDurable`). New: a normalizing `Proposal` type + cross-kind severity scorer (pure), a behavioral-only `InsightFeedback` model, notification-prefs on `User`.

**AI vs deterministic code.** Ranking and routing are *fully deterministic* (severity = shortfall depth, days-until-due, autopay-covered vs user-action, estimated vs real — a visible auditable score). Optional key-gated AI only interprets a natural-language reply ("snooze till payday," "I paid it," "mute Netflix") into the closed action set. No number is authored by the model.

**Grounding design.** Consumes typed proposals each carrying engine-computed numbers + a severity score; the LLM maps NL→action validated against a closed set and rate-limited. The new `InsightFeedback` model is strictly behavioral (kind, shown/acted/dismissed, date — no money, no PII). Quiet-by-default: nothing emailed without a key; email dormant in demo.

**Guardrails.** Never moves money; **never permanently hides a MATERIAL warning** (cash-needed shortfall / due-date crunch exempt from suppression); transparent "why you're seeing this / show everything" control; deterministic always-escalate floor (forecast first-negative within 7 days always pushed).

**Effort / impact.** M / high.

**Adversarial verdict: build-later.** The load-bearing safety claim holds: `forecast.firstNegativeDate` and the cash-needed shortfall engine deterministically identify "material," so the always-escalate floor is unit-testable and the suppression provably never buries a material warning. The de-dup-against-autopay capability is real and incumbents lack it. Reasons it's later, not now: (1) the marquee responsiveness-learning loop cold-starts to a deterministic default and needs weeks of behavioral data — invisible at launch; (2) the headline "push the ONE thing" rides a push/email channel dormant in demo, so out-of-the-box value is in-app feed ranking only; (3) cross-kind severity calibration is genuine judgment work, better sequenced once the proposal-source set is stable; (4) **cut or harden the "compress same-day proposals into one digest title"** — it is LLM text generation guarded only by a digit-allowlist (a materially softer boundary than the route-only classifier); a deterministic template removes the risk. Note: "life-event" is named as a proposal source but no life-event detector exists yet (see #20) — it's an optional input, not a blocker.

#### 2.3 Balance-Move Explainer — grounded "what changed and why" in one line *(rank #9)* — ✅ BUILT (DECISIONS #240)

*Shipped 2026-07-16 on `/trends`. The needs-rework verdict's two holes (word-form magnitude claims;
un-re-validated causal primary-driver) were resolved by a stronger design than the writeup proposed:
the LLM authors a TEMPLATE of ATOMIC placeholders + additive-only connectives and the engine
substitutes every figure/label, so fabrication/swap/flip are structurally impossible — not merely
detected by a `validateNarrative` allowlist. `primaryDriver` is forced to `movers[0]` (never a model
pick). Four Fable hostile-critic cycles (FAIL/FAIL/FAIL/PASS) hardened the prose boundary; see
STATUS / EDGE_CASES §Balance-Move. The honest caveat held: the deterministic template carries the
surface and is the zero-key/demo floor; the LLM is bounded polish. This validator is the reusable
substrate the writeup anticipated for §2.4 Monthly Money Review.*

**Job-to-be-done.** When my spending or balance jumps — or my savings rate drops to 9% — tell me why in plain English using my actual numbers, not a generic tip and not a category table I have to scan.

**Why it beats incumbents.** Copilot's AI "insights" drift into vague or invented claims; Monarch shows category deltas with no causal sentence. The novel mechanism — a number-set containment guard on LLM prose over fully-decomposed typed engine outputs — is something no incumbent can copy without our grounding rail.

**Engines reused.** `trends/trends.ts`, `reports/reports.ts`, `fi/insights.ts` (`monthlyFlows`), `networth/series.ts`, `recurring/summary.ts`, `cash-needed/engine.ts`, `categorize/normalize.ts`, `assistant/answer.ts` (`interpreted` flag).

**AI vs deterministic code.** Deterministic code computes the typed list of contributing factors (label + already-formatted signed cents) and trips the deviation threshold; the LLM only (a) picks the single primary-driver id and (b) writes one connective sentence. Zero arithmetic; it cannot reorder magnitudes.

**Grounding design.** `validateNarrative(prose, allowedNumberStrings)`: every currency/number/percent token in the draft must equal a `formatCents()`/percent output already in the payload (formats normalized), every merchant token in the payload allowlist, any shame word → reject the whole narrative and fall back to a deterministic template ("Dining is up $240 vs your 3-month average").

**Guardrails.** Educational not advisory; shame-word scanner on every line; comparison window stated; never recommends cutting a money-dial category; the deterministic fallback is never a guess.

**Effort / impact.** M / high.

**Adversarial verdict: needs-rework** (fixable, not a drop). The data and engines all verify, and this would be the *first* use of the LLM to generate user-facing prose rather than classify — a genuinely new attack surface. The validator IS the entire safety story and has two demonstrated holes: (1) **word-form magnitude claims** ("nearly doubled," "most of the drop," "tripled") carry no numeral token and sail through; (2) the **causal primary-driver choice is never re-validated** — `trends.ts` ranks movers by `abs(deltaCents)` (correlation, not causation), so the model can foreground a non-top driver. Three rails before build: (i) force `primaryDriver = movers[0]` deterministically or reject any LLM pick that isn't the engine's top mover; (ii) add a banned comparative-magnitude lexicon or constrain prose to a fixed connective template; (iii) keep framing descriptive, not causal. Honest caveat: the deterministic template already delivers ~80% of the value, so the LLM's marginal contribution is prose polish — the hardened design must justify the first-ever prose-generation cost.

#### 2.4 Monthly Money Review — an auto-drafted, honest recap that can't contradict the dashboard *(rank #10)*

**Job-to-be-done.** Hand me a short, honest recap of how last month went, where my money went, what's coming, and the single best thing to do next — I shouldn't have to go ask the coach.

**Why it beats incumbents.** Monarch/Copilot/Simplifi email a generic templated recap identically for everyone; none weave a narrative with per-claim source links AND a hallucination guard, and none degrade gracefully to a fully deterministic zero-key version (our demo-first invariant).

**Engines reused.** `fi/coach-copy.ts` (`generateMoneyReview`, `COACH_COPY`), `fi/insights.ts`, `trends/trends.ts`, `spending-plan/plan.ts` + `conscious.ts`, `networth/series.ts`, `forecast/forecast.ts`, `reports/reports.ts`, `cash-needed/engine.ts`, `src/server/coach.ts`, `api/cron/reminders/route.ts` (dormant-email pattern).

**AI vs deterministic code.** The full candidate insight set is pre-computed with exact numbers. Optional key-gated AI only **selects and orders** which candidates lead (classification over a closed candidate-id set, exactly like `LLM_ROUTABLE_KINDS`). Without a key, today's deterministic review ships unchanged. The cash-needed next-action is always included regardless of LLM ranking.

**Grounding design.** The LLM may only return candidate ids from the closed engine-produced set — it cannot inject a category, number, or merchant. Reuses the Balance-Move number-allowlist over any generated prose; the lead insight is deduped against last month's stored review; cached per month.

**Guardrails.** Every `COACH_COPY` line is already guardrail-scanned (educational, zero shame words, assumptions inline); "one month is weather, not climate" for down months; clearly dated period.

**Effort / impact.** L / high.

**Adversarial verdict: needs-rework.** Two dependencies are mischaracterized in the self-score and must be built, not reused: `generateMoneyReview` today is a thin 4-field if/else, *not* a candidate-insight set with ids; and the "Balance-Move `validateNarrative` allowlist" it claims to reuse **does not exist yet** (it's #2.3 above — sequence them together). The sufficiency claim also fails as worded: a number-allowlist does not catch fabricated *causality*, advisory framing, or shame tone. Required rework: (1) drop or fully constrain any free-prose path to id-selection + templated prose (or add an advisory/shame/causality scanner re-validated in code); (2) build the candidate-set engine and the number-allowlist validator; (3) keep the cash-needed action pinned. After that it's solid; the compliant id-selection core is a faithful clone of the proven router and never lets the LLM originate a fact.

---

### Wave 3 — larger build, or needs new data / an unstructured-input pipeline

These are real and differentiating, but each requires net-new storage, write-path plumbing, or an OCR/vision pipeline the codebase does not have today. Lead is Why-This-Category because it makes the anti-hallucination boundary *visible* with the least new infra of the group.

#### 3.1 Why-This-Category — every label shows its source; AI guesses are flagged, not silent *(rank #3 — Wave 3 lead)*

> **✅ SHIPPED (#238 slice 1 engine+persistence, #239 slice 2 UI+confirm).** The "build-later" verdict below is the AUTHORING-TIME assessment; it was built *with* the live-ingest prediction-logging work it asked for. Do not re-scope from the verdict — see STATUS and DECISIONS #238/#239 for the shipped state.

**JTBD.** When a charge lands in "Dining," tell me *who* decided that and how sure it was, so I can trust the auto-categorization and catch the AI's mistakes before they pollute my budget.

**Why it beats incumbents.** Mint/Simplifi/Monarch silently auto-categorize; Copilot uses AI categorization but presents it as fact. We already compute a `'deterministic'|'llm'` provenance tag and `confidenceBps` — surfacing it turns the anti-hallucination boundary into a visible, correctable trust surface, and tightens today's silent `AUTO_SILENT` auto-file toward disclosure.

**Engines reused.** `categorize/pipeline.ts`, `categorize/llm.ts`, new `categorize/provenance.ts`, `src/server/categorize-assist.ts`, Prisma `CategoryPrediction`/`Correction`/`CategorizationRule`. **AI role unchanged** — the LLM only proposes a category for unsure rows and only wins at `confidenceBps ≥ 9000`. The new work is purely deterministic: persist and render which source won, route AI-sourced rows to a visible "confirm" state.

**Grounding design.** `describeProvenance(predictionRow) → { source, label, confidenceBps, needsConfirm }`, `needsConfirm` iff `source === 'llm'`. A correction writes a `Correction` + `CategorizationRule`, so the human is the final fact-setter; AI auto-files stay reversible. **Guardrails:** no-shame ("want to fix this?" not "wrong"); AI rows framed as suggestions needing a human OK; never auto-files an inflow as a spend category.

**Effort / impact.** M (realistically M/L) / high.

**Adversarial verdict: build-later.** The constitution fit is near-poster-child, but the "small migration" claim is false and *understated*: `source`/`matchedRuleId` are computed transiently and **discarded at every write path** (`Transaction` and `CategoryPrediction` have no `source` column; Plaid/SimpleFIN ingest persist only `categoryId`/`confidenceBps`/`needsReview`; `assistUnsureRows` explicitly strips `source:'llm'`). New finding: `CategoryPrediction` rows are written *only* in `seed.ts` — live ingest writes no prediction rows at all, so the render data is demo-only today. Sharpest gotcha: historical LLM-filed rows are **unrecoverable** (a confident LLM auto-file is byte-identical to a merchant default after write), so this is forward-only — "older rows show source unknown" masks exactly the LLM rows the feature exists to flag. Build it *with* the work to log predictions at live ingest, reframe effort to M/L, and accept the forward-only limit.

#### 3.2 AI Trust Center & Audit Ledger — a live track record and an auditable log of every value AI touched *(rank #6)*

> **✅ SHIPPED (#242 feature; #248 per-touchpoint track record).** All three reworks the "needs-rework" verdict below asked for are done: (a) headline narrowed to "AI-originated dollar figures / financial facts: 0"; (b) `CategoryPrediction.source` + live-ingest prediction logging (via #238); (c) `AuditLog` LLM-touchpoint logging + Trust Center page. #248 added the per-touchpoint track record. Do not re-scope from the verdict — see STATUS and DECISIONS #242/#248.

**JTBD.** Before I rely on this app's AI, prove it's accurate on *my* data, that "90% sure" really means 90%, that it never invents dollar figures, and give me one place to audit every time AI touched my data.

**Why it beats incumbents.** Every competitor asks for blind trust; none show a per-user Brier calibration scorecard, none can honestly claim zero AI-originated dollar figures, and no consumer finance app offers an AI audit trail. Logging *rejections* — proof the guardrail fired and a bad guess was thrown away — is itself a trust signal.

**Engines reused.** `accuracy/score.ts` (`scorePredictions`, Brier — already built), new `ai-audit/describe.ts`, `categorize/llm.ts`, `assistant/intent.ts`, Prisma `AuditLog`/`CategoryPrediction`/`Correction`. **AI role: none at compute time** — this surface only measures and logs the AI.

**Grounding design.** Reuse `accuracy/score.ts` unchanged; copy states sample size inline ("based on 312 confirmed labels"); honest about small n. New formatter turns `AuditLog` rows into human lines; demo (no key) shows an honestly-empty ledger.

**Effort / impact.** M / high.

**Adversarial verdict: needs-rework.** The headline claim breaks as worded: "Numbers the AI computed for you: 0 / every number comes from a tested engine" is *self-falsifying on its own page*, because `pickAssistedCategory` stores the LLM's own `confidence` as `confidenceBps`, and that AI-originated number is the literal input to the Brier scorecard. The defensible, durably-true invariant is the narrower **"AI-originated dollar figures / financial facts: 0."** Three reworks: (a) reword the headline to "dollar figures / financial facts" and treat the LLM confidence as surfaced uncertainty; (b) add a `CategoryPrediction.source` tag and persist predictions in the live ingest path (today the scorecard is permanently empty in production and measures the *categorizer's* accuracy, not "the AI's"); (c) build the `AuditLog` LLM-touchpoint logging (today it logs only user mutations). Genuinely differentiating and constitution-aligned once the claim is narrowed and the write-paths exist.

#### 3.3 Document Onboarding Extractor — snap a statement, paystub, or 401k page into the engines *(rank #4)*

> **✅ SHIPPED as v1 (#247), reshaped exactly per the verdict below** — text-only card statement, span-pointer LLM, reuses `parseManualStatement`. Paystub, 401k, vision/photos, fee watchdog deferred to later slices as the verdict recommended. See STATUS and DECISIONS #247.

**JTBD.** My credit-union card, my employer's 401k, and my pre-tax 401k+match won't link to anything — let me snap the statement/paystub/page and have the app onboard the numbers without typing six fields, and tell me if a fee or APR quietly changed.

**Why it beats incumbents.** Pre-tax 401k contribution+match and disclosure-box APR/fee changes (non-transaction events) are **structurally invisible** to every aggregator; YNAB makes you hand-type. Extracting them from the document, then re-validating against the engines, reaches a depth no aggregator can.

**Engines reused.** `cards/manual-statement.ts` (`parseManualStatement`), `cash-needed/engine.ts`, new `paystub/parse.ts`, `settings/dials.ts`, `investments/retirement.ts` + `portfolio.ts`, `networth/series.ts`, `debt/payoff.ts`, `categorize/llm.ts` (validator template). **AI is a constrained extractor only** — it returns one JSON object per doc type, each field with a confidence + the verbatim source span. It labels/copies; it never sums, computes, or invents a ticker.

**Grounding design.** Mirrors `parseFromText → parseLlmCategory`: a new pure validator per doc keeps a field only if it passes the *same* deterministic checks the manual paths enforce, plus **arithmetic reconciliation gates** (paystub net ?= gross − deductions; portfolio Σpositions ?= stated balance; disclosed APR vs on-file APR). Period→monthly computed in code; store the fund *name* if no printed ticker. Nothing writes until the human confirms; manual-source holdings never overwritten.

**Effort / impact.** L (realistically XL if photos ship in v1) / high.

**Adversarial verdict: build-later, bordering needs-rework on scope.** The grounding pattern is real and exact, but: (1) the reconciliation gates are strong for paystub/portfolio yet **absent for single-number statement fields** like `statementBalance` — a transposed digit passes every gate, leaning entirely on human-confirm + the source span; (2) no vision/OCR path exists in `src/` today; (3) the 401k contribution+match has no home in the schema; (4) sending paystub PII to a model **directly contradicts** the live `ask-view.tsx` promise "your account data is never sent to it." Recommended reshape: ship a **single text-PDF doc type as v1 — the card statement** (reuses `parseManualStatement` verbatim, needs no new schema, adds a code check that the model's returned substring literally exists in the source text, avoids the worst PII). Defer paystub, 401k holdings, vision/photos, and the fee watchdog to later slices.

#### 3.4 Subscription Radar & Negotiation Drafter — catch the quiet hike, forecast the renewal, draft the pushback *(rank #8)*

> **✅ SHIPPED — deterministic radar slice (#246):** two-plateau price-hike detection + 5 surfaces, dormant-sub flag, and the forward 7/30/90-day renewal schedule. The negotiation drafter is DEFERRED per the verdict (free-form LLM prose over money facts is unsafe). See STATUS and DECISIONS #246.

**JTBD.** Tell me the moment a subscription crept up or one I stopped using is still charging me, warn me before the annual hit ambushes my statement, and hand me the exact pushback script with my real numbers in it.

**Why it beats incumbents.** Rocket Money/Simplifi show a static list and surface a hike only as a vague after-the-fact note; none build a forward-dated calendar of the *next* charge with predicted amount, and Rocket/Billshark charge a cut to negotiate. **Engines reused:** `recurring/detect.ts` + `summary.ts`, `fi/insights.ts` (`findOpportunities`), `fi/fi.ts` (`opportunityFVCents`), `calendar/build.ts`, `reports/reports.ts`. Detection + renewal calendar + the fact pack are 100% deterministic; optional AI drafts the prose of a negotiation script around an injected, locked fact block.

**Effort / impact.** M (realistically M/L) / high.

**Adversarial verdict: needs-rework.** The deterministic radar (2-plateau price detector, dormant-sub flag, 7/30/90-day renewal calendar for monthly/weekly/biweekly series) is genuinely differentiated and ships safely now. But the *scored headline* fails scrutiny on two points: (1) the number/date whitelist does **not** make the generative script safe — it is blind to qualitative fabrication ("long-time customer," "for years," a fabricated competitor claim) that contains no number; (2) the flagship **annual** pre-warn is ungroundable in demo and for most users (`detect.ts` drops series with <3 occurrences, so annual cadence needs ~2+ years of history; the demo has 18 months) and "real tenure" needs net-new plumbing (`RecurringSeriesResult` has no first-seen field). Rework: demote/strongly-caveat or cut the annual feature until ≥2yr history exists; build + bound tenure plumbing; replace free-form generation with slot-filled templates (or expand the whitelist to qualitative-claim rejection, tested adversarially). Degrades safely — reputational risk, not silent corruption.

#### 3.5 Receipt Splitter — receipt photo to a reconciled multi-category split *(rank #15)*

**JTBD.** My $214 Costco run is groceries, household, and a tire but lands as one transaction in one category — snap the receipt and split it correctly. **Why it beats incumbents:** Monarch/YNAB split by hand; none itemize a receipt photo and *prove* the parts sum to the authoritative charge. **Grounding is exemplary:** the reconcile gate already ships (`triage-actions.ts:280-283` throws unless parts sum *exactly* to `amountCents`, with sign/whole-cent guards and an atomic race-safe claim), so the AI is a pure additive prefill that cannot persist a bad split.

**Effort / impact.** M (realistically M/L) / med. **Adversarial verdict: needs-rework.** Three substantive issues: (1) the headline "categories finally get clean *automatically*" overstates — printed line items are pre-tax subtotals while the charge is post-tax, and order-level discounts (RedCard, Costco rebates) don't reconcile per-line, so the gate (correctly) fails on a large fraction of real receipts and degrades to "AI-prefills-a-split-you-then-fix"; (2) Amazon (a named target) has no paper receipt and splits across shipments — needs structured order-page import, not a photo; (3) the vision path is net-new infra and contradicts the "never sent" disclosure. Reworks: downgrade the headline to "assisted prefill," specify tax/discount handling in the reconcile design, and fix the privacy disclosure. Safety is the best in the set; the ceiling is reconcile frequency and capture friction.

---

### Later — inventive, lower-certainty, or product/scoping questions first

Real ideas worth keeping on the board, but each needs a design or product decision resolved before it earns engineering time. Compressed to the essentials.

- **Scenario Studio — compound what-ifs + sensitivity band (#13, XL, needs-rework).** Type "switch jobs, take a 15% pay cut, throw $300/mo at my cards" and see the effect on debt-free date, cash crunch, and retirement, with an honest ± sensitivity grid (never a fake Monte-Carlo probability). The fabrication-proof claim *holds* (LLM is a parameter-mapper emitting `{knob, op, tokenRef}` with no numbers, clamped via `DIAL_LIMITS`). Two blockers: (a) there is no unified scenario-snapshot assembler — a "pay cut" must propagate *identically* across savings-rate, FI, forecast, cash-needed, AND retirement, or you ship a silent inconsistency; that coherence layer must itself become a tested engine. (b) The **decision-comparison half** ("$6k to the loan or invest it?") is structurally advisory and is the reason this isn't build-now — split it out and either reframe it as non-comparative outcomes or drop it. Ship the groundable what-if + sensitivity band only, *after* the snapshot engine lands.

- **Adaptive Coaching Profile — your money signature (#11, M/L, ✅ SHIPPED 2026-07-21, #252).** Shipped exactly per the rework verdict below: pure `engine/fi/signature.ts` with hysteresis as a RETROSPECTIVE WALK over the monthly series (dead-zone bands + a 3-consecutive-month persistence gate; no stored state, so labels are a pure function of history and cannot oscillate on recompute by construction), two habit axes (saving consistency over ≤12 eligible months; spending steadiness as MAD/median over the trailing 6 full months — the §12 radar's integer convention) decoupled from a deliberately responsive "this month" weather state (strained/tight/calm/bright, personal-best via the streak engine), and habit framing enforced by a locked identity-lexicon ban (no archetype nouns, no "you are a…"). One /coach card; facts inline; seed untouched with a hand-verified steady/steady/calm lock. See STATUS §Money Signature + DECISIONS #252. *Original verdict (authoring-time):* A behavior-derived archetype + "financial weather" state that re-tones the same facts (calm when strained, celebratory when thriving). Groundable and constitution-fitting, but the core claim breaks: discrete threshold cuts over continuous cents **oscillate every recompute** (Cushion-builder ↔ Edge-walker), and there is zero hysteresis/smoothing in the engines — a label flip while both cite a true number reads as *more* arbitrary. Rework: require N-month persistence / hysteresis before any axis label changes; decouple stable axes from the responsive weather state; reword identity framing toward habits, not personality.

- **Life-Event Radar — notice the big change, re-frame the plan (#20, L, ✅ INCOME-PAUSE HALF SHIPPED 2026-07-21, #251; the rest stays hard-gated).** The one groundable signature is now BUILT exactly per the verdict below: pure `engine/income/pause.ts` (lapsed `isIncome` series — expectation from `nextDate(lastSeenAt, cadence)`, never the forward-stepped `nextExpectedAt` which hides lapses; cadence-scaled grace W5/BW7/M10, occurrences ≥4, $100 floor, ANNUAL + aggregates excluded, 60-day news cap on the nudge only), surfaced as an ACTION-tier `income_pause` nudge with the runway figure ("about N months, cash ÷ 6-month average expenses") disclosed inline, and an engineered demo seed pause (+$380×4 "Stripe Payout", silent since asOf−2mo). The mutation IS the verdict's `projectedIncome = 0`, shipped confirmation-gated: "Yes, it's paused" (IncomePauseConfirmation) excludes the series from `toScheduledTransactions` projections + the automation blueprint while lapsed; the confirmed pause stays in the feed as a quiet HANDLED row carrying the Undo (a money mutation never outlives its own visibility), auto-reverts when a deposit resumes (stale confirmations deleted), demo-fenced. See STATUS §Income-Pause Radar + DECISIONS #251. The OTHER signatures (new dependent, relocation) stay hard-gated on the original grounds: they collapse into `computeSpendingTrends` movers + a label with *no ground truth* — unsatisfiable under rule #3's hand-verified-expected-values discipline. *Original verdict (authoring-time):* Detect structural signatures (income-pause, new dependent, relocation) and re-frame the plan with the user's confirmation. The strong claim holds for **exactly one** signature: income-pause → runway support (a lapsed `isIncome` series + thin runway is high-precision and high-stakes). Ship the income-pause/runway slice as its own narrow engine; hard-gate the rest. Also note the "pure recompute" must *mutate* assumptions (force `projectedIncome = 0`), which is real new work.

- **Habits & Plan Adherence — streaks + did your automation run? (#17, M, needs-rework).** Splits cleanly: the groundable streaks (card cleared in full, savings-rate personal best, no subscription creep) can ship build-now and are mildly novel; the *differentiating* drift loop ("blueprint said $500, only $300 landed") is the least grounded — `detectTransfers` returns only a `Set<string>` of ids with no destination/pairing/confidence, and the app models savings as an income−expenses residual, not a tracked flow. Rework: build a real transfer-pair engine (destination + confidence + a correction trail), hard-gate on both-legs-connected, descope to aggregate intended-vs-inferred.

- **Unusual Charge & Double-Bill Radar — outliers on your own history (#12, M, ✅ OUTLIER HALF SHIPPED 2026-07-20, #249).** Per-merchant median+MAD outlier detection genuinely beats flat "large transaction" thresholds. The reshape verdict ("ship the per-merchant outlier detector after seeding 1-2 engineered anomalies; defer the duplicate detector until timestamps are captured or a ground-truth-tested whitelist exists") is now BUILT: pure `engine/anomaly/detect.ts` (median+MAD, K=4 + $40 additive floor, ≥6-sample baseline, 45-day flag window, aggregate pseudo-merchants excluded), the engineered $214.36 Blue Bottle seed anomaly (demo-first satisfied — the "$214 coffee" now exists), surfaced as an ACTION-tier `unusual_charge` nudge with the median basis disclosed inline. See STATUS §Unusual Charge Radar + DECISIONS #249. The *double-bill* half stays deferred on its original blocker: `Transaction.date` is date-only (no intraday timestamp), so a genuine same-day double-charge and two legitimate visits are indistinguishable.

- **Threaded Ask — multi-turn follow-ups (#21, M, needs-rework).** "What about dining?" / "and the month before?" The no-fabrication half holds, but the described concatenation mechanism is *wrong*: `resolveSpendTarget`/`parseTimeframe` are ordered first-match-wins, so "groceries…what about dining" silently returns groceries, and "the month before" has no relative-offset arithmetic at all. Plus the marquee value is effectively key-gated (follow-ups parse to `unknown` and hit `answerUnknown` with no key). Needs follow-up-first resolution + net-new tested relative-timeframe math + a stateful API contract.

- **Merchant Pattern Lens — "here's your relationship with X" (#19, M, ✅ SHIPPED 2026-07-21, #250).** Shipped exactly per the reshape verdict below: deterministic profile + templated narration, generative-LLM framing dropped. Pure `engine/merchant/profile.ts` (count/total/first-last/median-typical + full-month recent-vs-prior trend, honest abstentions for aggregates and thin history) + pure `lens-copy.ts` templates, surfaced as a `?merchant=` register filter with a lens card (tap any merchant name). The median shares the §12 radar's exact convention — a seed lock proves the two surfaces agree. The "weekday mornings" class of claim is BANNED by a locked lexicon test, not just omitted (time-of-day data doesn't exist). See STATUS §Merchant Pattern Lens + DECISIONS #250. *Original verdict (authoring-time):* A per-merchant behavioral profile in plain language. The pure profile engine is worth building (medium-impact curiosity surface), but the AI value prop hangs on a "Balance-Move number-whitelist" precedent **that doesn't exist yet**, a digit-whitelist can't validate qualitative claims, and the flagship example ("weekday mornings") needs time-of-day data we don't capture. Ship the deterministic profile + templated narration; drop the generative-LLM framing.

---

## 4. What NOT to build (and why)

These were genuinely considered and are being recommended **against** — so the owner can see the reasoning, not just the absence.

- **Fairness Ledger — household who-pays-what + settle-up (#16).** The entire feature rests on both partners' funding accounts living in **one** Aimplifi login — but the reason Splitwise exists is that couples *don't* share PFM logins. In the realistic separate-login case the partner's payments and after-tax income simply aren't in the database, and the differentiation collapses to the manual re-keyed side-app it claims to replace. It also requires three net-new schema additions (account owner tag, a SplitRule store, a per-transaction shared/personal flag) and is in direct tension with the data-retention model ("household members = separate users"). This is a fundamental product-market problem, not polish. Re-scope the architecture or shelve it.

- **Year-End Tax-Aware Nudges (#18).** The honest, groundable version is thin: "here are your YTD charity/property-tax/childcare totals vs a coded standard-deduction constant — confirm with a pro." Everything richer is **ungroundable on data we lack** — no AGI (so no medical 7.5%-floor, no true itemize-vs-standard), no FSA/HSA payroll contributions (so "did I max dependent-care" is impossible; childcare *spend* ≠ FSA *contributions*), no SALT state-income component. This is also the **highest-liability** flavor of "educational not advice," and most tax content is *non-numeric*, so the number-byte-match guard can't bound it. Useful ~2 months/year at best. If pursued, hard-constrain the LLM to a vetted note library and ship only raw totals + tax-year-stamped constants.

- **Money Dial Finder — infer what you value from spending (#14).** The novelty is real (no incumbent infers values from behavior), but the scoring proxy **inverts its own thesis on our own data**: pure low-variance + persistence rewards subscriptions, streaming, and coffee (the canonical *mindless* spend it promises to distinguish) and *penalizes* travel (the prototypical money dial, because it's lumpy). The target field is also display-only, so even a corrected version is a one-time setup moment, not a recurring decision aid. Needs the engine reworked (down-weight raw variance, special-handle subscriptions/entertainment, lead with share-of-discretionary) before it's worth UI.

- **The decision-comparison half of Scenario Studio and any "which option wins by $X" output.** Computing that one option beats another by a dollar amount is a recommendation in substance; neutral "the right call is yours" copy does not cure it. It flirts with the licensed-advice line the constitution draws. Keep what-if illustration; drop the comparative verdict.

- **An SEC-regulated AI advisor (the Origin path) or an MCP "make Claude manage your money" agent (the Era path).** Named here for completeness because the market is moving this way. Both invert our entire thesis: they hand reasoning and action-taking to a general LLM, maximizing the hallucination surface precisely on transfers and money math — the opposite of "the LLM never originates a fact." Our moat is *not* being the most agentic app; it is being the most *trustworthy* one. Do not chase this battleground.

---

## 5. Recommended first build — ✅ BUILT (DECISIONS #125)

**Build the debt-free-by-date slice of *Plan in Words* (#1).** It is the highest leverage + lowest risk concept in the entire set: the single build-now verdict with the cleanest monotonicity, the purest constitution fit ("essentially the purest possible expression of LLM-never-originates-a-fact"), zero new storage, and it lands on the unowned inverse-planning job while reusing engines that already ship.

**Engine-first build sketch (no UI until the pure module is green):**

- **New pure module:** `src/lib/engine/solve/debt-free-by-date.ts`.
- **Signature:** `solveDebtFreeByDate(input: { debts: DebtInput[]; targetDate: IsoDate; today: IsoDate; safeToSpendCents: number }) → { feasible: boolean; requiredExtraMonthlyCents: number; shareOfSafeToSpendBps: number; monthsToDebtFree: number }`.
- **Method:** a bounded, integer-cent **bisection** over `planDebtPayoff`'s `extraMonthlyCents → monthsToDebtFree` (non-increasing, so monotone-bisectable), capped iterations with proven bounds — a direct generalization of the shipped `coastFI` binary search. Infeasible targets (not reachable at these inputs) return `feasible: false`, never a fabricated amount. The answer is expressed as `shareOfSafeToSpendBps` against real `getSpendingPlan` output.
- **Test idiom:** EDGE_CASES-pinned bisection cases with hand-verified expected cents — zero-interest debt, goal-already-met, non-convergence, and a target that is reachable only with an extra payment exceeding safe-to-spend (returns `feasible: false` + the honest figure). Same discipline as the cash-needed engine's edge-case suite.
- **AI boundary:** the LLM extracts *only* the target date and goal-type from the sentence; a deterministic regex/`parseTimeframe` tier owns date extraction so it works zero-key in demo; any echoed dollar amount is string-matched verbatim against the user's text before use. The solver produces the number; the model never does.
- **Surface — no 8th nav icon:** the result lands on the **existing Ask Aimplifi and Goals surfaces** as a grounded answer card ("to be debt-free by Dec 2027 you'd add ~$420/mo — about 38% of your current safe-to-spend"), reusing the assistant's `interpreted` banner and confirm-before-create flow.

If the owner says "do that," the next slice is the arbitrary savings goal, and retire-at-age (accumulation + decumulation) ships last per the sequencing the adversarial review required.

---

*This is a plan only — no application code has been changed. It is awaiting the owner's pick, consistent with the repo's plan-doc convention.*