/**
 * Reports tile — Giving so far this year (DECISIONS #520).
 * One-authored through COACH_COPY. Demo is honestly empty until a
 * gifts or charity row is filed. No opportunity-cost illustration.
 */
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';
import type { GivingYtd } from '@/lib/engine/reports/giving-ytd';
import { cents, formatCents } from '@/lib/money';

export function GivingYtdCard({
  result,
  year,
}: {
  result: GivingYtd | null;
  year: number;
}) {
  const sentence = result ? COACH_COPY.givingYtd(result) : null;

  return (
    <Card data-testid="giving-ytd-card">
      <CardHeader className="pb-2">
        <CardDescription>{COACH_COPY.givingYtdTitle(year)}</CardDescription>
        <CardTitle className="text-base" data-testid="giving-ytd-given">
          {result ? formatCents(cents(result.givenYtdCents)) : COACH_COPY.givingYtdSubtitle()}
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm">
        {sentence ? (
          <p data-testid="giving-ytd-sentence">{sentence}</p>
        ) : (
          <p className="text-muted-foreground" data-testid="giving-ytd-empty">
            {COACH_COPY.givingYtdEmpty(year)}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
