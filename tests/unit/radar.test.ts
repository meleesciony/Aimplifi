/**
 * Known-answer tests for the Cash Flow Radar engine (src/lib/engine/radar/radar.ts),
 * pinned to docs/EDGE_CASES.md §Cash Flow Radar cases A–D and F. Fixed
 * today = 2026-06-10 (June 1 2026 is a Monday). The three adjudicated conditions
 * (AI plan §1.2) are each pinned by a named test: committed-only alarm, deposit-only
 * transfer sources, estimated labels on future cycles.
 */
import { describe, it, expect } from 'vitest';
import { isoDate, type ISODate } from '@/lib/dates';
import { cents } from '@/lib/money';
import type { CardObligation } from '@/lib/engine/cash-needed/types';
import type { BurnRates } from '@/lib/engine/radar/burn';
import {
  RADAR_PUSH_WINDOW_DAYS,
  computeRadar,
  projectCardDues,
  type RadarCardDue,
  type RadarInput,
} from '@/lib/engine/radar/radar';

const TODAY = isoDate('2026-06-10');
const d = (s: string): ISODate => isoDate(s);

function due(
  over: Omit<Partial<RadarCardDue>, 'dueDate' | 'amountCents'> & { dueDate: string; amountCents: number },
): RadarCardDue {
  return {
    cardId: 'card-1',
    cardName: 'Sapphire',
    isEstimated: false,
    ...over,
    dueDate: d(over.dueDate),
    amountCents: cents(over.amountCents),
  };
}

function baseInput(over: Partial<RadarInput> = {}): RadarInput {
  return {
    today: TODAY,
    horizonDays: 30,
    startingBalanceCents: cents(100000),
    committedEvents: [],
    cardDues: [],
    accounts: [
      { id: 'acct-checking', name: 'Checking', type: 'CHECKING', currentBalanceCents: 100000, feedDroppedAt: null },
      { id: 'acct-savings', name: 'Savings', type: 'SAVINGS', currentBalanceCents: 500000, feedDroppedAt: null },
      { id: 'acct-brokerage', name: 'Brokerage', type: 'INVESTMENT', currentBalanceCents: 14200000, feedDroppedAt: null },
    ],
    paymentAccountId: 'acct-checking',
    holidays: [],
    burn: null,
    undatableCards: [],
    ...over,
  };
}

const okBurn = (typical: number, heavy: number, history = true): BurnRates => ({
  typicalDailyCents: cents(typical),
  heavyDailyCents: cents(heavy),
  sampleDays: 56,
  hasEnoughHistory: history,
});

describe('computeRadar — case A: clear', () => {
  const r = computeRadar(
    baseInput({
      committedEvents: [{ date: '2026-06-15', amountCents: 50000, label: 'Payroll' }],
      cardDues: [due({ dueDate: '2026-06-20', amountCents: 30000 })],
    }),
  );

  it('never negative: ok, no transfer, no colliding card', () => {
    expect(r.status).toBe('ok');
    expect(r.committed.firstNegativeDate).toBeNull();
    expect(r.coverTransfer).toBeNull();
    expect(r.collidingCards).toEqual([]);
    expect(r.pushWorthy).toBe(false);
  });

  it('walk: lowest is the day-0 anchor (100000), ending 120000', () => {
    expect(r.committed.lowestCents).toBe(100000);
    expect(r.committed.lowestDate).toBe('2026-06-10');
    expect(r.committed.endingCents).toBe(120000);
  });
});

