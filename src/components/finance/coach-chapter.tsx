'use client';

import { useEffect, useRef } from 'react';

/**
 * Coach chapters (visual IA). The page is three jobs — this month, the
 * long game, and the habits that hold. Unread chapters start closed so
 * first paint is This month, not a 7000px feed. Content stays in the DOM
 * (e2e testids survive); hash links and the chapter nav open a target.
 */
export function CoachChapter({
  id,
  title,
  lead,
  defaultOpen = false,
  children,
}: {
  id: string;
  title: string;
  lead: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = window as Window & {
      __AIMPLIFI_E2E_OPEN_COACH?: boolean;
      __AIMPLIFI_E2E_KEEP_COACH_CLOSED?: boolean;
    };
    if (w.__AIMPLIFI_E2E_OPEN_COACH && !w.__AIMPLIFI_E2E_KEEP_COACH_CLOSED) {
      el.open = true;
    }
    const reveal = () => {
      el.open = true;
      el.focus();
    };
    const applyHash = () => {
      if (window.location.hash === `#${id}`) reveal();
    };
    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest('a');
      if (link?.getAttribute('href') === `#${id}`) reveal();
    };
    applyHash();
    window.addEventListener('hashchange', applyHash);
    document.addEventListener('click', onClick);
    return () => {
      window.removeEventListener('hashchange', applyHash);
      document.removeEventListener('click', onClick);
    };
  }, [id]);

  return (
    <details
      ref={ref}
      id={id}
      data-testid={`coach-chapter-${id}`}
      data-chapter={id.replace('coach-', '')}
      tabIndex={-1}
      open={defaultOpen || undefined}
      className="scroll-mt-20 space-y-5 sm:space-y-6"
    >
      <summary className="cursor-pointer border-b border-border/60 pb-3 ps-4">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <span className="mt-1 block max-w-2xl text-sm leading-relaxed text-muted-foreground">{lead}</span>
      </summary>
      {children}
    </details>
  );
}
