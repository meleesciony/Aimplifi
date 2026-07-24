/**
 * The duplicate card's render contract (#296) — the lock on the owner-reported defect of
 * 2026-07-24: two live U.S. Bank Plaid connections produced byte-identical
 * "Disconnect U.S. Bank (Plaid ····2927)" buttons and byte-identical aria-labels, so there was
 * no way to tell which connection a tap would cut.
 *
 * The module is pure and framework-free precisely so this file can lock every rendered string in
 * the node env (no RTL/jsdom in this repo). Hand-verified expectations; see docs/EDGE_CASES.md
 * §Duplicate-Accounts.
 */
import { describe, expect, it } from 'vitest';

import {
  type DuplicateConnectionInfo,
  type DuplicatePairContext,
  type DuplicatePairView,
  type DuplicateSideAccount,
  DUPLICATE_HOWTO,
  DUPLICATE_HOWTO_TESTID,
  DUPLICATE_INTRO,
  DUPLICATE_INTRO_TESTID,
  DUPLICATE_PAIR_IMPACT_TESTID,
  DUPLICATE_PAIR_WHY_TESTID,
  DUPLICATE_SIDE_A_TESTID,
  DUPLICATE_SIDE_B_TESTID,
  DUPLICATE_SIDE_CONNECTION_TESTID,
  DUPLICATE_SIDE_FEEDS_TESTID,
  DUPLICATE_SIDE_NOTE_TESTID,
  cardOffersDisconnect,
  connectionOrdinals,
  duplicateCardView,
  connectionsById,
  duplicatePairView,
  providerMask,
  visibleAccountsByItem,
} from '@/components/finance/duplicate-card-view';

function acct(p: Partial<DuplicateSideAccount> & { id: string }): DuplicateSideAccount {
  return {
    name: 'Loan - 2927',
    mask: '2927',
    currentBalanceCents: 2_380_042,
    provider: 'plaid',
    deletable: false,
    plaidItemId: null,
    ...p,
  };
}

function item(p: Partial<DuplicateConnectionInfo> & { itemId: string }): DuplicateConnectionInfo {
  return {
    institution: 'U.S. Bank',
    lastSyncedAt: '2026-07-24',
    ordinal: 1,
    sameBankCount: 1,
    accountCount: 1,
    ...p,
  };
}

function ref(p: { id: string; name?: string; provider?: string; mask?: string | null }) {
  return {
    id: p.id,
    name: p.name ?? 'Loan - 2927',
    provider: p.provider ?? 'plaid',
    mask: p.mask === undefined ? '2927' : p.mask,
  };
}

function ctxOf(
  rows: DuplicateSideAccount[],
  items: DuplicateConnectionInfo[],
  opts?: { canDelete?: boolean; canDisconnect?: boolean },
): DuplicatePairContext {
  return {
    accountsById: new Map(rows.map((r) => [r.id, r] as const)),
    itemsById: new Map(items.map((i) => [i.itemId, i] as const)),
    visibleByItem: visibleAccountsByItem(rows),
    canDelete: opts?.canDelete ?? true,
    canDisconnect: opts?.canDisconnect ?? true,
  };
}

/** The owner's live case: two connections to one bank, item-1 feeding 2 accounts, item-2 feeding 1. */
function ownerCase(): { view: DuplicatePairView } {
  const rows = [
    acct({ id: 'a', plaidItemId: 'it-1' }),
    acct({ id: 'b', plaidItemId: 'it-2' }),
    acct({ id: 'c', name: 'CREDIT CARD', mask: '0977', currentBalanceCents: 120_000, plaidItemId: 'it-1' }),
  ];
  const items = [
    item({ itemId: 'it-1', ordinal: 1, sameBankCount: 2, accountCount: 2 }),
    item({ itemId: 'it-2', ordinal: 2, sameBankCount: 2, accountCount: 1 }),
  ];
  return {
    view: duplicatePairView({ a: ref({ id: 'a' }), b: ref({ id: 'b' }) }, ctxOf(rows, items)),
  };
}

