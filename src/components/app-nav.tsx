'use client';

/**
 * App navigation (DECISIONS #187 / Gap 3 §2, revised #757):
 * - sm+: grouped sidebar (primary / money / explore) — labels only;
 *   replacing the wrapping 19-pill header that read as a sitemap.
 * - phones: five primary destinations in the fixed bottom tab bar; secondary
 *   destinations live in a labelled "More" sheet opened from the header.
 *
 * prefetch={false} on ALL nav links (#166): every revalidatePath invalidated
 * the router cache and re-fired ~12 nav prefetches at once; a post-action
 * router.refresh() racing that storm was intermittently aborted, so mutations
 * looked like silent no-ops. Nav clicks now fetch on demand.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Menu, Search, X } from 'lucide-react';

import { BrandMark } from '@/components/brand-mark';
import { SignOutButton } from '@/components/auth/sign-out-button';
import {
  PRIMARY_DESTINATIONS,
  SHEET_DESTINATIONS,
  type NavDestination,
} from '@/lib/nav/destinations';
import { searchDestinations } from '@/lib/nav/search';

const PRIMARY = PRIMARY_DESTINATIONS;
const SHEET = SHEET_DESTINATIONS;

function sidebarLinkClass(active: boolean) {
  return `flex min-w-0 items-start gap-2 rounded-lg px-2 py-1.5 text-sm ${
    active
      ? 'bg-accent font-medium text-foreground'
      : 'text-muted-foreground hover:bg-accent hover:text-foreground'
  }`;
}

export function AppNav({ reviewBadge }: { reviewBadge?: React.ReactNode }) {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const [moreOpen, setMoreOpen] = useState(false);
  const [query, setQuery] = useState('');
  const moreBtnRef = useRef<HTMLButtonElement>(null);
  const sheetTitleId = useId();
  const searchId = useId();

  const closeMore = useCallback(() => {
    setMoreOpen(false);
    setQuery('');
  }, []);

  useEffect(() => {
    if (!moreOpen) return;
    document.getElementById(searchId)?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeMore();
        moreBtnRef.current?.focus();
        return;
      }
      if (e.key !== 'Tab') return;
      const sheet = document.getElementById('nav-more-sheet');
      if (!sheet) return;
      const focusable = [...sheet.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled])',
      )];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [moreOpen, closeMore, searchId]);

  const secondaryActive = SHEET.some((i) => isActive(i.href));

  const matches = useMemo(() => searchDestinations(SHEET, query), [query]);
  const money = matches.filter((d) => d.group === 'money');
  const explore = matches.filter((d) => d.group === 'explore');

  const wordmark = (
    <Link
      href="/dashboard"
      className="flex shrink-0 items-center gap-2 text-base font-bold tracking-tight sm:text-lg"
    >
      <BrandMark className="size-5 sm:size-6" />
      Aimplifi
    </Link>
  );

  return (
    <>
      <div data-testid="main-nav">
      <nav
        className="flex min-w-0 items-center justify-between gap-3 border-b border-border/70 px-4 py-3 sm:hidden"
        aria-label="Main"
      >
        {wordmark}
        <button
          ref={moreBtnRef}
          type="button"
          data-testid="nav-more"
          aria-expanded={moreOpen}
          aria-controls="nav-more-sheet"
          aria-haspopup="dialog"
          onClick={() => setMoreOpen((o) => !o)}
          className={`ml-auto flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm font-medium ${
            moreOpen || secondaryActive
              ? 'bg-brand-500/15 text-brand-500'
              : 'bg-accent/60 text-foreground'
          }`}
        >
          {moreOpen ? <X className="size-4" aria-hidden /> : <Menu className="size-4" aria-hidden />}
          More
        </button>
        <SignOutButton />
      </nav>

      <aside
        className="sticky top-0 hidden h-svh w-56 shrink-0 flex-col overflow-y-auto border-r border-border/70 bg-background/90 px-3 py-4 sm:flex"
        aria-label="Main"
        data-testid="desktop-sidebar"
      >
        <div className="mb-4 px-2">{wordmark}</div>
        <SidebarGroup label="Daily">
          {PRIMARY.map((item) => (
            <SidebarRow
              key={item.href}
              item={item}
              active={isActive(item.href)}
              testid={item.testid}
              reviewBadge={item.href === '/triage' ? reviewBadge : undefined}
            />
          ))}
        </SidebarGroup>
        <SidebarGroup label="Money & accounts">
          {SHEET.filter((d) => d.group === 'money').map((item) => (
            <SidebarRow
              key={item.href}
              item={item}
              active={isActive(item.href)}
              testid={`desktop-${item.testid}`}
            />
          ))}
        </SidebarGroup>
        <SidebarGroup label="Explore">
          {SHEET.filter((d) => d.group === 'explore').map((item) => (
            <SidebarRow
              key={item.href}
              item={item}
              active={isActive(item.href)}
              testid={`desktop-${item.testid}`}
            />
          ))}
        </SidebarGroup>
        <div className="mt-auto border-t border-border/60 pt-3">
          <SignOutButton testId="desktop-sign-out-form" />
        </div>
      </aside>
      </div>

      {moreOpen ? (
        <>
          <button
            type="button"
            aria-label="Close menu"
            data-testid="nav-more-backdrop"
            className="fixed inset-0 z-[45] bg-black/50 backdrop-blur-[2px] sm:hidden"
            onClick={() => {
              closeMore();
              moreBtnRef.current?.focus();
            }}
          />
          <div
            id="nav-more-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby={sheetTitleId}
            data-testid="nav-more-sheet"
            className="nav-more-sheet pointer-events-auto fixed inset-x-0 bottom-0 z-50 flex max-h-[min(78vh,36rem)] flex-col rounded-t-2xl border-t border-border/80 bg-background shadow-[0_-12px_40px_rgba(0,0,0,0.35)] sm:hidden"
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

            <div className="shrink-0 px-3 pb-3">
              <label htmlFor={searchId} className="sr-only">
                Search all sections
              </label>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <input
                  id={searchId}
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search — try “subscriptions” or “budget”"
                  autoComplete="off"
                  data-testid="nav-more-search"
                  className="h-11 w-full rounded-xl border border-border/60 bg-card pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground focus:border-brand-500/60"
                />
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
              {matches.length === 0 ? (
                <p className="px-1 py-6 text-center text-sm text-muted-foreground" data-testid="nav-more-empty">
                  Nothing here matches “{query}”. Try a word you would use for it — “bills”,
                  “targets”, “balance”.
                </p>
              ) : null}

              {money.length > 0 ? (
                <>
                  <p className="mb-2 px-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Money &amp; accounts
                  </p>
                  <ul className="space-y-2" data-testid="nav-more-secondary">
                    {money.map((item) => (
                      <SheetRow
                        key={item.href}
                        item={item}
                        active={isActive(item.href)}
                        onNavigate={closeMore}
                      />
                    ))}
                  </ul>
                </>
              ) : null}

              {explore.length > 0 ? (
                <>
                  <p className="mb-2 mt-4 px-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Explore
                  </p>
                  <ul className="space-y-2" data-testid="nav-more-discover">
                    {explore.map((item) => (
                      <SheetRow
                        key={item.href}
                        item={item}
                        active={isActive(item.href)}
                        onNavigate={closeMore}
                      />
                    ))}
                  </ul>
                </>
              ) : null}
            </div>
          </div>
        </>
      ) : null}

      <nav
        className="pb-safe-bottom pointer-events-none fixed inset-x-0 bottom-0 z-40 flex border-t border-border/70 bg-background/90 backdrop-blur-md sm:hidden"
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
              className={`pointer-events-auto relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] ${
                active
                  ? 'text-brand-500 before:absolute before:inset-x-5 before:top-0 before:h-0.5 before:rounded-full before:bg-brand-500'
                  : 'text-muted-foreground'
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

function SidebarGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <p className="mb-1 px-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <ul className="space-y-0.5">{children}</ul>
    </div>
  );
}

/** Labels that collide without a line of copy (Plan / Spending / Reports / Trends). */
const DESCRIBED_SIDEBAR = new Set(['/spending-plan', '/budgets', '/reports', '/trends']);

