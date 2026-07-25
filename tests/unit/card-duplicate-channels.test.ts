/**
 * TASKS L.15 — the duplicated card, on the six surfaces that were silent about it.
 *
 * The defect class (enumerated by a read-only sweep during L.8, 2026-07-24): one real card arriving
 * through TWO live connections emits two of everything, and until now only /cards, the dashboard
 * hero and the reminders list said so. The reminder email printed two bullets for one card, the
 * weekly digest the same lines, web push sent TWO notifications (distinct keys, because the
 * accountIds differ), the Ask assistant stated an inflated card count beside an inflated figure, the
 * Glass-Box trace listed both rows inside the breakdown of the number the hero now qualifies, and
 * the calendar put two events on the grid. The three offline channels are the sharpest: the reader
 * acts on them away from the app, with no banner anywhere near them.
 *
 * FAIL-OLD: every assertion below that expects a disclosure fails against the pre-L.15 build, where
 * none of these builders took a `cardDuplicates` argument at all.
 *
 * Every builder carries an explicit ABSTENTION test, because a disclosure that names a card the
 * reader cannot find on the surface in front of them sends them hunting for a row that is not there
 * (`docs/lessons/context-carrying-features-must-abstain.md`, and the reason `resolvePairs` drops any
 * pair whose two cards are not both displayed). An earlier header here claimed the abstention tests
 * were "the majority"; a critic counted them and was right to call it — the claim is
 * now the one the file actually keeps, and it is a property, not a ratio, so it cannot go stale as
 * tests are added.
 */
import { describe, expect, it } from 'vitest';
import { cents } from '@/lib/money';
import { isoDate } from '@/lib/dates';
import type { PaymentReminder } from '@/lib/engine/reminders/select';
import { buildReminderEmail, reminderLine } from '@/lib/engine/reminders/select';
import { buildWeeklyDigest } from '@/lib/engine/digest/build';
import { selectNotifications } from '@/lib/engine/notify/select';
import { traceCashNeeded } from '@/lib/engine/glass-box/trace';
import { answerCashNeeded } from '@/lib/engine/assistant/answer';
import { buildCashFlowCalendar } from '@/lib/engine/calendar/build';
import {
  CARD_DUPLICATE_HOWTO_EMAIL,
  CARD_DUPLICATE_TITLE,
  type CardDuplicatePairInput,
  cardDuplicateAnswerNote,
  cardDuplicateCalendarView,
  cardDuplicateEmailLines,
  cardDuplicatePushNotes,
  cardDuplicateRadarNote,
  cardDuplicateTraceBasis,
  cardDuplicateUndatedNote,
  cardDuplicateView,
} from '@/lib/engine/account/card-duplicate-view';
import type { CashNeededResult } from '@/lib/engine/cash-needed/types';

const TODAY = isoDate('2026-06-10');

/** The owner's real pair, from the live /cards screenshot that opened L.6: one Chase card, twice. */
const PAIR: CardDuplicatePairInput[] = [
  { aId: 'chase-a', bId: 'chase-b', confidence: 'high', reasons: ['same last-4 (0977)'] },
];

function reminder(p: {
  accountId: string;
  accountName: string;
  daysUntil?: number;
  userActionCents?: number;
  autopayCents?: number;
  cashRequiredCents?: number;
}): PaymentReminder {
  const userAction = p.userActionCents ?? 667_968;
  const daysUntil = p.daysUntil ?? 3;
  return {
    accountId: p.accountId,
    accountName: p.accountName,
    obligationType: 'card',
    dueDate: isoDate('2026-06-13'),
    daysUntil,
    urgency: daysUntil === 0 ? 'today' : daysUntil <= 3 ? 'soon' : 'upcoming',
    cashRequiredCents: cents(p.cashRequiredCents ?? userAction),
    userActionCents: cents(userAction),
    autopayCents: cents(p.autopayCents ?? 0),
    autopayCovered: userAction === 0 && (p.autopayCents ?? 0) > 0,
    isEstimated: false,
  } as PaymentReminder;
}

