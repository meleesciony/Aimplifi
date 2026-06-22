/**
 * businessToday resolver (DECISIONS #58) — the single sanctioned wall-clock read.
 * Known-answer: DEMO_TODAY pin wins; the seeded demo user stays on the seed date;
 * every real user gets the REAL clock (the fix for the frozen-date production bug).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { businessToday } from '@/lib/business-today';

const DEMO_USER_ID = 'user-demo'; // src/auth.config.ts
const SEED_AS_OF = '2026-06-10'; // DEFAULT_AS_OF, src/lib/seed/build.ts

function realClockExpected(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

afterEach(() => vi.unstubAllEnvs());

describe('businessToday', () => {
  it('honors the DEMO_TODAY pin for everyone (tests/explicit demo)', () => {
    vi.stubEnv('DEMO_TODAY', '2026-03-15');
    expect(businessToday('any-real-user')).toBe('2026-03-15');
    expect(businessToday(DEMO_USER_ID)).toBe('2026-03-15');
    expect(businessToday()).toBe('2026-03-15');
  });

  it('pins the seeded demo user to the seed date when DEMO_TODAY is unset', () => {
    vi.stubEnv('DEMO_TODAY', ''); // unset → falsy
    expect(businessToday(DEMO_USER_ID)).toBe(SEED_AS_OF);
  });

  it('gives a REAL signed-up user the real clock (not the frozen seed date)', () => {
    vi.stubEnv('DEMO_TODAY', '');
    const got = businessToday('real-user-abc');
    expect(got).toBe(realClockExpected());
    expect(got).not.toBe(SEED_AS_OF); // would be the old bug
    expect(got).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('defaults to the real clock when no userId is given (non-demo)', () => {
    vi.stubEnv('DEMO_TODAY', '');
    expect(businessToday()).toBe(realClockExpected());
  });
});
