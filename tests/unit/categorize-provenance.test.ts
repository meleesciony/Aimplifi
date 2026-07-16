/**
 * Why-This-Category §3.1 slice 1 — the pure provenance resolver.
 * Acceptance criteria 1–3 (WHY_THIS_CATEGORY_PLAN.md):
 *   1. Resolver totality — every input triple maps to exactly one kind.
 *   2. No fabricated origin — `ai-guess` ⇔ persisted `source === 'llm'`.
 *   3. The three-way absence — user-set / not-recorded distinguished honestly.
 */
import { describe, expect, it } from 'vitest';
import {
  describeProvenance,
  type PredictionSource,
  type ProvenanceInput,
  type ProvenanceKind,
} from '@/lib/engine/categorize/provenance';

const ALL_SOURCES: PredictionSource[] = [
  'transfer',
  'user-rule',
  'merchant-default',
  'fallback',
  'provider-category',
  'llm',
];

function input(over: Partial<ProvenanceInput>): ProvenanceInput {
  return {
    source: 'merchant-default',
    hasPredictionRow: true,
    txnConfidenceBps: 9500,
    userLabeled: false,
    // Default: the current category still matches what was predicted (guard passes).
    predictedCategoryId: 'dining',
    currentCategoryId: 'dining',
    ...over,
  };
}

describe('describeProvenance — recorded-source mapping', () => {
  const cases: Array<[PredictionSource, ProvenanceKind]> = [
    ['llm', 'ai-guess'],
    ['user-rule', 'your-rule'],
    ['merchant-default', 'merchant-default'],
    ['provider-category', 'provider'],
    ['transfer', 'transfer'],
    ['fallback', 'uncategorized'],
  ];
  it.each(cases)('source %s → kind %s', (source, kind) => {
    expect(describeProvenance(input({ source })).kind).toBe(kind);
  });

  it('only ai-guess needsConfirm', () => {
    for (const source of ALL_SOURCES) {
      const v = describeProvenance(input({ source }));
      expect(v.needsConfirm).toBe(source === 'llm');
    }
  });

  it('every kind carries a non-empty, no-shame label', () => {
    const shame = /wrong|bad|mistake|fail|error/i;
    for (const source of [...ALL_SOURCES, null]) {
      const v = describeProvenance(input({ source, hasPredictionRow: source !== null }));
      expect(v.label.length).toBeGreaterThan(0);
      expect(v.label).not.toMatch(shame);
    }
  });
});

describe('criterion 2 — no fabricated origin', () => {
  it('ai-guess is reachable ONLY from persisted source === llm', () => {
    // Sweep the whole input space; assert ai-guess ⇒ source === "llm".
    const sources: Array<PredictionSource | null> = [...ALL_SOURCES, null];
    const confidences = [0, 5000, 7000, 8500, 9000, 9900, 10000];
    for (const source of sources) {
      for (const hasPredictionRow of [true, false]) {
        for (const txnConfidenceBps of confidences) {
          for (const userLabeled of [true, false]) {
            for (const categoryMatch of [true, false]) {
              const v = describeProvenance({
                source,
                hasPredictionRow,
                txnConfidenceBps,
                userLabeled,
                predictedCategoryId: 'dining',
                currentCategoryId: categoryMatch ? 'dining' : 'coffee',
              });
              if (v.kind === 'ai-guess') {
                expect(source).toBe('llm');
                expect(hasPredictionRow).toBe(true);
                expect(userLabeled).toBe(false);
                expect(categoryMatch).toBe(true); // never surfaces a stale source (P1-3)
              }
              if (v.needsConfirm) expect(v.kind).toBe('ai-guess');
            }
          }
        }
      }
    }
  });

  it('high confidence alone never manufactures an AI or merchant origin', () => {
    // A confident row with NO recorded source stays honest, not a guessed origin.
    expect(describeProvenance(input({ source: null, hasPredictionRow: true, txnConfidenceBps: 9900 })).kind).toBe(
      'not-recorded',
    );
  });
});

describe('criterion 3 — the three-way absence + user-label override', () => {
  it('no row + confidence 10000 → user-set (the human dictated it)', () => {
    const v = describeProvenance(input({ hasPredictionRow: false, txnConfidenceBps: 10000 }));
    expect(v.kind).toBe('user-set');
    expect(v.needsConfirm).toBe(false);
  });

  it('no row + confidence < 10000 → not-recorded (predates prediction logging)', () => {
    expect(describeProvenance(input({ hasPredictionRow: false, txnConfidenceBps: 8000 })).kind).toBe('not-recorded');
  });

  it('row + null source → not-recorded (predates the source column)', () => {
    expect(describeProvenance(input({ hasPredictionRow: true, source: null })).kind).toBe('not-recorded');
  });

  it('userLabeled overrides ANY original source → user-set, never asks to re-confirm', () => {
    for (const source of ALL_SOURCES) {
      const v = describeProvenance(input({ source, userLabeled: true }));
      expect(v.kind).toBe('user-set');
      expect(v.needsConfirm).toBe(false);
    }
  });

  it('a corrected AI row reads user-set, not a stale ai-guess', () => {
    // The exact trap: the llm prediction row survives a correction (labeledAt set).
    const v = describeProvenance(input({ source: 'llm', userLabeled: true }));
    expect(v.kind).toBe('user-set');
    expect(v.needsConfirm).toBe(false);
  });
});

describe('P1-3 — a stale source (current category moved) is never surfaced as its origin', () => {
  it('predicted ≠ current → not-recorded, for EVERY source (backfill re-file / sync refresh / partner correction)', () => {
    for (const source of ALL_SOURCES) {
      const v = describeProvenance(input({ source, predictedCategoryId: 'dining', currentCategoryId: 'coffee' }));
      expect(v.kind).toBe('not-recorded');
      expect(v.needsConfirm).toBe(false);
    }
  });

  it('a partner-corrected llm row (category moved, labeledAt not set) does NOT beg to re-confirm', () => {
    // household partner correction sets categoryId + confidence 9900 but never
    // labeledAt — so userLabeled is false. The category moved, so the stale 'llm'
    // source must not render "AI guess — needs your OK".
    const v = describeProvenance(
      input({ source: 'llm', userLabeled: false, predictedCategoryId: 'software', currentCategoryId: 'dining', txnConfidenceBps: 9900 }),
    );
    expect(v.kind).toBe('not-recorded');
    expect(v.needsConfirm).toBe(false);
  });

  it('predicted === current → the source is surfaced normally', () => {
    expect(describeProvenance(input({ source: 'llm', predictedCategoryId: 'x', currentCategoryId: 'x' })).kind).toBe('ai-guess');
  });
});

describe('criterion 1 — totality (never throws, always one valid kind)', () => {
  const KINDS = new Set<ProvenanceKind>([
    'user-set',
    'your-rule',
    'merchant-default',
    'provider',
    'transfer',
    'ai-guess',
    'uncategorized',
    'not-recorded',
  ]);
  it('maps every input triple to exactly one known kind', () => {
    const sources: Array<PredictionSource | null> = [...ALL_SOURCES, null];
    for (const source of sources) {
      for (const hasPredictionRow of [true, false]) {
        for (const txnConfidenceBps of [0, 9900, 10000]) {
          for (const userLabeled of [true, false]) {
            for (const currentCategoryId of ['dining', 'coffee', null]) {
              const v = describeProvenance({
                source,
                hasPredictionRow,
                txnConfidenceBps,
                userLabeled,
                predictedCategoryId: 'dining',
                currentCategoryId,
              });
              expect(KINDS.has(v.kind)).toBe(true);
            }
          }
        }
      }
    }
  });
});