describe('computeRadar — undatable cards beside the verdict (P1-20 / C.12)', () => {
  it('a Clear verdict carries them on the result and says so in assumptions', () => {
    // The defect: the radar's "Clear" never mentioned cards the engine could not date
    // while the hero on the same page disclosed them — an all-clear that cannot see
    // money the reader owes is the expensive direction.
    const r = computeRadar(
      baseInput({
        committedEvents: [{ date: '2026-06-15', amountCents: 50000, label: 'Payroll' }],
        undatableCards: [
          { cardId: 'c-x', cardName: 'CREDIT CARD' },
          { cardId: 'c-y', cardName: 'STORE CARD' },
        ],
      }),
    );
    expect(r.status).toBe('ok');
    expect(r.undatableCards).toEqual([
      { cardId: 'c-x', cardName: 'CREDIT CARD' },
      { cardId: 'c-y', cardName: 'STORE CARD' },
    ]);
    expect(r.assumptions.join(' ')).toMatch(
      /2 cards with no statement or due date yet are excluded from every figure here — the Clear verdict covers only what the projection can see\./,
    );
  });

  it('an alert state (the cover transfer) discloses them too — singular form, Heads-up verdict', () => {
    const r = computeRadar(
      baseInput({
        startingBalanceCents: cents(10000),
        cardDues: [due({ dueDate: '2026-06-12', amountCents: 30000 })],
        undatableCards: [{ cardId: 'c-x', cardName: 'CREDIT CARD' }],
      }),
    );
    expect(r.status).toBe('alert');
    expect(r.coverTransfer).not.toBeNull();
    expect(r.assumptions.join(' ')).toMatch(
      /1 card with no statement or due date yet is excluded from every figure here — the Heads-up verdict covers only what the projection can see\./,
    );
  });

  it('none → empty pass-through, no note (gate mutation lock)', () => {
    const r = computeRadar(baseInput({}));
    expect(r.undatableCards).toEqual([]);
    expect(r.assumptions.join(' ')).not.toMatch(/no statement or due date yet/);
  });
});

describe('computeRadar — case B: dip after a card, named + minimum timed cover', () => {
  const r = computeRadar(
    baseInput({
      cardDues: [due({ dueDate: '2026-06-19', amountCents: 70000 })],
      committedEvents: [{ date: '2026-06-24', amountCents: -60000, label: 'Rent' }],
    }),
  );

  it('alert on the committed line: first negative 06-24, dip 30000', () => {
    expect(r.status).toBe('alert');
    expect(r.committed.firstNegativeDate).toBe('2026-06-24');
    expect(r.committed.lowestCents).toBe(-30000);
    expect(r.daysUntilFirstNegative).toBe(14);
    expect(r.pushWorthy).toBe(false); // 14 > RADAR_PUSH_WINDOW_DAYS
  });

  it('colliding card = most recent due before the dip (Sapphire 06-19)', () => {
    expect(r.collidingCards.map((c) => [c.cardName, c.dueDate])).toEqual([['Sapphire', '2026-06-19']]);
  });

  it('dipEvents name what tips the balance under on the dip date (Rent)', () => {
    expect(r.dipEvents).toEqual([{ label: 'Rent', amountCents: -60000 }]);
  });

  it('cover: $300 exact multiple stays, byDate = previous business day (Tue 06-23)', () => {
    expect(r.coverTransfer?.amountCents).toBe(30000);
    expect(r.coverTransfer?.byDate).toBe('2026-06-23');
  });

  it('ADJUDICATED CONDITION 2: sources are deposit accounts only — never the brokerage, never the payment account', () => {
    const sources = r.coverTransfer?.sources ?? [];
    expect(sources.map((s) => s.id)).toEqual(['acct-savings']);
    expect(sources[0].sufficient).toBe(true);
  });
});

describe('computeRadar — case C: due TODAY comes off the day-0 anchor', () => {
  const r = computeRadar(
    baseInput({
      startingBalanceCents: cents(20000),
      cardDues: [due({ dueDate: '2026-06-10', amountCents: 30000 })],
    }),
  );

  it('first negative is today; pushWorthy; the due-today card is the colliding card', () => {
    expect(r.committed.firstNegativeDate).toBe('2026-06-10');
    expect(r.daysUntilFirstNegative).toBe(0);
    expect(r.pushWorthy).toBe(true);
    expect(r.collidingCards.map((c) => c.dueDate)).toEqual(['2026-06-10']);
    expect(r.dipEvents).toEqual([]); // day 0 is the anchor; the colliding card carries the cause
  });

  it('cover: dip 10000 → $100; byDate clamped to today (never past-dated)', () => {
    expect(r.coverTransfer?.amountCents).toBe(10000);
    expect(r.coverTransfer?.byDate).toBe('2026-06-10');
  });
});