describe('#296 regression — the two sides of a duplicate pair must be distinguishable', () => {
  it('test_regression__duplicate_pair_sides_must_be_distinguishable', () => {
    const { view } = ownerCase();
    // Every one of these four failed before #296: both sides rendered "Disconnect U.S. Bank".
    expect(view.a.action!.label).not.toBe(view.b.action!.label);
    expect(view.a.action!.ariaLabel).not.toBe(view.b.action!.ariaLabel);
    expect(view.a.connectionLine).not.toBe(view.b.connectionLine);
    expect(view.a.feedsLine).not.toBe(view.b.feedsLine);
  });

  it('puts the connection ordinal and the blast radius on the button face', () => {
    const { view } = ownerCase();
    expect(view.a.action!.label).toBe('Disconnect connection 1');
    expect(view.a.action!.subLabel).toBe('2 accounts stop updating');
    expect(view.b.action!.label).toBe('Disconnect connection 2');
    expect(view.b.action!.subLabel).toBe('1 account stops updating');
  });

  it('carries the same discrimination in the accessible name', () => {
    const { view } = ownerCase();
    expect(view.a.action!.ariaLabel).toBe(
      'Disconnect connection 1 — 2 accounts stop updating — row 1: Loan - 2927 (Plaid ····2927)',
    );
    expect(view.b.action!.ariaLabel).toBe(
      'Disconnect connection 2 — 1 account stops updating — row 2: Loan - 2927 (Plaid ····2927)',
    );
  });

  it('names which connection feeds each row', () => {
    const { view } = ownerCase();
    expect(view.a.connectionLine).toBe('Plaid: U.S. Bank · connection 1 of 2 · last synced 2026-07-24');
    expect(view.b.connectionLine).toBe('Plaid: U.S. Bank · connection 2 of 2 · last synced 2026-07-24');
  });

  it('shows the blast radius BEFORE the tap, not only in the confirm prompt', () => {
    const { view } = ownerCase();
    expect(view.a.feedsLine).toBe('Also feeds 1 other account: CREDIT CARD ····0977');
    expect(view.b.feedsLine).toBe('Feeds only this account.');
  });

  it('spells out the consequence in the confirm prompt', () => {
    const { view } = ownerCase();
    expect(view.a.action!.prompt).toBe(
      'Disconnect connection 1 at U.S. Bank? 2 accounts stop updating — this one and 1 more. Nothing is deleted: this copy keeps its last balance and keeps counting until you delete it. Reconnecting means signing in at your bank again.',
    );
    expect(view.b.action!.prompt).toBe(
      'Disconnect connection 2 at U.S. Bank? This account stops updating. Nothing is deleted: it keeps its last balance and keeps counting until you delete it. Reconnecting means signing in at your bank again.',
    );
  });

  it('states why the pair is flagged and what doing nothing costs', () => {
    const { view } = ownerCase();
    expect(view.why).toBe('Two separate Plaid connections to U.S. Bank both report this account.');
    expect(view.impact).toBe('Both are counted right now: $23,800.42 + $23,800.42 = $47,600.84.');
  });
});

/** Every shape that can produce a rendered control. Module scope so BOTH the distinctness
 *  suite and the target-resolution suite run over exactly the same fixtures. */
const MATRIX: { name: string; view: () => DuplicatePairView }[] = [
  { name: 'owner case', view: () => ownerCase().view },
  {
    name: 'both deletable, identical everything',
    view: () =>
      duplicatePairView(
        { a: ref({ id: 'a' }), b: ref({ id: 'b' }) },
        ctxOf([acct({ id: 'a', deletable: true }), acct({ id: 'b', deletable: true })], []),
      ),
  },
  {
    name: 'both disconnect, unresolved items',
    view: () =>
      duplicatePairView(
        { a: ref({ id: 'a' }), b: ref({ id: 'b' }) },
        ctxOf([acct({ id: 'a', plaidItemId: 'x' }), acct({ id: 'b', plaidItemId: 'y' })], []),
      ),
  },
  {
    name: 'cross-provider',
    view: () =>
      duplicatePairView(
        { a: ref({ id: 'a' }), b: ref({ id: 'b', provider: 'simplefin', mask: null }) },
        ctxOf(
          [
            acct({ id: 'a', plaidItemId: 'it-1' }),
            acct({ id: 'b', provider: 'simplefin', mask: null, deletable: true }),
          ],
          [item({ itemId: 'it-1' })],
        ),
      ),
  },
  {
    name: 'different institutions',
    view: () =>
      duplicatePairView(
        { a: ref({ id: 'a' }), b: ref({ id: 'b' }) },
        ctxOf(
          [acct({ id: 'a', plaidItemId: 'it-1' }), acct({ id: 'b', plaidItemId: 'it-2' })],
          [item({ itemId: 'it-1' }), item({ itemId: 'it-2', institution: 'USAA' })],
        ),
      ),
  },
  {
    name: 'null institution, two connections',
    view: () =>
      duplicatePairView(
        { a: ref({ id: 'a' }), b: ref({ id: 'b' }) },
        ctxOf(
          [acct({ id: 'a', plaidItemId: 'it-1' }), acct({ id: 'b', plaidItemId: 'it-2' })],
          [
            item({ itemId: 'it-1', institution: null, ordinal: 1, sameBankCount: 2 }),
            item({ itemId: 'it-2', institution: null, ordinal: 2, sameBankCount: 2 }),
          ],
        ),
      ),
  },
  {
    name: 'both masks null',
    view: () =>
      duplicatePairView(
        { a: ref({ id: 'a', mask: null }), b: ref({ id: 'b', mask: null }) },
        ctxOf(
          [
            acct({ id: 'a', mask: null, plaidItemId: 'it-1' }),
            acct({ id: 'b', mask: null, plaidItemId: 'it-2' }),
          ],
          [
            item({ itemId: 'it-1', ordinal: 1, sameBankCount: 2 }),
            item({ itemId: 'it-2', ordinal: 2, sameBankCount: 2 }),
          ],
        ),
      ),
  },
  {
    name: 'one side actionless',
    view: () =>
      duplicatePairView(
        { a: ref({ id: 'a' }), b: ref({ id: 'b', provider: 'manual', mask: null }) },
        ctxOf(
          [acct({ id: 'a', plaidItemId: 'it-1' }), acct({ id: 'b', provider: 'manual', mask: null })],
          [item({ itemId: 'it-1' })],
        ),
      ),
  },
  {
    name: 'both sides actionless',
    view: () =>
      duplicatePairView(
        { a: ref({ id: 'a', provider: 'simplefin', mask: null }), b: ref({ id: 'b', provider: 'manual', mask: null }) },
        ctxOf(
          [
            acct({ id: 'a', provider: 'simplefin', mask: null }),
            acct({ id: 'b', provider: 'manual', mask: null }),
          ],
          [],
        ),
      ),
  },
];

