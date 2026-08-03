/**
 * O.16 — the reader's PLACE survives a row action.
 *
 * Owner, 2026-07-30: *"Can you add away to go back to what we were doing after
 * let's say changing a rule? Right now I have to click activity again and needs
 * category"*. He works the register filtered to "Needs a category"
 * (`?unclassified=1`), opens a rule from a row, saves, and the filter is gone.
 *
 * What is under test is NOT "a param is appended". It is the pair of properties
 * that make the affordance safe to render at all:
 *
 *   1. The destination can only ever be this app's register. `?back=` arrives
 *      from the URL bar, so it is attacker-controllable; the builder must not be
 *      able to express an external host no matter what it is handed.
 *   2. The affordance never describes a view the reader did not come from.
 *      A "Back to Needs a category" link that lands on the unfiltered register
 *      is a false claim about his own history, and it is worse than no link,
 *      because he will stop checking.
 *
 * Both are asserted as INVARIANTS over hostile inputs rather than as a handful
 * of happy-path strings, since the failure mode here is a value nobody thought
 * to type.
 */
import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_RETURN_SENTINEL,
  RETURN_PARAM,
  activityReturnFromBack,
  decodeRegisterReturn,
  withRegisterReturn,
} from '@/lib/engine/transactions/links';

/** A `?back=` value and why it is dangerous. */
const HOSTILE_RETURNS: ReadonlyArray<readonly [raw: string, why: string]> = [
  ['https://evil.example', 'an absolute URL — the classic open redirect'],
  ['//evil.example', 'a protocol-relative URL, which browsers treat as absolute'],
  ['http://evil.example/transactions?unclassified=1', 'an external host wearing our own path'],
  ['/settings', 'an internal path that is not the register'],
  ['javascript:alert(1)', 'a script URL'],
  ['../../etc/passwd', 'path traversal'],
  ['%2F%2Fevil.example', 'a percent-encoded protocol-relative URL'],
  ['\\\\evil.example', 'backslashes, which some parsers normalise to slashes'],
];

describe('decodeRegisterReturn — the destination is closed by construction', () => {
  it.each(HOSTILE_RETURNS)('refuses to leave the register for %s (%s)', (raw) => {
    const result = decodeRegisterReturn(raw);
    // Either it decodes to nothing at all, or — if some fragment of it happened
    // to parse as a query — the href is still rooted at our own register.
    if (result !== null) {
      expect(result.href.startsWith('/transactions?')).toBe(true);
    }
  });

  it('never returns an href outside /transactions, for ANY input', () => {
    const inputs = [
      ...HOSTILE_RETURNS.map(([raw]) => raw),
      'unclassified=1',
      'q=costco&page=3',
      'from=2026-01-01&to=2026-01-31',
      '',
      'a=b&c=d',
    ];
    for (const raw of inputs) {
      const result = decodeRegisterReturn(raw);
      if (result === null) continue;
      expect(result.href.startsWith('/transactions?')).toBe(true);
    }
  });

  it('says nothing when there is nothing to say', () => {
    expect(decodeRegisterReturn(undefined)).toBeNull();
    expect(decodeRegisterReturn(null)).toBeNull();
    expect(decodeRegisterReturn('')).toBeNull();
    // Every key is unknown to the register, so there is no view to return to.
    expect(decodeRegisterReturn('foo=bar&utm_source=x')).toBeNull();
  });
});

describe('decodeRegisterReturn — the label describes the landing', () => {
  it("names the owner's own queue", () => {
    const result = decodeRegisterReturn('unclassified=1');
    expect(result).not.toBeNull();
    expect(result!.href).toBe('/transactions?unclassified=1');
    expect(result!.label).toBe('Needs a category');
  });

  it('treats page as a position within a view, not another filter', () => {
    // Page 3 of the needs-a-category queue is still the needs-a-category queue,
    // and the page number is what makes the return an actual return.
    const result = decodeRegisterReturn('unclassified=1&page=3');
    expect(result!.label).toBe('Needs a category');
    expect(result!.href).toBe('/transactions?unclassified=1&page=3');
  });

  it('does not call an unfiltered page "filtered"', () => {
    // Page 7 of everything is a place worth returning to, but he narrowed
    // nothing — claiming otherwise describes a view he never built.
    const result = decodeRegisterReturn('page=7');
    expect(result!.href).toBe('/transactions?page=7');
    expect(result!.label).toBe('your activity list');
  });

  it('stops naming a single filter once a second axis narrows the view', () => {
    // "Needs a category" over a view also narrowed to one merchant describes a
    // bigger set than he will land on.
    const result = decodeRegisterReturn('unclassified=1&merchant=Costco');
    expect(result!.label).toBe('your filtered activity');
  });

  it.each([
    ['reimb=awaiting', 'Awaiting reimbursement'],
    ['reimb=received', 'Reimbursement received'],
  ])('names %s', (raw, label) => {
    expect(decodeRegisterReturn(raw)!.label).toBe(label);
  });

  it('drops a value the register itself would ignore, rather than calling it a filter', () => {
    // The register falls back to "no filter" on an unknown `reimb`, so carrying
    // it would land on the UNFILTERED list under a label claiming otherwise.
    expect(decodeRegisterReturn('reimb=bogus')).toBeNull();
    expect(decodeRegisterReturn('unclassified=yes')).toBeNull();
    expect(decodeRegisterReturn('type=sideways')).toBeNull();
    expect(decodeRegisterReturn('page=-4')).toBeNull();
    expect(decodeRegisterReturn('page=abc')).toBeNull();
  });

  it('keeps a valid value beside a dropped one', () => {
    const result = decodeRegisterReturn('unclassified=1&reimb=bogus');
    expect(result!.href).toBe('/transactions?unclassified=1');
    expect(result!.label).toBe('Needs a category');
  });
});