const DUPED = [
  reminder({ accountId: 'chase-a', accountName: 'CREDIT CARD' }),
  reminder({ accountId: 'chase-b', accountName: 'Chase Sapphire' }),
];

// ─── the pure builders ──────────────────────────────────────────────────────

describe('cardDuplicateEmailLines — the two email channels', () => {
  const rows = [
    { cardId: 'chase-a', label: 'CREDIT CARD' },
    { cardId: 'chase-b', label: 'Chase Sapphire' },
  ];

  it('names BOTH rows, exactly as the email prints them', () => {
    const lines = cardDuplicateEmailLines(PAIR, rows).join('\n');
    expect(lines).toContain(CARD_DUPLICATE_TITLE);
    expect(lines).toContain('“CREDIT CARD”');
    expect(lines).toContain('“Chase Sapphire”');
  });

  it('states the basis and its strength, never a bare verdict', () => {
    const lines = cardDuplicateEmailLines(PAIR, rows).join('\n');
    expect(lines).toContain('Likely');
    expect(lines).toContain('same last-4 (0977)');
    // A 'medium' pair really can be two different cards; it must not read the same.
    const medium = cardDuplicateEmailLines(
      [{ ...PAIR[0], confidence: 'medium' }],
      rows,
    ).join('\n');
    expect(medium).toContain('Possible');
    expect(medium).not.toContain('Likely');
  });

  it('says nothing has been adjusted and points at Accounts', () => {
    const lines = cardDuplicateEmailLines(PAIR, rows);
    expect(lines).toContain(CARD_DUPLICATE_HOWTO_EMAIL);
    expect(CARD_DUPLICATE_HOWTO_EMAIL).toContain('has been adjusted');
    expect(CARD_DUPLICATE_HOWTO_EMAIL).toContain('Accounts');
  });

  it('quotes NO on-screen position or figure the email does not carry', () => {
    // Decision (b): an email cannot say "the total above" or "the figure beside the card" — the
    // reader is not looking at the page those phrases describe.
    const text = cardDuplicateEmailLines(PAIR, rows).join(' ');
    expect(text).not.toMatch(/\babove\b/);
    expect(text).not.toMatch(/\bbelow\b/);
    expect(text).not.toMatch(/\bthis (page|screen)\b/);
  });

  it('ABSTAINS when only one side of the pair is in the email', () => {
    expect(cardDuplicateEmailLines(PAIR, [rows[0]])).toEqual([]);
  });

  it('ABSTAINS when there is no pair at all', () => {
    expect(cardDuplicateEmailLines([], rows)).toEqual([]);
  });

  it('INVENTS NO ORDINAL when both rows carry one name — the email numbers nothing', () => {
    // L.15 critic F1, the sharpest finding of this slice, and it fired on the DEFAULT reported
    // shape: two connections to one real card return the SAME provider name, and the old
    // unconditional positional breaker quoted “1. CREDIT CARD” / “2. CREDIT CARD” at a reader
    // looking at bullets. FAIL-OLD: the previous cut asserted those exact strings.
    const same = [
      { cardId: 'chase-a', label: 'CREDIT CARD' },
      { cardId: 'chase-b', label: 'CREDIT CARD' },
    ];
    const text = cardDuplicateEmailLines(PAIR, same).join(' ');
    expect(text).not.toMatch(/“\d+\. /);
    expect(text).toContain('Two entries are both named “CREDIT CARD”');
  });
});