describe('a control must resolve the object its own block describes', () => {
  // THE GAP THAT LET A MUTATION THROUGH (critic P0, 2026-07-24): the original suite asserted
  // targetId on side A only, so an injected `b.action.targetId = a.action.targetId` shipped a card
  // whose "Disconnect connection 2" button severed connection 1 — and 56/56 tests stayed green.
  // targetId is the one field whose corruption is destructive and irreversible, so it is now
  // locked on BOTH sides, in every shape that can produce a control.
  it('dispatches each side’s OWN item on a two-connection disconnect pair', () => {
    const { view } = ownerCase();
    expect(view.a.action!.targetId).toBe('it-1');
    expect(view.b.action!.targetId).toBe('it-2');
    expect(view.a.action!.targetId).not.toBe(view.b.action!.targetId);
    // …and the id matches the connection each block CLAIMS, not merely some other id.
    expect(view.a.connectionLine).toContain('connection 1 of 2');
    expect(view.b.connectionLine).toContain('connection 2 of 2');
  });

  it('dispatches each side’s OWN account on a two-delete pair', () => {
    const rows = [
      acct({ id: 'a', deletable: true, plaidItemId: 'gone-1' }),
      acct({ id: 'b', deletable: true, plaidItemId: 'gone-2' }),
    ];
    const view = duplicatePairView({ a: ref({ id: 'a' }), b: ref({ id: 'b' }) }, ctxOf(rows, []));
    expect(view.a.action!.targetId).toBe('a');
    expect(view.b.action!.targetId).toBe('b');
  });

  it('never lets two identical faces resolve different objects, across the whole matrix', () => {
    for (const m of MATRIX) {
      const view = m.view();
      for (const [x, y] of [[view.a, view.b]] as const) {
        if (!x.action || !y.action) continue;
        const sameFace = x.action.label === y.action.label && x.action.subLabel === y.action.subLabel;
        const sameTarget = x.action.kind === y.action.kind && x.action.targetId === y.action.targetId;
        expect(sameFace, `${m.name}: identical faces must mean identical targets`).toBe(sameTarget);
      }
    }
  });
});

describe('three copies of one account (all-pairs fan-out) — the card-wide invariant', () => {
  // detectDuplicateAccounts is an all-pairs loop with no transitive collapse, so N copies of one
  // real account emit N*(N-1)/2 pairs and one account is side `a` of several of them. A per-PAIR
  // collision breaker sees no tie in any of them and the card renders identical faces that delete
  // DIFFERENT accounts (critic P1) — the owner's original complaint, one revision later, in the
  // direction that cascades transactions with no undo.
  const rows = [
    acct({ id: 'pa', plaidItemId: 'gone-a', deletable: true }),
    acct({ id: 'pb', plaidItemId: 'gone-b', deletable: true }),
    acct({ id: 'sf', provider: 'simplefin', mask: null, deletable: true }),
  ];
  const pairs = [
    { a: ref({ id: 'pa' }), b: ref({ id: 'pb' }) },
    { a: ref({ id: 'pa' }), b: ref({ id: 'sf', provider: 'simplefin', mask: null }) },
    { a: ref({ id: 'pb' }), b: ref({ id: 'sf', provider: 'simplefin', mask: null }) },
  ];
  const views = duplicateCardView(pairs, ctxOf(rows, []));
  const controls = views.flatMap((v) => [v.a, v.b]).filter((s) => s.action);

  it('renders identical faces if and only if they resolve the same account', () => {
    for (const x of controls) {
      for (const y of controls) {
        const sameFace = x.action!.label === y.action!.label;
        const sameTarget = x.action!.kind === y.action!.kind && x.action!.targetId === y.action!.targetId;
        expect(sameFace, `"${x.action!.label}" vs "${y.action!.label}"`).toBe(sameTarget);
      }
    }
  });

  it('gives each distinct account a stable discriminator, and repeats it wherever that account appears', () => {
    const byTarget = new Map<string, Set<string>>();
    for (const c of controls) {
      const set = byTarget.get(c.action!.targetId) ?? new Set<string>();
      set.add(c.action!.label);
      byTarget.set(c.action!.targetId, set);
    }
    // pa appears in two pairs and must read the same both times.
    expect([...byTarget.get('pa')!]).toHaveLength(1);
    expect([...byTarget.get('pb')!]).toHaveLength(1);
    expect(byTarget.size).toBe(3);
    const labels = [...byTarget.values()].map((s) => [...s][0]);
    expect(new Set(labels).size).toBe(3);
    for (const l of labels) expect(l).toMatch(/^Delete this copy \(copy [123]\)$/);
  });
});