describe('withRegisterReturn — attaching the place on the way out', () => {
  it('carries the filter out to the rules page', () => {
    const href = withRegisterReturn('/rules?from=txn_1', 'unclassified=1');
    expect(href).toBe(`/rules?from=txn_1&${RETURN_PARAM}=unclassified%3D1`);
  });

  it('round-trips: what is attached is what comes back', () => {
    const query = 'q=costco&unclassified=1&page=2';
    const href = withRegisterReturn('/rules?from=txn_1', query);
    const raw = new URL(href, 'https://example.test').searchParams.get(RETURN_PARAM);
    const back = decodeRegisterReturn(raw);
    expect(back!.href).toBe('/transactions?q=costco&unclassified=1&page=2');
  });

  it('inserts before a fragment instead of pasting inside it', () => {
    // `renameHref` is `/rules?from=<id>#kw-rename`. Appending to the end puts the
    // param INSIDE the fragment: the page sees no return context and the anchor
    // no longer resolves.
    const href = withRegisterReturn('/rules?from=txn_1#kw-rename', 'unclassified=1');
    expect(href).toBe(`/rules?from=txn_1&${RETURN_PARAM}=unclassified%3D1#kw-rename`);
    const url = new URL(href, 'https://example.test');
    expect(url.hash).toBe('#kw-rename');
    expect(decodeRegisterReturn(url.searchParams.get(RETURN_PARAM))!.label).toBe('Needs a category');
  });

  it('uses ? when the destination has no query of its own', () => {
    const href = withRegisterReturn('/transactions/txn_1', 'unclassified=1');
    expect(href).toBe(`/transactions/txn_1?${RETURN_PARAM}=unclassified%3D1`);
  });

  it('attaches the Activity sentinel when the reader narrowed nothing', () => {
    // Without a sentinel, `/rules?from=<id>` looks like "he was on that row"
    // and Return dumps him on one transaction after months of Activity review.
    const expected = `/rules?from=txn_1&${RETURN_PARAM}=${ACTIVITY_RETURN_SENTINEL}`;
    expect(withRegisterReturn('/rules?from=txn_1', '')).toBe(expected);
    expect(withRegisterReturn('/rules?from=txn_1', null)).toBe(expected);
    expect(withRegisterReturn('/rules?from=txn_1', 'utm_source=email')).toBe(expected);
  });

  it('decodes the Activity sentinel to bare Activity', () => {
    expect(decodeRegisterReturn(ACTIVITY_RETURN_SENTINEL)).toEqual({
      href: '/transactions',
      label: 'Activity',
    });
    expect(activityReturnFromBack(undefined)).toEqual({
      href: '/transactions',
      label: 'Activity',
    });
  });

  it('does not let the register date bound collide with the rule source id', () => {
    // The register spells a date `?from=YYYY-MM-DD`; /rules spells a transaction
    // `?from=<id>`. Flattening would make one overwrite the other.
    const href = withRegisterReturn('/rules?from=txn_1', 'from=2026-01-01&to=2026-01-31');
    const url = new URL(href, 'https://example.test');
    expect(url.searchParams.get('from')).toBe('txn_1');
    expect(decodeRegisterReturn(url.searchParams.get(RETURN_PARAM))!.href).toBe(
      '/transactions?from=2026-01-01&to=2026-01-31',
    );
  });

  it('survives a merchant name full of URL metacharacters', () => {
    const query = new URLSearchParams({ merchant: 'Barnes & Noble #1' }).toString();
    const href = withRegisterReturn('/rules?from=txn_1', query);
    const url = new URL(href, 'https://example.test');
    // The `&` and `#` must not escape into the outer URL and truncate it.
    expect(url.searchParams.get('from')).toBe('txn_1');
    expect(url.hash).toBe('');
    const back = decodeRegisterReturn(url.searchParams.get(RETURN_PARAM));
    expect(new URL(back!.href, 'https://example.test').searchParams.get('merchant')).toBe(
      'Barnes & Noble #1',
    );
  });
});