describe('cardDuplicatePushNotes — the interrupting channel', () => {
  const rows = [
    { cardId: 'chase-a', label: 'CREDIT CARD' },
    { cardId: 'chase-b', label: 'Chase Sapphire' },
  ];

  it('gives EACH side a note naming the OTHER one', () => {
    const notes = cardDuplicatePushNotes(PAIR, rows);
    expect(notes.get('chase-a')).toContain('“Chase Sapphire”');
    expect(notes.get('chase-b')).toContain('“CREDIT CARD”');
  });

  it('carries the strength word even in a short body', () => {
    expect(cardDuplicatePushNotes(PAIR, rows).get('chase-a')).toContain('Likely duplicate');
    expect(
      cardDuplicatePushNotes([{ ...PAIR[0], confidence: 'medium' }], rows).get('chase-a'),
    ).toContain('Possible duplicate');
  });

  it('makes NO claim about how many notifications will arrive', () => {
    // A pair is disclosable because both cards are in the reminders list, but selectNotifications
    // then filters each side independently (autopay-covered, out of window, already sent) — so
    // "you will get two" would be false whenever only one side survives those filters.
    const note = cardDuplicatePushNotes(PAIR, rows).get('chase-a')!;
    expect(note).not.toMatch(/two (notifications|reminders|alerts)/i);
    expect(note).toMatch(/may be one payment asked for twice/);
  });

  it('ABSTAINS when only one side is in the reminders list', () => {
    expect(cardDuplicatePushNotes(PAIR, [rows[0]]).size).toBe(0);
  });
});

describe('cardDuplicateTraceBasis — the audited breakdown', () => {
  const rows = [
    { cardId: 'chase-a', label: 'CREDIT CARD' },
    { cardId: 'chase-b', label: 'Chase Sapphire' },
  ];

  it('names both rows and says they are INSIDE this number', () => {
    const [line] = cardDuplicateTraceBasis(PAIR, rows);
    expect(line).toContain('“CREDIT CARD”');
    expect(line).toContain('“Chase Sapphire”');
    expect(line).toContain('included in this number');
    expect(line).toContain('nothing has been adjusted');
  });

  it('ABSTAINS when only one side is among the traced rows', () => {
    expect(cardDuplicateTraceBasis(PAIR, [rows[1]])).toEqual([]);
  });
});

describe('cardDuplicateAnswerNote — the Ask answer', () => {
  const rows = [
    { cardId: 'chase-a', label: 'CREDIT CARD' },
    { cardId: 'chase-b', label: 'Chase Sapphire' },
  ];

  it('names the two figures this surface actually states: the amount and the count', () => {
    const [line] = cardDuplicateAnswerNote(PAIR, rows);
    expect(line).toContain('the amount and the card count in this answer');
    // L.15 critic F2: `facts` renders BELOW `detail` in ask-view, so "above" pointed the wrong way.
    expect(line).not.toMatch(/count above/);
    expect(line).toContain('Nothing has been adjusted');
  });

  it('ABSTAINS when only one side is counted', () => {
    expect(cardDuplicateAnswerNote(PAIR, [rows[0]])).toEqual([]);
  });
});

describe('cardDuplicateCalendarView — the month grid', () => {
  const rows = [
    { cardId: 'chase-a', label: 'CREDIT CARD due' },
    { cardId: 'chase-b', label: 'Chase Sapphire due' },
  ];

  it('names the two figures the month summary states', () => {
    const view = cardDuplicateCalendarView(PAIR, rows)!;
    expect(view.pairs[0].impact).toContain('money-out total');
    expect(view.pairs[0].impact).toContain('count of payments due');
  });

  it('makes NO claim that the two events share a date', () => {
    // Two providers can report different due dates for one real card; this sentence has to stay
    // true when they do.
    const view = cardDuplicateCalendarView(PAIR, rows)!;
    expect(view.pairs[0].impact).not.toMatch(/same (day|date)/i);
  });

  it('ABSTAINS when only one side has an event this month', () => {
    expect(cardDuplicateCalendarView(PAIR, [rows[0]])).toBeNull();
  });
});

// ─── the wiring: each surface actually carries it ───────────────────────────

describe('(b) the reminder email', () => {
  it('discloses the pair, AFTER the bullets that name the two cards', () => {
    const email = buildReminderEmail(DUPED, TODAY, PAIR)!;
    expect(email.text).toContain(CARD_DUPLICATE_TITLE);
    // The reader must meet both bullets before the sentence that refers to them.
    expect(email.text.indexOf(reminderLine(DUPED[1]))).toBeLessThan(
      email.text.indexOf(CARD_DUPLICATE_TITLE),
    );
  });

  it('still prints BOTH bullets — disclosure, never adjustment', () => {
    const email = buildReminderEmail(DUPED, TODAY, PAIR)!;
    expect(email.text).toContain(reminderLine(DUPED[0]));
    expect(email.text).toContain(reminderLine(DUPED[1]));
  });

  it('is byte-identical to the pre-L.15 email when there is no pair', () => {
    expect(buildReminderEmail(DUPED, TODAY, [])).toEqual(buildReminderEmail(DUPED, TODAY));
  });
});

