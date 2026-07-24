/**
 * The "Combined accounts" card's render contract (#297) — the lock on the owner-reported defect of
 * 2026-07-24 (STATUS §Combined-accounts): two SimpleFIN predecessors both linked to the one live
 * Plaid "Venture ····6271" rendered as two byte-identical rows — same title, same
 * "continued from your old SimpleFIN account", same cutover date — with two byte-identical "Undo"
 * buttons, so there was no way to tell which link a tap would reverse.
 *
 * The module is pure and framework-free precisely so this file can lock every rendered string in
 * the node env (no RTL/jsdom in this repo). Hand-verified expectations; see docs/EDGE_CASES.md
 * §Combined-accounts.
 */
import { describe, expect, it } from 'vitest';

import {
  type ContinuedAccountView,
  CONTINUED_ACCOUNT_TESTID,
  CONTINUED_CARD_TESTID,
  CONTINUED_COMBINES_TESTID,
  CONTINUED_SOURCE_TESTID,
  CONTINUED_UNDO_TESTID,
  continuedAccountsView,
} from '@/components/finance/continued-accounts-view';
import type { ReconciledPairView } from '@/server/transactions';

/** The owner's live shape: a SimpleFIN predecessor folding into a live Plaid successor. */
function link(p: {
  id: string;
  predName: string;
  predMask?: string | null;
  predProvider?: string;
  succId?: string;
  succName?: string;
  succMask?: string | null;
  cutoverDate?: string;
}): ReconciledPairView {
  return {
    id: p.id,
    cutoverDate: p.cutoverDate ?? '2026-07-18',
    predecessor: {
      id: `pred-${p.id}`,
      name: p.predName,
      mask: p.predMask ?? null,
      provider: p.predProvider ?? 'simplefin',
    },
    successor: {
      id: p.succId ?? 'succ-venture',
      name: p.succName ?? 'Venture',
      mask: p.succMask ?? '6271',
      provider: 'plaid',
    },
  };
}

function allUndoLabels(views: ContinuedAccountView[]): string[] {
  return views.flatMap((v) => v.sources.map((s) => s.undoLabel));
}
function allUndoAria(views: ContinuedAccountView[]): string[] {
  return views.flatMap((v) => v.sources.map((s) => s.undoAriaLabel));
}
function allIdentityLines(views: ContinuedAccountView[]): string[] {
  return views.flatMap((v) => v.sources.map((s) => s.identityLine));
}

describe('continuedAccountsView — testids are stable', () => {
  it('keeps the pre-#297 card and source testids so existing specs still resolve', () => {
    expect(CONTINUED_CARD_TESTID).toBe('reconcile-combined');
    expect(CONTINUED_SOURCE_TESTID).toBe('reconcile-combined-pair');
    expect(CONTINUED_UNDO_TESTID).toBe('reconcile-undo');
    expect(CONTINUED_ACCOUNT_TESTID).toBe('reconcile-combined-account');
    expect(CONTINUED_COMBINES_TESTID).toBe('reconcile-combines-note');
  });
});

describe('continuedAccountsView — the single-link case is unchanged in substance', () => {
  const views = continuedAccountsView([link({ id: 'r1', predName: 'Venture Rewards' })]);

  it('renders one account block with one source', () => {
    expect(views).toHaveLength(1);
    expect(views[0].sources).toHaveLength(1);
    expect(views[0].name).toBe('Venture');
    expect(views[0].providerMask).toBe('Plaid ····6271');
  });

  it('states no "combines" note when only one old account folds in', () => {
    expect(views[0].combinesLine).toBeNull();
  });

  it('names the old account and keeps the history + balance disclosure', () => {
    expect(views[0].sources[0].identityLine).toBe(
      "Continued from your old account Venture Rewards (SimpleFIN) — history kept through 2026-07-18; this old account's balance no longer counts on its own.",
    );
  });

  it('leaves a lone Undo as a bare "Undo" — no gratuitous disambiguation', () => {
    expect(views[0].sources[0].undoLabel).toBe('Undo');
  });

  it('still gives the lone Undo a fully identifying accessible name', () => {
    expect(views[0].sources[0].undoAriaLabel).toBe(
      'Undo — separate Venture Rewards (SimpleFIN) from Venture (Plaid ····6271); that old account counts on its own again',
    );
  });
});

