/**
 * Glass-Box share redaction (TASKS 1.6 / DECISIONS #202).
 * Amounts must survive redaction unchanged; labels must not leak card names.
 */
import { describe, expect, it } from 'vitest';
import {
  formatShareText,
  redactTraceForShare,
} from '@/lib/engine/glass-box/redact';
import type { NumberTrace } from '@/lib/engine/glass-box/trace';
import { cents } from '@/lib/money';
import { isoDate } from '@/lib/dates';

function cashTrace(over?: Partial<NumberTrace>): NumberTrace {
  const rows = [
    {
      id: 'a',
      label: 'Amex Blue',
      amountCents: cents(271233),
      date: isoDate('2026-06-15'),
      autopayCents: cents(50000),
      isEstimated: false,
      notes: ['Autopay handles this payment from Checking ****1234'],
    },
    {
      id: 'b',
      label: 'Chase Sapphire',
      amountCents: cents(210000),
      date: isoDate('2026-06-20'),
      isEstimated: false,
      notes: ['Statement balance'],
    },
    {
      id: 'c',
      label: 'Store Card',
      amountCents: cents(60000),
      date: isoDate('2026-06-22'),
      isEstimated: true,
      notes: [],
    },
  ];
  const sumCents = cents(271233 + 210000 + 60000);
  return {
    key: 'cash_needed',
    headlineCents: sumCents,
    rows,
    sumCents,
    reconciles: true,
    // Cash-needed amounts are all detected/seed rows — no reader-typed figure
    // can enter that trace (C.11).
    dataDerived: true,
    basis: ['Rows marked "est." use the current card balance.'],
    ...over,
  };
}

describe('redactTraceForShare', () => {
  it('replaces card names with Card N and strips identifying notes', () => {
    const out = redactTraceForShare(cashTrace());
    expect(out.rows.map((r) => r.label)).toEqual(['Card 1', 'Card 2', 'Card 3']);
    expect(out.rows[0]!.notes).toEqual(['Part of this row is covered by autopay.']);
    expect(out.rows[1]!.notes).toEqual([]);
    expect(out.rows.every((r) => !r.notes.some((n) => /Checking|\*\*\*\*|Amex|Chase/i.test(n)))).toBe(
      true,
    );
  });

  it('preserves amounts, dates, sum, and reconciles flag byte-for-byte', () => {
    const input = cashTrace();
    const out = redactTraceForShare(input);
    expect(out.headlineCents).toBe(input.headlineCents);
    expect(out.sumCents).toBe(input.sumCents);
    expect(out.reconciles).toBe(true);
    expect(out.rows.map((r) => r.amountCents)).toEqual(input.rows.map((r) => r.amountCents));
    expect(out.rows.map((r) => r.date)).toEqual(input.rows.map((r) => r.date));
    expect(out.rows.map((r) => r.autopayCents)).toEqual(input.rows.map((r) => r.autopayCents));
    expect(out.rows.map((r) => r.isEstimated)).toEqual(input.rows.map((r) => r.isEstimated));
  });

  it('keeps safe-to-spend category labels (already non-identifying)', () => {
    const input: NumberTrace = {
      key: 'safe_to_spend',
      headlineCents: cents(100),
      sumCents: cents(100),
      reconciles: true,
      dataDerived: true,
      basis: [],
      rows: [
        {
          id: 'income',
          label: 'Expected income',
          amountCents: cents(500),
          isEstimated: false,
          notes: ['should strip'],
        },
        {
          id: 'spent',
          label: 'Spent so far',
          amountCents: cents(-400),
          isEstimated: false,
          notes: [],
        },
      ],
    };
    const out = redactTraceForShare(input);
    expect(out.rows[0]!.label).toBe('Expected income');
    expect(out.rows[0]!.notes).toEqual([]);
  });
});

describe('formatShareText', () => {
  it('never includes original card names or account masks', () => {
    const text = formatShareText(cashTrace());
    expect(text).toContain('Ask Aimplifi · Glass-Box');
    expect(text).toContain('Card 1');
    expect(text).toContain('$2,712.33');
    expect(text).toContain('$5,412.33');
    expect(text).toContain('matched to the penny');
    expect(text).toContain('Nothing left this device');
    expect(text).not.toMatch(/Amex|Chase|Sapphire|Checking|\*\*\*\*1234/i);
  });

  // C.11 / audit P1-14: the snapshot carries the SAME gate as the panel.
  it('a data-derived multi-row trace carries the provenance clause', () => {
    const text = formatShareText(cashTrace());
    expect(text).toContain('Amounts from your own data; nothing invented.');
  });

  it('a reader-typed figure (dataDerived false) drops the provenance clause but keeps the device clause', () => {
    const text = formatShareText(cashTrace({ dataDerived: false }));
    expect(text).not.toContain('nothing invented');
    expect(text).toContain('Names redacted. Nothing left this device.');
  });

  it('a one-row trace prints no penny-match and no completeness claim — one amount beside the figure it is certifies nothing', () => {
    const oneRow = cashTrace({
      key: 'conscious_fixed',
      rows: [
        {
          id: 'fixed',
          label: 'Fixed costs',
          amountCents: cents(202356),
          isEstimated: false,
          notes: [],
        },
      ],
      headlineCents: cents(202356),
      sumCents: cents(202356),
    });
    const text = formatShareText(oneRow);
    expect(text).toContain('This amount is the whole figure.');
    expect(text).not.toContain('matched to the penny');
    // Critic cycle 2 P1-1: no completeness claim — the one row may itself be
    // an aggregate (the Fixed term is a rollup union).
    expect(text).not.toContain('nothing else is inside it');
  });
});
