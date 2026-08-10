/**
 * K.7 (DECISIONS #437) — the ownership rule: an obligation-backed loan payment is
 * projected ONCE. Every case below is written so that deleting the rule turns it
 * red, and so that widening the rule (suppressing on a weaker link) turns a
 * different one red — the two directions this module has to hold at the same time.
 */
import { describe, it, expect } from 'vitest';
import {
  splitLoanCarriedScheduled,
  type CarriedLoanPayment,
} from '@/lib/engine/loans/duplicate-projection';

/** The demo's auto loan, as `server/recurring.ts` would persist the detected series:
 *  description = the merchant canonical, signed outflow, on the payment account. */
const DETECTED = { description: 'CARMAX AUTO FINANCE', amountCents: -38500, nextDate: '2026-07-05' };
const RENT = { description: 'Rent — Peachtree Properties', amountCents: -180000, nextDate: '2026-07-24' };
const PAYROLL = { description: 'Payroll — Acme Analytics', amountCents: 245000, nextDate: '2026-07-10' };

const OBLIGATION = { accountId: 'acct-autoloan', paymentCents: 38500 };
const CARRIED: CarriedLoanPayment[] = [
  { canonical: 'Carmax Auto Finance', accountId: 'acct-autoloan', paymentCents: 38500 },
];

/** The canonical C.25 actually mints for this descriptor — pinned so the test can
 *  never pass by agreeing with a typo on both sides. */
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';
const DETECTED_CANONICAL = normalizeMerchant(DETECTED.description).canonical;

describe('splitLoanCarriedScheduled — the obligation owns the payment', () => {
  it('pins the canonical the rule matches on (the fixture is not free to invent one)', () => {
    expect(CARRIED[0].canonical).toBe(DETECTED_CANONICAL);
    expect(normalizeMerchant(DETECTED.description).aggregate).toBe(false);
  });

  it('suppresses the detected row a C.25 fact proves the obligation already carries', () => {
    const { kept, suppressed } = splitLoanCarriedScheduled({
      scheduled: [PAYROLL, DETECTED, RENT],
      obligations: [OBLIGATION],
      carried: CARRIED,
    });
    expect(suppressed).toEqual([DETECTED]);
    // Everything else survives, in order, as the SAME objects.
    expect(kept).toEqual([PAYROLL, RENT]);
    expect(kept[0]).toBe(PAYROLL);
    expect(kept[1]).toBe(RENT);
  });

  it('keeps the row when the loan has no obligation in THIS projection (nothing carries it)', () => {
    // The R4 case: a superseded predecessor's obligation is filtered out upstream.
    // Suppressing here would delete a real payment from the projection entirely.
    const { kept, suppressed } = splitLoanCarriedScheduled({
      scheduled: [DETECTED],
      obligations: [],
      carried: CARRIED,
    });
    expect(suppressed).toEqual([]);
    expect(kept).toEqual([DETECTED]);
  });

  it('keeps the row when C.25 minted no fact (a first month, or a loan the bank shows one-sided)', () => {
    const { kept, suppressed } = splitLoanCarriedScheduled({
      scheduled: [DETECTED],
      obligations: [OBLIGATION],
      carried: [],
    });
    expect(suppressed).toEqual([]);
    expect(kept).toEqual([DETECTED]);
  });

  it('keeps the row when the amounts differ — the obligation does not carry THIS money', () => {
    // An escrow adjustment, a late fee, a payoff at a new amount: the app shows it
    // nowhere else, so it must stay visible (#400's failure-direction rule).
    const offAmount = { ...DETECTED, amountCents: -41200 };
    const { kept, suppressed } = splitLoanCarriedScheduled({
      scheduled: [offAmount],
      obligations: [OBLIGATION],
      carried: CARRIED,
    });
    expect(suppressed).toEqual([]);
    expect(kept).toEqual([offAmount]);
  });

  it('keeps the row when the fact names a loan account no obligation here charges at that amount', () => {
    // The fact is real but speaks for a DIFFERENT loan; a canonical+amount match
    // alone must not be enough, or one merchant paying two loans would launder the
    // undatable one's payment out of the projection (C.25's own P1-3 lesson).
    const { kept, suppressed } = splitLoanCarriedScheduled({
      scheduled: [DETECTED],
      obligations: [{ accountId: 'acct-otherloan', paymentCents: 38500 }],
      carried: CARRIED,
    });
    expect(suppressed).toEqual([]);
    expect(kept).toEqual([DETECTED]);
  });

  it('never suppresses an inflow, even at the obligation amount', () => {
    const inflow = { description: DETECTED.description, amountCents: 38500, nextDate: '2026-07-05' };
    const { kept, suppressed } = splitLoanCarriedScheduled({
      scheduled: [inflow],
      obligations: [OBLIGATION],
      carried: CARRIED,
    });
    expect(suppressed).toEqual([]);
    expect(kept).toEqual([inflow]);
  });

  it('refuses an aggregate canonical, so a shared descriptor can never be suppressed', () => {
    // C.25 refuses to MINT a fact from an aggregate payee (the C.4 doctrine); this
    // refuses to CONSUME one, so a fact arriving by any other route is still inert.
    const zelle = { description: 'ZELLE PAYMENT TO CARMAX', amountCents: -38500, nextDate: '2026-07-05' };
    const m = normalizeMerchant(zelle.description);
    expect(m.aggregate).toBe(true); // the premise of this test, pinned
    const { kept, suppressed } = splitLoanCarriedScheduled({
      scheduled: [zelle],
      obligations: [OBLIGATION],
      carried: [{ canonical: m.canonical, accountId: 'acct-autoloan', paymentCents: 38500 }],
    });
    expect(suppressed).toEqual([]);
    expect(kept).toEqual([zelle]);
  });

  it('is an identity passthrough on the golden path (no obligations, no facts)', () => {
    const rows = [PAYROLL, RENT];
    const { kept, suppressed } = splitLoanCarriedScheduled({
      scheduled: rows,
      obligations: [],
      carried: [],
    });
    expect(suppressed).toEqual([]);
    expect(kept).toEqual(rows);
  });

  it('suppresses at most as many occurrences as facts cover the key — the cap is per proven payment, not per canonical', () => {
    // Cycle-1 critic F2 (executed): two rows at the same canonical+amount are TWO
    // series — two loans paying through one shared canonical, or a re-keyed
    // series — and ONE fact proves exactly ONE of them is carried. The pre-critic
    // rule suppressed both on the key alone, deleting the other loan's payment
    // from the projection entirely. Capped: first row suppressed, the second
    // stays projected, visibly.
    const second = { ...DETECTED, nextDate: '2026-08-05' };
    const { kept, suppressed } = splitLoanCarriedScheduled({
      scheduled: [DETECTED, second, RENT],
      obligations: [OBLIGATION],
      carried: CARRIED,
    });
    expect(suppressed).toEqual([DETECTED]);
    expect(kept).toEqual([second, RENT]);
  });
});