describe('(c) the weekly digest', () => {
  const base = { review: null, today: TODAY, reminders: DUPED };

  it('discloses the pair inside the payments section', () => {
    const digest = buildWeeklyDigest({ frozenCards: [], ...base, cardDuplicates: PAIR })!;
    expect(digest.text).toContain(CARD_DUPLICATE_TITLE);
    expect(digest.text).toContain('“Chase Sapphire”');
  });

  it('is byte-identical to the pre-L.15 digest when there is no pair', () => {
    expect(buildWeeklyDigest({ frozenCards: [], ...base, cardDuplicates: [] })).toEqual(
      buildWeeklyDigest({ frozenCards: [], ...base }),
    );
  });

  it('says nothing when there are no dues to attach the two names to', () => {
    // With an empty reminders list the digest only sends because of a review, and there are no
    // bullets for the disclosure to point at — resolvePairs drops the pair anyway.
    const digest = buildWeeklyDigest({ frozenCards: [],
      review: {
        improvement: 'i',
        creep: 'c',
        nextAction: 'n',
      } as never,
      reminders: [],
      today: TODAY,
      cardDuplicates: PAIR,
    });
    expect(digest?.text ?? '').not.toContain(CARD_DUPLICATE_TITLE);
  });
});

describe('(d) web push', () => {
  const args = { radar: null, today: TODAY, reminders: DUPED };

  it('still sends BOTH notifications — it discloses, it does not suppress', () => {
    // DECIDED: suppression is an adjustment, and its failure direction is a MISSED PAYMENT on a
    // genuinely separate card. Disclosure's failure direction is one redundant notification.
    const out = selectNotifications({ ...args, cardDuplicates: PAIR });
    expect(out.filter((n) => n.kind === 'payment_due')).toHaveLength(2);
  });

  it('puts the note on BOTH, each naming the other card', () => {
    const out = selectNotifications({ ...args, cardDuplicates: PAIR });
    const a = out.find((n) => n.key.includes('chase-a'))!;
    const b = out.find((n) => n.key.includes('chase-b'))!;
    expect(a.body).toContain('“Chase Sapphire”');
    expect(b.body).toContain('“CREDIT CARD”');
  });

  it('keeps the amount and the date ahead of the advisory', () => {
    // A push body is truncated by the operating system: the half the reader must act on comes first.
    const [n] = selectNotifications({ ...args, cardDuplicates: PAIR });
    expect(n.body.indexOf('$6,679.68')).toBeLessThan(n.body.indexOf('duplicate'));
  });

  it('discloses on the surviving notification when only one side clears the filters', () => {
    // The sibling is autopay-covered, so it emits nothing — but the pair is still a fact about the
    // reader's accounts, and the note deliberately claims nothing about notification counts.
    const out = selectNotifications({
      ...args,
      reminders: [DUPED[0], reminder({ accountId: 'chase-b', accountName: 'Chase Sapphire', userActionCents: 0, autopayCents: 667_968 })],
      cardDuplicates: PAIR,
    });
    expect(out.filter((n) => n.kind === 'payment_due')).toHaveLength(1);
    expect(out[0].body).toContain('“Chase Sapphire”');
  });

  it('is byte-identical to the pre-L.15 selection when there is no pair', () => {
    expect(selectNotifications({ ...args, cardDuplicates: [] })).toEqual(
      selectNotifications(args),
    );
  });
});

// ─── (e) + (f): fixtures over a real-shaped CashNeededResult ────────────────

