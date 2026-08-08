/**
 * C.15 (audit F1/F2/F3) — a TRANSACTION or a named page as the return
 * destination: the O.16 construction, one hop deeper.
 *
 * The owner's 2026-08-02 audit found the return affordance "quite clunky":
 * a figure drilled on /dashboard, /triage, /budgets, /reports or /trends
 * opened a transaction detail whose way back said "Activity" — the reader's
 * PLACE was structurally inexpressible. F1: a detail destination could not be
 * expressed at all; F2: the detail view's split-parent link was bare; F3: the
 * four entry points handed the detail page no context.
 *
 * What is under test is the same PAIR of properties the O.16 lock asserts,
 * moved one hop deeper:
 *
 *   1. The destination can only ever be one of this module's literal paths.
 *      `?back=` arrives from the URL bar, so it is attacker-controllable; the
 *      transaction decoder must not be able to express a path, only an id, and
 *      the named-page decoder must not be able to express a path at all, only
 *      a token the closed `PAGE_RETURNS` table admits.
 *   2. A forwarded `?back=` is forwarded ONLY when it decodes. A second-hop
 *      link that laundered a failed decode would carry a value no decoder can
 *      read — dead context, indistinguishable from lost context. Everything
 *      else collapses to the Activity sentinel, which every decoder reads.
 *
 * Both are asserted as INVARIANTS over hostile inputs, not as a handful of
 * happy-path strings, since the failure mode here is a value nobody thought
 * to type.
 */
import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_RETURN_SENTINEL,
  PAGE_RETURNS,
  RETURN_PARAM,
  decodeNamedPageReturn,
  decodeRegisterReturn,
  decodeTransactionReturn,
  forwardableBack,
  namedPageBack,
  returnFromBack,
  withForwardedReturn,
  type PageReturnToken,
} from '@/lib/engine/transactions/links';

/**
 * Ids are verified against the live database, not guessed from Prisma's
 * generator: a real row is `cmqvrv3hd0025j0cu9gvo2zor` (cuid, `c` + 24
 * lowercase alphanumerics) and a demo seed row is `txn-00001` — both must
 * survive, or one population dead-links silently.
 */
const CUID_ID = 'cmqvrv3hd0025j0cu9gvo2zor';
const DEMO_ID = 'txn-00001';

/** A `?back=` value and why it is dangerous. */
const HOSTILE_RETURNS: ReadonlyArray<readonly [raw: string, why: string]> = [
  ['https://evil.example', 'an absolute URL — the classic open redirect'],
  ['//evil.example', 'a protocol-relative URL, which browsers treat as absolute'],
  ['http://evil.example/transactions/abc', 'an external host wearing our own path'],
  ['javascript:alert(1)', 'a script URL'],
  ['../../etc/passwd', 'path traversal'],
  ['%2F%2Fevil.example', 'a percent-encoded protocol-relative URL'],
  ['\\\\evil.example', 'backslashes, which some parsers normalise to slashes'],
  ['/transactions/abc', 'a path — the caller may name an id, never a path'],
  ['settings?q=x', 'an id followed by a query — `?` must not split the id off'],
  ['a#frag', 'a fragment in the id — `#` must not survive into the href'],
  ['a.b', 'dot-segments, which would resolve `..` against the literal path'],
];

describe('decodeTransactionReturn — the destination is closed by construction', () => {
  it.each(HOSTILE_RETURNS)('refuses to leave the literal path for %s (%s)', (raw) => {
    expect(decodeTransactionReturn(raw)).toBeNull();
  });

  it('refuses every id-shaped escape', () => {
    for (const raw of [
      'UPPERCASE',
      'with space',
      'with%20encoding',
      'back\\slash',
      'trailing/',
      '-leading-dash', // the first char class is [a-z0-9]
      '', // covered again explicitly below
    ]) {
      expect(decodeTransactionReturn(raw), raw).toBeNull();
    }
  });

  it('says nothing when there is nothing to say', () => {
    expect(decodeTransactionReturn(undefined)).toBeNull();
    expect(decodeTransactionReturn(null)).toBeNull();
    expect(decodeTransactionReturn('')).toBeNull();
  });

  it('decodes BOTH id shapes that actually sit in the database', () => {
    for (const id of [CUID_ID, DEMO_ID]) {
      const result = decodeTransactionReturn(id);
      expect(result).toEqual({ href: `/transactions/${id}`, label: 'the transaction' });
    }
  });

  it('never returns an href outside `/transactions/<id>` for ANY input', () => {
    // Whatever fragment of a hostile value parsed, the href is still the
    // literal path plus exactly the caller's raw token — the id cannot escape.
    const inputs = [...HOSTILE_RETURNS.map(([raw]) => raw), CUID_ID, DEMO_ID];
    for (const raw of inputs) {
      const result = decodeTransactionReturn(raw);
      if (result === null) continue;
      expect(result.href.startsWith(`/transactions/${raw}`)).toBe(true);
    }
  });
});

