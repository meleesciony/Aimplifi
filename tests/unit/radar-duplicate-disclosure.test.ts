/**
 * TASKS L.15 (g) — Cash Flow Radar, the SEVENTH surface, and the cycle-2 critic's NEW-1 correction.
 *
 * The radar repeats every card obligation across a 90-day horizon, so a duplicated card is
 * double-counted in every projected cycle: it can manufacture a CRITICAL "checking may go negative"
 * push that would not otherwise exist and inflate the only move-this-much figure in the app. It
 * discloses that (never adjusts it).
 *
 * The correction this file exists to lock: the first cut resolved the pair against
 * `cashNeeded.cards` — EVERY obligation the engine knows about — while its own comment claimed to
 * read the projection. `projectCardDues` drops an obligation with nothing still due and anything
 * past the horizon, so a PAID-OFF duplicated pair, in no projected cycle at all, still produced
 * "every cycle in this projection counts it twice" on a genuine overdraft warning. That is the
 * dangerous failure direction: it tells someone facing a real dip that the amount to move may be
 * inflated when it is not.
 *
 * FAIL-OLD: the abstention test below passes `dues`-absent cards and fails against the
 * `cashNeeded.cards` wiring. The pure-builder abstention test in card-duplicate-channels.test.ts
 * could not catch this — it hand-builds the row list, which is exactly the wiring under test here.
 */
import { describe, expect, it } from 'vitest';
import { isoDate } from '@/lib/dates';
import { radarFromSnapshot } from '@/server/radar';
import type { CardDuplicatePairInput } from '@/lib/engine/account/card-duplicate-view';
import type { FinanceSnapshot } from '@/lib/providers/types';

const TODAY = isoDate('2026-07-25');

const PAIR: CardDuplicatePairInput[] = [
  { aId: 'dup-a', bId: 'dup-b', confidence: 'high', reasons: ['same last-4 (0977)'] },
];

/**
 * A snapshot with a checking account plus the cards given.
 *
 * A card owing money carries a POSITIVE balance — the app's own convention (`seed/build.ts` seeds
 * `Sapphire Card: 294811`, and `cash-needed/engine.ts` reads `statementBalance =
 * card.currentBalanceCents; if (statementBalance > 0)`). The first cut of this file said the
 * opposite in a comment and used negatives; a critic executed both and found the estimate path emits
 * FOUR dues under the real convention and ZERO under the fixture's — so any case added on that path
 * would have abstained and passed for entirely the wrong reason (critic P3).
 */
function snapWith(
  cards: readonly {
    id: string;
    name: string;
    balanceCents: number;
    statementCents?: number;
    dueDay?: number;
  }[],
  income = false,
): FinanceSnapshot {
  return {
    accounts: [
      {
        id: 'chk',
        name: 'Everyday Checking',
        type: 'CHECKING',
        currentBalanceCents: 1_000_00,
        currency: 'USD',
        provider: 'plaid',
      },
      ...cards.map((c) => ({
        id: c.id,
        name: c.name,
        type: 'CREDIT',
        currentBalanceCents: c.balanceCents,
        currency: 'USD',
        provider: 'plaid',
        dueDayOfMonth: c.dueDay ?? 5,
        cycleCloseDayOfMonth: 8,
      })),
    ],
    paymentAccountId: 'chk',
    autopays: [],
    // WITHOUT a statement the engine estimates a $0 obligation, `projectCardDues` emits no due, and
    // every case here would abstain — including the positive one, which would then prove nothing.
    statements: cards
      .filter((c) => c.statementCents !== undefined)
      .map((c) => ({
        id: `stmt-${c.id}`,
        accountId: c.id,
        cycleStart: isoDate('2026-06-20'),
        cycleEnd: isoDate('2026-07-20'),
        dueDate: isoDate(`2026-08-${String(c.dueDay ?? 5).padStart(2, '0')}`),
        statementBalanceCents: c.statementCents!,
        minimumPaymentCents: 2_500,
        isEstimated: false,
      })),
    cardPayments: [],
    transactions: [],
    // Biweekly pay, so a due that lands AFTER the crunch is genuinely absorbed and moves neither the
    // dip date nor the cover amount — the state the cycle-3 P1 turns on.
    scheduled: income
      ? [
          {
            id: 'pay',
            accountId: 'chk',
            description: 'Payroll',
            amountCents: 400_000,
            nextDate: isoDate('2026-08-07'),
            cadence: 'BIWEEKLY',
          },
        ]
      : [],
    balanceSnapshots: [],
  } as unknown as FinanceSnapshot;
}

const noteOf = (snap: FinanceSnapshot, pairs: CardDuplicatePairInput[]) =>
  radarFromSnapshot(snap, TODAY, 90, pairs).radar.duplicateDisclosure;

