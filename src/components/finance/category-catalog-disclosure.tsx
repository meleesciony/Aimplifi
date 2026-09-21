import type { ReactNode } from 'react';

/**
 * Built-in + custom category editors are a catalog, not a first-paint decision.
 * Inbox / Budgets / Rules keep the same managers; they start closed.
 */
export function CategoryCatalogDisclosure({
  children,
  testid,
  summary = 'Edit categories',
}: {
  children: ReactNode;
  testid: string;
  summary?: string;
}) {
  return (
    <details className="rounded-xl border bg-card" data-testid={testid}>
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium">{summary}</summary>
      <div className="space-y-5 border-t px-4 py-4">{children}</div>
    </details>
  );
}
