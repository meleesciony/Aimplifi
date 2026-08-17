/**
 * Money Dials — the pure validation / normalization engine for the per-user
 * settings a real user configures during onboarding and from /settings:
 *   - hourly wage (powers the YMOYL "hours of work" / life-energy view)
 *   - safe withdrawal rate (SWR — the FI number is annual spend ÷ this rate)
 *   - expected return (used for years-to-FI, Coast FI, and opportunity-cost FV)
 *   - the personal "money dials" they spend on intentionally (category ids)
 *   - the checking/savings account card payments are drawn FROM (the single
 *     input the entire Cash-Needed Engine is computed against)
 *
 * No React, no DB, no `new Date()`: raw form strings in → validated, normalized
 * values OR per-field errors out. Every error is accumulated (all fields
 * reported at once) so the form never plays whack-a-mole. The engines
 * (src/lib/engine/fi, src/lib/engine/cash-needed) consume the normalized output
 * unchanged — this module is the one boundary where free text becomes the typed
 * `swrBps` / `expectedReturnBps` / `hourlyWageCents` the engines already take.
 *
 * Bounds are chosen to keep those engines well-defined and the numbers credible,
 * NOT to pass judgement on anyone's plan:
 *   - SWR 1.00%–10.00% (100–1000 bps). `fiNumberCents` THROWS on swrBps ≤ 0
 *     (divide-by-zero), so 0 must be rejected here; > 10% makes the FI multiple
 *     < 10× spending, which is not a retirement target.
 *   - Expected return 0.00%–15.00% (0–1500 bps). 0 is the valid "assume no
 *     growth" case the FI engine handles explicitly; a long-run nominal return
 *     above 15% is not credible.
 *   - Wage optional; if set, $0.01–$10,000.00/hr (1–1,000,000 cents). Empty
 *     clears it (the life-energy view then hides itself; hoursOfWork → 0).
 *   - ≤ 12 money dials, each a budgetable category id (O.17a).
 *   - Payment account must be one the user OWNS and be CHECKING or SAVINGS —
 *     you fund a card payment from cash, never from another card/loan/brokerage.
 *
 * See docs/EDGE_CASES.md §Money-Dials for the hand-verified parse table and
 * docs/DECISIONS.md #28.
 */
import { centsFromDollarString } from '@/lib/money';
import { RETIREMENT_ASSUMPTIONS } from '@/lib/engine/investments/retirement';
import { CATEGORIES } from '@/lib/engine/categorize/categories';
import { isBudgetable } from '@/lib/engine/budgets/status';

export const DIAL_LIMITS = {
  swrBps: { min: 100, max: 1000 }, // 1.00% – 10.00%
  expectedReturnBps: { min: 0, max: 1500 }, // 0.00% – 15.00%
  wageCents: { min: 1, max: 1_000_000 }, // $0.01 – $10,000.00 / hr
  dials: { maxCount: 12 },
  // Retirement-plan ages (DECISIONS #123). Generous windows kept engine-safe by the
  // cross-field ordering check below (currentAge ≤ retirementAge < endAge ≤ 120).
  currentAge: { min: 18, max: 100 },
  retirementAge: { min: 18, max: 110 },
  endAge: { min: 19, max: 120 },
  inflationBps: { min: 0, max: 1000 }, // 0.00% – 10.00%
  // Pay-yourself-first savings target (#295 / L.11(C)): % of expected monthly
  // income reserved before guilt-free spending. 0% is a valid explicit "goals
  // only"; the ceiling is deliberately generous (a FIRE-style saver may target
  // well past Sethi's 20%) but stops short of 100%, where the plan would claim
  // every future dollar is spoken for from a number that is itself an estimate.
  savingsTargetBps: { min: 0, max: 9000 }, // 0.00% – 90.00%
} as const;

