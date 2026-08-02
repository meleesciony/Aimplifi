/**
 * W.7 / DECISIONS #383 — Fixed / Discretionary headings deep-link into the
 * register with a Class filter the destination's own control can DISPLAY.
 */
import { describe, expect, it } from 'vitest';
import {
  decodeRegisterReturn,
  spendClassMonthRegisterHref,
  withRegisterReturn,
} from '@/lib/engine/transactions/links';

describe('spendClassMonthRegisterHref (W.7)', () => {
  it('names spendClass + the month window the register reads', () => {
    expect(
      spendClassMonthRegisterHref({
        spendClass: 'fixed',
        month: '2026-06',
        amountCents: 316196,
      }),
    ).toBe('/transactions?spendClass=fixed&from=2026-06-01&to=2026-06-30');
    expect(
      spendClassMonthRegisterHref({
        spendClass: 'guilt-free',
        month: '2026-07',
        amountCents: 0,
      }),
    ).toBe('/transactions?spendClass=guilt-free&from=2026-07-01&to=2026-07-31');
  });

  it('always returns a string — both classes are displayable on the register', () => {
    // Unlike categoryRegisterHref, there is no null refusal: the Class <select>
    // can show Fixed and Discretionary for every reader.
    expect(
      typeof spendClassMonthRegisterHref({
        spendClass: 'fixed',
        month: '2026-06',
        amountCents: 1,
      }),
    ).toBe('string');
  });

  it('survives the return-trip builder (O.16) so Back lands on the same Class filter', () => {
    const href = spendClassMonthRegisterHref({
      spendClass: 'fixed',
      month: '2026-06',
      amountCents: 1,
    });
    const query = href.split('?')[1]!;
    const leaving = withRegisterReturn('/rules', query);
    const back = new URLSearchParams(leaving.split('?')[1]).get('back');
    const decoded = decodeRegisterReturn(back);
    // pickRegisterParams reorders into REGISTER_VIEW_PARAMS order — compare
    // the filter axes, not the builder's original param order.
    const got = new URLSearchParams(decoded!.href.split('?')[1]);
    expect(got.get('spendClass')).toBe('fixed');
    expect(got.get('from')).toBe('2026-06-01');
    expect(got.get('to')).toBe('2026-06-30');
    expect(decoded?.label).toBe('your filtered activity'); // spendClass + from + to = multi-axis
  });
});