describe('test_regression__combined_card_sources_must_be_distinguishable', () => {
  /**
   * THE REPORTED DEFECT, verbatim shape: two SimpleFIN predecessors, one live Plaid successor.
   * Pre-#297 this produced two identical rows and two identical "Undo" buttons.
   */
  const owner = [
    link({ id: 'r1', predName: 'Venture' }),
    link({ id: 'r2', predName: 'Venture' }),
  ];
  const views = continuedAccountsView(owner);

  it('groups both links under ONE live account instead of listing it twice', () => {
    expect(views).toHaveLength(1);
    expect(views[0].successorId).toBe('succ-venture');
    expect(views[0].sources).toHaveLength(2);
  });

  it('states that two old accounts combine into it — the fact the flat list hid', () => {
    expect(views[0].combinesLine).toBe(
      'Combines 2 old accounts into this one. Each is listed below and can be undone on its own.',
    );
  });

  it('distinguishes the two sources by ordinal EVEN when the names are byte-identical', () => {
    const lines = allIdentityLines(views);
    expect(lines[0]).toBe(
      "Old account 1 of 2: Venture (SimpleFIN) — history kept through 2026-07-18; this old account's balance no longer counts on its own.",
    );
    expect(lines[1]).toBe(
      "Old account 2 of 2: Venture (SimpleFIN) — history kept through 2026-07-18; this old account's balance no longer counts on its own.",
    );
    expect(new Set(lines).size).toBe(2);
  });

  it('gives the two Undo buttons different faces and different accessible names', () => {
    expect(new Set(allUndoLabels(views)).size).toBe(2);
    expect(new Set(allUndoAria(views)).size).toBe(2);
  });

  it('keeps each Undo pointing at its own reconciliation id', () => {
    expect(views[0].sources.map((s) => s.id)).toEqual(['r1', 'r2']);
  });
});

describe('continuedAccountsView — distinctness is structural, not data-dependent', () => {
  /** The #296 cycle-2 F2 lesson: a per-group breaker sees no collision ACROSS groups. */
  it('breaks a tie between two different accounts that would each render one "Undo"', () => {
    const views = continuedAccountsView([
      link({ id: 'r1', predName: 'Venture', succId: 'succ-a', succName: 'Venture', succMask: '6271' }),
      link({ id: 'r2', predName: 'Venture', succId: 'succ-b', succName: 'Venture', succMask: '6271' }),
    ]);
    expect(views).toHaveLength(2);
    expect(new Set(allUndoLabels(views)).size).toBe(2);
    expect(new Set(allUndoAria(views)).size).toBe(2);
  });

  const shapes: { name: string; rows: ReconciledPairView[] }[] = [
    { name: 'one link', rows: [link({ id: 'r1', predName: 'Venture' })] },
    {
      name: 'two identical predecessors, one successor',
      rows: [link({ id: 'r1', predName: 'Venture' }), link({ id: 'r2', predName: 'Venture' })],
    },
    {
      name: 'three identical predecessors, one successor',
      rows: [
        link({ id: 'r1', predName: 'Venture' }),
        link({ id: 'r2', predName: 'Venture' }),
        link({ id: 'r3', predName: 'Venture' }),
      ],
    },
    {
      name: 'two successors, identical everything',
      rows: [
        link({ id: 'r1', predName: 'X', succId: 'a', succName: 'X', succMask: null }),
        link({ id: 'r2', predName: 'X', succId: 'b', succName: 'X', succMask: null }),
      ],
    },
    {
      name: 'empty names and null masks',
      rows: [
        link({ id: 'r1', predName: '', predMask: null, succId: 'a', succName: '', succMask: null }),
        link({ id: 'r2', predName: '', predMask: null, succId: 'a', succName: '', succMask: null }),
      ],
    },
    {
      name: 'mixed: one multi-source account and one single-source account',
      rows: [
        link({ id: 'r1', predName: 'Venture' }),
        link({ id: 'r2', predName: 'Venture' }),
        link({ id: 'r3', predName: 'Spark Miles', succId: 'succ-spark', succName: 'Spark Miles' }),
      ],
    },
    {
      name: 'a predecessor whose name already looks like our ordinal copy',
      rows: [
        link({ id: 'r1', predName: 'Venture (copy 1)' }),
        link({ id: 'r2', predName: 'Venture (copy 1)' }),
      ],
    },
    {
      name: 'manual predecessor folded into a plaid successor',
      rows: [
        link({ id: 'r1', predName: 'Old card', predProvider: 'manual' }),
        link({ id: 'r2', predName: 'Old card', predProvider: 'manual' }),
      ],
    },
  ];

  it.each(shapes)('no two Undo controls can ever tie — $name', ({ rows }) => {
    const views = continuedAccountsView(rows);
    const labels = allUndoLabels(views);
    const aria = allUndoAria(views);
    expect(labels).toHaveLength(rows.length);
    expect(new Set(labels).size).toBe(rows.length);
    expect(new Set(aria).size).toBe(rows.length);
  });

  it.each(shapes)('every source keeps its own reconciliation id — $name', ({ rows }) => {
    const views = continuedAccountsView(rows);
    const ids = views.flatMap((v) => v.sources.map((s) => s.id));
    expect(ids.sort()).toEqual(rows.map((r) => r.id).sort());
  });
});

