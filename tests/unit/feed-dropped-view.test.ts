/**
 * The disclosure for an account its bank has stopped sharing (TASKS L.14).
 *
 * GOLDEN LITERALS, not `f(x) === f(x, default)`. The L.15 critic cycle killed a test that
 * compared changed code against its own default and therefore could not fail; every expectation
 * here is the sentence a human read and approved.
 *
 * The two claims under test are the ones that can be FALSE rather than merely clumsy:
 *   • that the balance is still counted — true only because this slice deliberately adjusts no
 *     figure. If a later change starts excluding these rows, this file must go red.
 *   • that the reader can act where they are standing — true on /accounts, which lists the row and
 *     carries Delete and reconnect, and false on the dashboard, which carries neither.
 */
import { describe, expect, it } from 'vitest';

import { isoDate } from '@/lib/dates';
import {
  FEED_DROPPED_STILL_COUNTED,
  type DroppedAccountInput,
  feedDroppedDashboardNotice,
  feedDroppedLine,
  feedDroppedRemedies,
  feedDroppedRowNote,
} from '@/lib/engine/account/feed-dropped-view';

function dropped(over: Partial<DroppedAccountInput> = {}): DroppedAccountInput {
  return {
    id: 'acct-1',
    name: 'Everyday Checking',
    mask: '0977',
    type: 'CHECKING',
    feedDroppedAt: isoDate('2026-07-19'),
    currentBalanceCents: 421_055,
    ...over,
  };
}

describe('feedDroppedLine — what stopped, when, and what the frozen number is', () => {
  it('names the account, the date and the last balance', () => {
    expect(feedDroppedLine(dropped())).toBe(
      'Everyday Checking ••0977 — your bank stopped sharing this account on Sun, Jul 19, 2026. The last balance we saw was $4,210.55, and it has not changed since.',
    );
  });

  it('labels a CARD balance as owed — the same digits mean the opposite thing', () => {
    // Balances are stored positive with the type carrying the sign, so "$4,210.55" printed bare
    // beside a credit card reads as money the reader HAS when it is money they OWE (the
    // verbatim-value-not-verbatim-meaning lesson).
    expect(feedDroppedLine(dropped({ name: 'Sapphire', type: 'CREDIT' }))).toContain(
      'The last balance we saw was $4,210.55 owed',
    );
  });

  it('labels a LOAN as owed too, and a brokerage plainly', () => {
    expect(feedDroppedLine(dropped({ type: 'LOAN' }))).toContain('$4,210.55 owed');
    expect(feedDroppedLine(dropped({ type: 'INVESTMENT' }))).toContain('was $4,210.55, and');
  });

  it('drops the mask segment when the provider gave none', () => {
    expect(feedDroppedLine(dropped({ mask: null }))).toContain('Everyday Checking — your bank stopped');
  });

  it('renders a hostile account name safely', () => {
    // Bank- and user-supplied text reaches this sentence; renderSafe is what keeps an invisible
    // character or a run of whitespace from rewriting the disclosure's shape.
    expect(feedDroppedLine(dropped({ name: '  Everyday​   Checking  ' }))).toContain(
      'Everyday Checking ••0977 — your bank',
    );
  });
});

