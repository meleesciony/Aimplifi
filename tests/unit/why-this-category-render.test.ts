/**
 * Why-This-Category §3.1 slice 2 — the register render contract (criteria 6 & 9).
 *
 * The register renders `provenanceBadgeView(row.provenance)` VERBATIM: the badge
 * text is the resolver's own label, the tone/confirm are a pure function of the
 * verdict, and nothing here re-derives an origin. Pinning the presentation view
 * over `describeProvenance` therefore pins what the DOM shows for a given stored
 * fact — the e2e proves the wire-up on real demo data.
 */
import { describe, expect, it } from 'vitest';
import {
  describeProvenance,
  type PredictionSource,
  type ProvenanceInput,
  type ProvenanceKind,
} from '@/lib/engine/categorize/provenance';
import { provenanceBadgeView } from '@/components/finance/provenance-badge';

function input(over: Partial<ProvenanceInput>): ProvenanceInput {
  return {
    source: 'merchant-default',
    hasPredictionRow: true,
    txnConfidenceBps: 9500,
    userLabeled: false,
    predictedCategoryId: 'dining',
    currentCategoryId: 'dining',
    ...over,
  };
}

describe('criterion 6 — the badge shows the resolver verdict verbatim, no re-derivation', () => {
  const cases: Array<[Partial<ProvenanceInput>, ProvenanceKind, string]> = [
    [{ source: 'llm' }, 'ai-guess', 'AI guess — needs your OK'],
    [{ source: 'user-rule' }, 'your-rule', 'Your rule'],
    [{ source: 'merchant-default' }, 'merchant-default', 'Known merchant'],
    [{ source: 'provider-category' }, 'provider', 'From your bank'],
    [{ source: 'transfer' }, 'transfer', 'Transfer'],
    [{ source: 'fallback' }, 'uncategorized', 'Needs a category'],
    [{ userLabeled: true }, 'user-set', 'You set this'],
    [{ hasPredictionRow: true, source: null }, 'not-recorded', 'Source not recorded'],
  ];

  it.each(cases)('%o → kind %s / label %s', (over, kind, label) => {
    const view = provenanceBadgeView(describeProvenance(input(over)));
    expect(view.kind).toBe(kind);
    // The badge copy is the verdict's own label — the view never re-authors it.
    expect(view.label).toBe(label);
  });

  it('attention tone and the confirm control appear for ai-guess ONLY', () => {
    const sources: Array<PredictionSource | null> = [
      'transfer',
      'user-rule',
      'merchant-default',
      'fallback',
      'provider-category',
      'llm',
      null,
    ];
    for (const source of sources) {
      const view = provenanceBadgeView(
        describeProvenance(input({ source, hasPredictionRow: source !== null })),
      );
      const isGuess = source === 'llm';
      expect(view.showConfirm).toBe(isGuess);
      expect(view.tone).toBe(isGuess ? 'attention' : 'muted');
    }
  });

  it('a user-labeled row never offers confirm, whatever proposed it first', () => {
    for (const source of ['llm', 'merchant-default', 'provider-category'] as PredictionSource[]) {
      const view = provenanceBadgeView(describeProvenance(input({ source, userLabeled: true })));
      expect(view.kind).toBe('user-set');
      expect(view.showConfirm).toBe(false);
    }
  });
});

describe('criterion 9 — no fabricated confidence anywhere on the surface', () => {
  it('no provenance label renders a percentage or numeric confidence', () => {
    const sources: Array<PredictionSource | null> = [
      'transfer',
      'user-rule',
      'merchant-default',
      'fallback',
      'provider-category',
      'llm',
      null,
    ];
    for (const source of sources) {
      for (const userLabeled of [true, false]) {
        for (const txnConfidenceBps of [8000, 9000, 9900, 10000]) {
          const view = provenanceBadgeView(
            describeProvenance(input({ source, userLabeled, hasPredictionRow: source !== null, txnConfidenceBps })),
          );
          expect(view.label).not.toMatch(/\d/); // no digit → no "92%", no "9500 bps"
          expect(view.label).not.toMatch(/%|percent|confiden/i);
        }
      }
    }
  });
});