describe('decodeNamedPageReturn — tokens are a closed vocabulary', () => {
  it.each(Object.entries(PAGE_RETURNS) as Array<[PageReturnToken, { path: string; label: string }]>)(
    'round-trips the %s token (path %s)',
    (token, { path, label }) => {
      const result = decodeNamedPageReturn(namedPageBack(token, null));
      expect(result).toEqual({ href: path, label });
    },
  );

  it('carries the page\'s own query through to the literal path', () => {
    const result = decodeNamedPageReturn(namedPageBack('reports', 'month=2026-06'));
    expect(result).toEqual({ href: '/reports?month=2026-06', label: 'your reports' });
  });

  it('never builds a path from the caller — hostile queries stay inert', () => {
    // The query is appended to the TABLE's literal path; `next` is a value the
    // target page ignores, exactly as the register ignores an unlisted key.
    const result = decodeNamedPageReturn('_reports?next=//evil.example');
    expect(result!.href.startsWith('/reports?')).toBe(true);
    expect(decodeNamedPageReturn('_settings')).toBeNull();
    expect(decodeNamedPageReturn('_REPORTS')).toBeNull();
    expect(decodeNamedPageReturn('_activity')).toBeNull(); // the register's sentinel, deliberately absent
  });

  it('says nothing when there is nothing to say', () => {
    expect(decodeNamedPageReturn(undefined)).toBeNull();
    expect(decodeNamedPageReturn(null)).toBeNull();
    expect(decodeNamedPageReturn('')).toBeNull();
    expect(decodeNamedPageReturn('reports')).toBeNull(); // no `_` prefix
  });
});

describe('the three encodings are mutually disjoint — decode order cannot launder', () => {
  it('no transaction id can parse as a register query or a named token', () => {
    expect(decodeTransactionReturn('unclassified=1')).toBeNull(); // `=` is not in the charset
    expect(decodeTransactionReturn('_triage')).toBeNull(); // `_` fails the first char class
    expect(decodeRegisterReturn('txn-00001')).toBeNull(); // no `=` pairs
    expect(decodeNamedPageReturn('txn-00001')).toBeNull();
  });
});

describe('returnFromBack — the detail page\'s ONE source of "Return to …"', () => {
  it('names a register view, a transaction, a named page, or honest Activity', () => {
    expect(returnFromBack('unclassified=1')).toEqual({
      href: '/transactions?unclassified=1',
      label: 'Needs a category',
    });
    expect(returnFromBack(DEMO_ID)).toEqual({
      href: `/transactions/${DEMO_ID}`,
      label: 'the transaction',
    });
    expect(returnFromBack('_dashboard')).toEqual({
      href: '/dashboard',
      label: 'your dashboard',
    });
    expect(returnFromBack(ACTIVITY_RETURN_SENTINEL)).toEqual({
      href: '/transactions',
      label: 'Activity',
    });
  });

  it('falls back to Activity rather than inventing a label', () => {
    // `garbage` is deliberately NOT here: it is a pattern-valid id and decodes
    // to /transactions/garbage, whose detail page answers its own not-found —
    // the caller names an id, never a path (see TRANSACTION_ID_PATTERN).
    for (const raw of ['https://evil.example', '_settings', 'with space']) {
      expect(returnFromBack(raw), raw).toEqual({ href: '/transactions', label: 'Activity' });
    }
    expect(returnFromBack(undefined)).toEqual({ href: '/transactions', label: 'Activity' });
  });
});