describe('feedDroppedDashboardNotice — a surface with no list and no controls', () => {
  it('is silent when nothing is dropped, so an unaffected dashboard is byte-identical', () => {
    expect(feedDroppedDashboardNotice([])).toBeNull();
  });

  it('states that the balance is STILL COUNTED, because it is', () => {
    const n = feedDroppedDashboardNotice([dropped()])!;
    expect(n.title).toBe('One account stopped updating');
    expect(n.body).toBe(
      'That last balance is still counted wherever Aimplifi adds up your accounts, because only you can tell us whether the account still exists.',
    );
  });

  it('points at the Accounts ROUTE, never at a position on the page', () => {
    // "the row below" is false here: the dashboard lists no accounts and carries neither the
    // Delete nor the reconnect control. Whether a surface can be pointed at is a fact about the
    // surface (L.15), so the builder that knows it is the one that says it.
    const n = feedDroppedDashboardNotice([dropped()])!;
    expect(n.whereToFix).toBe('Open Accounts to fix or remove it.');
    const all = [n.title, n.body, n.whereToFix, ...n.lines].join(' ');
    expect(all).not.toMatch(/\b(below|above|to the right|on this card)\b/i);
  });

  it('speaks for a PARTNER’s frozen account, by count, without naming it (critic F-3)', () => {
    // The viewer's own banner is own-rows-only, but the household figures on the same page sum a
    // partner's frozen balance. Silence there leaves a joint total resting on a stale number the
    // viewer cannot see, cannot fix, and is not told about. A count only: names and amounts belong
    // to another member and the sharing consent does not extend to narrating them here.
    const n = feedDroppedDashboardNotice([], 1)!;
    expect(n.title).toBe('One account stopped updating');
    expect(n.body).toContain('only they can reconnect it');
    expect(n.lines).toEqual([]);
    // Nothing of the viewer's own to fix, so it must not send them to a page to fix it.
    expect(n.whereToFix).toBeNull();
  });

  it('counts the viewer’s own and the partner’s together in the title', () => {
    const n = feedDroppedDashboardNotice([dropped()], 2)!;
    expect(n.title).toBe('3 accounts stopped updating');
    expect(n.body).toContain('2 of them belong to someone else');
    expect(n.lines).toHaveLength(1); // only the viewer's own is ever named
    expect(n.whereToFix).toBe('Open Accounts to fix or remove it.');
  });

  it('stays silent when neither side has anything frozen', () => {
    expect(feedDroppedDashboardNotice([], 0)).toBeNull();
  });

  it('ENUMERATES every affected account instead of printing a count over something else', () => {
    // A count computed over anything other than what renders is exactly the L.15 defect; naming
    // them all removes the possibility rather than guarding against it.
    const n = feedDroppedDashboardNotice([
      dropped({ id: 'a', name: 'Everyday Checking' }),
      dropped({ id: 'b', name: 'Sapphire', type: 'CREDIT', mask: '4321' }),
    ])!;
    expect(n.title).toBe('2 accounts stopped updating');
    expect(n.lines).toHaveLength(2);
    expect(n.lines[0]).toContain('Everyday Checking ••0977');
    expect(n.lines[1]).toContain('Sapphire ••4321');
    expect(n.whereToFix).toBe('Open Accounts to fix or remove them.');
  });
});

describe('feedDroppedRowNote — the surface that DOES carry the controls', () => {
  it('carries the consequence and both remedies while the bank is still connected', () => {
    const note = feedDroppedRowNote(dropped(), true);
    expect(note).toContain('Your bank stopped sharing this account on Sun, Jul 19, 2026');
    expect(note).toContain(FEED_DROPPED_STILL_COUNTED);
    expect(note).toContain('tick it again');
    expect(note).toContain('delete the row, which also removes its history');
  });

  it('does NOT repeat the account name — the row paints it on the line above', () => {
    // Critic P2-1: the previous version opened with the shared identity line, so the row printed
    // the name twice in two different mask glyphs (`····4321` heading vs `••4321` note).
    const note = feedDroppedRowNote(dropped(), true);
    expect(note).not.toContain('Everyday Checking');
    expect(note).not.toContain('••0977');
    expect(note.startsWith('Your bank stopped sharing')).toBe(true);
  });

  it('STOPS naming the re-tick once the bank is disconnected — that control is gone', () => {
    // Critic F-4: `PlaidUpdateButton` renders once per PlaidItem. Disconnect the bank and the row
    // and its stamp deliberately remain, but "reopen Add or fix accounts" sends a first-timer
    // hunting for a button that is not on the page.
    const note = feedDroppedRowNote(dropped(), false);
    expect(note).not.toContain('Add or fix accounts');
    expect(note).not.toContain('tick it again');
    expect(note).toContain('no longer connected');
    expect(note).toContain('connect it again');
    expect(note).toContain('delete the row, which also removes its history');
  });

  it('still states the frozen amount and the still-counted claim when disconnected', () => {
    const note = feedDroppedRowNote(dropped(), false);
    expect(note).toContain('$4,210.55');
    expect(note).toContain(FEED_DROPPED_STILL_COUNTED);
  });

  it('the two remedy strings are genuinely different, not one string with a flag', () => {
    expect(feedDroppedRemedies(true)).not.toBe(feedDroppedRemedies(false));
  });

  it('makes no positional claim in either state', () => {
    expect(feedDroppedRowNote(dropped(), true)).not.toMatch(/\b(below|above)\b/i);
    expect(feedDroppedRowNote(dropped(), false)).not.toMatch(/\b(below|above)\b/i);
  });
});
