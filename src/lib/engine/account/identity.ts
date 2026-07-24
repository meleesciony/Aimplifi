/**
 * The account identity ladder (docs/ACCOUNT_IDENTITY_ARCHITECTURE.md §5) — TASKS L.10.
 *
 * Answers ONE question: are these two account rows provably the same real account, provably
 * different, or is it unproven? It is deliberately narrow. It runs **only within one provider
 * at one institution**, because that is the only scope in which the comparison it makes is
 * sound:
 *
 *   * Within one provider+institution both last-4s come from the SAME convention, so a
 *     DIFFERENCE means different accounts. That veto is what protects the owner's stated
 *     case (A): a husband's and a wife's card on one issuer must never be merged away.
 *   * ACROSS providers the same comparison is false — SimpleFIN's "396" and Plaid's "5351"
 *     are the same real Schwab account (owner-confirmed, TASKS L.9). So this module refuses
 *     to answer cross-provider at all rather than exporting a veto someone could reuse there.
 *     Cross-provider identity stays user-confirmed forever (`duplicates.ts` + reconciliation).
 *
 * Two rules this module holds to, both learned the expensive way:
 *
 *   * **A null is UNKNOWN, never "differs"** (decision recorded in the design doc §5 after the
 *     slice-1 critic). Every veto needs a value on BOTH sides. The rows most likely to carry a
 *     null are the stale halves of the duplicates this feature exists to fix, so reading a null
 *     as "differs" would veto exactly the pairs it is for — and reading it as a match would
 *     prove pairs nothing supports. An absence is not evidence
 *     (docs/lessons/an-empty-set-is-not-a-fact-about-money.md).
 *   * **An identical balance never proves anything** (invariant D4). Two cards on ONE account
 *     share one balance, and two empty accounts share $0.00 — it is a fine signal for an
 *     advisory (`duplicates.ts` uses it, correctly) and no basis at all for an action. This
 *     module never looks at a balance.
 *
 * Pure: no React, no DB, no `new Date()`, no model calls. Deterministic.
 */

/**
 * `same` — proven the same real account; an action may be OFFERED (never taken automatically).
 * `different` — proven different; never offer, and override any weaker positive signal.
 * `unproven` — no conclusion. Falls through to the advisory layer, which is where every pair
 * this ladder cannot prove belongs.
 */
export type IdentityVerdict = 'same' | 'different' | 'unproven';

/** Which rung produced a `same`. `P` = Plaid's persistent id; `A` = last-4 + type + currency. */
export type IdentityTier = 'P' | 'A';

/** The identity-bearing fields of one account row, plus its connection's institution. */
export interface IdentityAccount {
  /** The provider that minted the row: 'plaid' | 'simplefin' | 'manual' | 'demo' | … */
  readonly provider: string;
  /** Plaid's stable `ins_*` id for the connection this row came through (L.10 slice 1). */
  readonly institutionId: string | null;
  /** The connection's human institution name — the fallback when no id has been resolved yet. */
  readonly institutionName: string | null;
  /** Last-4, from the mask COLUMN only. A number parsed out of a NAME is never a veto input. */
  readonly mask: string | null;
  /** CHECKING | SAVINGS | CREDIT | INVESTMENT | LOAN */
  readonly type: string;
  /** The provider's raw subtype ('checking', 'credit card', 'roth', 'traditional'). */
  readonly subtype: string | null;
  /** ISO-4217; null assumed USD (legacy/manual rows). */
  readonly currency: string | null;
  /** Plaid `persistent_account_id` — survives a re-link, but only at TAN institutions. */
  readonly persistentAccountId: string | null;
  /** The connection (PlaidItem) this row arrived through, when known. Two rows returned by the
   *  SAME connection are different accounts by the provider's own construction — see the veto. */
  readonly connectionId: string | null;
}