/**
 * The app's expected-return dial, in bps — the SAME 700 as `User.expectedReturnBps
 * @default(700)` in prisma/schema.prisma, which is asserted against this constant in
 * `tests/unit/return-dial-default.test.ts` (the whole possessive below rests on that equality).
 *
 * W.13. Unlike `inflationBps`, this column is NOT nullable and the /settings field is
 * REQUIRED, so there is no stored "unset" state to read: every reader who has never chosen a
 * return carries the app's 700 and is indistinguishable, in the row, from one who typed 7.
 * The copy therefore attributes the dial by VALUE — see `returnIsAppDefault`.
 */
export const DEFAULT_EXPECTED_RETURN_BPS = 700;

/**
 * Whether the reader's return dial is still the number Aimplifi picked.
 *
 * This is a claim the money copy makes out loud ("our default 7.00% return assumption"), so
 * it may only assert what value-equality proves: that 7.00% IS our default and IS the rate in
 * use. It may NOT say "which you haven't changed" — a reader who deliberately typed 7 is
 * inside this branch and no column records the difference.
 *
 * The one reachable error runs in the safe direction: a reader who chose exactly 7.00% is
 * told the app's default is 7.00%, which is true and merely under-credits them. The inverse —
 * telling a reader who never opened /settings that 7.00% is "your return assumption" — is the
 * false claim W.13 exists to remove (`an-answer-is-only-as-believable-as-its-visible-inputs`:
 * a possessive is a claim). Making the column nullable would not fix it: every row already in
 * the database holds 700, so the new meaning would describe none of them
 * (`a-new-meaning-for-an-old-column-is-a-migration`).
 */
export function returnIsAppDefault(expectedReturnBps: number): boolean {
  return expectedReturnBps === DEFAULT_EXPECTED_RETURN_BPS;
}

/**
 * Who chose each of the two rates a projection is worked out from. Passed as ONE named object
 * rather than two positional booleans: the copy functions below take both, `boolean` is not
 * distinguishable from `boolean` to tsc, and a silent swap would put each dial's possessive on
 * the other dial's rate.
 */
export interface DialOwnership {
  /** True when `expectedReturnBps` is still `DEFAULT_EXPECTED_RETURN_BPS` (see above). */
  returnIsDefault: boolean;
  /** True when `User.inflationBps` was null and the read fell back to `RETIREMENT_ASSUMPTIONS`. */
  inflationIsDefault: boolean;
}

/** Account types from which a card payment may legitimately be drawn. */
export const PAYMENT_ACCOUNT_TYPES = ['CHECKING', 'SAVINGS'] as const;

export interface RawDials {
  /** Dollars, e.g. "38" / "38.50". Empty string = clear (unset). */
  wage: string;
  /** Percent, e.g. "4" / "4.25". */
  swr: string;
  /** Percent, e.g. "7" / "6.5". */
  expectedReturn: string;
  /** Category ids, separated by newlines and/or commas (picker checkboxes). */
  moneyDials: string;
  /** Account id the user picked to fund card payments. */
  paymentAccountId: string;
  /** Whole years. Empty string = use the default planning assumption. */
  currentAge: string;
  retirementAge: string;
  endAge: string;
  /** Percent, e.g. "2.5". Empty string = use the default inflation assumption. */
  inflation: string;
  /** Percent of the monthly income pattern to save first, e.g. "15". Empty string = unset (goals only). */
  savingsTarget: string;
}

export interface NormalizedDials {
  hourlyWageCents: number | null;
  swrBps: number;
  expectedReturnBps: number;
  moneyDials: string[];
  paymentAccountId: string;
  /** Retirement-planning assumptions; null = "unset, use the default" (DECISIONS #123). */
  currentAge: number | null;
  retirementAge: number | null;
  endAge: number | null;
  inflationBps: number | null;
  /** Pay-yourself-first target, bps of the monthly income pattern; null = unset (goals only). */
  savingsTargetBps: number | null;
}

export type DialField = keyof RawDials;
export type FieldErrors = Partial<Record<DialField, string>>;

export type ValidateResult =
  | { ok: true; value: NormalizedDials }
  | { ok: false; errors: FieldErrors };