describe('forwardableBack — the waypoint gate for second-hop links', () => {
  it.each([
    ['unclassified=1', 'a register view'],
    ['q=costco&page=3', 'a filtered register'],
    [ACTIVITY_RETURN_SENTINEL, 'the Activity sentinel'],
    [CUID_ID, 'a transaction id'],
    ['_triage', 'a bare named token'],
    ['_reports?month=2026-06', 'a named token with the page\'s own query'],
  ])('forwards %s (%s) verbatim', (raw) => {
    expect(forwardableBack(raw)).toBe(raw);
  });

  it('collapses everything that fails every decode to the Activity sentinel', () => {
    for (const raw of [undefined, null, '', 'https://evil.example', '_settings', 'garbage words']) {
      expect(forwardableBack(raw), String(raw)).toBe(ACTIVITY_RETURN_SENTINEL);
    }
  });
});

describe('withForwardedReturn — attaching the place on the way out of a transaction', () => {
  it('attaches a named-page token', () => {
    const href = withForwardedReturn(`/transactions/${DEMO_ID}`, '_triage');
    expect(href).toBe(`/transactions/${DEMO_ID}?${RETURN_PARAM}=_triage`);
  });

  it('attaches a register query with the register\'s own encoding', () => {
    // Byte-identical to what withRegisterReturn produces for the same query —
    // the two encoders share the register encoding.
    const href = withForwardedReturn(`/transactions/${DEMO_ID}`, 'unclassified=1');
    expect(href).toBe(`/transactions/${DEMO_ID}?${RETURN_PARAM}=unclassified%3D1`);
    const raw = new URL(href, 'https://example.test').searchParams.get(RETURN_PARAM);
    expect(decodeRegisterReturn(raw)!.label).toBe('Needs a category');
  });

  it('round-trips a transaction id: what is attached is what comes back', () => {
    const href = withForwardedReturn('/rules?from=txn_1', CUID_ID);
    const raw = new URL(href, 'https://example.test').searchParams.get(RETURN_PARAM);
    expect(decodeTransactionReturn(raw)!.href).toBe(`/transactions/${CUID_ID}`);
  });

  it('round-trips a named page with its query', () => {
    const href = withForwardedReturn('/transactions/x', namedPageBack('trends', 'window=6m'));
    const raw = new URL(href, 'https://example.test').searchParams.get(RETURN_PARAM);
    expect(decodeNamedPageReturn(raw)).toEqual({
      href: '/trends?window=6m',
      label: 'your trends',
    });
  });

  it('inserts before a fragment instead of pasting inside it', () => {
    // The rename link is `/rules?from=<id>#kw-rename`; a param appended to the
    // end lands INSIDE the fragment and the page sees no return context.
    const href = withForwardedReturn('/rules?from=txn_1#kw-rename', '_triage');
    expect(href).toBe(`/rules?from=txn_1&${RETURN_PARAM}=_triage#kw-rename`);
    const url = new URL(href, 'https://example.test');
    expect(url.hash).toBe('#kw-rename');
    expect(decodeNamedPageReturn(url.searchParams.get(RETURN_PARAM))!.label).toBe(
      'the triage inbox',
    );
  });

  it('uses ? when the destination has no query of its own', () => {
    const href = withForwardedReturn(`/transactions/${DEMO_ID}`, '_dashboard');
    expect(href).toBe(`/transactions/${DEMO_ID}?${RETURN_PARAM}=_dashboard`);
  });

  it('collapses a hostile value to the Activity sentinel — no laundering', () => {
    // The gate lives INSIDE the encoder: a second-hop link carrying a failed
    // decode would deliver dead context, indistinguishable from lost context.
    const expected = `/transactions/${DEMO_ID}?${RETURN_PARAM}=${ACTIVITY_RETURN_SENTINEL}`;
    expect(withForwardedReturn(`/transactions/${DEMO_ID}`, 'https://evil.example')).toBe(expected);
    expect(withForwardedReturn(`/transactions/${DEMO_ID}`, '_settings')).toBe(expected);
    expect(withForwardedReturn(`/transactions/${DEMO_ID}`, null)).toBe(expected);
    expect(withForwardedReturn(`/transactions/${DEMO_ID}`, '')).toBe(expected);
  });

  it('forwards a hostile value sitting beside a valid one', () => {
    // `?back=_triage&back=https://evil.example` — a multiple-value param.
    // `get` reads the FIRST, and the encoder forwards what a decoder would
    // read; the second value is inert because it is never read.
    const href = withForwardedReturn('/transactions/x', '_triage');
    const url = new URL(`${href}&${RETURN_PARAM}=https://evil.example`, 'https://example.test');
    const raw = url.searchParams.get(RETURN_PARAM);
    expect(decodeNamedPageReturn(raw)!.label).toBe('the triage inbox');
  });
});