function SidebarRow({
  item,
  active,
  testid,
  reviewBadge,
}: {
  item: NavDestination;
  active: boolean;
  testid: string;
  reviewBadge?: React.ReactNode;
}) {
  const Icon = item.icon;
  const described = DESCRIBED_SIDEBAR.has(item.href);
  return (
    <li>
      <Link
        href={item.href}
        prefetch={false}
        data-testid={testid}
        aria-current={active ? 'page' : undefined}
        title={item.description}
        className={sidebarLinkClass(active)}
      >
        <Icon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span className="min-w-0">
          <span className="flex items-center gap-1">
            {item.label}
            {reviewBadge}
          </span>
          {described ? (
            <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
              {item.description}
            </span>
          ) : null}
        </span>
      </Link>
    </li>
  );
}

function SheetRow({
  item,
  active,
  onNavigate,
}: {
  item: NavDestination;
  active: boolean;
  onNavigate: () => void;
}) {
  const Icon = item.icon;
  return (
    <li>
      <Link
        href={item.href}
        prefetch={false}
        data-testid={item.testid}
        aria-current={active ? 'page' : undefined}
        onClick={onNavigate}
        className={`flex min-h-14 items-start gap-3 rounded-xl border px-3 py-2.5 transition ${
          active
            ? 'border-brand-500/40 bg-brand-500/10'
            : 'border-border/60 bg-card hover:border-foreground/20 hover:bg-accent/50'
        }`}
      >
        <span
          className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg ${
            active ? 'bg-brand-500/20 text-brand-500' : 'bg-muted text-foreground'
          }`}
        >
          <Icon className="size-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span
            className={`block text-sm font-medium leading-tight ${
              active ? 'text-brand-500' : 'text-foreground'
            }`}
          >
            {item.label}
          </span>
          <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
            {item.description}
          </span>
        </span>
      </Link>
    </li>
  );
}
