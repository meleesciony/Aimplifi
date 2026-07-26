/**
 * Retirement REGISTRATION — the one account fact that is comparable across providers
 * (TASKS L.9, owner-reported 2026-07-24).
 *
 * The "Continue an account you already had" card offered the owner's SimpleFIN
 * `Charles Schwab US Roth Contributory IRA` against BOTH his Plaid `Roth IRA` and his Plaid
 * `Traditional IRA`, at the same badge, on the same evidence class — a shared name token. Tapping
 * the wrong one folds a Roth IRA's history into a Traditional IRA. The two proposals were equally
 * plausible to the card because nothing in the cross-provider heuristic knew that a Roth and a
 * Traditional are different accounts BY DEFINITION, whatever their names, balances or numbers say.
 *
 * WHY THIS MAY BE A CROSS-PROVIDER VETO WHEN A LAST-4 MAY NOT
 * `docs/ACCOUNT_IDENTITY_ARCHITECTURE.md` §5 scopes the identity ladder — and its `subtype` veto —
 * to ONE provider, because a mask is an identifier CONVENTION: SimpleFIN's `396` and Plaid's `5351`
 * are the same real Schwab account (owner-confirmed), so mask inequality across providers means
 * nothing. A registration is not a convention. It is a fact about the account's tax treatment that
 * every provider is describing the same way, in words, because the IRS defines it — so "one side is
 * a Roth, the other is not" survives the provider boundary that a number cannot cross.
 *
 * FAILURE DIRECTION (docs/lessons/failure-direction-is-per-role-not-per-value.md)
 * A veto's misfire HIDES a real duplicate, which is the silent-double-count direction #292 removed
 * the mask veto for. So this one is deliberately hard to fire:
 *   - Both sides must resolve to a registration. An absence is never a difference (§5's null rule).
 *   - Resolution requires an UNAMBIGUOUS word. `roth` is unambiguous. Plaid's `ira` subtype is not
 *     — it is the subtype for a traditional IRA, but an institution that does not specialise its
 *     subtypes returns it for a Roth as well, so `ira` alone resolves to nothing. Evidence of a
 *     Roth therefore always WINS over evidence of a pretax account, and a Roth↔Roth pair can never
 *     be vetoed by one side's unspecialised subtype.
 *   - INVESTMENT rows only. "Roth" is a surname and "Traditional" is a deposit-product name, so
 *     `Roth Family Checking` vs `Traditional Checking` is a shape a real household can hold.
 *   - NAME evidence is weaker than subtype evidence, because bank-composed names embed the
 *     HOLDER'S name ("Michael Lee - Roth IRA …") and "Roth" is a common surname (fresh-context
 *     critic, executed: "Jill Roth - Traditional IRA" resolved roth and vetoed a REAL Traditional
 *     pair into a silent double-count — worse than never vetoing). So a name resolves only inside
 *     an IRA context, and a name carrying BOTH token classes is conflicting evidence — an absence,
 *     per this module's own rule. A provider subtype never contains a surname, so it stays
 *     unconditional.
 *
 * RECORDED LIMITS (critics P2, accepted — each fails toward an OFFERABLE pair, never a hidden one):
 *   - Employer-plan registrations are out of scope. Bare `401k`/`403b`/`457b`/`keogh` subtypes
 *     resolve to nothing — the same unspecialised-institution argument as `ira` (a Roth 401k
 *     could arrive under one), so the veto that protects IRAs cannot protect a Roth 401k from a
 *     pretax one. Plaid's specialised `roth 401k` subtype DOES resolve.
 *   - A real registration named without an IRA context abstains too ("Charles Schwab Roth
 *     Brokerage", "Roth 401k") — the price of keeping "Roth Capital Brokerage" (a surname or an
 *     institution) and "TIAA Traditional Annuity" (a product sold both pretax and after-tax)
 *     from resolving registrations the data does not support. The wrong-fold offer this re-opens
 *     is user-confirmed and advisory, with both feed names printed.
 *   - A real Roth product name carrying a pretax word abstains ("Roth Conversion Traditional
 *     IRA", "Roth Rollover IRA") — the same both-token rule that keeps a surname from vetoing a
 *     real pair. Documented so the trade is deliberate, not discovered.
 *   - RESIDUAL WINDOW, irreducible (cycle-3 critic): a holder surnamed Roth on an IRA product
 *     named with a bare "IRA" ("Jill Roth - IRA") is token-identical to a real "Roth IRA", so it
 *     still resolves roth and can still veto a real pair — and in the veto direction the pair
 *     prints NOWHERE (cycle-4, executed: no notice, no candidate, no group). No code fix exists
 *     that keeps the owner's case working; the window is narrow (a surname coincidence on one
 *     naming shape) and the surface is advisory. Recorded, not hidden.
 *
 * Pure: no React, no DB, no `new Date()`, no model calls.
 */

