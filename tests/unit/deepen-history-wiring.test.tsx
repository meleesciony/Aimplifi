// @vitest-environment jsdom
/**
 * H.6 — the three lines that actually CARRY the owner's intent (critic finding F4).
 *
 * The provider half is locked in plaid-link-collision-wiring.test.ts, and the storage half in
 * plaid-update-mode.test.ts. Between them sat a hole a fresh-context critic named precisely:
 * nothing tested the component that puts the flag INTO those two halves. Delete the
 * `{ deepenHistory }` argument from the button's `linkPlaidAccount` call and every other test in
 * the slice stays green while the feature silently reverts to what the owner complained about —
 * an irreversibly discarded Item and ninety days of history.
 *
 * So this asserts the wiring itself, in both directions, because "the deepen button sends true"
 * is only half a contract: the ORDINARY Connect button sharing this component must still send
 * false, or L.10's refusal is repealed for every user by a default parameter.
 *
 * `react-plaid-link` is stubbed so `open()` resolves immediately into the success handler — the
 * real SDK needs a live link token and a bank. Everything on this side of that boundary is real:
 * the component, its click handler, the localStorage record, and the argument shapes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `vi.mock` factories are hoisted above every top-level binding, so the spies they return have
// to be created inside `vi.hoisted` rather than as ordinary consts.
const mocks = vi.hoisted(() => ({
  linkPlaidAccount: vi.fn(async () => ({ ok: true, added: 0 })),
  createPlaidLinkToken: vi.fn(async () => ({ ok: true, linkToken: 'tok-1', sandbox: false })),
  /** The live Link session's success callback, captured so a test can finish it deliberately. */
  session: { onSuccess: null as ((t: string) => void) | null, opened: false },
}));
const { linkPlaidAccount, createPlaidLinkToken } = mocks;

vi.mock('@/server/plaid-actions', () => ({
  linkPlaidAccount: mocks.linkPlaidAccount,
  createPlaidLinkToken: mocks.createPlaidLinkToken,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }) }));

/** The stubbed SDK: `open()` hands a public token straight to the component's onSuccess. */
// `open()` deliberately does NOT complete the session. The stash is written at open() and
// cleared when the exchange resolves, so a stub that succeeds instantly leaves no window in
// which to observe the record the OAuth return page would read — which is the whole point of
// two of these tests.
vi.mock('react-plaid-link', () => ({
  usePlaidLink: (cfg: { onSuccess: (t: string) => void }) => {
    mocks.session.onSuccess = cfg.onSuccess;
    return {
      open: () => {
        mocks.session.opened = true;
      },
      ready: true,
    };
  },
}));

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ConnectAccountsButton } from '@/components/finance/connect-accounts-button';
import { OAUTH_LINK_TOKEN_KEY, readStoredDeepenHistory } from '@/lib/plaid-oauth';

let container: HTMLDivElement;
let root: Root;

/** Mount, let the on-mount token mint settle, then click the one button rendered. */
async function mountAndClick(deepen: boolean): Promise<void> {
  await act(async () => {
    root.render(<ConnectAccountsButton deepenHistory={deepen} />);
  });
  const testId = deepen ? 'deepen-history-btn' : 'connect-bank-btn';
  const btn = container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
  if (!btn) throw new Error(`no ${testId} rendered`);
  await act(async () => {
    btn.click();
  });
  if (!mocks.session.opened) throw new Error('Link never opened');
}

/** Finish the Link session the click opened, as the real SDK does when the bank returns. */
async function completeLinkSession(): Promise<void> {
  const onSuccess = mocks.session.onSuccess;
  if (!onSuccess) throw new Error('no Link session to complete');
  await act(async () => {
    onSuccess('public-token-1');
  });
}

describe('the deepen intent reaches the server and the OAuth stash (H.6, critic F4)', () => {
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    window.localStorage.clear();
    linkPlaidAccount.mockClear();
    createPlaidLinkToken.mockClear();
    mocks.session.onSuccess = null;
    mocks.session.opened = false;
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('the deepen button tells the server this link is deliberate', async () => {
    await mountAndClick(true);
    await completeLinkSession();
    expect(linkPlaidAccount).toHaveBeenCalledWith('public-token-1', { deepenHistory: true });
  });

  it('the deepen button stamps the intent where the OAuth return page will find it', async () => {
    // The stash is what carries the intent through a Chase/Capital One redirect, which destroys
    // this component. Asserted through the module's own reader rather than the raw JSON so the
    // two halves cannot drift.
    await mountAndClick(true);
    expect(window.localStorage.getItem(OAUTH_LINK_TOKEN_KEY)).toBeTruthy();
    expect(readStoredDeepenHistory()).toBe(true);
  });

  it('test_regression__the_ordinary_connect_button_still_sends_false', async () => {
    // The half that protects everyone who did NOT ask for this. If the flag ever defaults on —
    // a flipped default, a spread that carries it, a prop rename — L.10's refusal is repealed
    // for every user of the front door and the owner's original complaint returns.
    await mountAndClick(false);
    expect(readStoredDeepenHistory()).toBe(false);
    await completeLinkSession();
    expect(linkPlaidAccount).toHaveBeenCalledWith('public-token-1', { deepenHistory: false });
  });

  it('an ordinary link opened after an abandoned deepen session overwrites the stale intent', async () => {
    // One record, stamped at every open(). The critic could not find a leak here and neither
    // could I; this pins the property that makes that true, because it is a property of WHERE
    // storeLinkToken is called, which a refactor could quietly move back to mint time.
    await mountAndClick(true);
    expect(readStoredDeepenHistory()).toBe(true);
    await act(async () => root.unmount());
    root = createRoot(container);
    await mountAndClick(false);
    expect(readStoredDeepenHistory()).toBe(false);
  });

  it('renders the caveat about hand-filed work only on the deepen door', async () => {
    await mountAndClick(true);
    expect(container.querySelector('[data-testid="deepen-history-caveat"]')).not.toBeNull();
    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () => {
      root.render(<ConnectAccountsButton />);
    });
    expect(container.querySelector('[data-testid="deepen-history-caveat"]')).toBeNull();
  });
});
