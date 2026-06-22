'use client';

/**
 * App navigation (cycle-1 H3): active-state aware on every viewport; at <sm
 * the five primary destinations live in a fixed bottom tab bar (thumb reach)
 * and the rest in the top bar, so nothing is hidden behind invisible scroll.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BarChart3,
  Calendar,
  CreditCard,
  Gauge,
  Inbox,
  Landmark,
  LayoutDashboard,
  PiggyBank,
  Receipt,
  Settings,
  Sprout,
  Wallet,
} from 'lucide-react';

const PRIMARY = [
  { href: '/dashboard', label: 'Home', icon: LayoutDashboard, testid: 'nav-dashboard' },
  { href: '/cards', label: 'Cards', icon: CreditCard, testid: 'nav-cards' },
  { href: '/triage', label: 'Inbox', icon: Inbox, testid: 'nav-triage' },
  { href: '/coach', label: 'Coach', icon: Sprout, testid: 'nav-coach' },
  { href: '/calendar', label: 'Calendar', icon: Calendar, testid: 'nav-calendar' },
] as const;

const SECONDARY = [
  { href: '/spending-plan', label: 'Plan', icon: Gauge, testid: 'nav-spending-plan' },
  { href: '/reports', label: 'Reports', icon: BarChart3, testid: 'nav-reports' },
  { href: '/accounts', label: 'Accounts', icon: Landmark, testid: 'nav-accounts' },
  { href: '/transactions', label: 'Activity', icon: Receipt, testid: 'nav-transactions' },
  { href: '/goals', label: 'Goals', icon: PiggyBank, testid: 'nav-goals' },
  { href: '/budgets', label: 'Spending', icon: Wallet, testid: 'nav-budgets' },
  { href: '/settings', label: 'Settings', icon: Settings, testid: 'nav-settings' },
] as const;

function topLinkClass(active: boolean) {
  return `rounded-md px-2 py-1 text-sm ${
    active
      ? 'bg-accent font-medium text-foreground'
      : 'text-muted-foreground hover:bg-accent hover:text-foreground'
  }`;
}

export function AppNav({ reviewBadge }: { reviewBadge?: React.ReactNode }) {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <>
      {/* top nav: full set from sm up; secondary-only on phones (primary moves to the bottom bar) */}
      <nav className="flex items-center gap-0.5 sm:gap-1" aria-label="Main">
        <Link href="/dashboard" className="mr-1 text-base font-bold tracking-tight sm:mr-2 sm:text-lg">
          Aim<span className="text-emerald-500">plifi</span>
        </Link>
        {PRIMARY.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            data-testid={item.testid}
            aria-current={isActive(item.href) ? 'page' : undefined}
            className={`hidden sm:block ${topLinkClass(isActive(item.href))}`}
          >
            {item.label}
            {item.href === '/triage' && reviewBadge}
          </Link>
        ))}
        {SECONDARY.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              data-testid={item.testid}
              aria-current={isActive(item.href) ? 'page' : undefined}
              aria-label={item.label}
              title={item.label}
              className={topLinkClass(isActive(item.href))}
            >
              {/* icon-only on phones — labels would overflow 380px (cycle-2 regression) */}
              <Icon className="size-4 sm:hidden" aria-hidden />
              <span className="hidden sm:inline">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* bottom tab bar — phones only */}
      <nav
        // pointer-events-none on the strip so content scrolled flush to the
        // viewport bottom stays clickable; links re-enable their own events
        className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex border-t bg-background/95 backdrop-blur sm:hidden"
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
              aria-current={active ? 'page' : undefined}
              data-testid={`bottom-${item.testid}`}
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
