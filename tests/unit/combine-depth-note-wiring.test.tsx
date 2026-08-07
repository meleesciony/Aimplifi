// @vitest-environment jsdom
/**
 * H.6c — the depth note actually reaches the combine card's option blocks.
 *
 * The engine carries `keepEarliestTxnDate`/`dropEarliestTxnDate` and the copy function is locked
 * in combine-connections-copy.test.ts, but the hop between them is the card — and H.6's own
 * ledger row records why the middle of a wire needs its own test: the untested hop is the one a
 * refactor can delete with every other test green. The mid-pull deepen state is exactly when
 * this note is the ONLY on-page warning that the prominent button would revoke the connection
 * still downloading two years of history.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { CombineConnectionsCard } from '@/components/finance/combine-connections-card';
import type { CombineConnectionsProposal, CombineDirection } from '@/lib/engine/account/combine-connections';

afterEach(cleanup);

const PAIR = {
  predecessorAccountId: 'a-old',
  predecessorName: 'CREDIT CARD',
  successorAccountId: 'a-new',
  successorName: 'CREDIT CARD',
  mask: '0977',
  tier: 'A' as const,
  reasons: ['same bank', 'same last-4'],
};

function direction(
  keep: string,
  drop: string,
  keepDate: string | null,
  dropDate: string | null,
): CombineDirection {
  return {
    keepItemId: keep,
    dropItemId: drop,
    offerable: true,
    keepEarliestTxnDate: keepDate,
    dropEarliestTxnDate: dropDate,
    strandedAccountNames: [],
    pairs: [PAIR],
  };
}

function renderCard(recommended: CombineDirection, alternative: CombineDirection | null) {
  const proposal: CombineConnectionsProposal = {
    institutionLabel: 'Chase',
    recommended,
    alternative,
    alternativeBlockedNames: [],
  };
  render(
    <CombineConnectionsCard
      proposals={[proposal]}
      items={[
        { itemId: 'item-old', institution: 'Chase' },
        { itemId: 'item-new', institution: 'Chase' },
      ]}
      pending={false}
      onCombine={() => {}}
      onDismiss={() => {}}
      blocked={[]}
      onFetchBankId={() => {}}
      onReconsider={() => {}}
    />,
  );
}

describe('the combine card renders the depth note beside the option it describes', () => {
  it('warns on the option that would drop the deeper side, and only on that option', () => {
    // The landed-deepen shape ranked the deep side as recommended; the ALTERNATIVE (keep the
    // shallow old side) is the one that needs the caveat.
    renderCard(
      direction('item-new', 'item-old', '2024-08-08', '2026-05-09'),
      direction('item-old', 'item-new', '2026-05-09', '2024-08-08'),
    );
    const notes = screen.getAllByTestId('combine-depth-note');
    expect(notes).toHaveLength(1);
    expect(notes[0].textContent).toContain('older history');
  });

  it('warns on BOTH options in the mid-pull shape — each direction carries a real depth risk', () => {
    // Before the background pull lands, the ranking itself prefers the old side — so the
    // PROMINENT button is the one that would revoke the still-downloading connection and must
    // carry the "wait" note. The alternative would drop the only side holding history while the
    // kept side has stored nothing yet, which is its own honest warning.
    renderCard(
      direction('item-old', 'item-new', '2026-05-09', null),
      direction('item-new', 'item-old', null, '2026-05-09'),
    );
    const notes = screen.getAllByTestId('combine-depth-note');
    expect(notes).toHaveLength(2);
    expect(notes[0].textContent).toContain('hasn’t stored any transactions yet');
    expect(notes[0].textContent).toContain('wait');
    expect(notes[1].textContent).toContain('older history');
  });

  it('renders no note when neither side has stored anything (the plain just-created duplicate)', () => {
    renderCard(
      direction('item-old', 'item-new', null, null),
      direction('item-new', 'item-old', null, null),
    );
    expect(screen.queryAllByTestId('combine-depth-note')).toHaveLength(0);
  });
});
