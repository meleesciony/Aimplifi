/**
 * Money Signature copy locks (#252) — habit framing, never identity.
 *
 * The rework that made §Later #11 buildable requires the copy to frame
 * PATTERNS, not personality: no archetype nouns, no "you are a …" identity
 * claims, and every label ships with the fact it is read from. The lexicon
 * ban here is the #250 precedent (banned-claim classes are locked, not just
 * omitted).
 */
import { describe, expect, it } from 'vitest';
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';

const SIGNATURE_STRINGS: { label: string; text: string }[] = [
  { label: 'title', text: COACH_COPY.signatureTitle() },
  { label: 'basis', text: COACH_COPY.signatureBasis() },
  { label: 'weather:strained', text: COACH_COPY.signatureWeather('strained', 0.8, 1200, 'May 2026') },
  { label: 'weather:tight', text: COACH_COPY.signatureWeather('tight', 2.4, 300, 'May 2026') },
  { label: 'weather:tightNegative', text: COACH_COPY.signatureWeather('tight', 5.1, -800, 'May 2026') },
  { label: 'weather:calm', text: COACH_COPY.signatureWeather('calm', 4.2, 900, 'May 2026') },
  { label: 'weather:bright', text: COACH_COPY.signatureWeather('bright', 6.5, 3197, 'May 2026') },
  { label: 'weather:infinite', text: COACH_COPY.signatureWeather('calm', Infinity, null, null) },
  { label: 'saving:steady', text: COACH_COPY.signatureSavingSteady(10, 12, 'Aug 2025') },
  { label: 'saving:variable', text: COACH_COPY.signatureSavingVariable(4, 12) },
  { label: 'saving:forming', text: COACH_COPY.signatureSavingForming(3, 6) },
  { label: 'saving:mixed', text: COACH_COPY.signatureSavingMixed(8, 12) },
  { label: 'saving:shiftingFromSteady', text: COACH_COPY.signatureSavingShiftingFromSteady(5, 12, 'Jun 2025') },
  { label: 'saving:shiftingFromVariable', text: COACH_COPY.signatureSavingShiftingFromVariable(10, 12) },
  { label: 'steadiness:steady', text: COACH_COPY.signatureSteadinessSteady(450) },
  { label: 'steadiness:variable', text: COACH_COPY.signatureSteadinessVariable(3333) },
  { label: 'steadiness:forming', text: COACH_COPY.signatureSteadinessForming(6) },
  { label: 'steadiness:mixed', text: COACH_COPY.signatureSteadinessMixed(2000) },
  { label: 'steadiness:shiftingFromSteady', text: COACH_COPY.signatureSteadinessShiftingFromSteady(5000) },
  { label: 'steadiness:shiftingFromVariable', text: COACH_COPY.signatureSteadinessShiftingFromVariable(800) },
  { label: 'steadiness:unreadable', text: COACH_COPY.signatureSteadinessUnreadable(6) },
];

/**
 * Identity/archetype framing is BANNED across every signature string: the
 * feature describes habits the data shows, never who the user "is". The
 * archetype nouns are the ones the original plan idea floated (and their
 * generic class), locked out so a future edit can't drift back.
 */
const IDENTITY_BANNED = [
  /\byou are an?\b/i,
  /\byou're an?\b/i,
  /\bpersonality\b/i,
  /\barchetype\b/i,
  /\bmoney type\b/i,
  /\btype of (person|saver|spender)\b/i,
  /\bcushion.builder\b/i,
  /\bedge.walker\b/i,
  /\bspender\b/i,
  /\bsaver\b/i, // "steady saver" as a NOUN label is identity; habit copy says "saving is a steady habit"
  /\bpersona\b/i,
];

