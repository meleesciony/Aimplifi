/**
 * The destination catalogue — every place in the app, what it is FOR, and the words a reader
 * might go looking for it with.
 *
 * Owner, 2026-07-31: *"a lot of sections in the app are cumbersome in daily workflow. You
 * basically have to search it in a menu for it to show up. A new user wouldn't have this
 * knowledge."*
 *
 * The More sheet listed fourteen bare nouns, and four of them are near-synonyms whose difference
 * nobody can guess from the label: **Plan** is `/spending-plan`, **Spending** is `/budgets`,
 * **Reports** is `/reports` and **Trends** is `/trends`. A reader who wants "what did I spend on
 * groceries" has four plausible taps and no way to rank them, so the menu was a memory test —
 * which is exactly what "a new user wouldn't have this knowledge" describes.
 *
 * Two things fix that, and neither is a re-organisation: say what each page ANSWERS, and let the
 * reader type what they want instead of recognising a noun. `keywords` exists for the second —
 * "subscriptions" must find `/recurring` and "budget" must find both spending pages, even though
 * neither word is in either label.
 *
 * Descriptions are written from each page's OWN copy (its `<h1>`, its empty state, its view
 * docblock), not invented here: a menu that describes a page differently from the page is a
 * second source of truth about what the product does, and this repo has one status home for the
 * same reason.
 */

import {
  BarChart3,
  Calendar,
  CreditCard,
  Gauge,
  Inbox,
  Landmark,
  LayoutDashboard,
  LineChart,
  ListChecks,
  MessageCircle,
  PiggyBank,
  Receipt,
  Repeat,
  Settings,
  ShieldCheck,
  Sprout,
  TrendingUp,
  Wallet,
  Waves,
  type LucideIcon,
} from 'lucide-react';
import { INBOX_NAV_DESCRIPTION } from '@/lib/copy/inbox-copy';

/** Which block of the menu a destination belongs to. `primary` items are the bottom tab bar. */
export type NavGroup = 'primary' | 'money' | 'explore';

export interface NavDestination {
  href: string;
  /** The short name, unchanged from the shipped nav so muscle memory and testids survive. */
  label: string;
  /**
   * One line answering "what do I come here for", in the reader's terms. Present on EVERY
   * destination, not just the ambiguous ones — an item with a description beside one without
   * reads as the important one, which is a ranking nobody intended.
   */
  description: string;
  /**
   * Words a reader might search with that are NOT in the label or description. The label is the
   * app's word for the thing; these are the reader's. Kept lowercase — `matchesQuery` lowercases
   * the query once and compares against these directly.
   */
  keywords: readonly string[];
  group: NavGroup;
  icon: LucideIcon;
  testid: string;
}

/**
 * The catalogue. Order within each group is the shipped nav's order, unchanged — this slice makes
 * the menu legible, it does not re-rank it.
 *
 * The four near-synonyms are the reason this file exists, so they are described against each
 * other rather than each in isolation: **Plan** is the guilt-free figure and the maths behind it,
 * **Spending** is this month's actuals against targets you set, **Reports** is six months of
 * history, and **Trends** is what MOVED. A reader who wants "what did I spend on groceries" can
 * now pick one instead of guessing between four nouns.
 */