/** The tax treatment two rows can disagree about. `pretax` covers traditional/rollover/SEP/SIMPLE —
 *  they differ from each other in contribution rules, not in what a duplicate check needs to know. */
export type AccountRegistration = 'roth' | 'pretax';

export interface RegistrationAccount {
  /** CHECKING | SAVINGS | CREDIT | INVESTMENT | LOAN. Only INVESTMENT resolves (see above). */
  type: string;
  /** The FEED's name, never the user's nickname — a nickname must never reach a comparison (L.7). */
  name: string;
  /** The provider's raw subtype, when it wrote one. SimpleFIN and manual rows never have it. */
  subtype?: string | null;
}

/** Word-boundary tokens, lowercased. Digits stay (so `401k` survives) but carry no meaning here. */
function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      .filter(Boolean),
  );
}

/** Words that mean "this is a Roth", in either a name or a provider subtype. */
const ROTH_TOKENS = ['roth'];

/**
 * Words that mean "this is NOT a Roth", unambiguously. `ira` is deliberately absent: it is Plaid's
 * subtype for a traditional IRA AND the fallback an institution returns for a Roth it did not
 * specialise, so reading it as pretax would veto the very pair this feature exists to offer.
 */
const PRETAX_TOKENS = ['traditional', 'rollover', 'sep', 'sarsep', 'simple'];

/** `sep`/`simple` are only meaningful from a PROVIDER subtype — as free words in a bank-composed
 *  name ("Simple Brokerage") they are marketing, not a registration. `traditional` and `rollover`
 *  ARE meaningful in a name: "Traditional IRA" / "Rollover IRA" are the product names the brokers
 *  themselves print. */
const PRETAX_NAME_TOKENS = ['traditional', 'rollover'];

/** The context a NAME's roth/pretax word must appear in (singular AND plural — "Roth and
 *  Traditional IRAs" tokenizes to `iras`, cycle-2 critic P2-1). */
const IRA_CONTEXT_TOKENS = ['ira', 'iras'];

function has(set: Set<string>, words: readonly string[]): boolean {
  return words.some((w) => set.has(w));
}

/**
 * The account's registration, or null when nothing unambiguous says. Subtype and name are NOT
 * equal evidence: a provider subtype never contains a surname, so it resolves unconditionally;
 * a bank-composed name can embed the HOLDER'S name ("Michael Lee - …"), and "Roth" is a common
 * surname — so a name resolves only inside an IRA context, and a name carrying BOTH a roth word
 * and a pretax word is conflicting evidence, which this module reads as an absence.
 */
export function accountRegistration(a: RegistrationAccount): AccountRegistration | null {
  if (a.type !== 'INVESTMENT') return null;
  const sub = tokens(a.subtype ?? '');
  const nam = tokens(a.name);
  // Each source resolves on its own rules: a provider subtype never contains a surname, so it is
  // unconditional; a bank-composed name can embed the HOLDER'S name ("Michael Lee - …"), and
  // "Roth" is a common surname — so a name resolves only inside an IRA context, and a name
  // carrying BOTH a roth word and a pretax word is conflicting evidence, which this module reads
  // as an absence.
  const subReg: AccountRegistration | null = has(sub, ROTH_TOKENS) ? 'roth' : has(sub, PRETAX_TOKENS) ? 'pretax' : null;
  let namReg: AccountRegistration | null = null;
  if (has(nam, IRA_CONTEXT_TOKENS)) {
    const roth = has(nam, ROTH_TOKENS);
    const pretax = has(nam, PRETAX_NAME_TOKENS);
    namReg = roth && pretax ? null : roth ? 'roth' : pretax ? 'pretax' : null;
  }
  // A name↔subtype CONTRADICTION is conflicting evidence too (cycle-2 critic P2-3, executed:
  // {name:'Roth IRA', subtype:'traditional'} resolved pretax and vetoed a REAL Roth↔Roth pair —
  // the silent-double-count direction this module exists to prevent). Abstain, exactly as the
  // within-name conflict does.
  if (subReg !== null && namReg !== null && subReg !== namReg) return null;
  return subReg ?? namReg;
}

/**
 * True when the two rows are provably DIFFERENT accounts on registration alone — one is a Roth and
 * the other is not. Both sides must resolve; one unknown side is an absence, never a difference.
 */
export function registrationsConflict(a: RegistrationAccount, b: RegistrationAccount): boolean {
  const ra = accountRegistration(a);
  const rb = accountRegistration(b);
  return ra !== null && rb !== null && ra !== rb;
}
