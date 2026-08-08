// @vitest-environment jsdom
/**
 * H.7b — the repair card's rendered states (critic cycle 1 P3-8: the demo
 * branch was rendered by no test, and card-local strings sat outside the copy
 * test's reach — both now imported from the copy module and asserted through a
 * real render).
 *
 * The server actions are stubbed (jsdom has no server); everything on this
 * side of that boundary is real: the component, its branches, the copy.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';

vi.mock('@/server/transfer-flag-repair-actions', () => ({
  applyTransferFlagRepairAction: vi.fn(async () => ({ ok: true, cleared: 1 })),
  undoTransferFlagRepairAction: vi.fn(async () => ({ ok: true, restored: 1, skipped: 0 })),
}));

import { TransferRepairCard } from '@/components/settings/transfer-repair-card';
import {
  REPAIR_DEMO_NOTE,
  repairCashAdvanceCaution,
  repairClaim,
  repairLastRunLine,
  repairNothingLine,
} from '@/components/settings/transfer-repair-copy';
import type { TransferFlagRepairPreview } from '@/server/transfer-flag-repair';

const basePreview: TransferFlagRepairPreview = {
  clearCount: 2,
  inflowCents: 50_000,
  outflowCents: 50_000,
  incomeCategorisedCount: 1,
  endorsedCount: 2,
  declinedOutOfScopeCount: 0,
  flaggedCount: 4,
  rows: [
    {
      id: 't1',
      date: '2026-05-03',
      amountCents: 50_000,
      rawDescriptor: 'CEF I CEF IV PPD',
      categoryId: 'income',
      categoryName: 'Income',
      accountName: 'Everyday Checking',
    },
    {
      id: 't2',
      date: '2026-05-01',
      amountCents: -50_000,
      rawDescriptor: 'KALSHI INC PAYMENT',
      categoryId: 'entertainment',
      categoryName: 'Entertainment & Streaming',
      accountName: 'Rewards Card',
    },
  ],
  lastRun: null,
};

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function render(preview: TransferFlagRepairPreview, canApply: boolean): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(<TransferRepairCard preview={preview} canApply={canApply} />);
  });
  return host;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const byId = (host: HTMLElement, id: string) => host.querySelector(`[data-testid="${id}"]`);

describe('H.7b card render states', () => {
  it('a real account with repairs: claim + caution + rows + apply button, no demo note', () => {
    const el = render(basePreview, true);
    expect(byId(el, 'transfer-repair-claim')?.textContent).toBe(repairClaim(basePreview));
    expect(byId(el, 'transfer-repair-caution')?.textContent).toBe(repairCashAdvanceCaution());
    expect(byId(el, 'transfer-repair-apply')).not.toBeNull();
    expect(byId(el, 'transfer-repair-demo-note')).toBeNull();
    expect(byId(el, 'transfer-repair-rows')?.textContent).toContain('KALSHI INC PAYMENT');
  });

  it('the shared demo sees the same claim but a read-only note — no door that fails, no undo', () => {
    const el = render(
      {
        ...basePreview,
        lastRun: {
          id: 'r1',
          createdAt: '2026-08-08T03:00:00.000Z',
          clearedCount: 2,
          skippedCount: 0,
          inflowCents: 0,
          outflowCents: 700,
          undone: false,
        },
      },
      false,
    );
    expect(byId(el, 'transfer-repair-claim')).not.toBeNull();
    expect(byId(el, 'transfer-repair-apply')).toBeNull();
    expect(byId(el, 'transfer-repair-demo-note')?.textContent).toBe(REPAIR_DEMO_NOTE);
    expect(byId(el, 'transfer-repair-undo')).toBeNull();
  });

  it('the zero state names its zero, and a standing run renders the recorded confirmation with Undo', () => {
    const el = render(
      {
        ...basePreview,
        clearCount: 0,
        rows: [],
        inflowCents: 0,
        outflowCents: 0,
        incomeCategorisedCount: 0,
        lastRun: {
          id: 'r1',
          createdAt: '2026-08-08T03:00:00.000Z',
          clearedCount: 2,
          skippedCount: 1,
          inflowCents: 500,
          outflowCents: 700,
          undone: false,
        },
      },
      true,
    );
    expect(byId(el, 'transfer-repair-nothing')?.textContent).toBe(
      repairNothingLine({ flaggedCount: 4, declinedOutOfScopeCount: 0 }),
    );
    const lastRun = byId(el, 'transfer-repair-last-run');
    expect(lastRun?.textContent).toContain(
      repairLastRunLine({ clearedCount: 2, skippedCount: 1, inflowCents: 500, outflowCents: 700 }),
    );
    expect(byId(el, 'transfer-repair-undo')).not.toBeNull();
  });
});
