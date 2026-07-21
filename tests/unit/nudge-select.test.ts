/**
 * Smart Notification & Nudge Engine — slice 1 acceptance tests
 * (AI_DIFFERENTIATION_PLAN §2.2; NUDGE_PLAN.md criteria 1–7).
 *
 * The engine is a pure reshape+order over existing engine outputs. These tests pin:
 *   1. verbatim-copy (every cents/date equals its source field; no money arithmetic),
 *   2. total tier mapping over a closed union,
 *   3. the always-escalate CRITICAL floor (survives dismissal),
 *   4. autopay silence (HANDLED never headlines),
 *   5. push lockstep (every selectNotifications candidate tiers CRITICAL, both drifts),
 *   6. deterministic order (hand-verified in docs/EDGE_CASES.md §Nudge feed),
 *   7. dismissal honesty (CRITICAL reappears next build; opportunity keys to its fact).
 *
 * Fixed today = 2026-06-10 throughout. All amounts integer cents.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cents } from '@/lib/money';
import { addDays, isoDate } from '@/lib/dates';
import type { PaymentReminder, ReminderUrgency } from '@/lib/engine/reminders/select';
import type { RadarResult } from '@/lib/engine/radar/radar';
import type { CashNeededResult } from '@/lib/engine/cash-needed/types';
import type { Opportunity, OpportunityKind } from '@/lib/engine/fi/insights';
import {
  paymentNotificationKey,
  radarNotificationKey,
  selectNotifications,
} from '@/lib/engine/notify/select';
import { buildNudgeFeed } from '@/lib/engine/nudge/select';
import type { NudgeInput, ProposalTier } from '@/lib/engine/nudge/types';
import type { UnusualCharge } from '@/lib/engine/anomaly/detect';

const TODAY = isoDate('2026-06-10');

// ---- fixture factories (hand-built source rows, seed-independent) ----------------

function reminder(o: {
  accountId?: string;
  accountName?: string;
  dueDate: string;
  daysUntil: number;
  userActionCents: number;
  autopayCents?: number;
  autopayCovered?: boolean;
  isEstimated?: boolean;
  urgency?: ReminderUrgency;
}): PaymentReminder {
  const autopay = o.autopayCents ?? 0;
  return {
    accountId: o.accountId ?? 'acct-1',
    accountName: o.accountName ?? 'Sapphire',
    obligationType: 'card',
    dueDate: isoDate(o.dueDate),
    daysUntil: o.daysUntil,
    urgency: o.urgency ?? (o.daysUntil <= 0 ? 'today' : o.daysUntil <= 3 ? 'soon' : 'upcoming'),
    cashRequiredCents: cents(autopay + o.userActionCents),
    userActionCents: cents(o.userActionCents),
    autopayCents: cents(autopay),
    autopayCovered: o.autopayCovered ?? autopay > 0,
    isEstimated: o.isEstimated ?? false,
  };
}

function radarOf(o: {
  pushWorthy?: boolean;
  firstNegativeDate?: string | null;
  daysUntilFirstNegative?: number | null;
  coverCents?: number;
  coverByDate?: string;
  includesEstimatedDues?: boolean;
}): RadarResult {
  const fnd = o.firstNegativeDate === undefined ? '2026-06-14' : o.firstNegativeDate;
  return {
    today: TODAY,
    horizonDays: 30,
    status: 'alert',
    committed: {
      firstNegativeDate: fnd ? isoDate(fnd) : null,
      lowestDate: isoDate(fnd ?? '2026-06-14'),
      lowestCents: -5000,
      endingCents: -5000,
    },
    daysUntilFirstNegative: o.daysUntilFirstNegative === undefined ? 4 : o.daysUntilFirstNegative,
    pushWorthy: o.pushWorthy ?? true,
    collidingCards: [],
    dipEvents: [],
    coverTransfer:
      o.coverCents === undefined
        ? null
        : { amountCents: cents(o.coverCents), byDate: isoDate(o.coverByDate ?? '2026-06-13'), sources: [] },
    burn: null,
    includesEstimatedDues: o.includesEstimatedDues ?? false,
    assumptions: [],
  };
}

function cashNeededOf(o: {
  shortfallCents: number;
  shortfallDate?: string | null;
  byDate?: string | null;
  requiredCents?: number;
  /** isEstimated flag per synthesized perDueDate point (default: one real point). */
  cycleEstimatedFlags?: boolean[];
}): CashNeededResult {
  const flags = o.cycleEstimatedFlags ?? [false];
  const perDueDate = flags.map((est, i) => ({
    date: isoDate(addDays(TODAY, i + 1)),
    cards: [
      {
        cardId: `c${i}`,
        cardName: `Card ${i}`,
        amountCents: cents(10000),
        autopayCents: cents(0),
        isEstimated: est,
      },
    ],
    dayTotalCents: cents(10000),
    cumulativeNeedCents: cents(10000 * (i + 1)),
    projectedBalanceAfterCents: cents(-5000),
    shortfallCents: cents(5000),
  }));
  return {
    scenario: 'PAY_IN_FULL',
    headline: {
      requiredCents: cents(o.requiredCents ?? 481233),
      byDate: o.byDate === undefined ? isoDate('2026-06-15') : o.byDate ? isoDate(o.byDate) : null,
      cardsDueCount: 2,
      shortfallCents: cents(o.shortfallCents),
      shortfallDate:
        o.shortfallDate === undefined
          ? isoDate('2026-06-15')
          : o.shortfallDate
            ? isoDate(o.shortfallDate)
            : null,
      recommendation: null,
    },
    perDueDate,
    cards: [],
    upcoming: [],
    intraPeriodMinimum: null,
    minimumPathInterestCents: null,
    assumptions: [],
  };
}

