/**
 * O.15 slice 1 — a merchant NAME links to the rows behind it.
 *
 * The owner's verdict was that the app has "no cohesion": surfaces named a
 * merchant and went nowhere, so /recurring could say "you pay Netflix $15.99/mo"
 * with no way to ask "since when?". Slice 1 makes every such name a link.
 *
 * The claim under test is NOT "the href starts with /transactions". It is that
 * FOLLOWING the link lands on the rows the name refers to — and for a merchant
 * that claim rests entirely on the ENCODING, because the register matches a
 * merchant by `t.merchantName.toLowerCase() !== merchant` (query.ts:200): an
 * EXACT, case-insensitive equality. There is no substring fallback to soften a
 * mangled parameter. One wrong escape does not degrade the destination, it
 * empties it — and an empty register is not an error, it is a page reading "no
 * transactions" about charges the reader is looking straight at. That failure
 * returns HTTP 200 and logs nothing, which is why it gets a unit lock rather
 * than a passing glance in review.
 *
 * The names below are not decoration. Real merchant strings carry `&` ("Barnes &
 * Noble"), `#`, `+` and non-ASCII far more often than category slugs — which are
 * lowercase ASCII by construction — do, which is exactly why the merchant
 * builder needed centralising when the category one had survived inline.
 */
import { describe, expect, it } from 'vitest';
import { MERCHANT_LINK_CLASS, merchantRegisterHref } from '@/lib/engine/transactions/links';
import { filterTransactions, type TxnFilter, type TxnView } from '@/lib/engine/transactions/query';

/** A merchant name and why it is dangerous to put in a URL. */
const HOSTILE_NAMES: ReadonlyArray<readonly [name: string, why: string]> = [
  ['Blue Bottle Coffee', 'spaces — the commonest case, and the one `+` vs `%20` splits on'],
  ['Barnes & Noble', '`&` starts a new query parameter if unescaped: the name truncates to "Barnes"'],
  ['Trader Joe’s', 'a curly apostrophe — the iOS default, per the a-guard-must-read lesson'],
  ['A#1 Auto', '`#` starts a fragment if unescaped: everything after it never reaches the server'],
  ['C++ Bookstore', '`+` is a literal plus that a form-encoding reader turns into a space'],
  ['星巴克', 'non-ASCII, which must survive the round trip byte for byte'],
  ['Sam=s Club', '`=` inside a value, which a naive split(\'=\') parser would cut'],
  ['100% Chiropractic', '`%` — a stray percent is an INVALID escape and can throw on decode'],
];

describe('merchantRegisterHref (O.15 — the link itself)', () => {
  it.each(HOSTILE_NAMES)('round-trips %j (%s)', (name) => {
    // Parsed as a REAL URL, not as `href.split('?')[1]`. The difference is not
    // pedantry: a manual split hands the whole tail to URLSearchParams, so an
    // unescaped `#` survives as an ordinary character and the test passes on a
    // builder that does no escaping at all. Through `new URL`, `#` starts the
    // fragment — which never leaves the browser — and "A#1 Auto" arrives at the
    // server as "A". Measured, with the escaping removed: the split version left
    // 6 of these 8 names green, this version leaves 5 — `A#1 Auto` is the name
    // only the real-URL parse can catch. One extra name, and it is the whole
    // reason to prefer this form: the weaker parse agreed with the bug.
    const url = new URL(merchantRegisterHref(name), 'https://www.aimplifi.app');
    expect(url.searchParams.get('merchant')).toBe(name);
  });

  it('encodes a space as %20, never a bare +', () => {
    // The reason this is pinned rather than left to taste: `URLSearchParams`
    // .toString() — the obvious way to build this — emits `+` for a space, which
    // only decodes back to a space under form-encoding rules. `%20` is a space to
    // every query parser there is. The TWO merchant links that were already
    // shipped emitted `%20`, so pinning it is what makes the refactor provably
    // unable to move where an existing link lands.
    const href = merchantRegisterHref('Blue Bottle Coffee');
    expect(href).toBe('/transactions?merchant=Blue%20Bottle%20Coffee');
    expect(href).not.toContain('+');
  });

  it('is a plain string, never null — unlike the category builder, and on purpose', () => {
    // categoryRegisterHref refuses (returns null) when the register's category
    // <select> cannot DISPLAY the id. There is no equivalent predicate for a
    // merchant: the register has no merchant control at all (see the builder's
    // docblock — a first draft of this comment claimed it had a free-text box,
    // and a critic checked), so every name is equally displayable and equally
    // unshown. Nothing a builder could evaluate would refuse the right subset.
    expect(typeof merchantRegisterHref('Never Seen Before Ltd')).toBe('string');
    expect(merchantRegisterHref('')).toBe('/transactions?merchant=');
  });
});