function resultWithPair(): CashNeededResult {
  const card = (cardId: string, cardName: string) => ({
    cardId,
    cardName,
    amountCents: cents(667_968),
    autopayCents: cents(0),
    isEstimated: false,
  });
  return {
    headline: {
      requiredCents: cents(1_335_936),
      cardsDueCount: 2,
      byDate: isoDate('2026-06-13'),
      shortfallCents: cents(0),
      recommendation: null,
    },
    perDueDate: [{ date: isoDate('2026-06-13'), cards: [card('chase-a', 'CREDIT CARD'), card('chase-b', 'Chase Sapphire')] }],
    cards: [
      { cardId: 'chase-a', cardName: 'CREDIT CARD', notes: [] },
      { cardId: 'chase-b', cardName: 'Chase Sapphire', notes: [] },
    ],
    upcoming: [],
    unknownDueDateCards: [],
  } as unknown as CashNeededResult;
}

describe('(f) the Glass-Box trace', () => {
  it('adds a basis line naming both rows', () => {
    const trace = traceCashNeeded(resultWithPair(), PAIR);
    expect(trace.basis.join(' ')).toContain('“CREDIT CARD”');
    expect(trace.basis.join(' ')).toContain('“Chase Sapphire”');
  });

  it('leaves the rows and the reconciliation untouched', () => {
    // `reconciles` checks the engine's internal consistency, not whether the world has two cards.
    // Dropping a row to "fix" the number would break the one invariant this feature rests on.
    const plain = traceCashNeeded(resultWithPair());
    const disclosed = traceCashNeeded(resultWithPair(), PAIR);
    expect(disclosed.rows).toEqual(plain.rows);
    expect(disclosed.sumCents).toBe(plain.sumCents);
    expect(disclosed.reconciles).toBe(true);
  });

  it('is byte-identical to the pre-L.15 trace when there is no pair', () => {
    expect(traceCashNeeded(resultWithPair(), [])).toEqual(traceCashNeeded(resultWithPair()));
  });
});

describe('(e) the Ask cash-needed answer', () => {
  it('qualifies the figure and the count it states', () => {
    const answer = answerCashNeeded(resultWithPair(), 'Everyday Checking', PAIR);
    expect(answer.detail).toContain('“CREDIT CARD”');
    expect(answer.detail).toContain('the amount and the card count in this answer');
  });

  it('puts the caveat BEFORE the move-money instruction', () => {
    // A shortfall is derived from requiredCents, so a duplicated card can manufacture one — and the
    // instruction that follows tells the reader to move cash they may not need to move.
    const inflated = resultWithPair();
    (inflated.headline as { shortfallCents: number }).shortfallCents = 50_000;
    (inflated.headline as { recommendation: unknown }).recommendation = {
      amountCents: cents(50_000),
      byDate: isoDate('2026-06-12'),
    };
    const answer = answerCashNeeded(inflated, 'Everyday Checking', PAIR)!;
    expect(answer.detail!.indexOf('duplicate') >= 0 || answer.detail!.indexOf('same card') >= 0).toBe(true);
    expect(answer.detail!.indexOf('same card')).toBeLessThan(answer.detail!.indexOf('move '));
  });

  it('leaves the headline figure and the count exactly as the engine computed them', () => {
    const answer = answerCashNeeded(resultWithPair(), 'Everyday Checking', PAIR);
    expect(answer.headlineCents).toBe(1_335_936);
    expect(answer.facts.find((f) => f.label === 'Cards due')?.value).toBe('2');
  });

  it('is byte-identical to the pre-L.15 answer when there is no pair', () => {
    expect(answerCashNeeded(resultWithPair(), 'Everyday Checking', [])).toEqual(
      answerCashNeeded(resultWithPair(), 'Everyday Checking'),
    );
  });
});

