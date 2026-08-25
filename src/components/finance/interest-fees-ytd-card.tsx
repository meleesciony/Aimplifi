/**
 * Reports tile — interest & fees paid YTD (DECISIONS #516).
 * One-authored through COACH_COPY. Demo is honestly empty until a fee
 * category is filed; live Plaid BANK_FEES rows populate it.
 */
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';
import type { InterestFeesYtd } from '@/lib/engine/reports/interest-fees-ytd';
import type { DialOwnership } from '@/lib/engine/settings/dials';
import { cents, formatCents } from '@/lib/money';

export function InterestFeesYtdCard({
  result,
  dialOwnership,
  year,
}: {
  result: InterestFeesYtd | null;
  dialOwnership: DialOwnership;
  year: number;
}) {
  const sentence = result ? COACH_COPY.interestFeesYtd(result, dialOwnership) : null;

  return (
    <Card data-testid="interest-fees-ytd-card">
      <CardHeader className="pb-2">
        <CardDescription>{COACH_COPY.interestFeesYtdTitle(year)}</CardDescription>
        <CardTitle className="text-base" data-testid="interest-fees-ytd-paid">
          {result ? formatCents(cents(result.paidYtdCents)) : COACH_COPY.interestFeesYtdSubtitle()}
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm">
        {sentence ? (
          <p data-testid="interest-fees-ytd-sentence">{sentence}</p>
        ) : (
          <p className="text-muted-foreground" data-testid="interest-fees-ytd-empty">
            {COACH_COPY.interestFeesYtdEmpty(year)}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