describe('K.7 cycle 1 — the two P1 fixes the hostile critic executed (F1, F2)', () => {
  // F1 — the REAL pipeline chain. C.25 mints its fact canonical from the RAW ACH
  // descriptor via the KNOWN_MERCHANTS pattern (/^ACH WITHDRAWAL CARMAX/ →
  // 'CarMax Auto Finance'); server/recurring.ts persists that same canonical as
  // the series description. The pattern does NOT round-trip: fed the canonical
  // itself, normalizeMerchant falls back to title-casing ('Carmax Auto Finance').
  // The pre-critic rule compared the fact's raw string against the row's
  // re-derived canonical and was INERT on the very chain it exists for (probe
  // k7-critic-canonical-chain-probe.mts: "REAL chain suppressed? : false"). Both
  // sides now pass through the same normalization.
  it('F1 — suppresses on the REAL chain: the pattern-minted fact canonical vs the persisted row description', () => {
    const m = normalizeMerchant('CarMax Auto Finance');
    expect(m.canonical).toBe('Carmax Auto Finance'); // premise pinned: no pattern covers the bare canonical
    expect(m.aggregate).toBe(false);
    const row = { description: 'CarMax Auto Finance', amountCents: -38500, nextDate: '2026-07-05' };
    const { kept, suppressed } = splitLoanCarriedScheduled({
      scheduled: [row],
      obligations: [OBLIGATION],
      carried: [{ canonical: 'CarMax Auto Finance', accountId: 'acct-autoloan', paymentCents: 38500 }],
    });
    expect(suppressed).toEqual([row]);
    expect(kept).toEqual([]);
  });

  // F2 — the generic servicer rule collapses both loans onto one canonical
  // ('Nelnet'), so a (canonical|amount) key can be shared by two obligations.
  // The cap must be one fact = one carried payment, never "any fact under the
  // key covers every row under it".
  const NELNET_LOAN_1 = { accountId: 'acct-student1', paymentCents: 20000 };
  const NELNET_LOAN_2 = { accountId: 'acct-student2', paymentCents: 20000 };
  const NELNET_ROW_1 = { description: 'NELNET', amountCents: -20000, nextDate: '2026-07-10' };
  const NELNET_ROW_2 = { description: 'NELNET', amountCents: -20000, nextDate: '2026-08-10' };
  const NELNET_CARRIED_1: CarriedLoanPayment = {
    canonical: 'Nelnet',
    accountId: 'acct-student1',
    paymentCents: 20000,
  };
  const NELNET_CARRIED_2: CarriedLoanPayment = {
    canonical: 'Nelnet',
    accountId: 'acct-student2',
    paymentCents: 20000,
  };

  it('F2 — one fact proves ONE carried payment: the undatable twin stays projected', () => {
    // C.25 could only date loan 1; loan 2 has no fact. Both payments leave
    // checking under the same canonical and amount. The pre-critic rule
    // suppressed BOTH — the undatable loan's real payment vanished from the
    // projection (probe k7-critic-over-suppress-probe.mts). Exactly the proven
    // one goes; the other stays, visibly (#400's failure direction).
    const { kept, suppressed } = splitLoanCarriedScheduled({
      scheduled: [NELNET_ROW_1, NELNET_ROW_2],
      obligations: [NELNET_LOAN_1, NELNET_LOAN_2],
      carried: [NELNET_CARRIED_1],
    });
    expect(suppressed).toHaveLength(1);
    expect(kept).toHaveLength(1);
    expect(kept[0]).toBe(NELNET_ROW_2); // the second series is the uncovered one
  });

  it('F2 — two facts prove two payments: BOTH rows may go, one per loan account', () => {
    // The other direction of the cap: with both loans dateable the key is
    // covered twice, and both rows are provably carried. A cap of one would now
    // silently keep a payment the obligations DO carry — the mirror of F2.
    const { kept, suppressed } = splitLoanCarriedScheduled({
      scheduled: [NELNET_ROW_1, NELNET_ROW_2],
      obligations: [NELNET_LOAN_1, NELNET_LOAN_2],
      carried: [NELNET_CARRIED_1, NELNET_CARRIED_2],
    });
    expect(suppressed).toHaveLength(2);
    expect(kept).toHaveLength(0);
  });
});
