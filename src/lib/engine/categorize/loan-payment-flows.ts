/**
 * C.25 (DECISIONS #403) — the loan-payment exclusion at the flow-summing
 * boundary, computed at READ time and carried by nothing stored.
 *
 * The defect (#400 measured it live): `countsInFlows` keys off the stored
 * `isTransfer`, and that flag is the product of a ±3-day same-amount
 * coincidence evaluated at SYNC time — so the owner's $6,217.07 mortgage
 * flipped in and out of every spending total by settlement timing (counted
 * in Apr/Jul, absent in May/Jun). The sync-time fix (write the class onto
 * the row) was built, gated green, and REVERTED: merchant identity is not
 * specific enough to persist, one coincidence classified a payee forever at
 * every amount, there was no undo anywhere, and it defeated C.24's
 * exactness invariant. This module is the direction that survived.
 *
 * Money leaves a flow sum only where "it is carried elsewhere" is CHECKED.
 * For a loan payment the carried-elsewhere surface is the committed /
 * forecast / calendar line, which exists exactly when the linked loan
 * account has a DATEABLE obligation (`selectLoanObligations`: LOAN/MORTGAGE
 * + minimumPaymentCents > 0 + dueDayOfMonth). A SimpleFIN loan writes
 * neither field and an undatable Plaid loan fails the same gate — for both,
 * the rows stay in the flows. Visible beats vanished (#400's
 * failure-direction rule): the defect leaves a real charge a reader can
 * weigh; a bad fix deletes real charges silently.
 *
 * The four gates, ALL required for a row to leave the flows:
 *  1. it would otherwise have been counted — an outflow on a CHECKING/
 *     SAVINGS account, POSTED, not a split parent, not reader-excluded;
 *  2. its merchant canonical is linked to one specific loan account by >= 2
 *     DISTINCT calendar months of ±3-day same-|amount| pairs, re-derived
 *     here from the raw rows — the stored flag is the unstable thing and is
 *     deliberately not part of this module's input type, so it cannot be
 *     consulted by construction. One coincidence (the roofing invoice of
 *     #400's P0-2) never qualifies; aggregate canonicals (Zelle/Venmo/…,
 *     the C.4 doctrine) are refused outright;
 *  3. that linked loan account has a dateable obligation;
 *  4. the row's |amount| equals one of that account's obligation payments —
 *     the P0-1 killer: on a bank that stamps every ACH `ONLINE PAYMENT`,
 *     only rows at the obligation's own amount leave, whatever else the
 *     descriptor names.
 */
import { daysBetween, isoDate, monthKey } from '@/lib/dates';
import { PAYMENT_ACCOUNT_TYPES } from '@/lib/engine/settings/dials';
import { isExcludedFromTotals } from '@/lib/engine/transactions/exclude';
import { normalizeMerchant } from './normalize';
import { LOAN_ACCOUNT_TYPES } from './transfers';

/** The pairing window `detectTransfers` itself applies (transfers.ts). */
const PAIR_WINDOW_DAYS = 3;

/** One coincidence is not a class (#400 P0-2). Two distinct months is the
 *  floor at which "recurring loan payment" beats "amount coincidence". */
const MIN_DISTINCT_PAIR_MONTHS = 2;

export interface LoanFlowRow {
  id: string;
  accountId: string;
  date: string; // YYYY-MM-DD
  amountCents: number;
  rawDescriptor: string;
  status: string;
  isSplitParent?: boolean;
  excludeFromTotals?: boolean | null;
  // `isTransfer` is absent ON PURPOSE: this exclusion re-derives the pairing
  // from dates and amounts, because the stored flag is exactly the thing
  // that flips with settlement timing (DECISIONS #403).
}

export interface LoanFlowInflow {
  id: string;
  accountId: string;
  date: string; // YYYY-MM-DD
  amountCents: number;
}

export interface LoanPaymentFlowExclusionInput {
  /** The snapshot's transactions (spending-account rows). */
  rows: readonly LoanFlowRow[];
  /** POSTED/USD inflows on the user's LOAN/MORTGAGE accounts — the snapshot
   *  withholds them from the engines (#62), so the assembler hands them in
   *  separately (the same targeted query C.24's detection reads,
   *  spending-plan.ts's loanSideInflows). */
  loanInflows: readonly LoanFlowInflow[];
  accountTypeById: ReadonlyMap<string, string>;
  /** The DATEABLE obligations (`selectLoanObligations` output, narrowed to
   *  what this module reads). An undatable or SimpleFIN loan simply has no
   *  entry here — refusal is expressed upstream, absence here. */
  obligations: readonly { accountId: string; paymentCents: number }[];
}