/** Drop ASCII control characters (tabs/CR that survive the split) and DEL. */
function stripControl(s: string): string {
  let out = '';
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) continue;
    out += ch;
  }
  return out;
}

/**
 * Parse a percent string ("4", "4.25", "10", " 6.5 ", "7%") to integer basis
 * points WITHOUT float arithmetic (1 bps = 0.01%, so two decimals is the exact
 * resolution). Returns null on anything malformed — a trailing optional "%",
 * 1–3 integer digits, up to 2 fractional digits, nothing else. Mirrors the
 * string-only technique of centsFromDollarString.
 */
export function bpsFromPercentString(s: string): number | null {
  const cleaned = s.trim().replace(/%$/, '').trim();
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!m) return null;
  const [, whole, frac = ''] = m;
  const fracPadded = (frac + '00').slice(0, 2);
  return parseInt(whole, 10) * 100 + parseInt(fracPadded, 10);
}

/**
 * Parse a whole-number-of-years string ("40", " 65 ") to an integer. Returns null
 * on anything malformed — 1–3 digits, no sign, no decimals. Bounds are NOT judged
 * here; the caller checks DIAL_LIMITS. Used for the retirement planning ages.
 */
export function wholeYearsFromString(s: string): number | null {
  const cleaned = s.trim();
  if (!/^\d{1,3}$/.test(cleaned)) return null;
  return parseInt(cleaned, 10);
}

/**
 * Parse a wage dollar string to cents. Returns null on malformed input
 * (delegates the exact-decimal parse to centsFromDollarString, which throws).
 * Sign/zero/bounds are NOT judged here — the caller checks DIAL_LIMITS.
 */
export function centsFromWageString(s: string): number | null {
  try {
    return centsFromDollarString(s);
  } catch {
    return null;
  }
}

/**
 * Normalize the freeform money-dials text into a clean string[]:
 * split on newlines/commas, strip control characters, trim, drop empties, and
 * dedupe case-insensitively (first occurrence's casing wins). Order preserved.
 * Length/count limits are enforced by validateDials, not here, so callers that
 * just want the canonical list (e.g. tests) get it without throwing.
 */
export function normalizeMoneyDials(s: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of s.split(/[\n,]/)) {
    const cleaned = stripControl(part).trim();
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }
  return out;
}

/**
 * The whole-form validator. Accumulates every field error. `eligibleAccounts`
 * is the set the user OWNS that are valid payment sources (CHECKING/SAVINGS);
 * the caller (server action) supplies it from a row-ownership-scoped query, so
 * an id outside this set is both an unknown-account and a not-owned rejection.
 *
 * `eligibleDialIds` is the budgetable category set the picker offered (system
 * + this user's customs). Default is the system budgetable ids so unit tests
 * that do not model customs stay honest. A token outside the set is refused —
 * names are not accepted on the write path (O.17a).
 */