describe('projectCardDues — case D: future-cycle synthesis, July-4 walk-back, estimated labels', () => {
  const freedom: CardObligation = {
    cardId: 'card-freedom',
    cardName: 'Freedom',
    dueDate: d('2026-07-04'), // Saturday; observed holiday Fri 07-03
    effectiveDueDate: d('2026-07-02'),
    cashRequiredCents: cents(40000),
    autopayCents: cents(0),
    userActionCents: cents(40000),
    remainingDueCents: cents(40000),
    minimumDueCents: cents(3500),
    isEstimated: false,
    notes: [],
    frozenSince: null,
    isManual: false,
  };
  const holidays = [d('2026-07-03')];

  it('ADJUDICATED CONDITION 3: 07-02 real + synthesized 08-04, 09-04 estimated; 10-04 past horizon', () => {
    const { dues, assumptions } = projectCardDues({
      obligations: [freedom],
      today: TODAY,
      horizonDays: 90,
      holidays,
    });
    expect(dues.map((x) => [x.dueDate, x.amountCents, x.isEstimated])).toEqual([
      ['2026-07-02', 40000, false],
      ['2026-08-04', 40000, true],
      ['2026-09-04', 40000, true],
    ]);
    expect(assumptions.some((a) => a.includes('estimate'))).toBe(true);
  });

  it('a $0-due card yields nothing', () => {
    const { dues } = projectCardDues({
      obligations: [{ ...freedom, cashRequiredCents: cents(0) }],
      today: TODAY,
      horizonDays: 90,
      holidays,
    });
    expect(dues).toEqual([]);
  });

  it('CRITIC P1-1 LOCK: future cycles repeat the STATEMENT basis, not the post-mid-cycle-payment residual', () => {
    // Freedom-like: $1,000 statement, $400 paid mid-cycle → $600 still due THIS
    // cycle, but a typical future cycle debits the full $1,000.
    const paidPart = { ...freedom, cashRequiredCents: cents(60000), cycleBasisCents: cents(100000) };
    const { dues } = projectCardDues({ obligations: [paidPart], today: TODAY, horizonDays: 90, holidays });
    expect(dues.map((x) => [x.dueDate, x.amountCents, x.isEstimated])).toEqual([
      ['2026-07-02', 60000, false], // current cycle: what is actually still due
      ['2026-08-04', 100000, true], // future cycles: the full statement basis
      ['2026-09-04', 100000, true],
    ]);
  });

  it('a card fully paid THIS cycle still projects its future cycles at the statement basis', () => {
    const paidOff = { ...freedom, cashRequiredCents: cents(0), cycleBasisCents: cents(100000) };
    const { dues } = projectCardDues({ obligations: [paidOff], today: TODAY, horizonDays: 90, holidays });
    expect(dues.map((x) => [x.dueDate, x.amountCents, x.isEstimated])).toEqual([
      ['2026-08-04', 100000, true],
      ['2026-09-04', 100000, true],
    ]);
  });

  it('a synthesized occurrence landing exactly ON today is skipped (never double-subtracted with the clamped current due)', () => {
    const monthOld = { ...freedom, dueDate: d('2026-05-10'), effectiveDueDate: TODAY };
    const { dues } = projectCardDues({ obligations: [monthOld], today: TODAY, horizonDays: 90, holidays });
    // current (clamped to today) + k=2 (07-10) + k=3 (08-10); k=1 lands ON today → skipped
    expect(dues.map((x) => [x.dueDate, x.isEstimated])).toEqual([
      ['2026-06-10', false],
      ['2026-07-10', true],
      ['2026-08-10', true],
    ]);
  });

  it('stale anchor: a long-passed raw due date skips synthesized occurrences on/before today', () => {
    const passed: CardObligation = {
      ...freedom,
      dueDate: d('2026-05-08'),
      effectiveDueDate: TODAY, // engine clamps passed dues to today
    };
    const { dues } = projectCardDues({ obligations: [passed], today: TODAY, horizonDays: 90, holidays });
    // current (today) + k=2 (07-08) + k=3 (08-08 → Sat → 08-07) + k=4 (09-08); k=1 (06-08 ≤ today) skipped
    expect(dues[0]).toMatchObject({ dueDate: '2026-06-10', isEstimated: false });
    expect(dues.slice(1).map((x) => x.dueDate)).toEqual(['2026-07-08', '2026-08-07', '2026-09-08']);
    expect(dues.slice(1).every((x) => x.isEstimated)).toBe(true);
  });
});

