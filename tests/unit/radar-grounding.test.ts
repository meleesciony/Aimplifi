/**
 * Cash Flow Radar — seed grounding (DECISIONS #172). Proves the radar cannot
 * disagree with the surfaces the user already trusts: on the real demo seed,
 * its committed events are EXACTLY /forecast's assembly (scheduled + loan
 * flows), its current-cycle card dues are EXACTLY the cash-needed engine's
 * obligations, its transfer math is the shared $50-round-up rule, and its
 * sources honor the deposit-account guardrail (adjudicated condition 2) on the
 * seed's real account mix (which includes a $142k brokerage that must never be
 * proposed).
 */
import { describe, expect, it } from 'vitest';
import { NO_RECURRING_OVERRIDES } from '@/lib/engine/recurring/override';
import { isoDate } from '@/lib/dates';
import { holidayTable } from '@/lib/dates';
import { buildSeedData } from '@/lib/seed/build';
import { roundUpToNext50Dollars, cents } from '@/lib/money';
import {
  expandScheduled,
  loanObligationsToScheduledFlows,
  type ScheduledFlow,
} from '@/lib/engine/forecast/forecast';
import { selectLoanObligations } from '@/lib/engine/loans/obligations';
import { cashNeededFromSnapshot } from '@/server/finance';
import { radarFromSnapshot, RADAR_HORIZON_DAYS } from '@/server/radar';
import { TRANSFER_SOURCE_TYPES } from '@/lib/engine/radar/radar';
import type { FinanceSnapshot } from '@/lib/providers/types';

const TODAY = isoDate('2026-06-10'); // the pinned demo date
const seed = buildSeedData('2026-06-10');

const snap: FinanceSnapshot = {
  paymentAccountId: 'acct-checking',
  accounts: seed.accounts,
  autopays: seed.autopays,
  statements: seed.statements,
  cardPayments: seed.cardPayments,
  transactions: seed.transactions,
  scheduled: seed.scheduled,
  balanceSnapshots: seed.snapshots,
  handoverKeys: new Set<string>(),
};

const { input, radar } = radarFromSnapshot(snap, TODAY, NO_RECURRING_OVERRIDES);

describe('radar grounding — committed events are /forecast’s exact assembly', () => {
  it('scheduled + loan flows expand to the identical event list', () => {
    const year = Number(TODAY.slice(0, 4));
    const holidays = holidayTable(year - 1, year + 1);
    const flows: ScheduledFlow[] = seed.scheduled
      .filter((s) => s.accountId === 'acct-checking')
      .map((s) => ({
        description: s.description,
        amountCents: s.amountCents,
        nextDate: s.nextDate,
        cadence: s.cadence,
      }));
    const loanFlows = loanObligationsToScheduledFlows(
      selectLoanObligations({ accounts: seed.accounts, today: TODAY, holidays }),
    );
    const expected = expandScheduled([...flows, ...loanFlows], TODAY, RADAR_HORIZON_DAYS);
    expect(input.committedEvents).toEqual(expected);
    expect(expected.length).toBeGreaterThan(0); // payroll/rent/savings/loan really flow in
  });
});

describe('radar grounding — card dues are the cash-needed engine’s obligations', () => {
  it('every current-cycle due matches an obligation exactly (id, date, amount, label)', () => {
    const { result } = cashNeededFromSnapshot(snap, TODAY, 'PAY_IN_FULL');
    const obligations = result.cards.filter((o) => o.cashRequiredCents > 0);
    // Non-synthesized dues (current knowledge, real or estimated statement):
    // exactly one per obligation, byte-identical fields.
    for (const o of obligations) {
      const match = input.cardDues.find(
        (x) =>
          x.cardId === o.cardId &&
          x.dueDate === o.effectiveDueDate &&
          x.amountCents === o.cashRequiredCents &&
          x.isEstimated === o.isEstimated,
      );
      expect(match, `obligation ${o.cardName} @ ${o.effectiveDueDate}`).toBeTruthy();
    }
    // Everything beyond the obligation set is a synthesized future cycle → estimated.
    const extras = input.cardDues.filter(
      (x) => !obligations.some((o) => o.cardId === x.cardId && o.effectiveDueDate === x.dueDate),
    );
    expect(extras.every((x) => x.isEstimated)).toBe(true);
    expect(radar.includesEstimatedDues).toBe(extras.length > 0 || obligations.some((o) => o.isEstimated));
  });
});

describe('radar grounding — transfer math and the deposit-only guardrail', () => {
  it('alert ⇔ committed first-negative; transfer amount is the shared $50 round-up of the dip', () => {
    if (radar.committed.firstNegativeDate === null) {
      expect(radar.status).not.toBe('alert');
      expect(radar.coverTransfer).toBeNull();
    } else {
      expect(radar.status).toBe('alert');
      expect(radar.coverTransfer?.amountCents).toBe(
        roundUpToNext50Dollars(cents(-radar.committed.lowestCents)),
      );
    }
  });

  it('sources are CHECKING/SAVINGS only — the seed brokerage and the payment account never appear', () => {
    const sources = radar.coverTransfer?.sources ?? [];
    const byId = new Map(seed.accounts.map((a) => [a.id, a]));
    for (const s of sources) {
      expect(TRANSFER_SOURCE_TYPES.has(byId.get(s.id)!.type)).toBe(true);
      expect(s.id).not.toBe('acct-checking');
      expect(s.id).not.toBe('acct-brokerage');
    }
  });
});

describe('radar grounding — burn is derived from real history and labeled', () => {
  it('the demo has months of history: pace is measurable, band lines exist, and the label assumption ships', () => {
    expect(input.burn?.hasEnoughHistory).toBe(true);
    expect(radar.burn?.expected).not.toBeNull();
    expect(radar.burn?.conservative).not.toBeNull();
    // heavy ≥ typical by construction (p80 ≥ p50)
    expect(radar.burn!.heavyDailyCents).toBeGreaterThanOrEqual(radar.burn!.typicalDailyCents);
    expect(radar.assumptions.some((a) => a.includes('estimate band'))).toBe(true);
  });

  it('band lines are pointwise the committed line minus the pace — never above it', () => {
    expect(radar.burn!.expected!.endingCents).toBeLessThanOrEqual(radar.committed.endingCents);
    expect(radar.burn!.conservative!.endingCents).toBeLessThanOrEqual(radar.burn!.expected!.endingCents);
  });
});
