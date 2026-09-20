'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Home chapters (#758 / #761). After the daily loop, unread bodies stay
 * unmounted so a phone is not a feature dump in the first HTML. First
 * open keeps the body mounted. Hash links and the chapter nav open a target.
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
  const [mounted, setMounted] = useState(defaultOpen);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = window as Window & {
      __AIMPLIFI_E2E_OPEN_HOME?: boolean;
      __AIMPLIFI_E2E_KEEP_HOME_CLOSED?: boolean;
    };
    const reveal = () => {
      setMounted(true);
      el.open = true;
      el.focus();
    };
    const e2eOpen =
      Boolean(w.__AIMPLIFI_E2E_OPEN_HOME) && !w.__AIMPLIFI_E2E_KEEP_HOME_CLOSED;
    const hashOpen = window.location.hash === `#${id}`;
    if (e2eOpen || hashOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- post-hydration one-shot window/hash read (#761); a lazy useState initializer would hydration-mismatch (server renders closed chapters)
      setMounted(true);
      el.open = true;
      if (hashOpen) el.focus();
    }
    const applyHash = () => {
      if (window.location.hash === `#${id}`) reveal();
    };
    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest('a');
      if (link?.getAttribute('href') === `#${id}`) reveal();
    };
    const onToggle = () => {
      if (el.open) setMounted(true);
    };
    el.addEventListener('toggle', onToggle);
    window.addEventListener('hashchange', applyHash);
    document.addEventListener('click', onClick);
    return () => {
      el.removeEventListener('toggle', onToggle);
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
      {mounted ? children : null}
    </details>
  );
}