/** The register's own row shape, minimal but real. */
function view(id: string, merchantName: string): TxnView {
  return {
    id,
    date: '2026-06-05',
    accountId: 'acct-A',
    accountName: 'Everyday Checking',
    merchantName,
    rawDescriptor: `RAW ${merchantName}`,
    categoryId: 'groceries',
    categoryName: 'Groceries',
    amountCents: -1234,
    status: 'POSTED',
    descriptorOrigin: 'bank',
    isTransfer: false,
    note: null,
    taxClass: null,
    needsReview: false,
    provenance: { kind: 'merchant-default', label: 'Known merchant', needsConfirm: false },
    excludeFromTotals: false,
    reimbursement: null,
    splitParentId: null,
    suggestion: null,
    spendClass: 'fixed',
    spendClassReaderSet: false,
  };
}

/** What the register shows after following the href, as transactions/page.tsx builds it. */
function followHref(href: string, rows: TxnView[]): TxnView[] {
  // Real-URL parsing here too, for the same reason as above: this is the half
  // that proves the reader lands on rows, so it must not be more forgiving than
  // a browser is.
  const url = new URL(href, 'https://www.aimplifi.app');
  const filter: Partial<TxnFilter> = { merchant: url.searchParams.get('merchant') };
  return filterTransactions(rows, filter);
}

describe('O.15 reconciliation — following the link lands on that merchant’s rows', () => {
  it.each(HOSTILE_NAMES)('a link built from %j selects exactly its own rows', (name) => {
    // The decoy differs from the target only OUTSIDE the escaped characters, so a
    // builder that dropped or mangled an escape would not merely return fewer
    // rows — under an exact-equality filter it returns NONE, and this fails.
    const rows = [view('t1', name), view('t2', `${name} Express`), view('t3', 'Unrelated Store')];
    const landed = followHref(merchantRegisterHref(name), rows);
    expect(landed.map((r) => r.id)).toEqual(['t1']);
  });

  it('matches case-insensitively, as the register does', () => {
    const rows = [view('t1', 'Blue Bottle Coffee')];
    expect(followHref(merchantRegisterHref('BLUE BOTTLE COFFEE'), rows).map((r) => r.id)).toEqual(['t1']);
  });

  it('a merchant with no rows lands on an empty register, not on every row', () => {
    // The failure direction that matters: a link whose parameter went missing
    // entirely would filter by nothing and show the WHOLE register — a much
    // larger set than the name promised, and the merchant equivalent of the
    // window-less category link `CategoryFigure` exists to prevent.
    const rows = [view('t1', 'Blue Bottle Coffee'), view('t2', 'Unrelated Store')];
    expect(followHref(merchantRegisterHref('Never Seen Before Ltd'), rows)).toEqual([]);
  });
});