export interface IdentityResult {
  readonly verdict: IdentityVerdict;
  /** Set only on a `same` verdict. */
  readonly tier: IdentityTier | null;
  /** Human-readable evidence, for disclosure in the UI. Never empty on a decided verdict. */
  readonly reasons: readonly string[];
}

/** Seed/fixture and user-typed rows are never subject to any of this (invariant D8). */
const EXCLUDED_PROVIDERS = new Set(['demo', 'manual']);

function norm(s: string | null): string | null {
  const t = (s ?? '').trim();
  return t.length > 0 ? t : null;
}

function normCurrency(c: string | null): string {
  return (c ?? 'USD').trim().toUpperCase();
}

function normLower(s: string | null): string | null {
  const t = norm(s);
  return t === null ? null : t.toLowerCase();
}

const UNPROVEN: IdentityResult = { verdict: 'unproven', tier: null, reasons: [] };

/**
 * Whether the two rows are known to sit at ONE institution — the scope the ladder is valid in.
 *
 * Plaid's `institution_id` is the real answer; the human name is the fallback, because the id
 * is backfilled by an ordinary sync sweep and a row linked before L.10 slice 1 carries null
 * until then. The name is the *same field the user reads on screen* ("Plaid: Chase"), so a
 * name match is exactly as strong as what the user is being asked to confirm — and the ladder
 * still requires a last-4 match on top of it before it will say `same`.
 *
 * Returns null when neither side can be established: unknown institution ⇒ unproven, never same.
 */
function institutionMatch(a: IdentityAccount, b: IdentityAccount): { matched: boolean; reason: string } | null {
  const idA = norm(a.institutionId);
  const idB = norm(b.institutionId);
  if (idA !== null && idB !== null) {
    return idA === idB ? { matched: true, reason: 'same bank' } : { matched: false, reason: 'different banks' };
  }
  // Exactly one side has an id ⇒ NO conclusion. Downgrading to the name here would be the worst
  // of both: Plaid carries many distinct `ins_*` under near-identical names ("Citizens Bank",
  // "First National Bank"), so a row that HAS been identified would be matched against one that
  // has not, on a string the two banks share (critic P2-5). The pair falls to the advisory layer
  // until the ordinary institution sweep gives the other side its id.
  if (idA !== null || idB !== null) return null;
  const nameA = normLower(a.institutionName);
  const nameB = normLower(b.institutionName);
  if (nameA !== null && nameB !== null) {
    return nameA === nameB
      ? { matched: true, reason: `same bank (${norm(a.institutionName)})` }
      : { matched: false, reason: 'different banks' };
  }
  return null;
}

/**
 * Compare two account rows on the identity ladder. Order matters: every veto is evaluated
 * BEFORE any positive rung, so a proven difference can never be overridden by a match one rung
 * down.
 *
 * The one place the doc's "first hit wins" and "the veto overrides everything" collide is
 * `persistent_account_id` equal + last-4 different. Decided here: that is CONTRADICTORY
 * evidence, not a proof either way, so it yields `unproven` and the pair falls to the advisory
 * layer. Neither reading is safe enough to act on — merging on the persistent id would fold two
 * differently-numbered cards together, and vetoing on the mask would discard the strongest
 * identifier Plaid publishes.
 */