export function validateDials(
  raw: RawDials,
  eligibleAccounts: readonly { id: string; type: string }[],
  eligibleDialIds: readonly string[] = CATEGORIES.filter((c) => isBudgetable(c.id)).map((c) => c.id),
): ValidateResult {
  const errors: FieldErrors = {};

  // ── wage (optional) ──
  let hourlyWageCents: number | null = null;
  const wageRaw = raw.wage.trim();
  if (wageRaw !== '') {
    const c = centsFromWageString(wageRaw);
    if (c === null) {
      errors.wage = 'Enter a dollar amount like 38 or 38.50.';
    } else if (c < DIAL_LIMITS.wageCents.min || c > DIAL_LIMITS.wageCents.max) {
      errors.wage = 'Wage must be between $0.01 and $10,000.00 per hour.';
    } else {
      hourlyWageCents = c;
    }
  }

  // ── safe withdrawal rate (required) ──
  let swrBps: number = DIAL_LIMITS.swrBps.min;
  const swr = bpsFromPercentString(raw.swr);
  if (swr === null) {
    errors.swr = 'Enter a percentage like 4 or 4.25.';
  } else if (swr < DIAL_LIMITS.swrBps.min || swr > DIAL_LIMITS.swrBps.max) {
    errors.swr = 'Safe withdrawal rate must be between 1% and 10%.';
  } else {
    swrBps = swr;
  }

  // ── expected return (required) ──
  let expectedReturnBps = 0;
  const ret = bpsFromPercentString(raw.expectedReturn);
  if (ret === null) {
    errors.expectedReturn = 'Enter a percentage like 7 or 6.5.';
  } else if (ret < DIAL_LIMITS.expectedReturnBps.min || ret > DIAL_LIMITS.expectedReturnBps.max) {
    errors.expectedReturn = 'Expected return must be between 0% and 15%.';
  } else {
    expectedReturnBps = ret;
  }

  // ── money dials (optional) — category ids only (O.17a) ──
  const allowedDialIds = new Set(eligibleDialIds);
  const moneyDials = normalizeMoneyDials(raw.moneyDials);
  if (moneyDials.length > DIAL_LIMITS.dials.maxCount) {
    errors.moneyDials = `Keep it to ${DIAL_LIMITS.dials.maxCount} money dials or fewer.`;
  } else if (moneyDials.some((id) => !allowedDialIds.has(id))) {
    errors.moneyDials = 'Pick from your spending categories.';
  }

  // ── payment account (required, owned, fundable type) ──
  let paymentAccountId = '';
  const pickedId = raw.paymentAccountId.trim();
  if (!pickedId) {
    errors.paymentAccountId = 'Choose the account your card payments come from.';
  } else if (!eligibleAccounts.some((a) => a.id === pickedId)) {
    errors.paymentAccountId = 'Pick one of your checking or savings accounts.';
  } else {
    paymentAccountId = pickedId;
  }

  // ── retirement-planning ages (each optional; empty = use the documented default) ──
  const parseAge = (
    rawVal: string,
    limits: { min: number; max: number },
    boundsMsg: string,
  ): { value: number | null; error?: string } => {
    if (rawVal.trim() === '') return { value: null };
    const n = wholeYearsFromString(rawVal);
    if (n === null) return { value: null, error: 'Enter a whole number of years (e.g. 65).' };
    if (n < limits.min || n > limits.max) return { value: null, error: boundsMsg };
    return { value: n };
  };
  const ca = parseAge(raw.currentAge, DIAL_LIMITS.currentAge, 'Current age must be between 18 and 100.');
  const ra = parseAge(raw.retirementAge, DIAL_LIMITS.retirementAge, 'Retirement age must be between 18 and 110.');
  const ea = parseAge(raw.endAge, DIAL_LIMITS.endAge, 'Plan-through age must be between 19 and 120.');
  if (ca.error) errors.currentAge = ca.error;
  if (ra.error) errors.retirementAge = ra.error;
  if (ea.error) errors.endAge = ea.error;

  // ── inflation (optional; empty = use the default) ──
  let inflationBps: number | null = null;
  const inflRaw = raw.inflation.trim();
  if (inflRaw !== '') {
    const infl = bpsFromPercentString(inflRaw);
    if (infl === null) {
      errors.inflation = 'Enter a percentage like 2.5.';
    } else if (infl < DIAL_LIMITS.inflationBps.min || infl > DIAL_LIMITS.inflationBps.max) {
      errors.inflation = 'Inflation must be between 0% and 10%.';
    } else {
      inflationBps = infl;
    }
  }

  // ── savings target (optional; empty = unset, goals alone decide savings) ──
  let savingsTargetBps: number | null = null;
  const stRaw = raw.savingsTarget.trim();
  if (stRaw !== '') {
    const st = bpsFromPercentString(stRaw);
    if (st === null) {
      errors.savingsTarget = 'Enter a percentage like 15 or 12.5.';
    } else if (st < DIAL_LIMITS.savingsTargetBps.min || st > DIAL_LIMITS.savingsTargetBps.max) {
      errors.savingsTarget = 'Savings target must be between 0% and 90%.';
    } else {
      savingsTargetBps = st;
    }
  }

  // ── cross-field ordering (only when each age that's set parsed cleanly) ──
  // Resolve each age to its EFFECTIVE value (entered value, else the default the read
  // path will use) so a partially-filled plan is checked against what it actually runs
  // as. Engine invariant: currentAge ≤ retirementAge < endAge ≤ 120 — we require at
  // least one retirement year (endAge > retirementAge), which also forces currentAge < endAge.
  if (!errors.currentAge && !errors.retirementAge && !errors.endAge) {
    const effCurrent = ca.value ?? RETIREMENT_ASSUMPTIONS.currentAge;
    const effRetire = ra.value ?? RETIREMENT_ASSUMPTIONS.retirementAge;
    const effEnd = ea.value ?? RETIREMENT_ASSUMPTIONS.endAge;
    if (effRetire < effCurrent) {
      errors.retirementAge = 'Retirement age can’t be before your current age.';
    } else if (effEnd <= effRetire) {
      errors.endAge = 'Plan-through age must be after your retirement age.';
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      hourlyWageCents,
      swrBps,
      expectedReturnBps,
      moneyDials,
      paymentAccountId,
      currentAge: ca.value,
      retirementAge: ra.value,
      endAge: ea.value,
      inflationBps,
      savingsTargetBps,
    },
  };
}

