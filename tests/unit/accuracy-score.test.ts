import { describe, expect, it } from 'vitest';
import { scorePredictions, type PredictionSample } from '@/lib/engine/accuracy/score';

describe('scorePredictions — accuracy + Brier calibration (DECISIONS #37)', () => {
  it('returns zeros for an empty set (nothing reviewed yet)', () => {
    expect(scorePredictions([])).toEqual({ n: 0, correct: 0, accuracyBps: 0, brierMilli: 0 });
  });

  it('hand-verified: 2/3 correct, Brier 0.300', () => {
    const samples: PredictionSample[] = [
      { predictedCategoryId: 'dining', confidenceBps: 9000, actualCategoryId: 'dining' }, // hit, p=.9 → (.9-1)²=.01
      { predictedCategoryId: 'shopping', confidenceBps: 8000, actualCategoryId: 'groceries' }, // miss, p=.8 → (.8-0)²=.64
      { predictedCategoryId: 'fuel', confidenceBps: 5000, actualCategoryId: 'fuel' }, // hit, p=.5 → (.5-1)²=.25
    ];
    // accuracy = 2/3 = 6666.67 → 6667 bps; Brier = (.01+.64+.25)/3 = .30 → 300 milli
    expect(scorePredictions(samples)).toEqual({ n: 3, correct: 2, accuracyBps: 6667, brierMilli: 300 });
  });

  it('perfect, fully-confident predictions → 100% accuracy, Brier 0', () => {
    const samples: PredictionSample[] = [
      { predictedCategoryId: 'income', confidenceBps: 10000, actualCategoryId: 'income' },
      { predictedCategoryId: 'rent', confidenceBps: 10000, actualCategoryId: 'rent' },
    ];
    expect(scorePredictions(samples)).toEqual({ n: 2, correct: 2, accuracyBps: 10000, brierMilli: 0 });
  });

  it('a confident miss is punished harder than an unsure miss (calibration)', () => {
    const confidentMiss = scorePredictions([{ predictedCategoryId: 'a', confidenceBps: 9500, actualCategoryId: 'b' }]);
    const unsureMiss = scorePredictions([{ predictedCategoryId: 'a', confidenceBps: 5500, actualCategoryId: 'b' }]);
    expect(confidentMiss.brierMilli).toBeGreaterThan(unsureMiss.brierMilli);
    expect(confidentMiss.accuracyBps).toBe(0);
  });

  it('clamps out-of-range confidence into [0,1] for the Brier term', () => {
    // confidence 12000bps clamps to p=1; a hit → (1-1)²=0
    expect(scorePredictions([{ predictedCategoryId: 'x', confidenceBps: 12000, actualCategoryId: 'x' }]).brierMilli).toBe(0);
  });
});
