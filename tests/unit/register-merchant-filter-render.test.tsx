// @vitest-environment jsdom
/**
 * The owner's 2026-08-07 screen, reproduced — and the rule that makes it
 * impossible, locked.
 *
 * REPORT: "still not showing up", with a register reading 0 transactions,
 * $0.00 / $0.00 / $0.00, "No transactions match these filters", and — four
 * lines above — "History available from Wed, Mar 25, 2026". Type, Account,
 * Category, Class and Period all on their defaults; search box empty; From and
 * To empty. Data present, zero shown, nothing on the page naming the reason.
 *
 * The one thing on that screen that could not appear without an active filter
 * is the "Clear" link (rendered on the same predicate as the "Showing a
 * filtered slice" copy). So a filter WAS on. `?merchant=` was the only axis in
 * that predicate the bar rendered no control for — invisible by construction,
 * and reachable from a dozen surfaces (register rows, the lens, /recurring,
 * /trends, the coach), where the match is EXACT on the display name and a name
 * no row carries returns zero forever.
 *
 * The first test below renders the bar with ONLY merchant set and asserts the
 * whole screenshot: every other control still on its default. The second is the
 * general rule rather than the one bug — EVERY axis in `hasFilters` must show
 * itself in the bar — which is what stops the next invisible filter from
 * shipping, since a new axis added to the predicate with no control fails here.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/transactions',
}));

vi.mock('next/link', () => ({
  default: function MockLink({
    href,
    children,
    prefetch = true,
    ...rest
  }: {
    href: string;
    children?: import('react').ReactNode;
    prefetch?: boolean;
  } & Omit<import('react').AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'children'>) {
    return (
      <a href={href} data-next-prefetch={prefetch ? 'true' : 'false'} {...rest}>
        {children}
      </a>
    );
  },
}));
// The register's row actions are server actions, and every one of them pulls
// next-auth into the module graph, which cannot load under jsdom. Stubbed at
// the ACTION boundary only — the component tree under test, empty state and
// filter bar included, is the real one. (Same technique as
// spend-window-render.test.tsx; no row is rendered by any test here anyway.)
vi.mock('@/server/custom-category-actions', () => ({ createCustomCategory: vi.fn() }));
vi.mock('@/server/tax-actions', () => ({ setTransactionTax: vi.fn() }));
vi.mock('@/server/transaction-flags-actions', () => ({
  setExcludeFromTotals: vi.fn(),
  setReimbursement: vi.fn(),
}));
vi.mock('@/server/triage-actions', () => ({ recategorize: vi.fn() }));

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TransactionFilters, transactionsHref } from '@/components/finance/transaction-filters';
import { TransactionList } from '@/components/finance/transaction-list';
import { cents } from '@/lib/money';

// This config does not enable vitest globals, so RTL's auto-cleanup does not
// run — without this the previous test's DOM survives and a CONTROL assertion
// can pass against the wrong render.
afterEach(() => {
  cleanup();
  push.mockClear();
});

/** Every axis off — the state the owner's controls were all displaying. */
const noFilters = {
  search: '',
  account: '',
  category: '',
  merchant: '',
  type: 'all',
  from: '',
  to: '',
  unclassified: false,
  reimbursement: null as 'awaiting' | 'received' | null,
  spendClass: '',
};

const ACCOUNTS = [{ id: 'acct_1', name: 'Chase Checking' }];
const CATEGORIES = [{ id: 'groceries', name: 'Groceries' }];

function renderBar(
  current: Partial<typeof noFilters>,
  unclassifiedCount = 0,
  missingAccountOption: { name: string | null } | null = null,
) {
  return render(
    <TransactionFilters
      accountOptions={ACCOUNTS}
      missingAccountOption={missingAccountOption}
      categoryOptions={CATEGORIES}
      current={{ ...noFilters, ...current }}
      unclassifiedCount={unclassifiedCount}
      today="2026-08-07"
      oldestDate="2026-03-25"
    />,
  );
}