describe('label distinctness is an invariant of construction, not of the data', () => {
  // The suffix is `(copy N)`, keyed on WHAT THE CONTROL RESOLVES rather than on which side of a
  // pair it sits (critic P1): `(row 1)` was pair-local, so the same account appearing in two
  // pairs got `(row 1)` twice while resolving different targets in each.
  it('breaks a Delete/Delete tie on two rows that are identical in every field', () => {
    const rows = [
      acct({ id: 'a', deletable: true, plaidItemId: 'gone-1' }),
      acct({ id: 'b', deletable: true, plaidItemId: 'gone-2' }),
    ];
    const view = duplicatePairView({ a: ref({ id: 'a' }), b: ref({ id: 'b' }) }, ctxOf(rows, []));
    expect(view.a.action!.label).toBe('Delete this copy (copy 1)');
    expect(view.b.action!.label).toBe('Delete this copy (copy 2)');
    expect(view.a.action!.subLabel).toBe('its history goes too');
    expect(view.b.action!.subLabel).toBe('its history goes too');
    expect(view.a.action!.ariaLabel).not.toBe(view.b.action!.ariaLabel);
  });

  it('breaks a Disconnect/Disconnect tie when neither item resolves', () => {
    const rows = [acct({ id: 'a', plaidItemId: 'x' }), acct({ id: 'b', plaidItemId: 'y' })];
    const view = duplicatePairView({ a: ref({ id: 'a' }), b: ref({ id: 'b' }) }, ctxOf(rows, []));
    expect(view.a.action!.label).toBe('Disconnect this connection (copy 1)');
    expect(view.b.action!.label).toBe('Disconnect this connection (copy 2)');
  });


  it.each(MATRIX.map((m) => [m.name, m] as const))(
    '%s: two rendered controls are never identical',
    (_, m) => {
      const view = m.view();
      if (view.a.action && view.b.action) {
        expect(view.a.action.label).not.toBe(view.b.action.label);
        expect(view.a.action.ariaLabel).not.toBe(view.b.action.ariaLabel);
      }
    },
  );
});

describe('two pairs sharing the same two connections (the owner’s actual /accounts)', () => {
  // PROGRESS.md 2026-07-24: he has CREDIT CARD ····0977 twice AND Loan - 2927 twice, each the same
  // real account arriving through the SAME two live Plaid connections. Both pairs render at once.
  const rows = [
    acct({ id: 'loanA', plaidItemId: 'it-1' }),
    acct({ id: 'loanB', plaidItemId: 'it-2' }),
    acct({ id: 'cardA', name: 'CREDIT CARD', mask: '0977', currentBalanceCents: 850_000, plaidItemId: 'it-1' }),
    acct({ id: 'cardB', name: 'CREDIT CARD', mask: '0977', currentBalanceCents: 850_000, plaidItemId: 'it-2' }),
  ];
  const items = [
    item({ itemId: 'it-1', ordinal: 1, sameBankCount: 2, accountCount: 2 }),
    item({ itemId: 'it-2', ordinal: 2, sameBankCount: 2, accountCount: 2 }),
  ];
  const ctx = ctxOf(rows, items);
  const loans = duplicatePairView({ a: ref({ id: 'loanA' }), b: ref({ id: 'loanB' }) }, ctx);
  const cards = duplicatePairView(
    { a: ref({ id: 'cardA', name: 'CREDIT CARD', mask: '0977' }), b: ref({ id: 'cardB', name: 'CREDIT CARD', mask: '0977' }) },
    ctx,
  );

  it('gives a connection the SAME identity in every pair it appears in', () => {
    // "connection 1" must mean one object page-wide, or the ordinal is worse than useless.
    expect(loans.a.connectionLine).toBe(cards.a.connectionLine);
    expect(loans.b.connectionLine).toBe(cards.b.connectionLine);
    expect(loans.a.action!.label).toBe(cards.a.action!.label);
    expect(loans.a.action!.targetId).toBe('it-1');
    expect(cards.a.action!.targetId).toBe('it-1');
  });

  it('still distinguishes the four buttons by the row each one resolves', () => {
    const arias = [loans.a, loans.b, cards.a, cards.b].map((s) => s.action!.ariaLabel);
    expect(new Set(arias).size).toBe(4);
  });

  it('names the sibling from the OTHER pair in each connection’s manifest', () => {
    expect(loans.a.feedsLine).toBe('Also feeds 1 other account: CREDIT CARD ····0977');
    expect(cards.a.feedsLine).toBe('Also feeds 1 other account: Loan - 2927 ····2927');
  });
});

describe('connection identity', () => {
  it('omits the ordinal when the bank has only one connection', () => {
    const rows = [acct({ id: 'a', plaidItemId: 'it-1' }), acct({ id: 'b', plaidItemId: 'it-2' })];
    const view = duplicatePairView(
      { a: ref({ id: 'a' }), b: ref({ id: 'b' }) },
      ctxOf(rows, [item({ itemId: 'it-1', institution: 'Chase' }), item({ itemId: 'it-2', institution: 'USAA' })]),
    );
    expect(view.a.connectionLine).toBe('Plaid: Chase · last synced 2026-07-24');
    expect(view.a.connectionLine).not.toMatch(/connection \d+ of/);
    expect(view.a.action!.label).toBe('Disconnect Chase');
    expect(view.b.action!.label).toBe('Disconnect USAA');
  });

  it('falls back to "Connected bank" / "this bank" rather than inventing a name', () => {
    const rows = [acct({ id: 'a', plaidItemId: 'it-1' }), acct({ id: 'b', plaidItemId: 'it-2' })];
    const view = duplicatePairView(
      { a: ref({ id: 'a' }), b: ref({ id: 'b' }) },
      ctxOf(rows, [
        item({ itemId: 'it-1', institution: null, ordinal: 1, sameBankCount: 2 }),
        item({ itemId: 'it-2', institution: null, ordinal: 2, sameBankCount: 2 }),
      ]),
    );
    expect(view.a.connectionLine).toBe('Plaid: Connected bank · connection 1 of 2 · last synced 2026-07-24');
    expect(view.a.action!.label).toBe('Disconnect connection 1');
    expect(view.a.action!.prompt).toContain('at this bank?');
  });

  it('says "Disconnect this bank" for a lone unnamed connection', () => {
    const rows = [acct({ id: 'a', plaidItemId: 'it-1' }), acct({ id: 'b', deletable: true })];
    const view = duplicatePairView(
      { a: ref({ id: 'a' }), b: ref({ id: 'b' }) },
      ctxOf(rows, [item({ itemId: 'it-1', institution: null })]),
    );
    expect(view.a.action!.label).toBe('Disconnect this bank');
    expect(view.a.action!.prompt).toMatch(/^Disconnect this bank\?/);
  });

  it('never renders "last synced null"', () => {
    const rows = [acct({ id: 'a', plaidItemId: 'it-1' }), acct({ id: 'b', deletable: true })];
    const view = duplicatePairView(
      { a: ref({ id: 'a' }), b: ref({ id: 'b' }) },
      ctxOf(rows, [item({ itemId: 'it-1', lastSyncedAt: null })]),
    );
    expect(view.a.connectionLine).toBe('Plaid: U.S. Bank · not synced yet');
    expect(view.a.connectionLine).not.toContain('null');
  });
});