describe('the radar discloses a duplicate only where the PROJECTION carries it', () => {
  it('discloses when both sides are genuinely projected', () => {
    const snap = snapWith([
      { id: 'dup-a', name: 'CREDIT CARD', balanceCents: 300_000, statementCents: 300_000 },
      { id: 'dup-b', name: 'CREDIT CARD', balanceCents: 300_000, statementCents: 300_000 },
    ]);
    const note = noteOf(snap, PAIR);
    expect(note).toContain('every cycle in this projection counts it twice');
    // Names the shared string once rather than inventing an ordinal the radar never paints
    // (the critic-F1 rule, which applies to this surface too).
    expect(note).not.toMatch(/“\d+\. /);
    expect(note).toContain('both named “CREDIT CARD”');
  });

  it('ABSTAINS on a PAID-OFF pair — it is in no projected cycle, so nothing is counted twice', () => {
    // THE NEW-1 REGRESSION. A $0 card yields no due, so `projectCardDues` emits nothing for it,
    // and claiming the projection double-counts it would hedge a warning that is entirely real.
    const snap = snapWith([
      { id: 'dup-a', name: 'CREDIT CARD', balanceCents: 0 },
      { id: 'dup-b', name: 'CREDIT CARD', balanceCents: 0 },
      { id: 'other', name: 'Spark Miles', balanceCents: 300_000, statementCents: 300_000 },
    ]);
    expect(noteOf(snap, PAIR)).toBeNull();
  });

  it('ABSTAINS when only ONE side of the pair is projected', () => {
    const snap = snapWith([
      { id: 'dup-a', name: 'CREDIT CARD', balanceCents: 300_000, statementCents: 300_000 },
      { id: 'dup-b', name: 'CREDIT CARD', balanceCents: 0 },
    ]);
    expect(noteOf(snap, PAIR)).toBeNull();
  });

  it('ABSTAINS when there is no suspected pair at all', () => {
    const snap = snapWith([
      { id: 'dup-a', name: 'CREDIT CARD', balanceCents: 300_000, statementCents: 300_000 },
      { id: 'dup-b', name: 'CREDIT CARD', balanceCents: 300_000, statementCents: 300_000 },
    ]);
    expect(noteOf(snap, [])).toBeNull();
  });

  it('ABSTAINS when the pair is projected but moves NEITHER the dip date NOR the amount', () => {
    // THE CYCLE-3 P1. An entirely ordinary state: a real crunch caused by a DIFFERENT card, with the
    // duplicated pair due later and absorbed. Being in the projection does not make "the dip date
    // may be earlier and the amount to move larger" true — both are fixed by the worst point of the
    // walk. Telling a reader facing a real dip that their transfer may be imaginary is how they
    // overdraft.
    const snap = snapWith([
      { id: 'other', name: 'Spark Miles', balanceCents: 300_000, statementCents: 300_000, dueDay: 29 },
      { id: 'dup-a', name: 'CREDIT CARD', balanceCents: 1_000, statementCents: 1_000, dueDay: 20 },
      { id: 'dup-b', name: 'CREDIT CARD', balanceCents: 1_000, statementCents: 1_000, dueDay: 20 },
    ], true);
    const r = radarFromSnapshot(snap, TODAY, 90, PAIR).radar;
    const truth = radarFromSnapshot(
      snapWith([
        { id: 'other', name: 'Spark Miles', balanceCents: 300_000, statementCents: 300_000, dueDay: 29 },
        { id: 'dup-a', name: 'CREDIT CARD', balanceCents: 1_000, statementCents: 1_000, dueDay: 20 },
      ], true),
      TODAY,
      90,
    ).radar;
    // Precondition: the duplicate genuinely changes neither figure the sentence names.
    expect(r.committed.firstNegativeDate).toBe(truth.committed.firstNegativeDate);
    expect(r.coverTransfer?.amountCents ?? null).toBe(truth.coverTransfer?.amountCents ?? null);
    // Therefore the radar must say nothing.
    expect(r.duplicateDisclosure).toBeNull();
  });

  it('ABSTAINS when the projection never dips — there is no dip date or transfer to be wrong about', () => {
    // Critic P2: the radar card renders `assumptions` under a header reading "Clear — your committed
    // cash flow stays above $0 for the next 90 days", and the old wording promised an earlier dip
    // date and a smaller transfer, neither of which that card prints.
    const snap = snapWith([
      { id: 'dup-a', name: 'CREDIT CARD', balanceCents: 100, statementCents: 100 },
      { id: 'dup-b', name: 'CREDIT CARD', balanceCents: 100, statementCents: 100 },
    ]);
    const r = radarFromSnapshot(snap, TODAY, 90, PAIR).radar;
    expect(r.committed.firstNegativeDate).toBeNull();
    expect(r.duplicateDisclosure).toBeNull();
  });

  it('adjusts NO figure — the projection is identical with and without the disclosure', () => {
    const snap = snapWith([
      { id: 'dup-a', name: 'CREDIT CARD', balanceCents: 300_000, statementCents: 300_000 },
      { id: 'dup-b', name: 'CREDIT CARD', balanceCents: 300_000, statementCents: 300_000 },
    ]);
    const plain = radarFromSnapshot(snap, TODAY, 90).radar;
    const disclosed = radarFromSnapshot(snap, TODAY, 90, PAIR).radar;
    expect(disclosed.committed).toEqual(plain.committed);
    expect(disclosed.coverTransfer).toEqual(plain.coverTransfer);
    expect(disclosed.pushWorthy).toBe(plain.pushWorthy);
  });
});
