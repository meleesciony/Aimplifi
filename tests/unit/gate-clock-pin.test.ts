/**
 * K.8 regression lock — the unit gate runs on a PINNED clock, not the ambient machine.
 *
 * Before this, `businessToday()` fell through to the real wall clock locally (vitest does
 * not load .env) while CI declared DEMO_TODAY as a job-level env var — so the same commit
 * was "6,167 passed" on the maintainer's machine and "4 failed" on every CI run for days,
 * and any unpinned test's verdict drifted with the calendar. The pin lives in
 * vitest.config.ts (process.env + test.env, unconditional); this file is the tripwire
 * that makes removing or changing it loud. Honest scope (critic-verified): it fires when
 * BOTH redundant mechanisms (process.env assignment and test.env mirror) are removed, or
 * when the pinned values change; deleting only one of the two is invisible here (and
 * currently changes nothing on the forks pool). On CI the DEMO_TODAY half is additionally
 * satisfied by verify.yml's job-level env, so a deleted config pin is caught there only
 * by the TZ assertions — every OTHER machine catches both.
 *
 * The literals here are hardcoded ON PURPOSE — importing a shared constant from the config
 * would let both drift together silently, which is the defect this file exists to catch.
 * If the pin is deliberately changed, change it here in the same commit and say why.
 *
 * No `vi.stubEnv` in this file, also on purpose: it asserts what the GATE provides, and a
 * stub would make it assert its own arrangement.
 */
import { describe, expect, it } from 'vitest';

import { businessToday } from '@/lib/business-today';

describe('test_regression__unit-gate-clock-is-pinned (K.8)', () => {
  it('DEMO_TODAY reaches every worker, and businessToday answers with it', () => {
    expect(process.env.DEMO_TODAY).toBe('2026-06-10');
    // A real (non-demo) user id: without the pin this is the machine's wall clock and the
    // assertion goes red the moment the config pin is deleted.
    expect(businessToday('some-real-user-id')).toBe('2026-06-10');
    // No argument at all — the other common call shape.
    expect(businessToday()).toBe('2026-06-10');
  });

  it('the gate timezone is UTC, matching the CI runner', () => {
    expect(process.env.TZ).toBe('UTC');
    // Not just the env var — Date must actually be operating in UTC in this worker.
    expect(new Date().getTimezoneOffset()).toBe(0);
  });
});
