/**
 * K.7 (DECISIONS #437) — WHICH SOURCE OWNS A LOAN PAYMENT.
 *
 * The same contractual loan payment can reach a projection surface twice:
 *
 *   · as a LOAN OBLIGATION — `selectLoanObligations` derives it from the loan
 *     account's issuer-reported terms (`minimumPaymentCents` + `dueDayOfMonth`,
 *     written by Plaid's `/liabilities/get` mortgage[]/student[] mappers, #134);
 *   · as a DETECTED SCHEDULED ROW — `server/recurring.ts` persists a
 *     `ScheduledTransaction` for every series `classifySeriesProjection` calls
 *     `counted`, and that classifier has no loan-payment gate, so the monthly
 *     bank ACH that PAYS the loan is itself learned as a recurring bill on the
 *     checking account.
 *
 * Both fire together on the ordinary shape (a Plaid loan whose payment leaves a
 * linked checking account), and the three surfaces that combine the two sources
 * — /calendar, /forecast, /radar — then count the payment TWICE. #134 accepted
 * this as a residual and `server/radar.ts` disclosed it in prose, because at the
 * time "no structural key links them; heuristic money-matching rejected".
 *
 * It was never executed. Neither state this repo ships exhibits it: the seeded
 * demo carries the obligation and no detected series (`seed/build.ts:550`
 * deleted the hand-authored row precisely to avoid the double display), and the
 * stale production demo carries the detected series and no obligation. Executed
 * on a fixture holding both (`scripts/audit-probes/k7-double-count-probe.mts`),
 * a $385.00/mo auto loan paints twice on /calendar and moves the 90-day
 * /forecast ending balance by $1,155.00 — three extra debits of a payment the
 * reader owes once, in a projection whose whole output is "you dip below $0 on
 * DATE".
 *
 * THE KEY #134 LACKED NOW EXISTS. C.25 (DECISIONS #403,
 * `engine/categorize/loan-payment-flows.ts`) links a checking merchant canonical
 * to ONE specific loan account, and it is not a coincidence test: ≥2 DISTINCT
 * calendar months of ±3-day same-|amount| pairs against inflows on that loan
 * account, aggregate canonicals (Zelle/Venmo/…) refused outright, a dateable
 * obligation required, and the row's amount required to equal one of that
 * account's obligation payments. The app already stakes the reader's SPENDING
 * TOTALS on that link: those charges leave the flow sums *because* they are
 * "carried elsewhere — the committed / forecast / calendar line". A link trusted
 * to delete a charge from someone's spending is trusted to stop projecting the
 * same charge twice. This module consumes that link and mints no new matching
 * rule of its own.
 *
 * THE OBLIGATION OWNS THE PAYMENT, and the detected row yields. Four reasons:
 *  1. it is the issuer's contract (amount AND due day), not an inference drawn
 *     from the history of paying it;
 *  2. it carries `accountId`, which the frozen-account disclosure (L.18–L.20),
 *     the duplicate-card view and the reminder selector all key off — a
 *     scheduled row carries only a description;
 *  3. C.25 already named the obligation-backed line as THE carried-elsewhere
 *     surface, so suppressing the obligation instead would delete the very
 *     surface that justifies removing those charges from spending;
 *  4. it repeats on the contract's own cadence, where a detected series' anchor
 *     drifts with whatever dates the bank happened to post.
 *
 * SUPPRESSION IS CAPPED, 1:1, AND NEVER FREE-STANDING. A scheduled row is dropped
 * only when a C.25 fact says its canonical is carried on a loan account that is in
 * THIS call's obligation list at THIS row's amount — and at most as many rows as
 * there are facts covering that (canonical, amount): each C.25 fact proves ONE
 * monthly payment is carried, so a canonical shared by two loans (Nelnet — the
 * generic servicer rule collapses them) can never have a payment no obligation
 * carries removed. Where the link is absent (a first month, a loan whose payments
 * the bank does not show on the loan side, a SimpleFIN loan that writes no terms
 * at all) nothing is suppressed and the double-count survives — visibly, and
 * disclosed by the caller. That is the #400 failure-direction rule kept intact: a
 * duplicate the reader can see and weigh beats a real payment silently deleted.
 */
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';

/** The scheduled-row fields this rule reads — a structural subset of
 *  `ScheduledLike` / `ScheduledFlow`, so both callers pass their own row type
 *  through unchanged (the generic below preserves it). */
export interface ScheduledRowLike {
  description: string;
  amountCents: number;
}

/** The obligation fields this rule reads (`selectLoanObligations` output,
 *  narrowed). Only accounts present HERE can suppress anything — an obligation
 *  filtered out upstream (a superseded predecessor, R4) must not silently take
 *  a scheduled row with it. */
export interface ObligationLike {
  accountId: string;
  paymentCents: number;
}

/**
 * One C.25 disclosure fact: this merchant canonical's outflows are carried on
 * this loan account at this payment amount (`snap.loanPaymentFlowExclusions.excluded`).
 */
export interface CarriedLoanPayment {
  canonical: string;
  accountId: string;
  paymentCents: number;
}