function oppOf(o: {
  kind: OpportunityKind;
  merchant: string;
  monthlyCents: number;
  isEstimate?: boolean;
  priceFromCents?: number;
  priceToCents?: number;
}): Opportunity {
  return {
    kind: o.kind,
    merchant: o.merchant,
    monthlyCents: cents(o.monthlyCents),
    fv10Cents: cents(0),
    fv20Cents: cents(0),
    fv30Cents: cents(0),
    isEstimate: o.isEstimate ?? false,
    priceFromCents: o.priceFromCents === undefined ? undefined : cents(o.priceFromCents),
    priceToCents: o.priceToCents === undefined ? undefined : cents(o.priceToCents),
  };
}

function input(over: Partial<NudgeInput> = {}): NudgeInput {
  return {
    today: TODAY,
    reminders: [],
    radar: null,
    cashNeeded: null,
    opportunities: [],
    ...over,
  };
}

function chargeOf(o: {
  txnId?: string;
  merchant?: string;
  date?: string;
  amountCents?: number;
  typicalCents?: number;
  madCents?: number;
  sampleCount?: number;
  deviationCents?: number;
}): UnusualCharge {
  return {
    txnId: o.txnId ?? 'txn-anom-1',
    merchantCanonical: o.merchant ?? 'Blue Bottle Coffee',
    date: isoDate(o.date ?? '2026-06-02'),
    amountCents: cents(o.amountCents ?? 21436),
    typicalCents: cents(o.typicalCents ?? 750),
    madCents: cents(o.madCents ?? 150),
    sampleCount: o.sampleCount ?? 14,
    deviationCents: cents(o.deviationCents ?? 20686),
  };
}

const KNOWN_TIERS: ReadonlySet<ProposalTier> = new Set(['critical', 'action', 'opportunity', 'handled']);
const KNOWN_KINDS: ReadonlySet<string> = new Set([
  'payment_due',
  'cash_flow_dip',
  'cash_needed_shortfall',
  'unusual_charge',
  'unused-subscription',
  'price-increase',
  'insurance-reshop',
  'negotiable-bill',
]);