describe('MERCHANT_LINK_CLASS', () => {
  it('carries a visible focus ring', () => {
    // Every hand-written copy of this markup omitted focus styling, so the links
    // were reachable by keyboard and invisible once reached. Centralising the
    // class is only worth doing if the thing it centralises is correct.
    expect(MERCHANT_LINK_CLASS).toContain('focus-visible:outline-2');
  });

  it('has a RESTING affordance, not hover-only', () => {
    // The defect this repo already measured once, on category figures at 380px:
    // `hover:underline` alone renders identically to plain text on a phone, where
    // there is no hover. A link nobody can see is indistinguishable from not
    // shipping it — and shipping it is the entire point of this slice.
    expect(MERCHANT_LINK_CLASS).toContain('underline');
    expect(MERCHANT_LINK_CLASS).toContain('decoration-dotted');
  });

  it('does not bake in `truncate`', () => {
    // Whether a name may be clipped is a fact about the layout it sits in: a
    // register row truncates, the Today feed's sentence must not. Baking it in
    // here would clip a link mid-sentence on the one surface that reads as prose.
    expect(MERCHANT_LINK_CLASS).not.toContain('truncate');
  });
});

/**
 * THE KNOWN GAP, PINNED (O.15 slice 1 critic, P0-1).
 *
 * The tests above prove the URL survives the trip. They cannot prove the app
 * puts the RIGHT NAME into it, because they build their fixture rows from the
 * same string they hand the builder. A fresh-context critic found the real
 * defect in that blind spot, and it is pinned here rather than described in a
 * comment, so that closing it means deleting assertions that explain themselves.
 *
 * TWO NAME-SPACES, and only one of them is what the register matches on:
 *  - The register displays and filters on the STORED name:
 *    `t.merchant?.canonical ?? normalizeMerchant(t.rawDescriptor).canonical`
 *    (server/transactions.ts:262), matched exactly (query.ts:200).
 *  - /recurring, the Today feed's unusual-charge row and /coach all display a
 *    LIVE RE-DERIVATION, `normalizeMerchant(t.rawDescriptor).canonical`
 *    (recurring/detect.ts:187 — `RecurringTxn` carries no merchant relation at
 *    all; anomaly/detect.ts:101; server/coach.ts:239).
 *
 * They agree until something changes the stored name without touching the
 * descriptor. O.13c's rename-payee rule does exactly that: it upserts a Merchant
 * with `canonical: renameTo` and re-points `Transaction.merchantId`
 * (server/keyword-rules.ts:598-621), leaving `rawDescriptor` alone forever.
 * After a rename the register says "Netflix (family plan)" and /recurring still
 * says "Netflix", so a link built from the /recurring name matches nothing.
 *
 * THIS IS OLDER THAN THE LINKS. The Merchant Lens already joins the two
 * name-spaces the same way and fails the same way
 * (server/transactions.ts:334 compares `s.merchantCanonical` to the register's
 * `profile.merchant`). The links did not create the split; they made it
 * reachable in one tap. Shipping them is still the better of the two available
 * failures — a plain name is a dead end for EVERY reader, while a link is a dead
 * end only for renamed payees — but "better" is not "correct", and the fix is
 * unifying merchant identity at the source, not widening the filter to paper
 * over it.
 */
describe('KNOWN GAP — a renamed payee splits the name-space (pinned, not fixed)', () => {
  const RENAMED = 'Netflix (family plan)';
  const DERIVED = 'Netflix';

  it('a link built from the re-derived name finds NONE of the renamed rows', () => {
    // The row as the register presents it after a rename: display name from the
    // stored Merchant, descriptor untouched.
    const rows = [view('t1', RENAMED), view('t2', RENAMED)];

    // The href /recurring would build, from the name /recurring displays.
    const landed = followHref(merchantRegisterHref(DERIVED), rows);

    // WHEN THIS FAILS, THE BUG IS FIXED — delete this test, do not "repair" it.
    // A non-empty result means the two name-spaces were unified (or the register
    // learned to match the descriptor), which is the intended end state.
    expect(landed).toEqual([]);
  });

  it('the same link works whenever the stored name has NOT been overridden', () => {
    // The overwhelming case, and why shipping is defensible: with no rename in
    // play the stored canonical IS the derived canonical, so the link lands.
    const rows = [view('t1', DERIVED), view('t2', 'Unrelated Store')];
    expect(followHref(merchantRegisterHref(DERIVED), rows).map((r) => r.id)).toEqual(['t1']);
  });
});