export interface LoanScheduledSplit<T> {
  /** Rows to project. Same objects, same order — never rebuilt. */
  kept: T[];
  /** Rows the obligation already carries. Kept for the caller's disclosure. */
  suppressed: T[];
}

/**
 * Split scheduled rows into the ones a projection should expand and the ones a
 * loan obligation in the same projection already carries.
 *
 * Byte-identical passthrough (`kept` holds the same object references in the
 * same order, `suppressed` empty) whenever there are no obligations, no C.25
 * facts, or nothing matches — which is every reader on the golden path.
 */
export function splitLoanCarriedScheduled<T extends ScheduledRowLike>(params: {
  scheduled: readonly T[];
  obligations: readonly ObligationLike[];
  /** `snap.loanPaymentFlowExclusions?.excluded ?? []` — absent when no merchant qualified. */
  carried: readonly CarriedLoanPayment[];
}): LoanScheduledSplit<T> {
  const { scheduled, obligations, carried } = params;
  if (obligations.length === 0 || carried.length === 0) return { kept: [...scheduled], suppressed: [] };

  // A fact can only speak for an obligation that is actually in THIS projection,
  // at that obligation's own payment amount.
  const obligationAmounts = new Map<string, Set<number>>();
  for (const o of obligations) {
    const set = obligationAmounts.get(o.accountId) ?? new Set<number>();
    set.add(o.paymentCents);
    obligationAmounts.set(o.accountId, set);
  }
  // Both sides are normalized before comparison, and for the same reason the row
  // side is: C.25 mints its fact canonical from the RAW descriptor via a
  // KNOWN_MERCHANTS pattern (`ACH WITHDRAWAL CARMAX AUTO FIN 4421` → 'CarMax
  // Auto Finance'), while the detector's persisted row description IS that
  // canonical — and most pattern canonicals do not round-trip through
  // `normalizeMerchant(canonical)` (it falls back to title-casing). An exact
  // compare of the two would make the rule inert on the very chain it exists
  // for (critic-executed, K.7 cycle 1 F1). Normalizing both to the fallback
  // canonical is sound: the canonical is the merchant's identity, so two names
  // of the same merchant agree and two different merchants cannot collide.
  //
  // Keyed by `canonical|amount`. The VALUE is how many facts cover the key (one
  // fact per loan account C.25 proved), because that is how many payments a
  // month the obligations provably carry: a canonical shared by two loans
  // (Nelnet — the generic servicer rule) with only one dateable may never have
  // BOTH rows suppressed, or the undatable loan's payment leaves the projection
  // entirely (critic-executed, K.7 cycle 1 F2).
  const coveredCount = new Map<string, number>();
  const countedFacts = new Set<string>();
  for (const c of carried) {
    if (!obligationAmounts.get(c.accountId)?.has(c.paymentCents)) continue;
    // Refuse an aggregate fact for the same reason the row side refuses one:
    // a shared descriptor must never be suppressible by any route.
    const m = normalizeMerchant(c.canonical);
    if (m.aggregate) continue;
    const factKey = `${m.canonical}|${c.paymentCents}`;
    const countedKey = `${factKey}|${c.accountId}`;
    if (countedFacts.has(countedKey)) continue; // one fact per account per key
    countedFacts.add(countedKey);
    coveredCount.set(factKey, (coveredCount.get(factKey) ?? 0) + 1);
  }
  if (coveredCount.size === 0) return { kept: [...scheduled], suppressed: [] };

  const kept: T[] = [];
  const suppressed: T[] = [];
  const suppressedSoFar = new Map<string, number>();
  for (const row of scheduled) {
    // OUTFLOWS ONLY. An inflow at a loan payment's amount is not that payment
    // (a refund, a payroll that happens to match), and nothing should be able to
    // delete income from a projection.
    if (row.amountCents >= 0) {
      kept.push(row);
      continue;
    }
    // The canonical is re-derived here rather than trusted from the description:
    // a DETECTED row's description IS the merchant canonical (`toScheduledRow`),
    // but a SEEDED or hand-authored row's is prose — and a pattern canonical
    // written by the detector ('CarMax Auto Finance') must meet a fact minted
    // from the same raw descriptor. One normalization for both sides.
    const m = normalizeMerchant(row.description);
    // An aggregate canonical is one name over many payees (the C.4 doctrine) —
    // C.25 refuses to mint a fact from one, and this refuses to consume one, so
    // a fact reached by any other route can never suppress a shared descriptor.
    if (m.aggregate) {
      kept.push(row);
      continue;
    }
    const key = `${m.canonical}|${-row.amountCents}`;
    const cap = coveredCount.get(key) ?? 0;
    const used = suppressedSoFar.get(key) ?? 0;
    if (used < cap) {
      suppressed.push(row);
      suppressedSoFar.set(key, used + 1);
    } else {
      // Over the cap, or no fact: the row stays projected — visibly, and
      // disclosed by the caller (#400's failure direction).
      kept.push(row);
    }
  }
  return { kept, suppressed };
}
