/**
 * P1.2 — compact staying-wealthy row. Server component: pure display of
 * `composeStayingWealthy`. Every string is already COACH_COPY. Checkmarks
 * mark a present signal; an absent one is a quiet circle, never a red X.
 */
import { CheckCircle2, Circle } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import type { StayingWealthyRow } from '@/lib/engine/fi/staying-wealthy';

export function StayingWealthyCard({ row }: { row: StayingWealthyRow }) {
  return (
    <Card data-testid="staying-wealthy-card">
      <CardHeader className="pb-2">
        <CardDescription>{row.title}</CardDescription>
        <CardTitle className="text-base" data-testid="staying-wealthy-framing">
          {row.framing}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="grid gap-2 sm:grid-cols-3" data-testid="staying-wealthy-signals">
          {row.signals.map((signal) => {
            const Icon = signal.present ? CheckCircle2 : Circle;
            const tone = signal.present ? 'text-positive-500' : 'text-muted-foreground';
            return (
              <li
                key={signal.id}
                className="flex min-w-0 items-start gap-2 text-sm"
                data-testid={`staying-wealthy-${signal.id}`}
                data-present={signal.present ? 'true' : 'false'}
              >
                <Icon className={`mt-0.5 size-4 shrink-0 ${tone}`} aria-hidden />
                <span>{signal.label}</span>
              </li>
            );
          })}
        </ul>
        <p className="text-xs text-muted-foreground" data-testid="staying-wealthy-footer">
          {row.footer}
        </p>
      </CardContent>
    </Card>
  );
}
