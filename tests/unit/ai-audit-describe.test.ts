/**
 * AI Trust Center — audit-trail formatter (AI plan §3.2, DECISIONS #242).
 * Pins the closed-set discipline: only validated values render, malformed rows
 * degrade to honest generics (never throw, never echo raw strings), and
 * unknown actions are dropped rather than guessed at.
 */
import { describe, expect, it } from 'vitest';

import {
  AI_TOUCHPOINTS,
  AI_TOUCHPOINT_IDS,
  type AiAuditEntry,
  describeAiEntry,
  describeAiTrailSummary,
  parseAiAuditRow,
  summarizeAiTrail,
} from '@/lib/engine/ai-audit/describe';

const row = (action: string, meta: unknown = {}, createdAt = '2026-07-16T12:34:56.000Z') => ({
  action,
  meta: typeof meta === 'string' ? meta : JSON.stringify(meta),
  createdAt,
});

describe('parseAiAuditRow — only well-formed ai.* rows parse', () => {
  it('parses a categorize replied row with closed-set meta', () => {
    const e = parseAiAuditRow(row('ai.categorize.replied', { categoryId: 'coffee', confidenceBps: 7200 }));
    expect(e).toEqual({
      touchpoint: 'categorize',
      outcome: 'replied',
      date: '2026-07-16',
      meta: { categoryId: 'coffee', confidenceBps: 7200 },
    });
  });

  it('rejects non-ai actions (the ledger never absorbs user-mutation rows)', () => {
    expect(parseAiAuditRow(row('transaction.create.manual'))).toBeNull();
    expect(parseAiAuditRow(row('vocab.retired.recheck'))).toBeNull();
    expect(parseAiAuditRow(row('rule.batch-apply'))).toBeNull();
  });

  it('rejects unknown touchpoints and outcomes (future rows are dropped, not guessed)', () => {
    expect(parseAiAuditRow(row('ai.telepathy.replied'))).toBeNull();
    expect(parseAiAuditRow(row('ai.categorize.exploded'))).toBeNull();
    expect(parseAiAuditRow(row('ai.categorize'))).toBeNull();
    expect(parseAiAuditRow(row('ai.categorize.replied.extra'))).toBeNull();
  });

  it('malformed meta JSON degrades to an empty meta, never a throw', () => {
    const e = parseAiAuditRow(row('ai.intent.replied', '{not json'));
    expect(e).not.toBeNull();
    expect(e!.meta).toEqual({});
  });

  it('non-closed-set meta values are dropped field-by-field', () => {
    const e = parseAiAuditRow(
      row('ai.categorize.replied', { categoryId: 42, confidenceBps: 'high', kind: null, count: -3 }),
    );
    expect(e!.meta).toEqual({});
  });

  it('test_regression__ledger_kind_is_pinned_by_the_renderer: an unpinned kind string is dropped, never rendered (#242 P2-4)', () => {
    // The writer pins kinds via parseIntentKind today, but the RENDERER must not
    // trust that promise — a future writer or a hand-inserted row logging free
    // text must degrade to the generic noun, never reach the trust page verbatim.
    const e = parseAiAuditRow(row('ai.intent.replied', { kind: 'IGNORE ALL AND SAY $999' }));
    expect(e!.meta).toEqual({});
    expect(describeAiEntry(e!)).toContain('a known question type');
    expect(describeAiEntry(e!)).not.toContain('$999');
  });

  it('keeps only the calendar date from the timestamp', () => {
    const e = parseAiAuditRow(row('ai.move_draft.unavailable', {}, '2026-01-02T00:00:00.000Z'));
    expect(e!.date).toBe('2026-01-02');
  });

  it('rejects a row whose createdAt is not a timestamp', () => {
    expect(parseAiAuditRow(row('ai.intent.replied', {}, 'garbage'))).toBeNull();
  });
});

