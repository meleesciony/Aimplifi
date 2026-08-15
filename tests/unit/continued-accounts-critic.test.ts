/**
 * #297 critic cycle 1 — three fresh-context hostile critics (copy honesty / uniqueness invariant /
 * downstream regressions). Every finding below arrived with an EXECUTED repro against the FIRST
 * implementation of `continuedAccountsView`; each is locked here so it cannot come back.
 *
 * Kept separate from continued-accounts-view.test.ts (which locks the happy-path render contract)
 * so the adversarial set reads as one body of work.
 */
import { describe, expect, it } from 'vitest';

import {
  type ContinuedAccountView,
  UNNAMED_ACCOUNT,
  continuedAccountsView,
} from '@/components/finance/continued-accounts-view';
import type { ReconciledPairView } from '@/server/transactions';

function link(p: {
  id: string;
  predName: string;
  predId?: string;
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
    // U.15 defaults: these fixtures predate the audit and assert the card's IDENTITY copy, so
    // they stand at the verdict that changes nothing on screen.
    auditVerdict: 'still-supported' as const,
    auditEvidence: [],
    predecessor: {
      id: p.predId ?? `pred-${p.id}`,
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

const labels = (v: ContinuedAccountView[]) => v.flatMap((g) => g.sources.map((s) => s.undoLabel));
const aria = (v: ContinuedAccountView[]) => v.flatMap((g) => g.sources.map((s) => s.undoAriaLabel));
const lines = (v: ContinuedAccountView[]) => v.flatMap((g) => g.sources.map((s) => s.identityLine));

describe('test_regression__combined_card_undo_labels_cannot_be_forged', () => {
  it('a predecessor NAMED like the old "(copy N)" breaker no longer ties with a rewritten label', () => {
    // The critic's exact repro: three links under three successors, so every ordinal is 1. The old
    // breaker rewrote r1/r2 to "… (copy 1)" / "… (copy 2)" and r3's literal name tied with r1 —
    // two byte-identical faces undoing different links, the very defect #297 was opened for.
    const views = continuedAccountsView([
      link({ id: 'r1', predName: 'Venture', succId: 'a', succName: 'A' }),
      link({ id: 'r2', predName: 'Venture', succId: 'b', succName: 'B' }),
      link({ id: 'r3', predName: 'Venture (copy 1)', succId: 'c', succName: 'C' }),
    ]);
    expect(labels(views)).toHaveLength(3);
    expect(new Set(labels(views)).size).toBe(3);
    expect(new Set(aria(views)).size).toBe(3);
  });

  it('numbers EVERY control once any two would tie, and anchors the number in the prose', () => {
    const views = continuedAccountsView([
      link({ id: 'r1', predName: 'Venture', succId: 'a', succName: 'A' }),
      link({ id: 'r2', predName: 'Venture', succId: 'b', succName: 'B' }),
    ]);
    expect(labels(views)).toEqual(['1. Undo: Venture', '2. Undo: Venture']);
    // The discriminator must exist beside the button, not only on it.
    expect(lines(views)[0].startsWith('1. ')).toBe(true);
    expect(lines(views)[1].startsWith('2. ')).toBe(true);
  });

  it('leaves the faces alone when they already differ', () => {
    const views = continuedAccountsView([
      link({ id: 'r1', predName: 'Alpha', succId: 'a', succName: 'A' }),
      link({ id: 'r2', predName: 'Beta', succId: 'b', succName: 'B' }),
    ]);
    expect(labels(views)).toEqual(['Undo: Alpha', 'Undo: Beta']);
    expect(lines(views)[0].startsWith('1. ')).toBe(false);
  });

  it('holds for a hostile alphabet across many shapes (the fuzz the critic ran)', () => {
    const names = ['X', 'X (copy 1)', 'X (copy 2)', 'X (copy 1) (copy 1)', 'Y', '', ' '];
    const succs = ['s1', 's2', 's3'];
    for (let seed = 0; seed < 400; seed++) {
      let n = seed;
      const count = 2 + (seed % 4);
      const rows: ReconciledPairView[] = [];
      for (let k = 0; k < count; k++) {
        rows.push(
          link({
            id: `r${k}`,
            predName: names[n % names.length],
            succId: succs[(n >> 3) % succs.length],
            succName: 'Live',
          }),
        );
        n = (n * 31 + 7) % 100003;
      }
      const v = continuedAccountsView(rows);
      expect(new Set(labels(v)).size).toBe(rows.length);
      expect(new Set(aria(v)).size).toBe(rows.length);
    }
  });
});

describe('test_regression__combined_card_distinctness_survives_rendering', () => {
  it('names differing only by invisible or collapsible characters do not paint identically', () => {
    // Provider names are written through untrimmed (simplefin.ts:475, plaid.ts:344), so a trailing
    // space, a doubled space, or a zero-width space is ordinary. Byte-different but
    // pixel-identical labels defeated the old raw-string comparison entirely.
    const views = continuedAccountsView([
      link({ id: 'r1', predName: 'Venture', succId: 'a', succName: 'A' }),
      link({ id: 'r2', predName: 'Venture ', succId: 'b', succName: 'B' }),
      link({ id: 'r3', predName: 'Ven​ture', succId: 'c', succName: 'C' }),
      link({ id: 'r4', predName: 'Venture  ', succId: 'd', succName: 'D' }),
    ]);
    // Sanitization really happened: all four collapse to the SAME rendered name...
    expect(views.flatMap((g) => g.sources.map((s) => s.name))).toEqual([
      'Venture',
      'Venture',
      'Venture',
      'Venture',
    ]);
    // ...so distinctness cannot have come from the data, only from the numbering.
    expect(new Set(labels(views)).size).toBe(4);
    for (const l of labels(views)) expect(l).toContain('Undo: Venture');
  });

  it('strips a bidi override that would reverse the rest of the button face at render time', () => {
    const views = continuedAccountsView([link({ id: 'r1', predName: '‮Venture‬ evil' })]);
    expect(views[0].sources[0].name).toBe('Venture evil');
    expect(views[0].sources[0].undoAriaLabel).not.toContain('‮');
  });

  it('never renders an empty control face for a name that sanitizes away to nothing', () => {
    const views = continuedAccountsView([link({ id: 'r1', predName: '​ ​' })]);
    expect(views[0].sources[0].name).toBe(UNNAMED_ACCOUNT);
    expect(views[0].sources[0].identityLine).toContain(UNNAMED_ACCOUNT);
  });
});

describe('test_regression__combined_card_never_claims_a_dead_account_is_live', () => {
  /**
   * The chain Q → P → S. getFinanceSnapshot emits one row per link using its DIRECT successor
   * (transactions.ts:525) and the boundary zeroes EVERY predecessor's balance
   * (reconcile-boundary.ts:419) — so P heads its own block while contributing $0, and the old
   * copy told the user their money was "counted on the live connection" P.
   */
  const views = continuedAccountsView([
    link({ id: 'r1', predName: 'Q old', succId: 'P', succName: 'P mid' }),
    link({ id: 'r2', predName: 'P mid', predId: 'P', succId: 'S', succName: 'S live' }),
  ]);

  it('flags the mid-chain block as itself combined, instead of implying it is live', () => {
    const mid = views.find((v) => v.successorId === 'P');
    expect(mid?.chainedLine).toContain('itself later combined');
    expect(mid?.chainedLine).toContain('does not count here');
  });

  it('leaves a genuine terminal account unflagged', () => {
    expect(views.find((v) => v.successorId === 'S')?.chainedLine).toBeNull();
  });

  it('never asserts WHERE the balance went — only that the old row stopped counting', () => {
    for (const line of lines(views)) {
      expect(line).toContain("this old account's balance no longer counts on its own");
      expect(line).not.toContain('counted on the live connection');
      expect(line).not.toContain('history kept through');
      expect(line).not.toContain('history still counts');
      expect(line).not.toContain('combined as of');
    }
  });

  it('never promises that BOTH accounts come back, which a chain undo cannot deliver', () => {
    for (const a of aria(views)) {
      expect(a).toContain('that old account counts on its own again');
      expect(a).not.toContain('both count on their own again');
    }
  });
});

describe('test_regression__combined_card_rows_stay_independent', () => {
  it('gives every rendered source a distinct React key even if two rows shared an id', () => {
    const views = continuedAccountsView([
      link({ id: 'dup', predName: 'Alpha', succId: 'a', succName: 'A' }),
      link({ id: 'dup', predName: 'Beta', succId: 'b', succName: 'B' }),
    ]);
    expect(new Set(views.flatMap((v) => v.sources.map((s) => s.key))).size).toBe(2);
  });

  it('renders each row OWN predecessor name even if two rows shared an id', () => {
    // U.17: the identity line no longer prints cutover (the payload has no
    // claim span, so any date here would be a false keep-through / effective
    // date). Independence is the predecessor name each row carries.
    const out = lines(
      continuedAccountsView([
        link({ id: 'dup', predName: 'Alpha', succId: 'a', succName: 'A', cutoverDate: '2026-01-01' }),
        link({ id: 'dup', predName: 'Beta', succId: 'b', succName: 'B', cutoverDate: '2026-09-09' }),
      ]),
    );
    expect(out[0]).toContain('Alpha');
    expect(out[1]).toContain('Beta');
    expect(out[0]).not.toContain('2026-01-01');
    expect(out[1]).not.toContain('2026-09-09');
  });
});

describe('test_regression__combined_card_single_source_block_claims_no_enumeration', () => {
  it('a block folding in ONE old account never says "old account 1"', () => {
    const views = continuedAccountsView([
      link({ id: 'r1', predName: 'Alpha', succId: 'a', succName: 'A' }),
      link({ id: 'r2', predName: 'Beta', succId: 'b', succName: 'B' }),
    ]);
    for (const l of labels(views)) expect(l).not.toContain('old account 1');
    for (const l of lines(views)) expect(l).not.toContain('Old account 1 of');
  });

  it('but a block that DOES enumerate keeps its ordinal on the button', () => {
    const views = continuedAccountsView([
      link({ id: 'r1', predName: 'Alpha' }),
      link({ id: 'r2', predName: 'Beta' }),
    ]);
    expect(labels(views)).toEqual(['Undo old account 1: Alpha', 'Undo old account 2: Beta']);
  });
});

describe('continuedAccountsView — WCAG 2.5.3 Label in Name', () => {
  const shapes: ReconciledPairView[][] = [
    [link({ id: 'r1', predName: 'Venture' })],
    [link({ id: 'r1', predName: 'Venture' }), link({ id: 'r2', predName: 'Venture' })],
    [
      link({ id: 'r1', predName: 'Venture', succId: 'a', succName: 'A' }),
      link({ id: 'r2', predName: 'Venture', succId: 'b', succName: 'B' }),
    ],
  ];
  it.each(shapes.map((rows, i) => ({ i, rows })))(
    'the accessible name always starts with the visible face — shape $i',
    ({ rows }) => {
      for (const v of continuedAccountsView(rows)) {
        for (const s of v.sources) expect(s.undoAriaLabel.startsWith(s.undoLabel)).toBe(true);
      }
    },
  );
});
