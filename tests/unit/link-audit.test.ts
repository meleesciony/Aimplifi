/**
 * U.15 — re-auditing confirmed supersessions against today's rules.
 *
 * Fixtures are production-shaped: the names are the ones the owner's real corpus carries, where
 * nine confirmed links pair accounts that are not the same account (PROGRESS.md 2026-08-12).
 */
import { describe, expect, it } from 'vitest';

import {
  type AuditableLink,
  auditConfirmedLinks,
  unsupportedLinkCount,
} from '@/lib/engine/account/link-audit';
import type { DuplicateAccountCandidate } from '@/lib/engine/account/duplicates';

function acct(p: Partial<DuplicateAccountCandidate> & { id: string }): DuplicateAccountCandidate {
  return {
    provider: 'plaid',
    name: 'Account',
    type: 'INVESTMENT',
    mask: null,
    currentBalanceCents: 0,
    currency: 'USD',
    ...p,
  };
}
function link(p: Partial<AuditableLink> & { id: string }): AuditableLink {
  return {
    predecessorAccountId: 'pred',
    successorAccountId: 'succ',
    cutoverDate: '2026-07-24',
    ...p,
  };
}

const schwabIra = acct({
  id: 'pred',
  provider: 'simplefin',
  name: 'Charles Schwab US Roth Contributory IRA ...396 (396)',
  currentBalanceCents: 23_490_511,
});
const vanguardTraditional = acct({
  id: 'succ',
  provider: 'plaid',
  name: 'Michael Lee - Traditional IRA Brokerage Account - ****1548',
  mask: '1548',
  subtype: 'ira',
  currentBalanceCents: 1_571,
});

describe('auditConfirmedLinks', () => {
  it('flags a confirmed link the app would refuse to create today, and names the evidence', () => {
    const [row] = auditConfirmedLinks([schwabIra, vanguardTraditional], [link({ id: 'L1' })]);
    expect(row.verdict).toBe('unsupported');
    expect(row.predecessorName).toContain('Roth Contributory IRA');
    expect(row.successorName).toContain('Traditional IRA');
    // Both conflicts are real for this pair and both are stated as FACTS, not conclusions.
    expect(row.evidence.join(' | ')).toContain('Roth');
    expect(row.evidence.join(' | ')).toContain('account numbers don’t match');
    expect(unsupportedLinkCount([row])).toBe(1);
  });

  it('leaves a link today’s detector still supports alone', () => {
    const rows = auditConfirmedLinks(
      [
        acct({ id: 'pred', provider: 'simplefin', name: 'Charles Schwab US Community Property ...383 (383)', currentBalanceCents: 89_888_999 }),
        acct({ id: 'succ', provider: 'plaid', name: 'Community Property', mask: '7383', currentBalanceCents: 86_204_694 }),
      ],
      [link({ id: 'L2' })],
    );
    expect(rows[0].verdict).toBe('still-supported');
    expect(rows[0].evidence.some((e) => e.startsWith('shared name'))).toBe(true);
    expect(unsupportedLinkCount(rows)).toBe(0);
  });

  it('never reports a MISSING side as unsupported — an absent account is inert, not evidence', () => {
    const rows = auditConfirmedLinks([schwabIra], [link({ id: 'L3' })]);
    expect(rows[0].verdict).toBe('inert');
    expect(rows[0].successorName).toBeNull();
    expect(unsupportedLinkCount(rows)).toBe(0);
  });

  it('never reports the detector’s ABSTENTION as a refusal (one provider connection)', () => {
    // Both rows from one SimpleFIN connection: ingest already dedups there, so the detector is
    // silent by design. Reading that silence as "we would no longer propose this" would flag
    // every same-connection link in the app as suspect.
    const rows = auditConfirmedLinks(
      [
        acct({ id: 'pred', provider: 'simplefin', name: 'Old Checking', type: 'CHECKING' }),
        acct({ id: 'succ', provider: 'simplefin', name: 'Totally Different', type: 'CHECKING' }),
      ],
      [link({ id: 'L4' })],
    );
    expect(rows[0].verdict).toBe('not-checkable');
    expect(unsupportedLinkCount(rows)).toBe(0);
  });

  it('two plaid rows from DIFFERENT items are judged, not abstained on', () => {
    const rows = auditConfirmedLinks(
      [
        acct({ id: 'pred', provider: 'plaid', plaidItemId: 'item-a', name: 'Rollover IRA', mask: '0584' }),
        acct({ id: 'succ', provider: 'plaid', plaidItemId: 'item-b', name: 'Roth IRA', mask: '5351' }),
      ],
      [link({ id: 'L5' })],
    );
    expect(rows[0].verdict).toBe('unsupported');
  });

  it('says so plainly when a pair stopped matching with no nameable conflict', () => {
    const rows = auditConfirmedLinks(
      [
        acct({ id: 'pred', provider: 'simplefin', name: 'Zephyr Holdings', type: 'CHECKING' }),
        acct({ id: 'succ', provider: 'plaid', name: 'Quasar Trust', type: 'CHECKING' }),
      ],
      [link({ id: 'L6' })],
    );
    expect(rows[0].verdict).toBe('unsupported');
    expect(rows[0].evidence).toEqual(['nothing about these two rows matches any more']);
  });

  it('orders actionable rows first and is deterministic under input reordering', () => {
    const accounts = [
      schwabIra,
      vanguardTraditional,
      acct({ id: 'g1', provider: 'simplefin', name: 'Aardvark Bank ...383 (383)', type: 'CHECKING' }),
      acct({ id: 'g2', provider: 'plaid', name: 'Aardvark Bank', mask: '7383', type: 'CHECKING' }),
    ];
    const links = [
      link({ id: 'Lb', predecessorAccountId: 'g1', successorAccountId: 'g2' }),
      link({ id: 'La' }),
    ];
    const forward = auditConfirmedLinks(accounts, links).map((r) => r.link.id);
    const reversed = auditConfirmedLinks([...accounts].reverse(), [...links].reverse()).map((r) => r.link.id);
    expect(forward).toEqual(['La', 'Lb']);
    expect(reversed).toEqual(forward);
  });

  it('audits every link it is given — none is silently dropped', () => {
    const rows = auditConfirmedLinks(
      [schwabIra, vanguardTraditional],
      [link({ id: 'L1' }), link({ id: 'L2' }), link({ id: 'L3', successorAccountId: 'gone' })],
    );
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.link.id))).toEqual(new Set(['L1', 'L2', 'L3']));
  });
});