/**
 * Whether a user still needs the one-time onboarding nudge: they have not yet
 * confirmed which account funds their card payments. That is the single dial
 * the entire cash-needed answer depends on, so it is the right gate.
 *
 * When the caller passes the current set of eligible (owned CHECKING/SAVINGS)
 * account ids, a non-null `paymentAccountId` that no longer resolves to one of
 * them — e.g. the chosen account was later deleted or became ineligible — also
 * counts as "needs onboarding". Otherwise `resolvePaymentAccount` would silently
 * recompute the headline against a *different* account with no signal; re-firing
 * the nudge prompts the user to re-pick. The seeded demo user always has a valid
 * id, so this is dormant in demo mode (no real multi-user signup yet — ROADMAP #2).
 */
export function needsOnboarding(
  user: { paymentAccountId: string | null },
  eligiblePaymentAccountIds?: readonly string[],
): boolean {
  if (user.paymentAccountId == null) return true;
  if (eligiblePaymentAccountIds && !eligiblePaymentAccountIds.includes(user.paymentAccountId)) {
    return true;
  }
  return false;
}

/**
 * Decode the stored `User.moneyDials` column (a JSON-encoded string[], or null)
 * back into a string[] — the single inverse of the encode below. Tokens may be
 * category ids (current writes) or leftover names (pre-O.17a). Callers that
 * mark a category pass the list through `resolveMoneyDialIds`. SQLite has no
 * Json type, so this is a plain TEXT column; wrapping JSON.parse in a try/catch
 * means a malformed or legacy value degrades to [] instead of throwing on a
 * server-rendered page.
 */
export function parseStoredDials(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Encode a money-dials list for storage: [] → null (the "unset" state). */
export function encodeDials(list: readonly string[]): string | null {
  return list.length > 0 ? JSON.stringify(list) : null;
}

// ── UI-boundary display helpers (pure, integer math, no floats) ──
// These turn stored integers back into the bare numbers a text <input> needs
// (NOT formatCents, which produces "$38.00" — invalid for a numeric field).

/** Cents → bare dollar string for an input value: 3850 → "38.50", 3800 → "38". */
export function centsToDollarInput(c: number): string {
  const whole = Math.floor(c / 100);
  const frac = c % 100;
  return frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(2, '0')}`;
}

/** bps → bare percent string for an input value: 400 → "4", 425 → "4.25". */
export function bpsToPercentInput(bps: number): string {
  const whole = Math.floor(bps / 100);
  const frac = bps % 100;
  return frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(2, '0')}`;
}

/** A nullable planning age → input value: a number, or "" for the "unset, use default" state. */
export function ageToInput(years: number | null): string {
  return years == null ? '' : String(years);
}
