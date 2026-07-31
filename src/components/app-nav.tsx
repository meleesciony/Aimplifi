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
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Menu, Search, X } from 'lucide-react';

import {
  PRIMARY_DESTINATIONS,
  SHEET_DESTINATIONS,
  type NavDestination,
} from '@/lib/nav/destinations';
import { searchDestinations } from '@/lib/nav/search';

/**
 * The three lists are now VIEWS of `NAV_DESTINATIONS`, not their own arrays.
 *
 * They used to be three hand-maintained tuples of `{href, label, icon, testid}` — fourteen bare
 * nouns, four of which are near-synonyms (Plan is /spending-plan, Spending is /budgets, and
 * Reports and Trends are both charts of spending). The owner's report was that finding anything
 * meant hunting a menu, and that "a new user wouldn't have this knowledge": with nothing but a
 * label to go on, choosing between those four IS knowledge you have to already have.
 *
 * Descriptions and search keywords live in `@/lib/nav/destinations` so they can be unit-tested
 * against each other (a description that fails to distinguish its neighbours is a test failure,
 * not a matter of taste) and so a route can never again be added to a menu without saying what
 * it is for.
 */
const PRIMARY = PRIMARY_DESTINATIONS;
const SHEET = SHEET_DESTINATIONS;

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
  const [query, setQuery] = useState('');
  const moreBtnRef = useRef<HTMLButtonElement>(null);
  const sheetTitleId = useId();
  const searchId = useId();

  const closeMore = useCallback(() => {
    setMoreOpen(false);
    // Reopening to someone else's leftover filter looks like a menu that has lost items — the
    // exact "where did it go" this slice exists to remove.
    setQuery('');
  }, []);

  // Escape closes the sheet; restore focus to the trigger.
  // Route changes close via onClick on sheet + bottom-tab links (no pathname
  // setState-in-effect — react-hooks/set-state-in-effect).
  useEffect(() => {
    if (!moreOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        // `closeMore`, not a bare `setMoreOpen(false)`: there are THREE ways to close this sheet
        // (Escape, the X, the backdrop) and closing now also has to reset the search. Escape was
        // the one that took its own path and kept the filter, so reopening showed a menu missing
        // most of its items — `fence-by-construction-not-per-call-site`, at the smallest scale.
        closeMore();
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
  }, [moreOpen, closeMore]);

  const secondaryActive = SHEET.some((i) => isActive(i.href));

  const matches = useMemo(() => searchDestinations(SHEET, query), [query]);
  const money = matches.filter((d) => d.group === 'money');
  const explore = matches.filter((d) => d.group === 'explore');

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
        {SHEET.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            prefetch={false}
            // Desktop-only testids (phones use the More-sheet copies — never both
            // mounted). Prefix keeps mobile e2e on nav-* sheet links unambiguous.
            data-testid={`desktop-${item.testid}`}
            aria-current={isActive(item.href) ? 'page' : undefined}
            // The desktop row has no space for a description, so it carries one as a tooltip —
            // "Plan" vs "Spending" vs "Reports" vs "Trends" is unguessable from the label here too.
            title={item.description}
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

            {/* Search sits ABOVE the list and filters it; it never replaces it. An empty query
                shows the whole menu, so a reader who ignores the box sees exactly what they saw
                before it existed, and one who uses it can type their own word — "subscriptions"
                for Recurring, "401k" for Investments — instead of recognising the app's. */}
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
                  className="h-11 w-full rounded-xl border border-border/60 bg-card pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground focus:border-emerald-500/60"
                />
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
              {matches.length === 0 ? (
                // A real state, given its own words. An empty list and a menu that failed to load
                // look identical, and only one of them is the reader's fault.
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

/**
 * One destination in the More sheet: icon, name, and the line saying what it answers.
 *
 * Single column rather than the old 2-col tile grid, because the descriptions are the fix and
 * they do not fit two-up at 380px. The sheet already scrolls; fourteen legible rows beat fourteen
 * ambiguous nouns that happen to fit on one screen.
 */
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
            ? 'border-emerald-500/40 bg-emerald-500/10'
            : 'border-border/60 bg-card hover:border-foreground/20 hover:bg-accent/50'
        }`}
      >
        <span
          className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg ${
            active ? 'bg-emerald-500/20 text-emerald-500' : 'bg-muted text-foreground'
          }`}
        >
          <Icon className="size-4" aria-hidden />
        </span>
        {/* min-w-0 down to the text: the mobile-overflow lesson — every flex item in the chain,
            or a long description pushes the row past the viewport on iOS Safari. */}
        <span className="min-w-0 flex-1">
          <span
            className={`block text-sm font-medium leading-tight ${
              active ? 'text-emerald-500' : 'text-foreground'
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