describe('money-signature copy — habit framing, never identity', () => {
  it.each(SIGNATURE_STRINGS.map((s) => [s.label, s] as const))('%s: no identity framing', (_, s) => {
    for (const banned of IDENTITY_BANNED) {
      expect(s.text, `"${s.text}" must not match ${banned}`).not.toMatch(banned);
    }
  });

  it('every labeled axis line carries the fact it is read from', () => {
    // steady/variable/mixed saving lines carry "N of your last M full months"
    expect(COACH_COPY.signatureSavingSteady(10, 12, 'Aug 2025')).toContain('10 of your last 12 full months');
    expect(COACH_COPY.signatureSavingVariable(4, 12)).toContain('4 of your last 12 full months');
    expect(COACH_COPY.signatureSavingMixed(8, 12)).toContain('8 of your last 12 full months');
    // steadiness lines carry the spread percentage and its median basis
    expect(COACH_COPY.signatureSteadinessSteady(450)).toContain('4.5%');
    expect(COACH_COPY.signatureSteadinessSteady(450)).toContain('median');
    expect(COACH_COPY.signatureSteadinessVariable(3333)).toContain('33.3%');
  });

  it('test_regression__signature-with-income-qualifier (critic P1-2): every month-count line carries it', () => {
    // The eligible window SKIPS no-income months, so "your last N full months"
    // without "with income" is false whenever such months sit inside the span.
    for (const text of [
      COACH_COPY.signatureSavingSteady(10, 12, 'Aug 2025'),
      COACH_COPY.signatureSavingVariable(4, 12),
      COACH_COPY.signatureSavingMixed(8, 12),
      COACH_COPY.signatureSavingShiftingFromSteady(5, 12, 'Jun 2025'),
      COACH_COPY.signatureSavingShiftingFromVariable(10, 12),
    ]) {
      expect(text).toContain('full months with income');
    }
  });

  it('test_regression__signature-shifting-copy (critic P1-1): lag-honest lines never assert the lagged label as current', () => {
    const fromSteady = COACH_COPY.signatureSavingShiftingFromSteady(5, 12, 'Jun 2025');
    expect(fromSteady).toContain('had been'); // past tense, not "is"
    expect(fromSteady).toContain('recent months look different');
    expect(fromSteady).toContain('5 of your last 12 full months with income');
    expect(fromSteady).toContain('3 months in a row');
    const steadinessFromSteady = COACH_COPY.signatureSteadinessShiftingFromSteady(5000);
    expect(steadinessFromSteady).toContain('had been');
    expect(steadinessFromSteady).toContain('50.0%');
    expect(steadinessFromSteady).not.toContain('runs steady');
  });

  it('the unreadable-window line never claims missing history (critic P2-1)', () => {
    const text = COACH_COPY.signatureSteadinessUnreadable(6);
    expect(text).toContain('no recorded spending');
    expect(text).not.toContain('needs');
    expect(text).not.toContain('history');
  });

  it('runway of exactly 1 renders "1 month", not "1 months" (critic P2-4)', () => {
    // runway 1 is reachable only as 'tight' (strained is strict <1)
    expect(COACH_COPY.signatureWeather('tight', 1, 500, 'May 2026')).toContain('about 1 month of');
    expect(COACH_COPY.signatureWeather('tight', 1, 500, 'May 2026')).not.toContain('1 months');
  });

  it('the steady-habit line disclosed its persistence anchor (since month)', () => {
    expect(COACH_COPY.signatureSavingSteady(10, 12, 'Aug 2025')).toContain('Aug 2025');
  });

  it('the basis line discloses the 3-month persistence rule and weather scope', () => {
    const basis = COACH_COPY.signatureBasis();
    expect(basis).toContain('3 months in a row');
    expect(basis).toContain('only about this month');
  });

  it('weather lines state the cushion basis inline (cash ÷ 6-month average)', () => {
    for (const state of ['strained', 'tight', 'calm', 'bright'] as const) {
      expect(COACH_COPY.signatureWeather(state, 2.5, 500, 'May 2026')).toContain(
        'cash ÷ your 6-month average expenses',
      );
    }
  });

  it('infinite runway never renders "Infinity"', () => {
    const text = COACH_COPY.signatureWeather('calm', Infinity, null, null);
    expect(text).not.toContain('Infinity');
    expect(text).toContain('no recorded average expenses');
  });

  it('the tight-negative variant names the month whose spending outpaced income', () => {
    expect(COACH_COPY.signatureWeather('tight', 5.1, -800, 'May 2026')).toContain('May 2026');
  });
});
