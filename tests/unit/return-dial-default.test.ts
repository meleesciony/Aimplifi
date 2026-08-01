/**
 * W.13 — the return dial's possessive rests on ONE equality, so that equality is asserted here
 * rather than assumed by six sentences on three cards.
 *
 * `User.expectedReturnBps` is `Int @default(700)` and NOT nullable, and the /settings field is
 * required, so there is no stored "unset" to read the way `inflationIsDefault` reads a null
 * column. The copy therefore decides ownership by value: `expectedReturnBps === 700` means the
 * number is the one Aimplifi picked. If the schema default ever moves and
 * `DEFAULT_EXPECTED_RETURN_BPS` does not, every reader on the NEW default would be told that
 * rate is "your return assumption" — the exact false claim this slice removed — and nothing
 * else in the build would notice, because both halves typecheck perfectly.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';
import type { Opportunity } from '@/lib/engine/fi/insights';
import { cents } from '@/lib/money';
import {
  DEFAULT_EXPECTED_RETURN_BPS,
  DIAL_LIMITS,
  returnIsAppDefault,
} from '@/lib/engine/settings/dials';

describe('W.13 — the constant the possessive rests on', () => {
  it('matches the @default the database actually writes', () => {
    const schema = readFileSync(join(process.cwd(), 'prisma', 'schema.prisma'), 'utf8');
    const line = schema
      .split('\n')
      .find((l) => /^\s*expectedReturnBps\s+Int/.test(l));
    expect(line, 'expectedReturnBps is missing from prisma/schema.prisma').toBeDefined();
    const match = /@default\((\d+)\)/.exec(line as string);
    expect(match, `expectedReturnBps has no @default: ${line}`).not.toBeNull();
    expect(Number((match as RegExpExecArray)[1])).toBe(DEFAULT_EXPECTED_RETURN_BPS);
    // And the column must still be non-nullable — the day it becomes `Int?`, "null means the
    // reader never chose" becomes readable and value-equality stops being the right rule (it
    // would go on calling a deliberately-chosen 7.00% ours for no reason).
    expect(line as string).not.toMatch(/Int\?/);
  });

  it('is a value the reader is allowed to type, which is what makes the error one-directional', () => {
    // The whole known imprecision: a reader who types exactly 7 lands in the "our default"
    // branch and no column can tell them apart. That is deliberate and it is the SAFE
    // direction — the sentence claims only that 7.00% is our default, never that they have not
    // changed it. Pinned so the trade-off cannot be forgotten and re-litigated as a bug.
    expect(DEFAULT_EXPECTED_RETURN_BPS).toBeGreaterThanOrEqual(DIAL_LIMITS.expectedReturnBps.min);
    expect(DEFAULT_EXPECTED_RETURN_BPS).toBeLessThanOrEqual(DIAL_LIMITS.expectedReturnBps.max);
    expect(returnIsAppDefault(DEFAULT_EXPECTED_RETURN_BPS)).toBe(true);
    expect(returnIsAppDefault(DEFAULT_EXPECTED_RETURN_BPS + 25)).toBe(false);
    expect(returnIsAppDefault(0)).toBe(false);
  });

  it('is non-zero, which is the only thing keeping one possessive on /coach true', () => {
    // `COACH_COPY.opportunity` still says "assuming your 0.00% return assumption" and was left
    // alone: that branch is `nominalReturnBps === 0`, so a reader who never chose a return can
    // only reach it if the app's own default were 0. The sentence is guarded by arithmetic
    // rather than by a flag, and this is where the arithmetic is checked.
    expect(DEFAULT_EXPECTED_RETURN_BPS).not.toBe(0);
    const row: Opportunity = {
      kind: 'unused-subscription',
      merchant: 'LA Fitness',
      monthlyCents: cents(3499),
      todayValue10Cents: cents(605000),
      todayValue20Cents: cents(1350000),
      todayValue30Cents: cents(2260000),
      isEstimate: false,
    };
    expect(COACH_COPY.opportunity(row, 0)).toContain('your 0.00% return assumption');
    expect(COACH_COPY.opportunity(row, DEFAULT_EXPECTED_RETURN_BPS)).not.toContain(
      'return assumption',
    );
  });
});