describe('(a) the calendar', () => {
  const obligation = (cardId: string, cardName: string) => ({
    cardId,
    cardName,
    effectiveDueDate: isoDate('2026-06-13'),
    cashRequiredCents: cents(667_968),
    isEstimated: false,
  });

  it('carries the accountId on every card-due event, so a caller can name only what is on the grid', () => {
    const cal = buildCashFlowCalendar({
      month: '2026-06',
      scheduled: [],
      cardObligations: [obligation('chase-a', 'CREDIT CARD'), obligation('chase-b', 'Chase Sapphire')] as never,
    });
    const due = cal.days.flatMap((d) => d.events).filter((e) => e.kind === 'card-due');
    expect(due).toHaveLength(2);
    expect(due.map((e) => e.accountId).sort()).toEqual(['chase-a', 'chase-b']);
  });

  it('ABSTAINS for a pair whose other side falls outside the displayed month', () => {
    const cal = buildCashFlowCalendar({
      month: '2026-06',
      scheduled: [],
      cardObligations: [
        obligation('chase-a', 'CREDIT CARD'),
        { ...obligation('chase-b', 'Chase Sapphire'), effectiveDueDate: isoDate('2026-07-13') },
      ] as never,
    });
    const rows = cal.days
      .flatMap((d) => d.events)
      .filter((e) => e.kind === 'card-due' && e.accountId !== undefined)
      .map((e) => ({ cardId: e.accountId!, label: e.label }));
    expect(cardDuplicateCalendarView(PAIR, rows)).toBeNull();
  });
});

// ─── regressions from the L.15 hostile-critic cycle ────────────────────────

describe('critic F1 — no builder invents a label the surface does not paint', () => {
  const SAME = [
    { cardId: 'chase-a', label: 'CREDIT CARD' },
    { cardId: 'chase-b', label: 'CREDIT CARD' },
  ];
  const ORDINAL = /“\d+\. /;

  it('the calendar names the shared string once instead of numbering the grid', () => {
    const view = cardDuplicateCalendarView(PAIR, SAME)!;
    expect(view.pairs[0].sentence).not.toMatch(ORDINAL);
    expect(view.pairs[0].sentence).toContain('Two entries are both named “CREDIT CARD”');
  });

  it('the push note does not tell the reader to compare against this notification’s own title', () => {
    const note = cardDuplicatePushNotes(PAIR, SAME).get('chase-a')!;
    expect(note).not.toMatch(ORDINAL);
    expect(note).toContain('a second entry with this same name');
  });

  it('the trace basis names the shared row name once', () => {
    const [line] = cardDuplicateTraceBasis(PAIR, SAME);
    expect(line).not.toMatch(ORDINAL);
    expect(line).toContain('both named “CREDIT CARD”');
  });

  it('the Ask note does the same — that answer paints no card list at all', () => {
    const [line] = cardDuplicateAnswerNote(PAIR, SAME);
    expect(line).not.toMatch(ORDINAL);
  });

  it('but /cards and the hero KEEP the ordinal net — they really do renumber their headings', () => {
    // `cardIdentityLabels` renders the prefix INTO the heading there, so the ordinal names something
    // on screen. This is the line between the two behaviours, and it is a property of the surface.
    const view = cardDuplicateView(PAIR, SAME.map((c) => ({ ...c, role: { counted: true, cents: 100 } as const })))!;
    expect(view.pairs[0].sentence).toContain('“1. CREDIT CARD”');
  });
});

describe('critic F4 — the Ask zero-due branch states a COUNT, so it discloses too', () => {
  const UNDATED = [
    { cardId: 'chase-a', label: 'CREDIT CARD' },
    { cardId: 'chase-b', label: 'CREDIT CARD' },
  ];

  it('says the count is inflated and that NO amount is affected', () => {
    const [line] = cardDuplicateUndatedNote(PAIR, UNDATED);
    expect(line).toContain('the count in this answer is one higher');
    // The opposite claim would be the false money claim in the other direction: an undated pair is
    // in no total, so telling this reader a figure is inflated would be wrong.
    expect(line).toContain('no amount here is affected');
  });

  it('reaches the real answer builder', () => {
    const undatedResult = {
      headline: { requiredCents: 0, cardsDueCount: 0, byDate: null, shortfallCents: 0, recommendation: null },
      perDueDate: [],
      cards: [],
      upcoming: [],
      unknownDueDateCards: [
        { cardId: 'chase-a', cardName: 'CREDIT CARD', currentBalanceCents: -100 },
        { cardId: 'chase-b', cardName: 'CREDIT CARD', currentBalanceCents: -100 },
      ],
    } as unknown as CashNeededResult;
    const answer = answerCashNeeded(undatedResult, 'Everyday Checking', PAIR);
    expect(answer.detail).toContain('the count in this answer is one higher');
  });

  it('ABSTAINS when only one undated card is in the pair', () => {
    expect(cardDuplicateUndatedNote(PAIR, [UNDATED[0]])).toEqual([]);
  });
});