describe('degrading honestly', () => {
  it('still offers the Disconnect when the item is missing, and says the radius is unknown', () => {
    const rows = [acct({ id: 'a', plaidItemId: 'it-x' }), acct({ id: 'b', deletable: true })];
    const view = duplicatePairView({ a: ref({ id: 'a' }), b: ref({ id: 'b' }) }, ctxOf(rows, []));
    expect(view.a.action!.kind).toBe('disconnect');
    expect(view.a.action!.targetId).toBe('it-x');
    expect(view.a.action!.label).toBe('Disconnect this connection');
    expect(view.a.action!.subLabel).toBe('we can’t tell what else it feeds');
    expect(view.a.feedsLine).toBeNull();
    expect(view.a.connectionLine).toMatch(/can’t read this connection’s details right now/);
    // The pre-#296 `(item?.accountCount ?? 1) - 1` degradation claimed a single-account item here.
    expect(JSON.stringify(view.a)).not.toMatch(/Feeds only this account/);
  });

  it('hands the user step 2 in the same block after a disconnect', () => {
    const rows = [acct({ id: 'a', plaidItemId: 'it-gone', deletable: true }), acct({ id: 'b', plaidItemId: 'it-1' })];
    const view = duplicatePairView(
      { a: ref({ id: 'a' }), b: ref({ id: 'b' }) },
      ctxOf(rows, [item({ itemId: 'it-1' })]),
    );
    expect(view.a.action!.kind).toBe('delete');
    expect(view.a.action!.label).toBe('Delete this copy');
    expect(view.a.action!.subLabel).toBe('its history goes too');
    expect(view.a.connectionLine).toBe(
      'Plaid — this copy’s connection is no longer linked. It stopped updating, but it still counts until you delete it.',
    );
    expect(view.a.feedsLine).toBeNull();
    expect(view.a.note).toBeNull();
  });

  it('offers nothing (never a stale Disconnect) when the row is deletable but delete is unwired', () => {
    const rows = [acct({ id: 'a', plaidItemId: 'it-gone', deletable: true }), acct({ id: 'b', plaidItemId: 'it-1' })];
    const view = duplicatePairView(
      { a: ref({ id: 'a' }), b: ref({ id: 'b' }) },
      ctxOf(rows, [item({ itemId: 'it-1' })], { canDelete: false }),
    );
    expect(view.a.action).toBeNull();
    expect(view.a.note).toBe('No control here yet — use this row’s own controls in the list above.');
  });

  it('explains an unstamped pre-#256 Plaid row instead of offering a control', () => {
    const rows = [acct({ id: 'a', plaidItemId: null }), acct({ id: 'b', plaidItemId: 'it-1' })];
    const view = duplicatePairView(
      { a: ref({ id: 'a' }), b: ref({ id: 'b' }) },
      ctxOf(rows, [item({ itemId: 'it-1' })]),
    );
    expect(view.a.action).toBeNull();
    expect(view.a.connectionLine).toBe(
      'Plaid — we can’t tell yet which connection feeds this copy. It resolves after this bank’s next sync.',
    );
    expect(view.a.note).toBe(
      'We can’t tell yet which connection feeds this copy. It resolves after this bank’s next sync.',
    );
    expect(view.a.feedsLine).toBeNull();
  });

  it('points a live SimpleFIN row at its own Disconnect rather than promising a refused Delete', () => {
    const rows = [acct({ id: 'a', provider: 'simplefin', mask: null }), acct({ id: 'b', plaidItemId: 'it-1' })];
    const view = duplicatePairView(
      { a: ref({ id: 'a', provider: 'simplefin', mask: null }), b: ref({ id: 'b' }) },
      ctxOf(rows, [item({ itemId: 'it-1' })]),
    );
    expect(view.a.action).toBeNull();
    expect(view.a.connectionLine).toBe(
      'SimpleFIN — still connected. Disconnect it in Bank sync, below, then a Delete appears here.',
    );
    expect(view.a.note).toBe(
      'SimpleFIN is still connected. Disconnect it in Bank sync, below, then a Delete appears here.',
    );
  });

  it('offers Delete on a disconnected SimpleFIN row', () => {
    const rows = [
      acct({ id: 'a', provider: 'simplefin', mask: null, deletable: true }),
      acct({ id: 'b', plaidItemId: 'it-1' }),
    ];
    const view = duplicatePairView(
      { a: ref({ id: 'a', provider: 'simplefin', mask: null }), b: ref({ id: 'b' }) },
      ctxOf(rows, [item({ itemId: 'it-1' })]),
    );
    expect(view.a.action!.kind).toBe('delete');
    expect(view.a.connectionLine).toBe(
      'SimpleFIN — disconnected. This copy stopped updating, but it still counts until you delete it.',
    );
  });

  it('sends a manual row to its own list entry', () => {
    const rows = [acct({ id: 'a', provider: 'manual', mask: null }), acct({ id: 'b', plaidItemId: 'it-1' })];
    const view = duplicatePairView(
      { a: ref({ id: 'a', provider: 'manual', mask: null }), b: ref({ id: 'b' }) },
      ctxOf(rows, [item({ itemId: 'it-1' })]),
    );
    expect(view.a.action).toBeNull();
    expect(view.a.connectionLine).toBe('Added by hand — edit or delete it on its own row in the list above.');
    expect(view.a.note).toBe('You added this one by hand — edit or delete it on its own row in the list above.');
  });

  it('omits the money line rather than printing $0.00 when a row is missing', () => {
    const rows = [acct({ id: 'a', plaidItemId: 'it-1' })];
    const view = duplicatePairView(
      { a: ref({ id: 'a' }), b: ref({ id: 'b' }) },
      ctxOf(rows, [item({ itemId: 'it-1' })]),
    );
    expect(view.impact).toBeNull();
    expect(view.b.action).toBeNull();
    expect(view.b.connectionLine).toBe('We can’t read this row right now — reload the page.');
    expect(view.b.note).toBe('No control here yet — use this row’s own controls in the list above.');
  });

  it('renders a pair with zero, one or two actions without throwing', () => {
    const one = duplicatePairView(
      { a: ref({ id: 'a' }), b: ref({ id: 'b', provider: 'simplefin', mask: null }) },
      ctxOf(
        [acct({ id: 'a', plaidItemId: 'it-1' }), acct({ id: 'b', provider: 'simplefin', mask: null })],
        [item({ itemId: 'it-1' })],
      ),
    );
    expect([one.a.action, one.b.action].filter(Boolean)).toHaveLength(1);
    const none = duplicatePairView(
      { a: ref({ id: 'a', provider: 'simplefin', mask: null }), b: ref({ id: 'b', provider: 'manual', mask: null }) },
      ctxOf(
        [acct({ id: 'a', provider: 'simplefin', mask: null }), acct({ id: 'b', provider: 'manual', mask: null })],
        [],
      ),
    );
    expect(none.a.action).toBeNull();
    expect(none.b.action).toBeNull();
    expect(none.a.note).not.toBeNull();
    expect(none.b.note).not.toBeNull();
  });
});