describe('computeRadar — case F: burn band is labeled estimate, never the alarm', () => {
  it('flat committed 100000, typical 1000/heavy 3000 over 10 days: endings 90000 / 70000, ok', () => {
    const r = computeRadar(baseInput({ horizonDays: 10, burn: okBurn(1000, 3000) }));
    expect(r.status).toBe('ok');
    expect(r.burn?.expected?.endingCents).toBe(90000);
    expect(r.burn?.conservative?.endingCents).toBe(70000);
    expect(r.burn?.expected?.firstNegativeDate).toBeNull();
  });

  it('ADJUDICATED CONDITION 1: heavy-burn dip raises watch, NEVER alert (committed stays clear)', () => {
    const r = computeRadar(
      baseInput({ startingBalanceCents: cents(20000), horizonDays: 10, burn: okBurn(1000, 3000) }),
    );
    expect(r.committed.firstNegativeDate).toBeNull();
    expect(r.burn?.conservative?.firstNegativeDate).toBe('2026-06-17'); // 20000 − 3000·7 = −1000
    expect(r.burn?.expected?.firstNegativeDate).toBeNull(); // 20000 − 1000·10 = 10000
    expect(r.status).toBe('watch');
    expect(r.coverTransfer).toBeNull(); // no committed dip ⇒ no transfer proposal
  });

  it('insufficient history: band lines null, watch cannot fire, status ok', () => {
    const r = computeRadar(
      baseInput({ startingBalanceCents: cents(20000), horizonDays: 10, burn: okBurn(1000, 3000, false) }),
    );
    expect(r.burn?.expected).toBeNull();
    expect(r.burn?.conservative).toBeNull();
    expect(r.status).toBe('ok');
  });
});

describe('computeRadar — misc invariants', () => {
  it('no eligible source accounts → transfer proposed with empty sources + honest note', () => {
    const r = computeRadar(
      baseInput({
        startingBalanceCents: cents(1000),
        cardDues: [due({ dueDate: '2026-06-15', amountCents: 50000 })],
        accounts: [
          { id: 'acct-checking', name: 'Checking', type: 'CHECKING', currentBalanceCents: 1000, feedDroppedAt: null },
          { id: 'acct-brokerage', name: 'Brokerage', type: 'INVESTMENT', currentBalanceCents: 999999, feedDroppedAt: null },
        ],
      }),
    );
    expect(r.coverTransfer?.sources).toEqual([]);
    expect(r.assumptions.some((a) => a.includes('No other checking or savings'))).toBe(true);
  });

  it(`pushWorthy boundary: dip exactly ${RADAR_PUSH_WINDOW_DAYS} days out is push-worthy, one later is not`, () => {
    const at = (date: string) =>
      computeRadar(
        baseInput({ startingBalanceCents: cents(0), cardDues: [due({ dueDate: date, amountCents: 5000 })] }),
      );
    expect(at('2026-06-17').pushWorthy).toBe(true); // 7 days
    expect(at('2026-06-18').pushWorthy).toBe(false); // 8 days
  });

  it('cover amount rounds UP to the next $50 on a non-multiple dip (31234 → 35000)', () => {
    const r = computeRadar(
      baseInput({ startingBalanceCents: cents(0), cardDues: [due({ dueDate: '2026-06-15', amountCents: 31234 })] }),
    );
    expect(r.coverTransfer?.amountCents).toBe(35000);
  });

  it('source boundaries: a balance exactly equal to the amount is sufficient; a $0 account is not listed', () => {
    const r = computeRadar(
      baseInput({
        startingBalanceCents: cents(0),
        cardDues: [due({ dueDate: '2026-06-15', amountCents: 50000 })],
        accounts: [
          { id: 'acct-checking', name: 'Checking', type: 'CHECKING', currentBalanceCents: 0, feedDroppedAt: null },
          { id: 'acct-savings', name: 'Savings', type: 'SAVINGS', currentBalanceCents: 50000, feedDroppedAt: null },
          { id: 'acct-empty', name: 'Empty savings', type: 'SAVINGS', currentBalanceCents: 0, feedDroppedAt: null },
        ],
      }),
    );
    expect(r.coverTransfer?.amountCents).toBe(50000);
    expect(r.coverTransfer?.sources.map((s) => [s.id, s.sufficient])).toEqual([['acct-savings', true]]);
  });

  it('includesEstimatedDues reflects any estimated due', () => {
    const real = computeRadar(baseInput({ cardDues: [due({ dueDate: '2026-06-20', amountCents: 1 })] }));
    const est = computeRadar(
      baseInput({ cardDues: [due({ dueDate: '2026-06-20', amountCents: 1, isEstimated: true })] }),
    );
    expect(real.includesEstimatedDues).toBe(false);
    expect(est.includesEstimatedDues).toBe(true);
  });
});