describe('critic P1-2 — the Cash Flow Radar, the seventh surface', () => {
  const rows = [
    { cardId: 'chase-a', label: 'CREDIT CARD' },
    { cardId: 'chase-b', label: 'Chase Sapphire' },
  ];

  it('says the dip date may be early and the amount to move too large', () => {
    const [line] = cardDuplicateRadarNote(PAIR, rows);
    expect(line).toContain('every cycle in this projection counts it twice');
    expect(line).toContain('the amount to move larger than you actually need');
    expect(line).toContain('Nothing has been adjusted');
  });

  it('ABSTAINS when only one side is in the projection', () => {
    expect(cardDuplicateRadarNote(PAIR, [rows[0]])).toEqual([]);
  });
});

describe('critic P2-1 — a no-pair user sees the pre-L.15 output, tested against a GOLDEN string', () => {
  // The previous cut asserted `f(x, []) === f(x)` — the same post-change function compared with its
  // own default, which a mutant that always appends the disclosure also passes. A literal is the
  // only thing that can actually fail.
  it('the reminder email is exactly the pre-L.15 text', () => {
    const email = buildReminderEmail([DUPED[0]], TODAY, [])!;
    expect(email.text).toBe(
      [
        "Here's what's coming up as of Wed, Jun 10, 2026:",
        '',
        "• CREDIT CARD: $6,679.68 due Sat, Jun 13, 2026 (in 3 days) — you'll pay $6,679.68 yourself",
        '',
        'A heads-up so nothing catches you by surprise. Aimplifi never moves money for you — this is just a reminder.',
      ].join('\n'),
    );
  });

  it('the push body is exactly the pre-L.15 text', () => {
    const [n] = selectNotifications({ reminders: [DUPED[0]], radar: null, today: TODAY, cardDuplicates: [] });
    expect(n.body).toBe(
      'Pay $6,679.68 yourself by Sat, Jun 13, 2026. Aimplifi never moves money for you.',
    );
  });

  it('the trace gains no basis line', () => {
    expect(traceCashNeeded(resultWithPair(), []).basis).toEqual([]);
  });

  // The cycle-2 critic ran a MUTANT that unconditionally appends the disclosure and found the whole
  // suite still green for these two — only three goldens existed. These are the missing pair.
  it('the weekly digest payments section is exactly the pre-L.15 text', () => {
    const digest = buildWeeklyDigest({ frozenCards: [], review: null, reminders: [DUPED[0]], today: TODAY, cardDuplicates: [] })!;
    expect(digest.text).not.toContain(CARD_DUPLICATE_TITLE);
    expect(digest.text).toContain(
      "• CREDIT CARD: $6,679.68 due Sat, Jun 13, 2026 (in 3 days) — you'll pay $6,679.68 yourself",
    );
    // The bullet is the LAST thing in the payments section: nothing was appended after it.
    const after = digest.text.slice(digest.text.indexOf('yourself') + 'yourself'.length);
    expect(after).not.toContain('named');
    expect(after).not.toContain('same card');
  });

  it('the Ask cash-needed answer is exactly the pre-L.15 answer', () => {
    const answer = answerCashNeeded(resultWithPair(), 'Everyday Checking', []);
    expect(answer.detail).toBeUndefined();
    expect(answer.headline).toBe(
      'You need $13,359.36 by Jun 13, 2026 to pay your cards in full.',
    );
    expect(answer.facts).toEqual([
      { label: 'Cards due', value: '2' },
      { label: 'From', value: 'Everyday Checking' },
    ]);
  });
});