describe('continuedAccountsView — grouping and ordering', () => {
  it('preserves first-appearance order of live accounts and payload order of sources', () => {
    const views = continuedAccountsView([
      link({ id: 'r1', predName: 'A', succId: 'succ-2', succName: 'Second' }),
      link({ id: 'r2', predName: 'B', succId: 'succ-1', succName: 'First' }),
      link({ id: 'r3', predName: 'C', succId: 'succ-2', succName: 'Second' }),
    ]);
    expect(views.map((v) => v.successorId)).toEqual(['succ-2', 'succ-1']);
    expect(views[0].sources.map((s) => s.name)).toEqual(['A', 'C']);
    expect(views[0].sources.map((s) => s.n)).toEqual([1, 2]);
    expect(views[1].sources.map((s) => s.n)).toEqual([1]);
  });

  it('returns nothing for no links (the card renders nothing at all)', () => {
    expect(continuedAccountsView([])).toEqual([]);
  });

  it('carries each link OWN cutover date, not the first one', () => {
    const views = continuedAccountsView([
      link({ id: 'r1', predName: 'A', cutoverDate: '2026-07-18' }),
      link({ id: 'r2', predName: 'B', cutoverDate: '2026-05-02' }),
    ]);
    expect(views[0].sources[0].identityLine).toContain('history kept through 2026-07-18');
    expect(views[0].sources[1].identityLine).toContain('history kept through 2026-05-02');
  });

  it('renders a predecessor mask when the old row has one', () => {
    const views = continuedAccountsView([
      link({ id: 'r1', predName: 'Venture', predMask: '4927', predProvider: 'plaid' }),
    ]);
    expect(views[0].sources[0].providerMask).toBe('Plaid ····4927');
  });
});

describe('continuedAccountsView — copy honesty', () => {
  const views = continuedAccountsView([
    link({ id: 'r1', predName: 'Venture' }),
    link({ id: 'r2', predName: 'Venture' }),
  ]);

  it('never claims the two links are correct — that is owner-only knowledge (rule 0)', () => {
    const prose = [
      views[0].combinesLine ?? '',
      ...allIdentityLines(views),
      ...allUndoLabels(views),
      ...allUndoAria(views),
    ].join(' ');
    for (const forbidden of ['same account', 'duplicate', 'verified', 'confirmed correct']) {
      expect(prose.toLowerCase()).not.toContain(forbidden);
    }
  });

  it('states that Undo is reversible in the accessible name of every control', () => {
    for (const aria of allUndoAria(views)) {
      expect(aria).toContain('that old account counts on its own again');
    }
  });

  it('states where the balance is counted, on every source line', () => {
    for (const line of allIdentityLines(views)) {
      expect(line).toContain("this old account's balance no longer counts on its own");
    }
  });
});