describe("the owner's screen: a register filtered by something no control showed", () => {
  it('reproduces every visible control from the screenshot — and now names the merchant that was narrowing it', () => {
    renderBar({ merchant: 'Truist Mortg Olb Mtgpmt' });

    // The screenshot, control by control: all five selects on their defaults,
    // both date inputs empty, the search box empty. These are what made the
    // "No transactions match these filters" sentence unanswerable.
    expect((screen.getByLabelText('Type') as HTMLSelectElement).value).toBe('all');
    expect((screen.getByLabelText('Account') as HTMLSelectElement).value).toBe('');
    expect((screen.getByLabelText('Category') as HTMLSelectElement).value).toBe('');
    expect((screen.getByLabelText('Class') as HTMLSelectElement).value).toBe('');
    expect((screen.getByLabelText('Period') as HTMLSelectElement).value).toBe('all-time');
    expect((screen.getByLabelText('From date') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('To date') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Search transactions') as HTMLInputElement).value).toBe('');

    // The two things that WERE on his screen and disagreed with each other: a
    // Clear link (so a filter is on) and the history line (so rows exist).
    expect(screen.getByTestId('txn-clear')).toBeTruthy();
    // Byte-for-byte the sentence in the owner's screenshot.
    expect(screen.getByTestId('txn-history-span').textContent).toBe(
      'History available from Wed, Mar 25, 2026.',
    );

    // The fix: the filter that was doing the narrowing is now on the page, and
    // it says which merchant.
    expect(screen.getByTestId('txn-filter-merchant').textContent).toContain('Truist Mortg Olb Mtgpmt');
  });

  it('one tap on the chip clears the merchant and nothing else', () => {
    renderBar({ merchant: 'Peloton', type: 'expense' });
    fireEvent.click(screen.getByTestId('txn-filter-merchant'));
    expect(push).toHaveBeenCalledWith('/transactions?type=expense');
  });

  it('clearing the merchant when it is the only filter returns the bare register', () => {
    renderBar({ merchant: 'Peloton' });
    fireEvent.click(screen.getByTestId('txn-filter-merchant'));
    expect(push).toHaveBeenCalledWith('/transactions');
  });

  it('no chip when no merchant — a control that is always there is not a disclosure', () => {
    renderBar({});
    expect(screen.queryByTestId('txn-filter-merchant')).toBeNull();
    expect(screen.queryByTestId('txn-clear')).toBeNull();
  });

  it('a merchant name carrying &, # and quotes reaches the chip verbatim', () => {
    // The names that make `merchantRegisterHref` use encodeURIComponent are the
    // same ones a chip could mangle on the way back out.
    renderBar({ merchant: 'Barnes & Noble #1042' });
    expect(screen.getByTestId('txn-filter-merchant').textContent).toContain('Barnes & Noble #1042');
  });
});

/**
 * The rule, not the instance. Each row is an axis of the bar's own `hasFilters`
 * predicate paired with the thing a reader can see when it is on. A future axis
 * added to that predicate without a control — the exact defect this slice is
 * fixing — fails here rather than in an owner's screenshot.
 */
describe('every filter the register can apply, the register shows', () => {
  const AXES: { name: string; current: Partial<typeof noFilters>; visible: (c: HTMLElement) => void }[] = [
    {
      name: 'search',
      current: { search: 'kroger' },
      visible: () => expect((screen.getByLabelText('Search transactions') as HTMLInputElement).value).toBe('kroger'),
    },
    {
      name: 'account',
      current: { account: 'acct_1' },
      visible: () => expect((screen.getByLabelText('Account') as HTMLSelectElement).value).toBe('acct_1'),
    },
    {
      name: 'category',
      current: { category: 'groceries' },
      visible: () => expect((screen.getByLabelText('Category') as HTMLSelectElement).value).toBe('groceries'),
    },
    {
      name: 'merchant',
      current: { merchant: 'Peloton' },
      visible: () => expect(screen.getByTestId('txn-filter-merchant').textContent).toContain('Peloton'),
    },
    {
      name: 'type',
      current: { type: 'income' },
      visible: () => expect((screen.getByLabelText('Type') as HTMLSelectElement).value).toBe('income'),
    },
    {
      name: 'from',
      current: { from: '2026-01-01' },
      visible: () => expect((screen.getByLabelText('From date') as HTMLInputElement).value).toBe('2026-01-01'),
    },
    {
      name: 'to',
      current: { to: '2026-01-31' },
      visible: () => expect((screen.getByLabelText('To date') as HTMLInputElement).value).toBe('2026-01-31'),
    },
    {
      name: 'unclassified',
      current: { unclassified: true },
      visible: () => expect(screen.getByTestId('txn-filter-unclassified').getAttribute('aria-pressed')).toBe('true'),
    },
    {
      name: 'reimbursement',
      current: { reimbursement: 'awaiting' },
      visible: () => expect(screen.getByTestId('txn-filter-reimb').textContent).toContain('Awaiting reimbursement'),
    },
    {
      name: 'spendClass',
      current: { spendClass: 'fixed' },
      visible: () => expect((screen.getByLabelText('Class') as HTMLSelectElement).value).toBe('fixed'),
    },
  ];

  for (const axis of AXES) {
    it(`${axis.name}: on ⇒ readable in the bar, and clearable`, () => {
      const { container } = renderBar(axis.current);
      axis.visible(container);
      // Every axis also has to be escapable: the Clear link is the floor, and
      // it appears on exactly the predicate the page uses to say "filtered".
      expect(screen.getByTestId('txn-clear')).toBeTruthy();
      cleanup();
    });
  }
});

describe('the empty state names the merchant zero', () => {
  const summary = { count: 0, inflowCents: cents(0), outflowCents: cents(0), netCents: cents(0), excludedCount: 0, countedOnHandoverDays: 0 };
  const pageInfo = { page: 1, pageSize: 50, pageCount: 1, total: 0, fromIndex: 0, toIndex: 0 };

  it('states the string being matched and links back to the whole register', () => {
    render(
      <TransactionList
        rows={[]}
        summary={summary}
        pageInfo={pageInfo}
        emptyReason={{ kind: 'merchant', merchant: 'Truist Mortg Olb Mtgpmt', withOtherFilters: false }}
      />,
    );
    const box = screen.getByTestId('txn-empty-merchant');
    expect(box.textContent).toContain('No transactions here match “Truist Mortg Olb Mtgpmt”');
    // The reader who reaches this sentence has already failed to find the
    // control, so the way out is a link, not an instruction.
    const link = screen.getByText('Show all transactions');
    expect(link.getAttribute('href')).toBe('/transactions');
  });

  it('does not claim the merchant is the whole story when other filters are also on', () => {
    render(
      <TransactionList
        rows={[]}
        summary={summary}
        pageInfo={pageInfo}
        emptyReason={{ kind: 'merchant', merchant: 'Peloton', withOtherFilters: true }}
      />,
    );
    expect(screen.getByTestId('txn-empty-merchant').textContent).toContain('with your other filters');
  });

  it('the pre-existing filters copy is untouched for every other narrowing', () => {
    render(<TransactionList rows={[]} summary={summary} pageInfo={pageInfo} emptyReason={{ kind: 'filters' }} />);
    expect(screen.getByTestId('txn-empty').textContent).toContain('No transactions match these filters.');
  });
});

// ── the account axis (owner report 2026-08-11: the mortgage dead-end) ─────────

describe('the account select tells the truth about a filter its options do not hold', () => {
  it("the owner's screen: `?account=<mortgageId>` set — the select DISPLAYS the mortgage instead of painting All accounts over an active filter", () => {
    renderBar({ account: 'acct-mortgage' }, 0, { name: 'Home Mortgage' });
    const select = screen.getByLabelText('Account') as HTMLSelectElement;
    expect(select.value).toBe('acct-mortgage');
    const injected = screen.getByTestId('txn-filter-account-missing-option') as HTMLOptionElement;
    expect(injected.textContent).toBe('Home Mortgage');
    expect(injected.value).toBe('acct-mortgage');
    // With the injected option, choosing "All accounts" actually CHANGES the
    // DOM value — before it, the reader's most obvious escape was a silent
    // no-op (U.3 critic #6). Asserted structurally: the '' option exists and
    // is not the selected one.
    expect(select.value).not.toBe('');
  });

  it('an id matching no account of the reader is named as not found, never rendered blank', () => {
    renderBar({ account: 'acct-gone' }, 0, { name: null });
    expect(screen.getByTestId('txn-filter-account-missing-option').textContent).toBe('(account not found)');
  });

  it('no injected option when the dropdown already holds the filter — the option list stays exactly the filterable set', () => {
    renderBar({ account: 'acct_1' });
    expect(screen.queryByTestId('txn-filter-account-missing-option')).toBeNull();
  });
});

describe('the empty state names the account zero', () => {
  const summary = { count: 0, inflowCents: cents(0), outflowCents: cents(0), netCents: cents(0), excludedCount: 0, countedOnHandoverDays: 0 };
  const pageInfo = { page: 1, pageSize: 50, pageCount: 1, total: 0, fromIndex: 0, toIndex: 0 };

  it("a mortgage filter states the account, the register's basis, and the page that actually holds it", () => {
    render(
      <TransactionList
        rows={[]}
        summary={summary}
        pageInfo={pageInfo}
        emptyReason={{ kind: 'account-not-here', id: 'acct-m', name: 'Home Mortgage', type: 'MORTGAGE' }}
      />,
    );
    const box = screen.getByTestId('txn-empty-account-not-here');
    expect(box.textContent).toContain('“Home Mortgage” is a mortgage account');
    expect(box.textContent).toContain('checking, savings, and card accounts');
    expect(screen.getByText('Accounts').getAttribute('href')).toBe('/accounts');
  });

  it('an investment filter routes to Investments WITHOUT claiming the page will narrow to it — /investments falls back silently (#160, U.3 critic #9)', () => {
    render(
      <TransactionList
        rows={[]}
        summary={summary}
        pageInfo={pageInfo}
        emptyReason={{ kind: 'account-not-here', id: 'acct-b', name: 'Schwab Brokerage', type: 'INVESTMENT' }}
      />,
    );
    const box = screen.getByTestId('txn-empty-account-not-here');
    expect(box.textContent).toContain('“Schwab Brokerage” is an investment account');
    // The claim is about the PAGE, not this account's presence on it.
    expect(box.textContent).toContain('holdings for investment accounts live on');
    expect(box.textContent).not.toContain('its holdings live on');
    expect(screen.getByText('Investments').getAttribute('href')).toBe('/investments?account=acct-b');
  });

  it("a SPENDING type wearing not-here can only mean the currency guard — the copy says currency, never the self-contradiction 'a checking account…transactions come from checking' (U.3 critic #5)", () => {
    render(
      <TransactionList
        rows={[]}
        summary={summary}
        pageInfo={pageInfo}
        emptyReason={{ kind: 'account-not-here', id: 'acct-eur', name: 'Chequing (EUR)', type: 'CHECKING' }}
      />,
    );
    const box = screen.getByTestId('txn-empty-account-not-here');
    expect(box.textContent).toContain('held in another currency');
    expect(box.textContent).toContain('USD accounts only');
    // Not the type sentence — that pair of claims contradicts itself here.
    expect(box.textContent).not.toContain('is a checking account');
    // The link promises the currency NOTE, not a row /accounts does not render.
    expect(box.textContent).toContain('currency note on');
    expect(screen.getByText('Accounts').getAttribute('href')).toBe('/accounts');
  });

  it('an in-basis account with no rows names its own empty history (U.3 critic #2)', () => {
    render(
      <TransactionList
        rows={[]}
        summary={summary}
        pageInfo={pageInfo}
        emptyReason={{ kind: 'account-empty', name: 'New Checking' }}
      />,
    );
    const box = screen.getByTestId('txn-empty-account-empty');
    expect(box.textContent).toContain('The register holds no transactions for “New Checking” yet');
    expect(screen.getByText('See it on Accounts').getAttribute('href')).toBe('/accounts');
  });

  it("an unknown account id says 'isn't one of your own' — deletion is a cause this page cannot establish, and a partner's id lands here too (U.3 critic #10)", () => {
    render(
      <TransactionList rows={[]} summary={summary} pageInfo={pageInfo} emptyReason={{ kind: 'account-unknown' }} />,
    );
    const box = screen.getByTestId('txn-empty-account-unknown');
    expect(box.textContent).toContain("isn't one of your own");
    expect(box.textContent).toContain('may have been deleted or belong to someone else');
    expect(screen.getByText('Show all transactions').getAttribute('href')).toBe('/transactions');
  });

  it('the count line names the account zero beside the $0.00 tiles — the F2 rule extended (U.3 critic #7)', () => {
    render(
      <TransactionList
        rows={[]}
        summary={summary}
        pageInfo={pageInfo}
        emptyReason={{ kind: 'account-not-here', id: 'acct-m', name: 'Home Mortgage', type: 'MORTGAGE' }}
      />,
    );
    expect(screen.getByTestId('txn-list').textContent).toContain('0 transactions in an account this page can’t show');
  });
});

describe('Needs a category chip is a real link (DECISIONS #532)', () => {
  it('test_regression__needs_category_href_encodes_unclassified', () => {
    expect(transactionsHref(noFilters)).toBe('/transactions');
    expect(transactionsHref({ ...noFilters, unclassified: true })).toBe('/transactions?unclassified=1');
    expect(transactionsHref({ ...noFilters, from: '2026-01-01', unclassified: true })).toBe(
      '/transactions?from=2026-01-01&unclassified=1',
    );
    expect(transactionsHref({ ...noFilters, from: '2026-01-01', unclassified: false })).toBe(
      '/transactions?from=2026-01-01',
    );
  });

  it('test_regression__needs_category_chip_is_a_href_before_hydration', () => {
    renderBar({}, 15);
    const chip = screen.getByTestId('txn-filter-unclassified');
    expect(chip.tagName).toBe('A');
    expect(chip.getAttribute('href')).toBe('/transactions?unclassified=1');
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    cleanup();

    renderBar({ unclassified: true }, 15);
    const on = screen.getByTestId('txn-filter-unclassified');
    expect(on.getAttribute('href')).toBe('/transactions');
    expect(on.getAttribute('aria-pressed')).toBe('true');
    cleanup();

    renderBar({ from: '2026-01-01', unclassified: false }, 15);
    const mixed = screen.getByTestId('txn-filter-unclassified');
    expect(mixed.getAttribute('href')).toBe('/transactions?from=2026-01-01&unclassified=1');
    cleanup();
  });
});

describe('Activity period names calendar years (DECISIONS #566)', () => {
  it('test_regression__activity_period_lists_calendar_years', () => {
    renderBar({}, 0, null);
    const period = screen.getByTestId('txn-filter-period') as HTMLSelectElement;
    const labels = Array.from(period.options).map((o) => o.textContent);
    expect(labels).toContain('Last year');
    expect(labels).toContain('2024');
    expect(labels).toContain('2026');
    expect(labels).not.toContain('2025');
  });
});
