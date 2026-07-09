'use client';

/**
 * App navigation (DECISIONS #187 / Gap 3 §2):
 * - sm+: full labelled text links in the header (unchanged).
 * - phones: five primary destinations in the fixed bottom tab bar; secondary
 *   destinations live in a labelled "More" sheet opened from the header —
 *   replacing the old 8 unlabeled top icons (ROADMAP / COMPETITIVE_GAP_PLAN).
 *
 * prefetch={false} on ALL nav links (#166): every revalidatePath invalidated
 * the router cache and re-fired ~12 nav prefetches at once; a post-action
 * router.refresh() racing that storm was intermittently aborted, so mutations
 * looked like silent no-ops. Nav clicks now fetch on demand.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  BarChart3,
  Calendar,
  CreditCard,
  Gauge,
  Inbox,
  Landmark,
  LayoutDashboard,
  LineChart,
  Menu,
  PiggyBank,
  Receipt,
  Settings,
  Sprout,
  TrendingUp,
  Wallet,
  X,
  MessageCircle,
  Repeat,
  Waves,
} from 'lucide-react';

const PRIMARY = [
  { href: '/dashboard', label: 'Home', icon: LayoutDashboard, testid: 'nav-dashboard' },
  { href: '/cards', label: 'Cards', icon: CreditCard, testid: 'nav-cards' },
  { href: '/triage', label: 'Inbox', icon: Inbox, testid: 'nav-triage' },
  { href: '/coach', label: 'Coach', icon: Sprout, testid: 'nav-coach' },
  { href: '/calendar', label: 'Calendar', icon: Calendar, testid: 'nav-calendar' },
] as const;

/** Secondary destinations — labelled More sheet on phones; text links on sm+. */
const SECONDARY = [
  { href: '/spending-plan', label: 'Plan', icon: Gauge, testid: 'nav-spending-plan' },
  { href: '/reports', label: 'Reports', icon: BarChart3, testid: 'nav-reports' },
  { href: '/accounts', label: 'Accounts', icon: Landmark, testid: 'nav-accounts' },
  { href: '/investments', label: 'Investments', icon: LineChart, testid: 'nav-investments' },
  { href: '/transactions', label: 'Activity', icon: Receipt, testid: 'nav-transactions' },
  { href: '/goals', label: 'Goals', icon: PiggyBank, testid: 'nav-goals' },
  { href: '/budgets', label: 'Spending', icon: Wallet, testid: 'nav-budgets' },
  { href: '/settings', label: 'Settings', icon: Settings, testid: 'nav-settings' },
] as const;

/** Dashboard-only surfaces — discoverable from More so they aren't orphaned. */
const DISCOVER = [
  { href: '/ask', label: 'Ask', icon: MessageCircle, testid: 'nav-ask' },
  { href: '/trends', label: 'Trends', icon: TrendingUp, testid: 'nav-trends' },
  { href: '/recurring', label: 'Recurring', icon: Repeat, testid: 'nav-recurring' },
  { href: '/forecast', label: 'Forecast', icon: Waves, testid: 'nav-forecast' },
] as const;

function topLinkClass(active: boolean) {
  // shrink-0 so wrapped desktop rows keep whole labels (never squash into Sign out).
  return `shrink-0 rounded-md px-1.5 py-1 text-sm sm:px-2 ${
    active
      ? 'bg-accent font-medium text-foreground'
      : 'text-muted-foreground hover:bg-accent hover:text-foreground'
  }`;
}