describe('blast radius counts every account but names only the ones this page shows', () => {
  const withRadius = (accountCount: number, siblings: DuplicateSideAccount[]) => {
    const rows = [acct({ id: 'a', plaidItemId: 'it-1' }), acct({ id: 'b', deletable: true }), ...siblings];
    return duplicatePairView(
      { a: ref({ id: 'a' }), b: ref({ id: 'b' }) },
      ctxOf(rows, [item({ itemId: 'it-1', accountCount })]),
    );
  };

  it('discloses currency-withheld siblings in words, never by name', () => {
    const view = withRadius(4, [
      acct({ id: 'c1', name: 'CHECKING', mask: '1188', plaidItemId: 'it-1' }),
      acct({ id: 'c2', name: 'SAVINGS', mask: '4402', plaidItemId: 'it-1' }),
    ]);
    expect(view.a.feedsLine).toBe(
      'Also feeds 3 other accounts: CHECKING ····1188 · SAVINGS ····4402 · plus 1 in another currency',
    );
    expect(view.a.action!.subLabel).toBe('4 accounts stop updating');
  });

  it('caps the named roster at three', () => {
    const view = withRadius(6, [
      acct({ id: 'c1', name: 'A', mask: '0001', plaidItemId: 'it-1' }),
      acct({ id: 'c2', name: 'B', mask: '0002', plaidItemId: 'it-1' }),
      acct({ id: 'c3', name: 'C', mask: '0003', plaidItemId: 'it-1' }),
      acct({ id: 'c4', name: 'D', mask: '0004', plaidItemId: 'it-1' }),
      acct({ id: 'c5', name: 'E', mask: '0005', plaidItemId: 'it-1' }),
    ]);
    expect(view.a.feedsLine).toBe('Also feeds 5 other accounts: A ····0001 · B ····0002 · C ····0003 · and 2 more');
    expect(view.a.action!.subLabel).toBe('6 accounts stop updating');
  });

  it('reports the cap and the currency gap together', () => {
    const view = withRadius(8, [
      acct({ id: 'c1', name: 'A', mask: '0001', plaidItemId: 'it-1' }),
      acct({ id: 'c2', name: 'B', mask: '0002', plaidItemId: 'it-1' }),
      acct({ id: 'c3', name: 'C', mask: '0003', plaidItemId: 'it-1' }),
      acct({ id: 'c4', name: 'D', mask: '0004', plaidItemId: 'it-1' }),
      acct({ id: 'c5', name: 'E', mask: '0005', plaidItemId: 'it-1' }),
    ]);
    expect(view.a.feedsLine).toMatch(/· and 2 more · plus 2 in another currency$/);
  });

  it('never renders a dangling list when every sibling is withheld', () => {
    const view = withRadius(3, []);
    expect(view.a.feedsLine).toBe(
      'Also feeds 2 other accounts in another currency, which this page doesn’t show.',
    );
  });

  it('never claims fewer accounts than it just named', () => {
    const view = withRadius(0, [acct({ id: 'c', name: 'CREDIT CARD', mask: '0977', plaidItemId: 'it-1' })]);
    expect(view.a.action!.subLabel).toBe('2 accounts stop updating');
    expect(view.a.feedsLine).toBe('Also feeds 1 other account: CREDIT CARD ····0977');
  });

  it.each([
    [1, '1 account stops updating'],
    [2, '2 accounts stop updating'],
    [3, '3 accounts stop updating'],
  ])('gets subject-verb agreement right for %i', (count, expected) => {
    const view = withRadius(count, []);
    expect(view.a.action!.subLabel).toBe(expected);
  });

  it.each([
    [1, 'Also feeds 1 other account:'],
    [2, 'Also feeds 2 other accounts:'],
  ])('gets the sibling count grammar right for %i sibling(s)', (siblings, prefix) => {
    const roster = [
      acct({ id: 'c1', name: 'A', mask: '0001', plaidItemId: 'it-1' }),
      acct({ id: 'c2', name: 'B', mask: '0002', plaidItemId: 'it-1' }),
    ].slice(0, siblings);
    // accountCount matches the roster exactly, so the clamp is a no-op and the grammar is the
    // only thing under test.
    const view = withRadius(siblings + 1, roster);
    expect(view.a.feedsLine).toContain(prefix);
  });
});

