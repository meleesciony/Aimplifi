/**
 * `monthRegisterHref` — the link under a bar on the /reports chart.
 *
 * Its siblings each have a lock of their own (`category-register-links`,
 * `merchant-register-links`) for the same reason: a builder can produce a
 * perfectly-formed URL whose PARAM NAMES the register does not read, and every
 * such link returns HTTP 200 while filtering nothing. So the assertions here are
 * about the exact keys `transactions/page.tsx` parses, not about the string
 * looking plausible.
 *
 * The second thing pinned here is the deliberate NARROWNESS: this builder adds
 * no `type` filter. That is not an oversight — `type=expense` is `amountCents < 0`,
 * which drops the refunds the spending bar netted against itself and keeps the
 * pending rows the bar never counted. The test asserts the absence, so removing
 * the restraint means deleting an assertion that explains why it is there.
 */
import { describe, expect, it } from 'vitest';
import { monthRegisterHref } from '@/lib/engine/transactions/links';

/** The keys `transactions/page.tsx` reads, as of this commit. */
const READ_BY_REGISTER = new Set([
  'q',
  'account',
  'category',
  'merchant',
  'type',
  'from',
  'to',
  'unclassified',
  'reimb',
  'page',
]);

const paramsOf = (href: string) => new URLSearchParams(href.slice(href.indexOf('?') + 1));

describe('monthRegisterHref', () => {
  it('lands on the register, windowed to the whole calendar month', () => {
    const p = paramsOf(monthRegisterHref('2026-06'));
    expect(monthRegisterHref('2026-06').startsWith('/transactions?')).toBe(true);
    expect(p.get('from')).toBe('2026-06-01');
    expect(p.get('to')).toBe('2026-06-30');
  });

  it('uses only param names the register actually reads', () => {
    for (const key of paramsOf(monthRegisterHref('2026-06')).keys()) {
      expect(READ_BY_REGISTER.has(key), `register does not read "${key}"`).toBe(true);
    }
  });

  it('adds NO type filter — one half of a month is not expressible as one', () => {
    // Deliberate. See the docblock: `type=expense` would silently change which
    // rows the destination shows relative to the bar the reader tapped.
    expect(paramsOf(monthRegisterHref('2026-06')).get('type')).toBeNull();
    expect(paramsOf(monthRegisterHref('2026-06')).get('category')).toBeNull();
  });

  it('ends the window on the real last day, including a leap February', () => {
    expect(paramsOf(monthRegisterHref('2024-02')).get('to')).toBe('2024-02-29');
    expect(paramsOf(monthRegisterHref('2026-02')).get('to')).toBe('2026-02-28');
    expect(paramsOf(monthRegisterHref('2026-01')).get('to')).toBe('2026-01-31');
    expect(paramsOf(monthRegisterHref('2026-04')).get('to')).toBe('2026-04-30');
  });

  it('every month of a year produces a from/to inside that same month', () => {
    for (let m = 1; m <= 12; m++) {
      const month = `2026-${String(m).padStart(2, '0')}`;
      const p = paramsOf(monthRegisterHref(month));
      expect(p.get('from')).toBe(`${month}-01`);
      expect(p.get('to')!.startsWith(`${month}-`)).toBe(true);
    }
  });
});