export function AppNav({ reviewBadge }: { reviewBadge?: React.ReactNode }) {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreBtnRef = useRef<HTMLButtonElement>(null);
  const sheetTitleId = useId();

  const closeMore = useCallback(() => setMoreOpen(false), []);

  // Escape closes the sheet; restore focus to the trigger.
  // Route changes close via onClick on sheet + bottom-tab links (no pathname
  // setState-in-effect — react-hooks/set-state-in-effect).
  useEffect(() => {
    if (!moreOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setMoreOpen(false);
        moreBtnRef.current?.focus();
      }
    }
    document.addEventListener('keydown', onKey);
    // Soft lock: prevent background scroll while the sheet is open.
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [moreOpen]);

  const secondaryActive = SECONDARY.some((i) => isActive(i.href)) || DISCOVER.some((i) => isActive(i.href));

  return (
    <>
      {/* flex-1 + wrap on sm+: links share the header row with Sign out (sibling)
          without overlapping it; phones keep a single-line brand + More. */}
      <nav
        className="flex min-w-0 flex-1 flex-wrap items-center gap-0.5 sm:gap-x-0.5 sm:gap-y-1"
        aria-label="Main"
        data-testid="main-nav"
      >
        <Link href="/dashboard" className="mr-1 shrink-0 text-base font-bold tracking-tight sm:mr-2 sm:text-lg">
          Aim<span className="text-emerald-500">plifi</span>
        </Link>

        {/* Desktop: full labelled set */}
        {PRIMARY.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            prefetch={false}
            data-testid={item.testid}
            aria-current={isActive(item.href) ? 'page' : undefined}
            className={`hidden sm:inline-flex ${topLinkClass(isActive(item.href))}`}
          >
            {item.label}
            {item.href === '/triage' && reviewBadge}
          </Link>
        ))}
        {SECONDARY.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            prefetch={false}
            // Desktop-only testids (phones use the More-sheet copies — never both
            // mounted). Prefix keeps mobile e2e on nav-* sheet links unambiguous.
            data-testid={`desktop-${item.testid}`}
            aria-current={isActive(item.href) ? 'page' : undefined}
            className={`hidden sm:inline-flex ${topLinkClass(isActive(item.href))}`}
          >
            {item.label}
          </Link>
        ))}

        {/* Phones: one labelled More control replaces the old 8-icon strip */}
        <button
          ref={moreBtnRef}
          type="button"
          data-testid="nav-more"
          aria-expanded={moreOpen}
          aria-controls="nav-more-sheet"
          aria-haspopup="dialog"
          onClick={() => setMoreOpen((o) => !o)}
          className={`ml-auto flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm font-medium sm:hidden ${
            moreOpen || secondaryActive
              ? 'bg-emerald-500/15 text-emerald-500'
              : 'bg-accent/60 text-foreground'
          }`}
        >
          {moreOpen ? <X className="size-4" aria-hidden /> : <Menu className="size-4" aria-hidden />}
          More
        </button>
      </nav>

      {/* More sheet — phones only; labelled 2-col grid (Gap 3 §2).
          Fragment (not a flow wrapper) so opening it doesn't steal header flex space. */}
      {moreOpen ? (
        <>
          <button
            type="button"
            aria-label="Close menu"
            data-testid="nav-more-backdrop"
            className="fixed inset-0 z-[45] bg-black/50 backdrop-blur-[2px] sm:hidden"
            onClick={closeMore}
          />
          <div
            id="nav-more-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby={sheetTitleId}
            data-testid="nav-more-sheet"
            className="nav-more-sheet pointer-events-auto fixed inset-x-0 bottom-0 z-50 flex max-h-[min(78vh,36rem)] flex-col rounded-t-2xl border-t border-border/80 bg-background shadow-[0_-12px_40px_rgba(0,0,0,0.35)] sm:hidden"
            // Sit above the bottom tab bar + safe area so tabs stay reachable
            // and the sheet doesn't cover the home indicator.
            style={{ paddingBottom: 'calc(5rem + env(safe-area-inset-bottom))' }}
          >
            <div className="flex shrink-0 items-center justify-between px-4 pb-2 pt-3">
              <div className="mx-auto h-1 w-10 rounded-full bg-muted-foreground/30" aria-hidden />
            </div>
            <div className="flex items-center justify-between px-4 pb-3">
              <h2 id={sheetTitleId} className="text-base font-semibold tracking-tight">
                More
              </h2>
              <button
                type="button"
                data-testid="nav-more-close"
                aria-label="Close"
                onClick={() => {
                  closeMore();
                  moreBtnRef.current?.focus();
                }}
                className="flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
              <p className="mb-2 px-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Money &amp; accounts
              </p>
              <ul className="grid grid-cols-2 gap-2" data-testid="nav-more-secondary">
                {SECONDARY.map((item) => {
                  const active = isActive(item.href);
                  const Icon = item.icon;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        prefetch={false}
                        data-testid={item.testid}
                        aria-current={active ? 'page' : undefined}
                        onClick={closeMore}
                        className={`flex min-h-14 items-center gap-3 rounded-xl border px-3 py-2.5 transition ${
                          active
                            ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500'
                            : 'border-border/60 bg-card text-foreground hover:border-foreground/20 hover:bg-accent/50'
                        }`}
                      >
                        <span
                          className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${
                            active ? 'bg-emerald-500/20' : 'bg-muted'
                          }`}
                        >
                          <Icon className="size-4" aria-hidden />
                        </span>
                        <span className="text-sm font-medium leading-tight">{item.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>

              <p className="mb-2 mt-4 px-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Explore
              </p>
              <ul className="grid grid-cols-2 gap-2" data-testid="nav-more-discover">
                {DISCOVER.map((item) => {
                  const active = isActive(item.href);
                  const Icon = item.icon;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        prefetch={false}
                        data-testid={item.testid}
                        aria-current={active ? 'page' : undefined}
                        onClick={closeMore}
                        className={`flex min-h-14 items-center gap-3 rounded-xl border px-3 py-2.5 transition ${
                          active
                            ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500'
                            : 'border-border/60 bg-card text-foreground hover:border-foreground/20 hover:bg-accent/50'
                        }`}
                      >
                        <span
                          className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${
                            active ? 'bg-emerald-500/20' : 'bg-muted'
                          }`}
                        >
                          <Icon className="size-4" aria-hidden />
                        </span>
                        <span className="text-sm font-medium leading-tight">{item.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </>
      ) : null}

      {/* bottom tab bar — phones only; five primary destinations unchanged */}
      <nav
        // pointer-events-none on the strip so content scrolled flush to the
        // viewport bottom stays clickable; links re-enable their own events
        className="pb-safe-bottom pointer-events-none fixed inset-x-0 bottom-0 z-40 flex border-t bg-background/95 backdrop-blur sm:hidden"
        aria-label="Primary"
        data-testid="bottom-nav"
      >
        {PRIMARY.map((item) => {
          const active = isActive(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch={false}
              aria-current={active ? 'page' : undefined}
              data-testid={`bottom-${item.testid}`}
              onClick={closeMore}
              className={`pointer-events-auto relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] ${
                active ? 'text-emerald-500' : 'text-muted-foreground'
              }`}
            >
              <Icon className="size-5" aria-hidden />
              {item.label}
              {item.href === '/triage' && (
                <span className="absolute right-1/2 top-1 translate-x-4">{reviewBadge}</span>
              )}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