describe('the card says only what is true for the pair it is showing', () => {
  it('names the providers conditionally and never claims "two providers"', () => {
    const samePlaid = ownerCase().view;
    expect(samePlaid.why).toBe('Two separate Plaid connections to U.S. Bank both report this account.');

    const unresolved = duplicatePairView(
      { a: ref({ id: 'a' }), b: ref({ id: 'b' }) },
      ctxOf([acct({ id: 'a', plaidItemId: 'x' }), acct({ id: 'b', plaidItemId: 'y' })], []),
    );
    expect(unresolved.why).toBe('Two separate Plaid connections both report this account.');

    const cross = duplicatePairView(
      { a: ref({ id: 'a' }), b: ref({ id: 'b', provider: 'simplefin', mask: null }) },
      ctxOf(
        [acct({ id: 'a', plaidItemId: 'it-1' }), acct({ id: 'b', provider: 'simplefin', mask: null, deletable: true })],
        [item({ itemId: 'it-1' })],
      ),
    );
    expect(cross.why).toBe('Plaid and SimpleFIN both report this account.');

    for (const v of [samePlaid, unresolved, cross]) expect(v.why).not.toMatch(/two providers/i);
  });

  it('keeps the intro provider-agnostic and the howto honest about the two steps', () => {
    expect(DUPLICATE_INTRO).not.toMatch(/provider/i);
    expect(DUPLICATE_HOWTO).toMatch(/two steps/);
    expect(DUPLICATE_HOWTO).toMatch(/keeps counting/);
  });

  it('never tells the user a disconnect fixes the double-count', () => {
    for (const m of [
      ownerCase().view,
      duplicatePairView(
        { a: ref({ id: 'a' }), b: ref({ id: 'b' }) },
        ctxOf([acct({ id: 'a', plaidItemId: 'x' }), acct({ id: 'b', plaidItemId: 'y' })], []),
      ),
    ]) {
      for (const side of [m.a, m.b]) {
        if (side.action?.kind !== 'disconnect') continue;
        expect(side.action.prompt).toMatch(/keeps counting until you delete it/);
        expect(side.action.prompt).toMatch(/Reconnecting means signing in/);
        expect(side.action.prompt).not.toMatch(/no longer counted|stops counting|removed from your net worth/);
      }
    }
  });

  it('never offers a Delete the server would refuse', () => {
    const rows = [acct({ id: 'a', deletable: false, plaidItemId: 'it-1' }), acct({ id: 'b', deletable: false })];
    const view = duplicatePairView(
      { a: ref({ id: 'a' }), b: ref({ id: 'b' }) },
      ctxOf(rows, [item({ itemId: 'it-1' })]),
    );
    expect(view.a.action?.kind).not.toBe('delete');
    expect(view.b.action).toBeNull();
  });

  it('gates the two-step sentence on a Disconnect actually being offered', () => {
    expect(cardOffersDisconnect([ownerCase().view])).toBe(true);
    const allDeletable = duplicatePairView(
      { a: ref({ id: 'a' }), b: ref({ id: 'b' }) },
      ctxOf([acct({ id: 'a', deletable: true }), acct({ id: 'b', deletable: true })], []),
    );
    expect(cardOffersDisconnect([allDeletable])).toBe(false);
  });

  const BANNED = [
    /you wasted/i,
    /stop buying/i,
    /\bguilty\b/i,
    /\bshame\b/i,
    /you should have/i,
    /\bsplurg/i,
    /cut back on your latte/i,
    /\birresponsib/i,
    /\bbad with money\b/i,
  ];
  const TICKERS = /\b(VTSAX|VTI|VOO|SPY|AAPL|TSLA|bitcoin|crypto|buy (shares|stocks?|the dip)|ticker)\b/i;

  it('emits no shame language and no security recommendations anywhere', () => {
    const strings = [DUPLICATE_INTRO, DUPLICATE_HOWTO];
    const collect = (v: DuplicatePairView) => {
      strings.push(v.why);
      if (v.impact) strings.push(v.impact);
      for (const s of [v.a, v.b]) {
        strings.push(s.connectionLine);
        if (s.feedsLine) strings.push(s.feedsLine);
        if (s.note) strings.push(s.note);
        if (s.action) strings.push(s.action.label, s.action.subLabel, s.action.ariaLabel, s.action.prompt);
      }
    };
    collect(ownerCase().view);
    collect(
      duplicatePairView(
        { a: ref({ id: 'a', provider: 'simplefin', mask: null }), b: ref({ id: 'b', provider: 'manual', mask: null }) },
        ctxOf(
          [acct({ id: 'a', provider: 'simplefin', mask: null }), acct({ id: 'b', provider: 'manual', mask: null })],
          [],
        ),
      ),
    );
    for (const s of strings) {
      for (const banned of BANNED) expect(s, `"${s}" must not match ${banned}`).not.toMatch(banned);
      expect(s, `"${s}" must not name a security`).not.toMatch(TICKERS);
    }
  });
});

