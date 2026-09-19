'use client';

import { useEffect, useRef } from 'react';

/**
 * Home chapters (#758). After the stage and the daily loop, unread chapters
 * start closed so a phone is not a feature dump. Content stays in the DOM
 * (e2e testids survive); hash links open a target.
 */
export function HomeChapter({
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
      __AIMPLIFI_E2E_OPEN_HOME?: boolean;
      __AIMPLIFI_E2E_KEEP_HOME_CLOSED?: boolean;
    };
    if (w.__AIMPLIFI_E2E_OPEN_HOME && !w.__AIMPLIFI_E2E_KEEP_HOME_CLOSED) {
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
      data-testid={`home-chapter-${id}`}
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