describe('a later, larger outflow splits the cover transfer from its deadline (L.23)', () => {
  // The money critic's executed probe. Before L.23 no cadence could produce this
  // shape: `coverTransfer.amountCents` is the worst dip over the WHOLE horizon
  // while `byDate` is one business day before the FIRST short day, and a detected
  // ANNUAL bill is the first thing that can drop a large lump 80 days out with a
  // small dip before it. The card was rendering "move $1,250.00 by Fri, Jun 12"
  // when $50.00 was what Jun 12 needed, with nothing explaining the other $1,200 —
  // and calling it "the smallest move that keeps the whole 90 days covered".
  const lateLump = () =>
    computeRadar(
      baseInput({
        horizonDays: 90,
        startingBalanceCents: cents(100000),
        committedEvents: [
          { date: d('2026-06-15'), amountCents: -105000, label: 'Rent' },
          { date: d('2026-08-29'), amountCents: -120000, label: 'Allstate Insurance Premium' },
        ],
      }),
    );

  it('names what the first short day needs, and what the rest is for', () => {
    const r = lateLump();
    expect(r.committed.firstNegativeDate).toBe('2026-06-15');
    // The whole-horizon cover is unchanged — it is sufficient, and shrinking it
    // would be the dangerous direction.
    expect(r.coverTransfer?.amountCents).toBe(125000);
    expect(r.coverTransfer?.byDate).toBe('2026-06-12');
    // FAIL-OLD: these three fields did not exist, so no surface could tell the
    // reader that 96% of the demand belongs to a date eleven weeks later.
    expect(r.coverTransfer?.worstDipDate).toBe('2026-08-29');
    expect(r.coverTransfer?.firstShortCents).toBe(5000);
    expect(r.coverTransfer?.worstDipEvents.map((e) => e.label)).toEqual(['Allstate Insurance Premium']);
    expect([...r.assumptions]).toContain(
      'Two steps work: $50.00 by Fri, Jun 12 covers the first short day — the rest is for Allstate Insurance Premium on Sat, Aug 29.',
    );
  });

  it('says nothing about a split when the worst dip IS the first short day', () => {
    const r = computeRadar(
      baseInput({
        horizonDays: 90,
        startingBalanceCents: cents(100000),
        committedEvents: [{ date: d('2026-06-15'), amountCents: -105000, label: 'Rent' }],
      }),
    );
    expect(r.coverTransfer?.worstDipDate).toBe('2026-06-15');
    // Zero, not the amount: a split sentence on the ordinary shape would invent a
    // two-step instruction where one step is the whole truth.
    expect(r.coverTransfer?.firstShortCents).toBe(0);
    expect(r.coverTransfer?.worstDipEvents).toEqual([]);
    expect([...r.assumptions].some((a) => a.startsWith('Two steps work'))).toBe(false);
  });

  it('an intermediate day deeper than the first step WITHHOLDS the split (C.12 critic P1-1)', () => {
    // Start $1,000. Rent −$1,050 on 06-15 → −$50 (first short). Car repair −$900 on
    // 07-01 → −$950, deeper than step 1 covers. Allstate −$1,200 on 08-29 → −$2,150
    // (worst). Step 1 ($50) leaves 07-01 at −$900: the second step is needed BEFORE
    // the low point the sentence would name — offering it re-introduces the decoupling.
    const r = computeRadar(
      baseInput({
        horizonDays: 90,
        startingBalanceCents: cents(100000),
        committedEvents: [
          { date: d('2026-06-15'), amountCents: -105000, label: 'Rent' },
          { date: d('2026-07-01'), amountCents: -90000, label: 'Car repair' },
          { date: d('2026-08-29'), amountCents: -120000, label: 'Allstate Insurance Premium' },
        ],
      }),
    );
    expect(r.committed.firstNegativeDate).toBe('2026-06-15');
    expect(r.coverTransfer?.amountCents).toBe(215000); // the single sufficient transfer stands
    expect(r.coverTransfer?.worstDipDate).toBe('2026-08-29');
    expect(r.coverTransfer?.firstShortCents).toBe(0);
    expect([...r.assumptions].some((a) => a.startsWith('Two steps work'))).toBe(false);
  });
});
