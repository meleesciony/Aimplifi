/**
 * Route-group loading skeleton (DECISIONS #81). Next.js wires this via Suspense for
 * every (app) segment, so pages render an instant skeleton instead of a blank screen
 * while their server queries resolve — protecting the "answer how much do I need" goal
 * under real network/DB latency. Purely presentational; the real page replaces it.
 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-2xl animate-pulse space-y-4" aria-hidden="true">
      <div className="h-40 rounded-2xl border bg-card" />
      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-28 rounded-2xl border bg-card" />
        ))}
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
