import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { type WithheldAccountSummary, withheldBannerCopy } from '@/lib/providers/currency';

/**
 * Disclosure for accounts the currency guard withholds (DECISIONS #135 residual: a non-USD
 * account must not vanish SILENTLY from /accounts and the dashboard figures). Renders
 * nothing when nothing is withheld, so every all-USD user's page is byte-identical.
 *
 * All copy lives in the pure withheldBannerCopy (unit-tested grammar branches — checker);
 * this component only places it. role="status" (not the Alert default role="alert"): this
 * is a persistent qualifier of the figures on the page, not an interruption.
 */
export function CurrencyExclusionBanner({ summary }: { summary: WithheldAccountSummary }) {
  const copy = withheldBannerCopy(summary);
  if (!copy) return null;
  return (
    <Alert role="status" data-testid="currency-exclusion-banner">
      <AlertTitle>{copy.title}</AlertTitle>
      <AlertDescription>{copy.description}</AlertDescription>
    </Alert>
  );
}