export interface LoanPaymentFlowExcludedMerchant {
  /** The merchant canonical whose outflows left the flows. */
  canonical: string;
  /** The loan account the money is carried to (one entry per active edge). */
  accountId: string;
  paymentCents: number;
}

export interface LoanPaymentFlowExclusion {
  /** Row ids to hand the flow predicates (`countsInFlows`, `isSpendRow`). */
  excludeIds: ReadonlySet<string>;
  /** The disclosure facts: what moved, and where it is counted instead. */
  excluded: readonly LoanPaymentFlowExcludedMerchant[];
}

/** The ±3-day same-|amount| pair test, one direction only: an OUTFLOW on a
 *  cash account against an INFLOW on a loan account. Never consults the
 *  stored flag. */
function pairsWith(
  outflow: { accountId: string; date: string; amountCents: number },
  inflows: readonly LoanFlowInflow[],
): boolean {
  for (const b of inflows) {
    if (b.accountId === outflow.accountId) continue;
    if (b.amountCents !== -outflow.amountCents) continue;
    if (Math.abs(daysBetween(isoDate(outflow.date), isoDate(b.date))) <= PAIR_WINDOW_DAYS) return true;
  }
  return false;
}

export function loanPaymentFlowExclusions(input: LoanPaymentFlowExclusionInput): LoanPaymentFlowExclusion {
  const { rows, loanInflows, accountTypeById, obligations } = input;

  // Loan inflows bucketed by the loan account they land on. Pairing reads
  // them per outflow; the bucket keeps the sweep linear.
  const inflowsByLoanAccount = new Map<string, LoanFlowInflow[]>();
  for (const b of loanInflows) {
    if (!LOAN_ACCOUNT_TYPES.has(accountTypeById.get(b.accountId) ?? '')) continue;
    const list = inflowsByLoanAccount.get(b.accountId) ?? [];
    list.push(b);
    inflowsByLoanAccount.set(b.accountId, list);
  }

  // Gate 2: canonical → loan account → distinct calendar months of pairs.
  // An "edge" (canonical, loanAccount) is the unit of identity: a merchant
  // paying two loans earns two independent edges, and one month against each
  // does NOT bootstrap either (months are counted per edge).
  const edgeMonths = new Map<string, Map<string, Set<string>>>();
  for (const t of rows) {
    if (t.amountCents >= 0) continue;
    // Pairing EVIDENCE is POSTED-only (critic P2-1): a pending row can
    // settle differently under a new id (transfers.ts says so itself), so
    // it must not classify a merchant. The row SWEEP below admits pending
    // rows into the set; the evidence that builds the set does not.
    if (t.status !== 'POSTED') continue;
    // A row that can NEVER leave the flows must never classify a merchant
    // either (critic cycle 3 P1-1, D1/D3): split containers carry no money
    // (their children do) and reader-excluded rows left by the reader's own
    // verdict. Admitting them as evidence would mint disclosure facts for a
    // merchant whose money stays counted — a false sentence on five surfaces.
    if (t.isSplitParent === true || isExcludedFromTotals(t)) continue;
    if (!(PAYMENT_ACCOUNT_TYPES as readonly string[]).includes(accountTypeById.get(t.accountId) ?? '')) {
      continue;
    }
    const m = normalizeMerchant(t.rawDescriptor);
    // An aggregate canonical is ONE NAME OVER MANY PAYEES, not one merchant
    // (the C.4 doctrine; C.24's F3) — it can never identify a loan-payment
    // payee, whatever pairs against it.
    if (m.aggregate) continue;
    for (const [loanAccountId, inflows] of inflowsByLoanAccount) {
      if (!pairsWith(t, inflows)) continue;
      const edges = edgeMonths.get(m.canonical) ?? new Map<string, Set<string>>();
      const months = edges.get(loanAccountId) ?? new Set<string>();
      months.add(monthKey(isoDate(t.date)));
      edges.set(loanAccountId, months);
      edgeMonths.set(m.canonical, edges);
    }
  }

  // Gates 3 + 4: an edge activates only where the loan side can actually
  // project — a dateable obligation ON THAT ACCOUNT — and it carries exactly
  // the obligation amounts. Money that does not match an obligation payment
  // stays in the flows (an escrow adjustment, a late fee, a payoff at a new
  // amount): the app shows it nowhere else, so deleting it would be the
  // silent direction (#400).
  //
  // Attribution is PER EDGE (critic P1-3 of this slice): one canonical can
  // pay TWO loans (the generic-descriptor world gate 4 exists for), and if
  // one of them is undatable, the canonical's covered amounts must not
  // launder the undatable loan's payments out of the flows. Covered amounts
  // are therefore kept per loan account, and each row is judged by where ITS
  // money can be checked — not by its name alone.
  const obligationsByAccount = new Map<string, number[]>();
  for (const o of obligations) {
    const list = obligationsByAccount.get(o.accountId) ?? [];
    list.push(o.paymentCents);
    obligationsByAccount.set(o.accountId, list);
  }
  const coveredByAccount = new Map<string, Set<number>>();
  const eligibleAccounts = new Map<string, Set<string>>(); // canonical -> accounts that can project
  const linkedAccounts = new Map<string, Set<string>>(); // canonical -> accounts it ever paired with
  for (const [canonical, edges] of edgeMonths) {
    for (const [loanAccountId, months] of edges) {
      const linked = linkedAccounts.get(canonical) ?? new Set<string>();
      linked.add(loanAccountId);
      linkedAccounts.set(canonical, linked);
      if (months.size < MIN_DISTINCT_PAIR_MONTHS) continue;
      const payments = obligationsByAccount.get(loanAccountId);
      if (payments === undefined || payments.length === 0) continue;
      const eligible = eligibleAccounts.get(canonical) ?? new Set<string>();
      eligible.add(loanAccountId);
      eligibleAccounts.set(canonical, eligible);
      const covered = coveredByAccount.get(loanAccountId) ?? new Set<number>();
      for (const p of payments) covered.add(p);
      coveredByAccount.set(loanAccountId, covered);
    }
  }

  // Which loan accounts can THIS row's money be checked on — the ±3-day
  // same-|amount| inflows it paired with itself. A row that paired nowhere
  // (a counterpart-missing month) is unattributed.
  const partnersOf = (t: LoanFlowRow): string[] => {
    const partners: string[] = [];
    for (const [loanAccountId, inflows] of inflowsByLoanAccount) {
      if (pairsWith(t, inflows)) partners.push(loanAccountId);
    }
    return partners;
  };
  const amountCoveredOn = (loanAccountId: string, amountCents: number): boolean =>
    coveredByAccount.get(loanAccountId)?.has(amountCents) ?? false;

  // Gate 1, then attribution, then the CARRY CAPACITY (critic cycle 2
  // P1-A/P1-B). Three lessons compose the rule:
  //
  //  * A row that paired with an INELIGIBLE account — even alongside an
  //    eligible one — is ambiguous: its money might be bound for the loan
  //    that cannot project, and deleting it would be the silent direction
  //    (#400). ALL of a row's partners must be eligible for the pair to be
  //    evidence FOR leaving (P1-A).
  //  * An unattributed row leaves only when EVERY account the merchant ever
  //    paired with can project — the counterpart-missing months of the
  //    owner's mortgage (#403's fixture A).
  //  * Amount equality alone is not a check (P1-B): on a bank that stamps
  //    every ACH alike, the RENT can share the canonical AND the amount of
  //    the loan payment. So at most the CARRIED count leaves — per
  //    canonical, month and amount, the capacity is the month's own loan
  //    inflows at that amount (observed carrying), or the obligations
  //    covering it (projected carrying — the counterpart-missing months),
  //    whichever is larger. Candidates beyond the capacity stay visible:
  //    the safe superset beats a precision fix that fabricates (#400).
  //
  // PENDING rows ARE admitted to the set (critic P2-1): the isSpendRow-basis
  // surfaces count pending, so a payment that leaves only AT post would move
  // the total mid-month — the instability class this module exists to kill;
  // countsInFlows surfaces never count pending rows anyway, so admitting
  // them there changes nothing. (Pairing EVIDENCE stays POSTED-only above —
  // a pending row can settle as a different row.)
  const excludeIds = new Set<string>();
  const excluded: LoanPaymentFlowExcludedMerchant[] = [];
  if (eligibleAccounts.size > 0) {
    interface Candidate {
      row: LoanFlowRow;
      canonical: string;
      amount: number;
      attributed: boolean;
      /** The eligible accounts covering this row's amount — where the money
       *  can be checked. Sorted, so the disclosure fact picks deterministically. */
      choiceAccounts: string[];
    }
    const candidates: Candidate[] = [];
    for (const t of rows) {
      if (t.amountCents >= 0) continue;
      if (t.isSplitParent === true || isExcludedFromTotals(t)) continue;
      if (!(PAYMENT_ACCOUNT_TYPES as readonly string[]).includes(accountTypeById.get(t.accountId) ?? '')) {
        continue;
      }
      const canonical = normalizeMerchant(t.rawDescriptor).canonical;
      const eligible = eligibleAccounts.get(canonical);
      if (eligible === undefined) continue;
      const amount = -t.amountCents;
      const partners = partnersOf(t);
      if (partners.length > 0) {
        // Attributed: evidence FOR leaving only when EVERY partner is an
        // eligible account that covers the amount (P1-A).
        if (partners.every((L) => eligible.has(L) && amountCoveredOn(L, amount))) {
          candidates.push({ row: t, canonical, amount, attributed: true, choiceAccounts: [...partners].sort() });
        }
      } else {
        // Unattributed: leaves only when every linked account can project
        // and one of them covers the amount (fixture A's missing months).
        const linked = linkedAccounts.get(canonical)!;
        if (linked.size === eligible.size && [...eligible].some((L) => amountCoveredOn(L, amount))) {
          const covering = [...eligible].filter((L) => amountCoveredOn(L, amount)).sort();
          candidates.push({ row: t, canonical, amount, attributed: false, choiceAccounts: covering });
        }
      }
    }
    // Deterministic order: attributed first (their pair IS the evidence),
    // then date, then id — the same read always makes the same choice.
    candidates.sort((a, b) => {
      if (a.attributed !== b.attributed) return a.attributed ? -1 : 1;
      if (a.row.date !== b.row.date) return a.row.date < b.row.date ? -1 : 1;
      return a.row.id < b.row.id ? -1 : a.row.id > b.row.id ? 1 : 0;
    });
    // Capacity per (canonical, month, amount): the month's inflows at that
    // amount onto the eligible linked accounts (observed carrying), or the
    // obligations covering it there (projected carrying), whichever is
    // larger. Both are CHECKED facts — never the candidate count itself.
    const inflowCount = (canonical: string, ym: string, amount: number): number => {
      const eligible = eligibleAccounts.get(canonical)!;
      let n = 0;
      for (const [loanAccountId, inflows] of inflowsByLoanAccount) {
        if (!eligible.has(loanAccountId)) continue;
        for (const b of inflows) {
          if (b.amountCents === amount && monthKey(isoDate(b.date)) === ym) n += 1;
        }
      }
      return n;
    };
    const obligationCount = (canonical: string, amount: number): number => {
      const eligible = eligibleAccounts.get(canonical)!;
      let n = 0;
      for (const loanAccountId of eligible) {
        for (const p of obligationsByAccount.get(loanAccountId) ?? []) {
          if (p === amount) n += 1;
        }
      }
      return n;
    };
    const used = new Map<string, number>();
    const factKeys = new Set<string>();
    for (const c of candidates) {
      const ym = monthKey(isoDate(c.row.date));
      const k = `${c.canonical}|${ym}|${c.amount}`;
      const seen = used.get(k) ?? 0;
      const capacity = Math.max(inflowCount(c.canonical, ym, c.amount), obligationCount(c.canonical, c.amount));
      if (seen < capacity) {
        excludeIds.add(c.row.id);
        used.set(k, seen + 1);
        // The disclosure facts are derived from ACTUAL exclusions, never from
        // eligibility (critic cycle 3 P1-1): a merchant that qualified but
        // kept all of its rows (covered-amount gap, split evidence, capacity
        // spent elsewhere) publishes nothing — the scoped "counted on the
        // loan" sentence (per surface, O.18e-FU) is printed only for money
        // that left.
        const accountId = c.choiceAccounts[0];
        const fk = `${c.canonical}|${accountId}|${c.amount}`;
        if (!factKeys.has(fk)) {
          factKeys.add(fk);
          excluded.push({ canonical: c.canonical, accountId, paymentCents: c.amount });
        }
      }
    }
  }
  return { excludeIds, excluded };
}