export const NAV_DESTINATIONS: readonly NavDestination[] = [
  {
    href: '/dashboard',
    label: 'Home',
    description: 'How much you need, and when — the whole picture in one screen.',
    keywords: ['overview', 'start', 'main', 'cash needed', 'summary'],
    group: 'primary',
    icon: LayoutDashboard,
    testid: 'nav-dashboard',
  },
  {
    href: '/cards',
    label: 'Cards',
    description: 'What to pay on every credit card, and by when, to clear each one in full.',
    keywords: ['credit', 'due date', 'minimum payment', 'statement', 'balance', 'payoff', 'apr'],
    group: 'primary',
    icon: CreditCard,
    testid: 'nav-cards',
  },
  {
    href: '/triage',
    label: 'Inbox',
    description: INBOX_NAV_DESCRIPTION,
    keywords: ['review', 'categorize', 'uncategorized', 'queue', 'needs review', 'ambiguous'],
    group: 'primary',
    icon: Inbox,
    testid: 'nav-triage',
  },
  {
    href: '/coach',
    label: 'Coach',
    description: 'Your savings rate, FI timeline, wealth target and money review.',
    keywords: [
      'fi',
      'financial independence',
      'retire',
      'savings rate',
      'wealth target',
      'million',
      'projection',
      'coast',
    ],
    group: 'primary',
    icon: Sprout,
    testid: 'nav-coach',
  },
  {
    href: '/calendar',
    label: 'Calendar',
    description: 'Dues, income and shortfalls laid out day by day.',
    keywords: ['due dates', 'bills', 'schedule', 'month view', 'inflows', 'paydays'],
    group: 'primary',
    icon: Calendar,
    testid: 'nav-calendar',
  },

  {
    href: '/spending-plan',
    label: 'Plan',
    description: 'How much is guilt-free to spend this month, and the line-by-line maths behind it.',
    keywords: ['budget', 'guilt free', 'safe to spend', 'allocation', 'left to spend', 'fixed costs'],
    group: 'money',
    icon: Gauge,
    testid: 'nav-spending-plan',
  },
  {
    href: '/budgets',
    label: 'Spending',
    description: 'Fixed vs guilt-free categories, this month\'s actuals, and targets you set.',
    keywords: [
      'budget',
      'targets',
      'caps',
      'limits',
      'categories',
      'this month',
      'groceries',
      'fixed',
      'guilt-free',
      'discretionary',
    ],
    group: 'money',
    icon: Wallet,
    testid: 'nav-budgets',
  },
  {
    href: '/reports',
    label: 'Reports',
    description: 'Six months of income against spending, plus this month by category.',
    keywords: ['history', 'chart', 'income', 'expenses', 'six months', 'past', 'graph'],
    group: 'money',
    icon: BarChart3,
    testid: 'nav-reports',
  },
  {
    href: '/accounts',
    label: 'Accounts',
    // "to open it", not "to see its transactions" (2026-08-11): loans,
    // mortgages and other tracked accounts have no register rows by
    // construction — they open their detail in place on /accounts.
    description: 'Everything you own and owe. Tap an account to open it.',
    keywords: ['balances', 'bank', 'connect', 'link', 'plaid', 'net worth', 'institution', 'add'],
    group: 'money',
    icon: Landmark,
    testid: 'nav-accounts',
  },
  {
    href: '/investments',
    label: 'Investments',
    description: 'Market value, gains, allocation and the holdings inside each account.',
    keywords: ['portfolio', 'holdings', 'brokerage', 'stocks', 'retirement', 'allocation', '401k'],
    group: 'money',
    icon: LineChart,
    testid: 'nav-investments',
  },
  {
    href: '/transactions',
    label: 'Activity',
    // "spending accounts", not "all accounts" (2026-08-11): the register's
    // basis is checking + savings + cards only (#62).
    description: 'Every transaction across your spending accounts. Search, filter, split, or add one by hand.',
    keywords: [
      'register',
      'search',
      'transactions',
      'receipts',
      'import',
      'csv',
      'manual',
      'split',
      'refund',
      'find',
    ],
    group: 'money',
    icon: Receipt,
    testid: 'nav-transactions',
  },
  {
    href: '/rules',
    label: 'Rules',
    description: 'Tell Aimplifi how to file a transaction and it follows your words instead of guessing.',
    keywords: ['categorize', 'keyword', 'automation', 'filing', 'rename', 'always file', 'fix'],
    group: 'money',
    icon: ListChecks,
    testid: 'nav-rules',
  },
  {
    href: '/goals',
    label: 'Goals',
    description: 'Savings targets and debt payoffs, each showing its effect on your FI date.',
    keywords: ['saving', 'target', 'debt', 'payoff', 'emergency fund', 'sinking fund'],
    group: 'money',
    icon: PiggyBank,
    testid: 'nav-goals',
  },
  {
    href: '/settings',
    label: 'Settings',
    description: 'Money dials, connections, categories, exports and your data.',
    keywords: [
      'preferences',
      'return',
      'inflation',
      'assumptions',
      'export',
      'password',
      'delete',
      'household',
      'notifications',
      'sign out',
    ],
    group: 'money',
    icon: Settings,
    testid: 'nav-settings',
  },

  {
    href: '/ask',
    label: 'Ask',
    description: 'Ask a question about your own money and get an answer computed from your data.',
    keywords: ['question', 'chat', 'ai', 'how much did i spend', 'query'],
    group: 'explore',
    icon: MessageCircle,
    testid: 'nav-ask',
  },
  {
    href: '/trends',
    label: 'Trends',
    description: 'What changed this month: category movers, biggest purchases and new merchants.',
    keywords: ['changes', 'movers', 'pace', 'new merchants', 'compare', 'month over month'],
    group: 'explore',
    icon: TrendingUp,
    testid: 'nav-trends',
  },
  {
    href: '/recurring',
    label: 'Recurring',
    description: 'Subscriptions and bills: what you pay, how often, what is next, and what crept up.',
    keywords: ['subscriptions', 'bills', 'memberships', 'price increase', 'cancel', 'unused', 'netflix'],
    group: 'explore',
    icon: Repeat,
    testid: 'nav-recurring',
  },
  {
    href: '/forecast',
    label: 'Forecast',
    description: 'Your projected balance day by day, with the low point and first negative flagged.',
    keywords: ['projection', 'cash flow', 'runway', 'balance', 'shortfall', 'overdraft', 'future'],
    group: 'explore',
    icon: Waves,
    testid: 'nav-forecast',
  },
  {
    href: '/trust',
    label: 'Trust',
    // The page's own headline invariant is a FIGURE ("Dollar figures the AI has authored: 0").
    // A menu is not a surface that recomputes it, so this points at the page and lets the page
    // state its own number rather than carrying a second copy of it that could go stale.
    description: 'What the AI touched, how often it was right, and which figures it authored.',
    keywords: ['ai', 'audit', 'accuracy', 'privacy', 'log', 'transparency'],
    group: 'explore',
    icon: ShieldCheck,
    testid: 'nav-trust',
  },
] as const;

/** The five bottom-tab destinations, in tab order. */
export const PRIMARY_DESTINATIONS = NAV_DESTINATIONS.filter((d) => d.group === 'primary');

/** Everything the More sheet lists, in sheet order. */
export const SHEET_DESTINATIONS = NAV_DESTINATIONS.filter((d) => d.group !== 'primary');
