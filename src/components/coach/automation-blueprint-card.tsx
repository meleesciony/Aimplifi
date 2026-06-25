/**
 * Automation Blueprint card (P0.5, DECISIONS #94). Pure render of the engine's
 * ordered steps as standing instructions to set up at the user's bank. The
 * banner states the hard invariant: Aimplifi never moves money. No money math
 * here — every step is phrased through COACH_COPY (guardrail-scanned).
 */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';
import type { BlueprintStep } from '@/lib/engine/automation/blueprint';
import { formatISODate, isoDate } from '@/lib/dates';
import { cents } from '@/lib/money';

export function AutomationBlueprintCard({ steps }: { steps: BlueprintStep[] }) {
  if (steps.length === 0) return null;
  return (
    <Card data-testid="automation-blueprint-card">
      <CardHeader className="pb-2">
        <CardDescription>Automation blueprint</CardDescription>
        <CardTitle className="text-base">Set it once, then let it run</CardTitle>
        <p className="text-sm text-muted-foreground">{COACH_COPY.automationBlueprintBanner()}</p>
      </CardHeader>
      <CardContent>
        <ol className="space-y-2 text-sm" data-testid="blueprint-steps">
          {steps.map((s) => (
            <li key={`${s.kind}-${s.order}`} className="flex items-baseline gap-2">
              <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs tabular-nums">
                {s.order}
              </span>
              <span>
                {s.kind === 'savings'
                  ? COACH_COPY.automationSavingsStep(
                      s.onPayday ? 'payday' : 'the 1st',
                      cents(s.amountCents),
                      s.name,
                    )
                  : COACH_COPY.automationCardStep(
                      s.name,
                      cents(s.amountCents),
                      s.dueDate ? formatISODate(isoDate(s.dueDate), 'short') : 'the due date',
                    )}
              </span>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