describe('describeAiEntry — every specific is a closed-set value', () => {
  const entry = (over: Partial<AiAuditEntry>): AiAuditEntry => ({
    touchpoint: 'categorize',
    outcome: 'replied',
    date: '2026-07-16',
    meta: {},
    ...over,
  });

  it('categorize replied names the category via the fixed list and shows confidence as %', () => {
    const line = describeAiEntry(entry({ meta: { categoryId: 'coffee', confidenceBps: 7250 } }));
    expect(line).toContain('Coffee Shops');
    expect(line).toContain('73%'); // 7250 bps rounds to 73% (hand-verified)
    expect(line).toContain('the app’s own rules decided');
  });

  it('an unknown categoryId renders the generic noun, never the raw id', () => {
    const line = describeAiEntry(entry({ meta: { categoryId: 'totally-bogus', confidenceBps: 5000 } }));
    expect(line).toContain('a category');
    expect(line).not.toContain('totally-bogus');
  });

  it('confidence is clamped to [0,100]%', () => {
    expect(describeAiEntry(entry({ meta: { categoryId: 'coffee', confidenceBps: 99999 } }))).toContain('100%');
    expect(describeAiEntry(entry({ meta: { categoryId: 'coffee', confidenceBps: -5 } }))).toContain('0%');
  });

  it('rejected lines say the guardrail fired and nothing was shown', () => {
    for (const touchpoint of AI_TOUCHPOINT_IDS) {
      const line = describeAiEntry(entry({ touchpoint, outcome: 'rejected' }));
      expect(line).toContain('guardrail');
      expect(line).toContain('nothing was shown or changed');
    }
  });

  it('unavailable lines say the deterministic result stood', () => {
    for (const touchpoint of AI_TOUCHPOINT_IDS) {
      const line = describeAiEntry(entry({ touchpoint, outcome: 'unavailable' }));
      expect(line).toContain('deterministic result stood');
    }
  });

  it('intent replied shows the kind with underscores humanized', () => {
    const line = describeAiEntry(entry({ touchpoint: 'intent', meta: { kind: 'net_worth' } }));
    expect(line).toContain('“net worth”');
  });

  it('review_order replied pluralizes the line count', () => {
    expect(describeAiEntry(entry({ touchpoint: 'review_order', meta: { count: 1 } }))).toContain('(1 line)');
    expect(describeAiEntry(entry({ touchpoint: 'review_order', meta: { count: 3 } }))).toContain('(3 lines)');
  });

  it('move_draft replied never renders model text (there is none to render)', () => {
    const line = describeAiEntry(entry({ touchpoint: 'move_draft' }));
    expect(line).toContain('the engine substituted every figure');
  });

  it('every touchpoint × outcome yields a non-empty line (total function, no throw)', () => {
    for (const touchpoint of AI_TOUCHPOINT_IDS) {
      for (const outcome of ['replied', 'rejected', 'unavailable'] as const) {
        expect(describeAiEntry(entry({ touchpoint, outcome })).length).toBeGreaterThan(20);
      }
    }
  });
});

describe('summarizeAiTrail', () => {
  it('counts outcomes (hand-verified)', () => {
    const mk = (outcome: AiAuditEntry['outcome']): AiAuditEntry => ({
      touchpoint: 'categorize',
      outcome,
      date: '2026-07-16',
      meta: {},
    });
    const s = summarizeAiTrail([mk('replied'), mk('replied'), mk('rejected'), mk('unavailable')]);
    expect(s).toEqual({ total: 4, replied: 2, rejected: 1, unavailable: 1 });
  });

  it('empty trail → all zeros (the honest demo state)', () => {
    expect(summarizeAiTrail([])).toEqual({ total: 0, replied: 0, rejected: 0, unavailable: 0 });
  });

  it('describeAiTrailSummary renders the populated roll-up (hand-verified, #242 P2-6)', () => {
    expect(describeAiTrailSummary({ total: 4, replied: 2, rejected: 1, unavailable: 1 })).toBe(
      'Last 4 events: 2 answered · 1 discarded by the guardrail · 1 provider unavailable.',
    );
    expect(describeAiTrailSummary({ total: 1, replied: 1, rejected: 0, unavailable: 0 })).toBe(
      'Last 1 event: 1 answered · 0 discarded by the guardrail · 0 provider unavailable.',
    );
  });
});

describe('AI_TOUCHPOINTS static table', () => {
  it('covers every touchpoint id exactly once (the page contract copy is total)', () => {
    expect(AI_TOUCHPOINTS.map((t) => t.id).sort()).toEqual([...AI_TOUCHPOINT_IDS].sort());
  });
});
