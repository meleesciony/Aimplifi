'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

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
 * is This month, not a 7000px card tree. First open keeps the body mounted.
 * Hash links, nested landmarks, the chapter nav, and the e2e harness open a target.
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
  const pendingFocus = useRef<string | null>(null);
  const landmarkKey = landmarks.join('\0');

  useLayoutEffect(() => {
    const target = pendingFocus.current;
    if (!mounted || !target) return;
    pendingFocus.current = null;
    const node = target === id ? ref.current : document.getElementById(target);
    node?.focus();
  }, [mounted, focusNonce, id]);

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
      el.open = true;
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
      el.open = true;
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
      <summary className="cursor-pointer border-b border-border/60 pb-3 ps-4">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <span className="mt-1 block max-w-2xl text-sm leading-relaxed text-muted-foreground">{lead}</span>
      </summary>
      {mounted ? children : null}
    </details>
  );
}