// ================================================================================
// Criterion 1 — verbatim-copy: every cents/date equals its source; no money arithmetic
// ================================================================================
describe('nudge · criterion 1 · verbatim-copy', () => {
  it('copies cents and dates byte-for-byte from each source row', () => {
    const r = reminder({ accountId: 'acct-amex', dueDate: '2026-06-12', daysUntil: 2, userActionCents: 180055 });
    const cn = cashNeededOf({ shortfallCents: 141233, shortfallDate: '2026-06-16' });
    const rad = radarOf({ firstNegativeDate: '2026-06-14', daysUntilFirstNegative: 4, coverCents: 50000 });
    const op = oppOf({ kind: 'unused-subscription', merchant: 'GymPass', monthlyCents: 4000 });
    const feed = buildNudgeFeed(input({ reminders: [r], cashNeeded: cn, radar: rad, opportunities: [op] }));

    const byKind = new Map(feed.ordered.map((p) => [p.kind, p]));
    // identity-equal to the exact source field (branded cents are primitives → === is value equality)
    expect(byKind.get('payment_due')!.centsAtStake).toBe(r.userActionCents);
    expect(byKind.get('payment_due')!.sortDate).toBe(r.dueDate);
    expect(byKind.get('payment_due')!.daysUntil).toBe(r.daysUntil);
    expect(byKind.get('cash_needed_shortfall')!.centsAtStake).toBe(cn.headline.shortfallCents);
    expect(byKind.get('cash_needed_shortfall')!.sortDate).toBe(cn.headline.shortfallDate);
    expect(byKind.get('cash_flow_dip')!.centsAtStake).toBe(rad.coverTransfer!.amountCents);
    expect(byKind.get('cash_flow_dip')!.sortDate).toBe(rad.committed.firstNegativeDate);
    expect(byKind.get('unused-subscription')!.centsAtStake).toBe(op.monthlyCents);
  });

  it('a handled autopay due exposes the autopay amount verbatim', () => {
    const r = reminder({ dueDate: '2026-06-12', daysUntil: 2, userActionCents: 0, autopayCents: 210000 });
    const feed = buildNudgeFeed(input({ reminders: [r] }));
    expect(feed.ordered[0].tier).toBe('handled');
    expect(feed.ordered[0].centsAtStake).toBe(r.autopayCents);
  });

  it('the engine source contains no money arithmetic (grep-provable)', () => {
    const path = fileURLToPath(new URL('../../src/lib/engine/nudge/select.ts', import.meta.url));
    const raw = readFileSync(path, 'utf8');
    // Strip comments and string/template literals so only executable code is inspected.
    const code = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '')
      .replace(/'(?:[^'\\]|\\.)*'/g, "''")
      .replace(/`(?:[^`\\]|\\.)*`/g, '``');
    // No money-arithmetic helpers.
    expect(/\b(?:addCents|sumCents|subCents|mulCents|divCents)\b/.test(code)).toBe(false);
    // No arithmetic operator bound to any cents-bearing identifier.
    const centsTok = '(?:centsAtStake|[A-Za-z]*Cents)';
    expect(new RegExp(centsTok + '\\s*[+\\-*/]').test(code)).toBe(false);
    expect(new RegExp('[+\\-*/]\\s*' + centsTok).test(code)).toBe(false);
  });
});

// ================================================================================
// Criterion 2 — total tier mapping over a closed union
// ================================================================================
describe('nudge · criterion 2 · total tier mapping', () => {
  it('maps every source row to exactly one proposal with a known tier and kind', () => {
    const reminders = [
      reminder({ accountId: 'a1', dueDate: '2026-06-12', daysUntil: 2, userActionCents: 50000 }),
      reminder({ accountId: 'a2', dueDate: '2026-06-30', daysUntil: 20, userActionCents: 30000 }),
      reminder({ accountId: 'a3', dueDate: '2026-06-12', daysUntil: 2, userActionCents: 0, autopayCents: 90000 }),
    ];
    const opportunities: Opportunity[] = [
      oppOf({ kind: 'unused-subscription', merchant: 'M1', monthlyCents: 4000 }),
      oppOf({ kind: 'price-increase', merchant: 'M2', monthlyCents: 2499, priceFromCents: 1999, priceToCents: 2499 }),
      oppOf({ kind: 'insurance-reshop', merchant: 'M3', monthlyCents: 12000 }),
      oppOf({ kind: 'negotiable-bill', merchant: 'M4', monthlyCents: 8000 }),
    ];
    const feed = buildNudgeFeed(
      input({
        reminders,
        opportunities,
        radar: radarOf({ firstNegativeDate: '2026-06-14' }),
        cashNeeded: cashNeededOf({ shortfallCents: 100000 }),
        unusualCharges: [chargeOf({})],
      }),
    );
    // 3 reminders + 4 opps + 1 dip + 1 shortfall + 1 unusual charge = 10 proposals, all valid.
    expect(feed.ordered).toHaveLength(10);
    for (const p of feed.ordered) {
      expect(KNOWN_TIERS.has(p.tier)).toBe(true);
      expect(KNOWN_KINDS.has(p.kind)).toBe(true);
      expect(p.subjectKey).toBe(`nudge:${p.kind}`);
    }
    const tiers = feed.ordered.map((p) => p.tier);
    expect(tiers.filter((t) => t === 'critical')).toHaveLength(3); // due-in-window + dip + shortfall
    expect(tiers.filter((t) => t === 'action')).toHaveLength(2); // due out of window + unusual charge
    expect(tiers.filter((t) => t === 'opportunity')).toHaveLength(4);
    expect(tiers.filter((t) => t === 'handled')).toHaveLength(1);
  });
});

// ================================================================================
// Unusual Charge Radar (#249) — ACTION tier, verbatim passthrough, per-txn dismissal
// ================================================================================
describe('nudge · unusual_charge (#249)', () => {
  it('carries every detector field VERBATIM: charge, date, merchant, typical, count', () => {
    const u = chargeOf({ txnId: 'txn-9', amountCents: 21436, typicalCents: 750, sampleCount: 14, date: '2026-06-02' });
    const feed = buildNudgeFeed(input({ unusualCharges: [u] }));
    expect(feed.ordered).toHaveLength(1);
    const p = feed.ordered[0];
    expect(p.kind).toBe('unusual_charge');
    expect(p.tier).toBe('action'); // a decision, no deadline — never competes with CRITICAL
    expect(p.key).toBe('unusual_charge:txn-9');
    expect(p.centsAtStake).toBe(u.amountCents);
    expect(p.sortDate).toBe(u.date);
    expect(p.merchant).toBe(u.merchantCanonical);
    expect(p.typicalCents).toBe(u.typicalCents);
    expect(p.typicalCount).toBe(u.sampleCount);
    expect(p.autopayCents).toBe(0);
    expect(p.isEstimated).toBe(false); // a posted charge is a fact, not an estimate
  });

  it('every OTHER kind carries null display context (merchant/typicalCents/typicalCount)', () => {
    const feed = buildNudgeFeed(
      input({
        reminders: [reminder({ dueDate: '2026-06-12', daysUntil: 2, userActionCents: 50000 })],
        radar: radarOf({ firstNegativeDate: '2026-06-14' }),
        cashNeeded: cashNeededOf({ shortfallCents: 100000 }),
        opportunities: [oppOf({ kind: 'unused-subscription', merchant: 'GymPass', monthlyCents: 4000 })],
      }),
    );
    for (const p of feed.ordered) {
      expect(p.merchant, p.kind).toBeNull();
      expect(p.typicalCents, p.kind).toBeNull();
      expect(p.typicalCount, p.kind).toBeNull();
    }
  });

  it('dismissal keys to the TRANSACTION: the same txn stays hidden, a new anomaly reappears', () => {
    const u = chargeOf({ txnId: 'txn-9' });
    const dismissedKeys = new Set(['unusual_charge:txn-9']);
    const hidden = buildNudgeFeed(input({ unusualCharges: [u], dismissedKeys }));
    expect(hidden.ordered).toHaveLength(0);
    // A NEW anomaly (different transaction) is a new fact — it is not suppressed.
    const fresh = buildNudgeFeed(input({ unusualCharges: [chargeOf({ txnId: 'txn-10' })], dismissedKeys }));
    expect(fresh.ordered).toHaveLength(1);
    expect(fresh.headline?.key).toBe('unusual_charge:txn-10');
  });

  it('ranks below a CRITICAL due but above opportunities; absent input means no proposal', () => {
    const feed = buildNudgeFeed(
      input({
        reminders: [reminder({ dueDate: '2026-06-12', daysUntil: 2, userActionCents: 50000 })],
        opportunities: [oppOf({ kind: 'unused-subscription', merchant: 'GymPass', monthlyCents: 4000 })],
        unusualCharges: [chargeOf({})],
      }),
    );
    expect(feed.ordered.map((p) => p.kind)).toEqual(['payment_due', 'unusual_charge', 'unused-subscription']);
    // Backward-compat: NudgeInput without the field behaves as before.
    expect(buildNudgeFeed(input({})).ordered).toHaveLength(0);
  });

  it('never pushes: selectNotifications is blind to unusual charges by construction', () => {
    // The push selector's input shape has no unusual-charge channel at all — the
    // lockstep concern (criterion 5) cannot arise for this kind. Assert the feed's
    // unusual_charge proposal is NOT critical (the only tier push escalates).
    const feed = buildNudgeFeed(input({ unusualCharges: [chargeOf({})] }));
    expect(feed.ordered[0].tier).not.toBe('critical');
  });
});

// ================================================================================
// Criterion 3 — always-escalate CRITICAL floor (survives any dismissal)
// ================================================================================
describe('nudge · criterion 3 · always-escalate floor', () => {
  it('a committed-only first-negative ≤7d ranks CRITICAL #1 regardless of dismissal', () => {
    const rad = radarOf({ firstNegativeDate: '2026-06-14', daysUntilFirstNegative: 4, coverCents: 50000 });
    const base = buildNudgeFeed(input({ radar: rad }));
    expect(base.headline).not.toBeNull();
    expect(base.headline!.kind).toBe('cash_flow_dip');
    expect(base.headline!.tier).toBe('critical');

    // Dismiss its key — it must still be the CRITICAL headline (a material warning is never buried).
    const dismissed = new Set([base.headline!.dismissKey]);
    const after = buildNudgeFeed(input({ radar: rad, dismissedKeys: dismissed }));
    expect(after.headline!.kind).toBe('cash_flow_dip');
    expect(after.headline!.tier).toBe('critical');
    expect(after.headline!.dismissed).toBe(true);
    expect(after.emptyReason).toBeNull();
  });
});

// ================================================================================
// Criterion 4 — autopay silence
// ================================================================================
describe('nudge · criterion 4 · autopay silence', () => {
  it('an autopay-covered due is HANDLED — never headline, never above a user-action proposal', () => {
    const autopay = reminder({ accountId: 'auto', dueDate: '2026-06-11', daysUntil: 1, userActionCents: 0, autopayCents: 300000 });
    const action = reminder({ accountId: 'act', dueDate: '2026-06-25', daysUntil: 15, userActionCents: 40000 });
    const feed = buildNudgeFeed(input({ reminders: [autopay, action] }));
    expect(feed.headline!.kind).toBe('payment_due');
    expect(feed.headline!.tier).toBe('action'); // the user-action due, NOT the earlier autopay date
    const handled = feed.ordered.find((p) => p.tier === 'handled');
    expect(handled).toBeDefined();
    // handled sorts strictly after the action item despite its earlier date
    expect(feed.ordered.indexOf(handled!)).toBeGreaterThan(feed.ordered.indexOf(feed.headline!));
  });

  it('an all-autopay day yields the honest empty headline', () => {
    const a1 = reminder({ accountId: 'a1', dueDate: '2026-06-11', daysUntil: 1, userActionCents: 0, autopayCents: 100000 });
    const a2 = reminder({ accountId: 'a2', dueDate: '2026-06-12', daysUntil: 2, userActionCents: 0, autopayCents: 200000 });
    const feed = buildNudgeFeed(input({ reminders: [a1, a2] }));
    expect(feed.headline).toBeNull();
    expect(feed.emptyReason).toBe('Nothing needs you today.');
    expect(feed.rest.every((p) => p.tier === 'handled')).toBe(true); // reassurance still present
    expect(feed.rest).toHaveLength(2);
  });

  it('no proposals at all → honest empty, no manufactured urgency', () => {
    const feed = buildNudgeFeed(input());
    expect(feed.headline).toBeNull();
    expect(feed.emptyReason).toBe('Nothing needs you today.');
    expect(feed.ordered).toHaveLength(0);
  });
});

// ================================================================================
// Criterion 5 — push lockstep (every selectNotifications candidate tiers CRITICAL)
// ================================================================================
describe('nudge · criterion 5 · push lockstep', () => {
  it('every push candidate has a CRITICAL feed proposal with the same key (both drift directions)', () => {
    const reminders = [
      reminder({ accountId: 'push-due', dueDate: '2026-06-12', daysUntil: 2, userActionCents: 50000 }), // pushes
      reminder({ accountId: 'later', dueDate: '2026-06-30', daysUntil: 20, userActionCents: 30000 }), // no push (ACTION)
      reminder({ accountId: 'auto', dueDate: '2026-06-11', daysUntil: 1, userActionCents: 0, autopayCents: 90000 }), // no push (HANDLED)
    ];
    const rad = radarOf({ firstNegativeDate: '2026-06-14', daysUntilFirstNegative: 4, coverCents: 50000 }); // pushes
    const opportunities = [oppOf({ kind: 'unused-subscription', merchant: 'M', monthlyCents: 4000 })];

    const notifications = selectNotifications({ reminders, radar: rad, today: TODAY });
    const feed = buildNudgeFeed(input({ reminders, radar: rad, opportunities }));

    expect(notifications.length).toBeGreaterThan(0);
    // Direction B (push escalates something the feed doesn't know): every candidate must
    // resolve to a feed proposal. Direction A (feed buries it): that proposal must be CRITICAL.
    for (const n of notifications) {
      const p = feed.ordered.find((x) => x.key === n.key);
      expect(p, `no feed proposal for push key ${n.key}`).toBeDefined();
      expect(p!.tier, `push key ${n.key} not CRITICAL in feed`).toBe('critical');
    }
    // The keys really are shared (reused, not re-minted).
    expect(notifications.map((n) => n.key)).toContain(paymentNotificationKey({ accountId: 'push-due', dueDate: '2026-06-12' }));
    expect(notifications.map((n) => n.key)).toContain(radarNotificationKey('2026-06-14'));
    // And the non-push items are genuinely below CRITICAL (proves the floor is discriminating).
    expect(feed.ordered.find((p) => p.key.includes('later'))!.tier).toBe('action');
    expect(feed.ordered.find((p) => p.tier === 'handled')).toBeDefined();
  });

  // The boundary is the ONLY place the twin predicates can drift: a `<=`→`<` mutation at
  // the window edge would push a daysUntil=3 due while tiering it ACTION, burying an
  // escalated warning. Sweep the edge in both directions so that mutation fails here.
  it.each([0, 1, 2, 3, 4, 5])('lockstep holds at the window boundary (daysUntil=%i)', (d) => {
    const r = reminder({ accountId: 'edge', dueDate: addDays(TODAY, d), daysUntil: d, userActionCents: 50000 });
    const pushEmitted = selectNotifications({ reminders: [r], radar: null, today: TODAY }).length === 1;
    const proposal = buildNudgeFeed(input({ reminders: [r] })).ordered[0];
    // push emits  ⇔  feed tiers it CRITICAL — for every day across the edge.
    expect(proposal.tier === 'critical', `daysUntil=${d}: push=${pushEmitted} tier=${proposal.tier}`).toBe(pushEmitted);
    expect(d <= 3 ? 'critical' : 'action').toBe(proposal.tier); // pins the exact edge value
  });

  it('an autopay-covered due neither pushes nor tiers CRITICAL (equivalence holds at userAction=0)', () => {
    const r = reminder({ accountId: 'auto', dueDate: '2026-06-11', daysUntil: 1, userActionCents: 0, autopayCents: 90000 });
    const pushEmitted = selectNotifications({ reminders: [r], radar: null, today: TODAY }).length === 1;
    const proposal = buildNudgeFeed(input({ reminders: [r] })).ordered[0];
    expect(pushEmitted).toBe(false);
    expect(proposal.tier).toBe('handled');
  });
});

// ================================================================================
// Criterion 6 — deterministic order (hand-verified, docs/EDGE_CASES.md §Nudge feed)
// ================================================================================
describe('nudge · criterion 6 · deterministic order', () => {
  it('O1: shortfall (2026-06-15) vs due-tomorrow (2026-06-11) → earlier date first', () => {
    const due = reminder({ accountId: 'due', dueDate: '2026-06-11', daysUntil: 1, userActionCents: 50000 });
    const cn = cashNeededOf({ shortfallCents: 141233, shortfallDate: '2026-06-15' });
    const feed = buildNudgeFeed(input({ reminders: [due], cashNeeded: cn }));
    expect(feed.ordered.map((p) => p.kind)).toEqual(['payment_due', 'cash_needed_shortfall']);
  });

  it('O2: estimated ($2000) vs real ($1800) due same day → higher cents first; estimated not demoted', () => {
    const amexReal = reminder({ accountId: 'amex', dueDate: '2026-06-12', daysUntil: 2, userActionCents: 180000, isEstimated: false });
    const chaseEst = reminder({ accountId: 'chase', dueDate: '2026-06-12', daysUntil: 2, userActionCents: 200000, isEstimated: true });
    const feed = buildNudgeFeed(input({ reminders: [amexReal, chaseEst] }));
    // Ordering is estimate-agnostic: the larger stake wins even though it's the estimate.
    expect(feed.ordered.map((p) => p.key)).toEqual([
      paymentNotificationKey({ accountId: 'chase', dueDate: '2026-06-12' }),
      paymentNotificationKey({ accountId: 'amex', dueDate: '2026-06-12' }),
    ]);
    expect(feed.ordered[0].isEstimated).toBe(true);
    expect(feed.ordered[0].tier).toBe('critical');
    expect(feed.ordered[1].tier).toBe('critical');
  });

  it('O3: price-increase ($24.99) vs unused-subscription ($40) → higher monthly first', () => {
    const priceInc = oppOf({ kind: 'price-increase', merchant: 'Netflix', monthlyCents: 2499, priceFromCents: 1999, priceToCents: 2499 });
    const unused = oppOf({ kind: 'unused-subscription', merchant: 'GymPass', monthlyCents: 4000 });
    const feed = buildNudgeFeed(input({ opportunities: [priceInc, unused] }));
    expect(feed.ordered.map((p) => p.kind)).toEqual(['unused-subscription', 'price-increase']);
  });

  it('full tier order: critical → action → opportunity → handled', () => {
    const feed = buildNudgeFeed(
      input({
        reminders: [
          reminder({ accountId: 'crit', dueDate: '2026-06-12', daysUntil: 2, userActionCents: 50000 }),
          reminder({ accountId: 'act', dueDate: '2026-06-30', daysUntil: 20, userActionCents: 30000 }),
          reminder({ accountId: 'auto', dueDate: '2026-06-11', daysUntil: 1, userActionCents: 0, autopayCents: 90000 }),
        ],
        opportunities: [oppOf({ kind: 'unused-subscription', merchant: 'M', monthlyCents: 4000 })],
      }),
    );
    expect(feed.ordered.map((p) => p.tier)).toEqual(['critical', 'action', 'opportunity', 'handled']);
  });
});

// ================================================================================
// Criterion 7 — dismissal honesty
// ================================================================================
describe('nudge · criterion 7 · dismissal honesty', () => {
  it('a CRITICAL condition dismissed today reappears (un-dismissed) on the next build', () => {
    const rad = radarOf({ firstNegativeDate: '2026-06-14', daysUntilFirstNegative: 4, coverCents: 50000 });
    const today = buildNudgeFeed(input({ radar: rad }));
    const dismissKey = today.headline!.dismissKey; // includes 2026-06-10
    expect(dismissKey).toContain('2026-06-10');

    // Same dismissal set, but a new day: the per-day key no longer matches → not dismissed.
    const tomorrow = buildNudgeFeed(
      input({ today: isoDate('2026-06-11'), radar: radarOf({ firstNegativeDate: '2026-06-14', daysUntilFirstNegative: 3, coverCents: 50000 }), dismissedKeys: new Set([dismissKey]) }),
    );
    expect(tomorrow.headline!.kind).toBe('cash_flow_dip');
    expect(tomorrow.headline!.dismissed).toBe(false);
  });

  it('a dismissed OPPORTUNITY stays hidden until its transition key changes, then returns', () => {
    const v1 = oppOf({ kind: 'price-increase', merchant: 'Netflix', monthlyCents: 2499, priceFromCents: 1999, priceToCents: 2499 });
    const first = buildNudgeFeed(input({ opportunities: [v1] }));
    const dismissKey = first.headline!.dismissKey;
    expect(dismissKey).not.toContain(TODAY); // per-fact, not per-day

    // Same fact, dismissed → suppressed entirely.
    const suppressed = buildNudgeFeed(input({ opportunities: [v1], dismissedKeys: new Set([dismissKey]) }));
    expect(suppressed.ordered).toHaveLength(0);
    expect(suppressed.headline).toBeNull();

    // A NEW price transition mints a new key → the opportunity returns despite the old dismissal.
    const v2 = oppOf({ kind: 'price-increase', merchant: 'Netflix', monthlyCents: 2999, priceFromCents: 2499, priceToCents: 2999 });
    const returned = buildNudgeFeed(input({ opportunities: [v2], dismissedKeys: new Set([dismissKey]) }));
    expect(returned.headline!.kind).toBe('price-increase');
    expect(returned.headline!.dismissed).toBe(false);
  });

  it('two same-merchant opportunities do not collide onto one dismissal', () => {
    // Two distinct series under one canonical merchant (e.g. two iCloud tiers).
    const tierA = oppOf({ kind: 'unused-subscription', merchant: 'iCloud', monthlyCents: 299 });
    const tierB = oppOf({ kind: 'unused-subscription', merchant: 'iCloud', monthlyCents: 999 });
    const feed = buildNudgeFeed(input({ opportunities: [tierA, tierB] }));
    const keys = feed.ordered.map((p) => p.dismissKey);
    expect(new Set(keys).size).toBe(2); // distinct keys — no collision

    // Dismissing the cheaper tier must NOT hide the pricier one.
    const dismissCheap = feed.ordered.find((p) => p.centsAtStake === tierA.monthlyCents)!.dismissKey;
    const after = buildNudgeFeed(input({ opportunities: [tierA, tierB], dismissedKeys: new Set([dismissCheap]) }));
    expect(after.ordered).toHaveLength(1);
    expect(after.ordered[0].centsAtStake).toBe(tierB.monthlyCents);
  });

  it('a dismissed ACTION due stays hidden while its fact is unchanged', () => {
    const due = reminder({ accountId: 'act', dueDate: '2026-06-30', daysUntil: 20, userActionCents: 30000 });
    const feed = buildNudgeFeed(input({ reminders: [due] }));
    const dismissKey = feed.headline!.dismissKey;
    const after = buildNudgeFeed(input({ reminders: [due], dismissedKeys: new Set([dismissKey]) }));
    expect(after.ordered).toHaveLength(0);
    expect(after.headline).toBeNull();
  });
});

// ================================================================================
// Guards — emit CRITICAL only when material (over-alert prevention; the false
// branches of the shortfall / pushWorthy guards, and the undated-order rule).
// ================================================================================
describe('nudge · guards · emit only when material', () => {
  it('a zero or negative shortfall emits NO cash_needed_shortfall proposal (no $0 urgency)', () => {
    for (const s of [0, -1]) {
      const feed = buildNudgeFeed(input({ cashNeeded: cashNeededOf({ shortfallCents: s }) }));
      expect(feed.ordered.find((p) => p.kind === 'cash_needed_shortfall')).toBeUndefined();
      expect(feed.headline).toBeNull();
    }
    // sanity (guards against a vacuous test): a positive shortfall DOES emit CRITICAL.
    const live = buildNudgeFeed(input({ cashNeeded: cashNeededOf({ shortfallCents: 1 }) }));
    expect(live.headline!.kind).toBe('cash_needed_shortfall');
    expect(live.headline!.tier).toBe('critical');
  });

  it('a non-pushWorthy radar emits NO cash_flow_dip (an 8–30d dip stays silent, matching push)', () => {
    const quiet = buildNudgeFeed(input({ radar: radarOf({ pushWorthy: false }) }));
    expect(quiet.ordered.find((p) => p.kind === 'cash_flow_dip')).toBeUndefined();
    expect(quiet.headline).toBeNull();
    // And push agrees: notify/select emits nothing for a non-pushWorthy radar (lockstep at the silence).
    expect(selectNotifications({ reminders: [], radar: radarOf({ pushWorthy: false }), today: TODAY })).toHaveLength(0);
    // sanity: pushWorthy DOES emit.
    expect(buildNudgeFeed(input({ radar: radarOf({ pushWorthy: true }) })).headline!.kind).toBe('cash_flow_dip');
  });

  it('within a tier, a dated proposal precedes an undated one (sortDate ranks above cents)', () => {
    // Both CRITICAL: a dated $500 due vs a fully-undated $2,000 shortfall. Date wins over cents.
    const due = reminder({ accountId: 'due', dueDate: '2026-06-12', daysUntil: 2, userActionCents: 50000 });
    const undated = cashNeededOf({ shortfallCents: 200000, shortfallDate: null, byDate: null });
    const feed = buildNudgeFeed(input({ reminders: [due], cashNeeded: undated }));
    expect(feed.ordered.map((p) => p.kind)).toEqual(['payment_due', 'cash_needed_shortfall']);
    expect(feed.ordered[0].tier).toBe('critical');
    expect(feed.ordered[1].sortDate).toBeNull();
  });
});

// ---- Slice 2, cycle-2 critic fixes (verbatim display context, honest estimate flag) ----
describe('nudge · slice-2 cycle-2 · money-honesty passthroughs', () => {
  it('N1: payment_due carries autopayCents VERBATIM (the card discloses the split, not a false total)', () => {
    // Partial autopay: statement $600, autopay minimum $100 → userActionCents $500.
    // centsAtStake is the $500 to pay; autopayCents must carry the $100 so the card can
    // show "autopay covers $100" and never present $500 as the whole statement.
    const r = reminder({ dueDate: '2026-06-12', daysUntil: 2, userActionCents: 50000, autopayCents: 10000 });
    const feed = buildNudgeFeed(input({ reminders: [r] }));
    const p = feed.ordered.find((x) => x.kind === 'payment_due')!;
    expect(p.tier).toBe('critical');
    expect(p.centsAtStake).toBe(r.userActionCents); // $500 to pay (verbatim)
    expect(p.autopayCents).toBe(r.autopayCents); // $100 covered (verbatim) — never summed
    // A no-autopay due carries autopayCents = 0 (the card then shows no split).
    const noAuto = reminder({ accountId: 'x', dueDate: '2026-06-12', daysUntil: 2, userActionCents: 60000 });
    expect(buildNudgeFeed(input({ reminders: [noAuto] })).ordered[0].autopayCents).toBe(0);
  });

  it('N1b: non-payment proposals carry autopayCents = 0', () => {
    const feed = buildNudgeFeed(
      input({
        cashNeeded: cashNeededOf({ shortfallCents: 1000 }),
        radar: radarOf({ coverCents: 5000 }),
        opportunities: [oppOf({ kind: 'unused-subscription', merchant: 'Gym', monthlyCents: 4000 })],
      }),
    );
    for (const p of feed.ordered.filter((x) => x.kind !== 'payment_due')) {
      expect(p.autopayCents).toBe(0);
    }
  });

  it('N2: cash_needed_shortfall.isEstimated reflects whether any cycle obligation is an estimate', () => {
    // NOTE: the real cash-needed engine makes perDueDate HOMOGENEOUS (all-real when any
    // statement exists, else all-estimated — estimated dues otherwise go to `upcoming`
    // and never feed the projection). The mixed [false,true] fixture below is synthetic;
    // `.some()` is robust either way, and this pins the honest-disclosure contract.
    // All-real cycle → not estimated.
    const real = buildNudgeFeed(input({ cashNeeded: cashNeededOf({ shortfallCents: 200000, cycleEstimatedFlags: [false, false] }) }));
    expect(real.headline!.kind).toBe('cash_needed_shortfall');
    expect(real.headline!.isEstimated).toBe(false);
    // Any estimated obligation in the cycle → the shortfall discloses "estimated".
    const est = buildNudgeFeed(input({ cashNeeded: cashNeededOf({ shortfallCents: 200000, cycleEstimatedFlags: [false, true] }) }));
    expect(est.headline!.isEstimated).toBe(true);
  });
});
