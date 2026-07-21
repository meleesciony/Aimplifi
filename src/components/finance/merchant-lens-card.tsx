/**
 * Merchant Pattern Lens card (AI plan §Later #19, DECISIONS #250). Renders the
 * server-computed narration VERBATIM — every line is a deterministic template
 * over the viewer's own rows (no LLM anywhere). Shown above the register when
 * it is filtered to one merchant; absent when the engine abstains.
 */
import Link from 'next/link';
import { Store } from 'lucide-react';
import { LENS_SCOPE_NOTE } from '@/lib/engine/merchant/lens-copy';
import type { MerchantLensView } from '@/server/transactions';

export function MerchantLensCard({ lens }: { lens: MerchantLensView }) {
  const { copy, thinNote } = lens;
  return (
    <section
      aria-label={copy.heading}
      data-testid="merchant-lens"
      className="space-y-1.5 rounded-md border bg-muted/30 px-4 py-3"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <Store className="size-4 text-muted-foreground" aria-hidden />
          {copy.heading}
        </h2>
        <Link
          href="/transactions"
          data-testid="merchant-lens-clear"
          className="shrink-0 text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          Show all transactions
        </Link>
      </div>
      <p className="text-sm" data-testid="merchant-lens-facts">
        {copy.factsLine}
      </p>
      {copy.typicalLine && (
        <p className="text-sm" data-testid="merchant-lens-typical">
          {copy.typicalLine}
        </p>
      )}
      {copy.trendLine && (
        <p className="text-sm" data-testid="merchant-lens-trend">
          {copy.trendLine}
        </p>
      )}
      {copy.cadenceLine && (
        <p className="text-sm" data-testid="merchant-lens-cadence">
          {copy.cadenceLine}
        </p>
      )}
      {thinNote && (
        <p className="text-xs text-muted-foreground" data-testid="merchant-lens-thin">
          {thinNote}
        </p>
      )}
      <p className="text-xs text-muted-foreground" data-testid="merchant-lens-scope">
        {copy.windowNote ? `${copy.windowNote} ${LENS_SCOPE_NOTE}` : LENS_SCOPE_NOTE}
      </p>
    </section>
  );
}
