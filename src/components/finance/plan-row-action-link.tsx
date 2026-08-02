'use client';

/**
 * Plan / glass-box row action. When the target is the Spending Fixed panel and
 * we are already on /budgets, scroll there — Next soft-nav to the same path
 * with a hash otherwise looks like a dead control.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { REVIEW_FIXED_HREF, SPEND_CLASS_PANEL_ID } from '@/lib/engine/spending-plan/fixed-review';

export function PlanRowActionLink({
  href,
  label,
  className,
  testId,
}: {
  href: string;
  label: string;
  className?: string;
  testId?: string;
}) {
  const pathname = usePathname();
  const toFixedPanel = href === REVIEW_FIXED_HREF || href === `/budgets#${SPEND_CLASS_PANEL_ID}`;

  if (toFixedPanel && pathname === '/budgets') {
    return (
      <a
        href={`#${SPEND_CLASS_PANEL_ID}`}
        className={className}
        data-testid={testId}
        onClick={(e) => {
          e.preventDefault();
          const el = document.getElementById(SPEND_CLASS_PANEL_ID);
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            history.replaceState(null, '', REVIEW_FIXED_HREF);
          }
        }}
      >
        {label}
      </a>
    );
  }

  return (
    <Link href={href} className={className} data-testid={testId}>
      {label}
    </Link>
  );
}
