'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

function hashTarget(hash: string): string {
  return hash.startsWith('#') ? hash.slice(1) : hash;
}

function hrefHash(href: string): string {
  try {
    return new URL(href, window.location.href).hash;
  } catch {
    return '';
  }
}

const EMPTY_LANDMARKS: readonly string[] = [];

/**
 * Coach chapters (visual IA). Unread bodies stay unmounted so first HTML
 * is This month, not a 7000px card tree. First open mounts, then opens,
 * so the chapter is never an empty shell. Space/Enter preventDefault
 * until that first open is applied. A UA that already toggled open is
 * caught by a MutationObserver on `open`; flushSync mounts children in
 * that microtask, before paint. The leftover click (Enter's synthesized
 * click, or a UA-first toggle) is held open. Nested landmarks, hash,
 * nav, and the e2e harness open a target.
 */
export function CoachChapter({
  id,
  title,
  lead,
  defaultOpen = false,
  landmarks = EMPTY_LANDMARKS,
  children,
}: {
  id: string;
  title: string;
  lead: string;
  defaultOpen?: boolean;
  landmarks?: readonly string[];
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [mounted, setMounted] = useState(defaultOpen);
  const [focusNonce, setFocusNonce] = useState(0);
  const pendingOpen = useRef(false);
  const pendingFocus = useRef<string | null>(null);
  const mountedRef = useRef(defaultOpen);
  const readyRef = useRef(defaultOpen);
  const holdOpenRef = useRef(false);
  const holdOpenTimer = useRef(0);
  const landmarkKey = landmarks.join('\0');

  const armHoldOpen = () => {
    holdOpenRef.current = true;
    if (holdOpenTimer.current !== 0) window.clearTimeout(holdOpenTimer.current);
    holdOpenTimer.current = window.setTimeout(() => {
      holdOpenRef.current = false;
      holdOpenTimer.current = 0;
    }, 500);
  };

  useLayoutEffect(() => {
    mountedRef.current = mounted;
    const el = ref.current;
    if (!el || !mounted) return;
    if (pendingOpen.current) {
      pendingOpen.current = false;
      el.open = true;
      readyRef.current = true;
    }
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    const node = target === id ? el : document.getElementById(target);
    node?.focus();
  }, [mounted, focusNonce, id]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const adopt = () => {
      if (!el.open || mountedRef.current) return;
      pendingOpen.current = true;
      flushSync(() => {
        setMounted(true);
      });
      armHoldOpen();
    };
    const observer = new MutationObserver(adopt);
    observer.observe(el, { attributes: true, attributeFilter: ['open'] });
    el.addEventListener('toggle', adopt);
    return () => {
      observer.disconnect();
      el.removeEventListener('toggle', adopt);
      if (holdOpenTimer.current !== 0) window.clearTimeout(holdOpenTimer.current);
    };
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = window as Window & {
      __AIMPLIFI_E2E_OPEN_COACH?: boolean;
      __AIMPLIFI_E2E_KEEP_COACH_CLOSED?: boolean;
    };
    const ownsHash = (hash: string) => {
      const target = hashTarget(hash);
      if (!target) return false;
      const list = landmarkKey.length === 0 ? [] : landmarkKey.split('\0');
      return target === id || list.includes(target);
    };
    const reveal = (target = id) => {
      pendingOpen.current = true;
      pendingFocus.current = target;
      setMounted(true);
      setFocusNonce((n) => n + 1);
    };
    const e2eOpen =
      Boolean(w.__AIMPLIFI_E2E_OPEN_COACH) && !w.__AIMPLIFI_E2E_KEEP_COACH_CLOSED;
    const landHash = window.location.hash;
    const hashOpen = ownsHash(landHash);
    if (e2eOpen || hashOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- post-hydration one-shot window/hash read (#761); a lazy useState initializer would hydration-mismatch (server renders closed chapters)
      setMounted(true);
      pendingOpen.current = true;
      if (hashOpen) {
        pendingFocus.current = hashTarget(landHash);
        setFocusNonce((n) => n + 1);
      }
    }
    const applyHash = () => {
      const hash = window.location.hash;
      if (ownsHash(hash)) reveal(hashTarget(hash));
    };
    const onClick = (event: MouseEvent) => {
      const eventTarget = event.target;
      if (!(eventTarget instanceof Element)) return;
      const link = eventTarget.closest('a');
      const href = link?.getAttribute('href');
      if (!href) return;
      const hash = hrefHash(href);
      if (ownsHash(hash)) reveal(hashTarget(hash));
    };
    window.addEventListener('hashchange', applyHash);
    document.addEventListener('click', onClick);
    return () => {
      window.removeEventListener('hashchange', applyHash);
      document.removeEventListener('click', onClick);
    };
  }, [id, landmarkKey]);

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
      <summary
        className="cursor-pointer border-b border-border/60 pb-3 ps-4"
        onClick={(event) => {
          if (holdOpenRef.current) {
            event.preventDefault();
            holdOpenRef.current = false;
            if (holdOpenTimer.current !== 0) {
              window.clearTimeout(holdOpenTimer.current);
              holdOpenTimer.current = 0;
            }
            return;
          }
          if (readyRef.current) return;
          event.preventDefault();
          pendingOpen.current = true;
          setMounted(true);
        }}
        onKeyDown={(event) => {
          if (event.key !== ' ' && event.key !== 'Enter') return;
          if (holdOpenRef.current) {
            event.preventDefault();
            return;
          }
          if (readyRef.current) return;
          event.preventDefault();
          pendingOpen.current = true;
          setMounted(true);
          if (event.key === 'Enter') armHoldOpen();
        }}
      >
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <span className="mt-1 block max-w-2xl text-sm leading-relaxed text-muted-foreground">{lead}</span>
      </summary>
      {mounted ? children : null}
    </details>
  );
}