export function compareAccountIdentity(a: IdentityAccount, b: IdentityAccount): IdentityResult {
  // ---- Scope guards. Outside the ladder's scope there is no verdict, not a negative one. ----
  if (EXCLUDED_PROVIDERS.has(a.provider) || EXCLUDED_PROVIDERS.has(b.provider)) return UNPROVEN;
  // Cross-provider is NOT answered here (L.9): a differing last-4 across providers is not a
  // veto, and this module's whole value is that its veto is sound. Refusing keeps it sound.
  if (a.provider !== b.provider) return UNPROVEN;

  // Two rows from ONE connection are different accounts by construction: a provider mints one
  // row per account it returns, and the ingest upsert is keyed on that id. Without this, the
  // ladder would "prove" two sibling cards at one bank are the same whenever they share a
  // last-4 shape — so the veto lives HERE rather than in each caller's pair loop, which is the
  // only way it also covers callers written later
  // (docs/lessons/fence-by-construction-not-per-call-site.md).
  const connA = norm(a.connectionId);
  const connB = norm(b.connectionId);
  if (connA !== null && connB !== null && connA === connB) {
    return { verdict: 'different', tier: null, reasons: ['one connection returned both, so the bank lists them separately'] };
  }

  const institution = institutionMatch(a, b);
  if (institution === null) return UNPROVEN;
  if (!institution.matched) return { verdict: 'different', tier: null, reasons: [institution.reason] };

  const maskA = norm(a.mask);
  const maskB = norm(b.mask);
  const masksKnown = maskA !== null && maskB !== null;
  const masksDiffer = masksKnown && maskA !== maskB;

  // ---- Vetoes (tier V). Each needs a value on BOTH sides; one missing ⇒ the veto is silent. ----
  const persistentA = norm(a.persistentAccountId);
  const persistentB = norm(b.persistentAccountId);
  if (persistentA !== null && persistentB !== null && persistentA !== persistentB) {
    return { verdict: 'different', tier: null, reasons: ['the bank reports them as different accounts'] };
  }
  if (norm(a.type) !== norm(b.type)) {
    return { verdict: 'different', tier: null, reasons: ['different kinds of account'] };
  }
  if (normCurrency(a.currency) !== normCurrency(b.currency)) {
    return { verdict: 'different', tier: null, reasons: ['different currencies'] };
  }
  const subtypeA = normLower(a.subtype);
  const subtypeB = normLower(b.subtype);
  if (subtypeA !== null && subtypeB !== null && subtypeA !== subtypeB) {
    // The signal that keeps a Roth from proposing against a Traditional (L.9).
    return { verdict: 'different', tier: null, reasons: [`different kinds of account (${subtypeA} vs ${subtypeB})`] };
  }

  // ---- Tier P — the bank's own cross-Item identifier. ----
  if (persistentA !== null && persistentB !== null && persistentA === persistentB) {
    if (masksDiffer) return UNPROVEN; // contradictory evidence; see the doc comment above.
    return {
      verdict: 'same',
      tier: 'P',
      reasons: [institution.reason, 'the bank reports the same account id for both'],
    };
  }

  // A differing last-4 within one provider+institution is the veto that protects case (A).
  if (masksDiffer) {
    return { verdict: 'different', tier: null, reasons: [`different last-4 (${maskA} vs ${maskB})`] };
  }

  // Retirement accounts are the one place where a silent absence is too dangerous to allow
  // through: a Roth and a Traditional at one brokerage are both INVESTMENT, often share a name
  // fragment, and the ONLY field that separates them is the subtype (TASKS L.9) — which a
  // disconnected row frequently lacks, because it is stamped on a best-effort call that a broken
  // connection is exactly the case to fail. So here, and only here, an unknown subtype is
  // disqualifying rather than merely silent: no proof, advisory layer, user decides.
  if (norm(a.type)?.toUpperCase() === 'INVESTMENT' && (subtypeA === null || subtypeB === null)) {
    return UNPROVEN;
  }

  // ---- Tier A — same last-4, same kind, same currency, at one institution. ----
  if (masksKnown) {
    return { verdict: 'same', tier: 'A', reasons: [institution.reason, `same last-4 (${maskA})`] };
  }

  // No last-4 on one side or both: nothing here proves anything. Names being alike and balances
  // being equal are advisory signals, and they live in duplicates.ts where they can only warn.
  return UNPROVEN;
}

/** Convenience: the ladder proved these two rows are the same real account. */
export function isProvenSameAccount(a: IdentityAccount, b: IdentityAccount): boolean {
  return compareAccountIdentity(a, b).verdict === 'same';
}