describe('connection numbering and roster helpers', () => {
  it('numbers each bank independently, in payload order', () => {
    const out = connectionOrdinals([
      { itemId: 'A', institution: 'U.S. Bank' },
      { itemId: 'B', institution: 'Chase' },
      { itemId: 'C', institution: 'U.S. Bank' },
    ]);
    expect(out.get('A')).toEqual({ ordinal: 1, sameBankCount: 2 });
    expect(out.get('C')).toEqual({ ordinal: 2, sameBankCount: 2 });
    expect(out.get('B')).toEqual({ ordinal: 1, sameBankCount: 1 });
  });

  it('groups two unnamed connections together and returns an empty map for no items', () => {
    const out = connectionOrdinals([
      { itemId: 'A', institution: null },
      { itemId: 'B', institution: null },
    ]);
    expect(out.get('A')).toEqual({ ordinal: 1, sameBankCount: 2 });
    expect(out.get('B')).toEqual({ ordinal: 2, sameBankCount: 2 });
    expect(connectionOrdinals([]).size).toBe(0);
  });

  it('projects the payload into connection identities', () => {
    const out = connectionsById([
      {
        itemId: 'A',
        institution: 'U.S. Bank',
        lastSyncedAt: '2026-07-24',
        accounts: [
          { name: 'Loan - 2927', mask: '2927' },
          { name: 'CREDIT CARD', mask: '0977' },
        ],
      },
      { itemId: 'B', institution: 'U.S. Bank', lastSyncedAt: null, accounts: [{ name: 'Loan - 2927', mask: '2927' }] },
    ]);
    expect([...out.keys()]).toEqual(['A', 'B']);
    expect(out.get('A')).toEqual({
      itemId: 'A',
      institution: 'U.S. Bank',
      lastSyncedAt: '2026-07-24',
      ordinal: 1,
      sameBankCount: 2,
      accountCount: 2,
    });
    expect(out.get('B')!.accountCount).toBe(1);
    expect(out.get('B')!.ordinal).toBe(2);
  });

  it('buckets only stamped rows, sorted by name then mask', () => {
    const out = visibleAccountsByItem([
      acct({ id: '1', name: 'B', mask: '0002', plaidItemId: 'it-1' }),
      acct({ id: '2', name: 'A', mask: '0001', plaidItemId: 'it-1' }),
      acct({ id: '3', name: 'A', mask: null, plaidItemId: 'it-1' }),
      acct({ id: '4', name: 'Z', mask: '9999', plaidItemId: null }),
    ]);
    expect(out.get('it-1')!.map((r) => r.id)).toEqual(['3', '2', '1']);
    expect(out.has('')).toBe(false);
    expect([...out.keys()]).toEqual(['it-1']);
  });

  it('formats the provider + last-4 label', () => {
    expect(providerMask({ provider: 'plaid', mask: '2927' })).toBe('Plaid ····2927');
    expect(providerMask({ provider: 'plaid', mask: null })).toBe('Plaid');
    expect(providerMask({ provider: 'simplefin', mask: null })).toBe('SimpleFIN');
    expect(providerMask({ provider: 'weird', mask: '1' })).toBe('weird ····1');
  });

  it('keeps the testid contract the e2e specs query', () => {
    expect(DUPLICATE_INTRO_TESTID).toBe('duplicate-intro');
    expect(DUPLICATE_HOWTO_TESTID).toBe('duplicate-howto');
    expect(DUPLICATE_PAIR_WHY_TESTID).toBe('duplicate-pair-why');
    expect(DUPLICATE_PAIR_IMPACT_TESTID).toBe('duplicate-pair-impact');
    expect(DUPLICATE_SIDE_A_TESTID).toBe('duplicate-side-a');
    expect(DUPLICATE_SIDE_B_TESTID).toBe('duplicate-side-b');
    expect(DUPLICATE_SIDE_CONNECTION_TESTID).toBe('duplicate-side-connection');
    expect(DUPLICATE_SIDE_FEEDS_TESTID).toBe('duplicate-side-feeds');
    expect(DUPLICATE_SIDE_NOTE_TESTID).toBe('duplicate-side-note');
  });
});
