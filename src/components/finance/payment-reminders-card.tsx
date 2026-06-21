/**
 * Upcoming card payments (ROADMAP #6) — the in-app half of payment reminders.
 * Read-only, derived from the same Cash-Needed obligations as the headline, so
 * the dates and amounts always agree. Urgency is shown as a TEXT label (not
 * color alone) for accessibility.
 */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCents } from '@/lib/money';
import { formatISODate, formatRelativeDays, isoDate } from '@/lib/dates';
import type { PaymentReminder, ReminderUrgency } from '@/lib/engine/reminders/select';

const URGENCY: Record<ReminderUrgency, { label: string; cls: string }> = {
  today: { label: 'Today', cls: 'border-red-900/50 bg-red-950/40 text-red-300' },
  soon: { label: 'Soon', cls: 'border-amber-900/50 bg-amber-950/40 text-amber-300' },
  upcoming: { label: 'Upcoming', cls: 'border-border bg-accent text-muted-foreground' },
};

export function PaymentRemindersCard({ reminders, today }: { reminders: PaymentReminder[]; today: string }) {
  const t = isoDate(today);
  return (
    <Card data-testid="payment-reminders-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Payment reminders</CardTitle>
        <CardDescription>
          {reminders.length === 0
            ? 'You’re all caught up — no card payments coming up.'
            : 'Upcoming card payments this cycle. Pulse never moves money for you — this is just a heads-up.'}
        </CardDescription>
      </CardHeader>
      {reminders.length > 0 && (
        <CardContent className="px-0 pb-2">
          <ul className="divide-y">
            {reminders.map((r) => {
              const u = URGENCY[r.urgency];
              return (
                <li key={`${r.cardId}:${r.dueDate}`} className="flex items-center justify-between gap-3 px-4 py-2" data-testid="reminder-row">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium ${u.cls}`}>{u.label}</span>
                      <span className="truncate font-medium" data-testid="reminder-card-name">{r.cardName}</span>
                      {r.isEstimated && <span className="shrink-0 text-[10px] text-muted-foreground">est.</span>}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      due {formatISODate(isoDate(r.dueDate))} · {formatRelativeDays(t, isoDate(r.dueDate))}
                      {r.autopayCovered
                        ? ' · autopay handles it — keep funds present'
                        : r.autopayCents > 0
                          ? ` · autopay covers ${formatCents(r.autopayCents)}, you pay ${formatCents(r.userActionCents)}`
                          : ''}
                    </div>
                  </div>
                  <div className="shrink-0 tabular-nums">{formatCents(r.cashRequiredCents)}</div>
                </li>
              );
            })}
          </ul>
        </CardContent>
      )}
    </Card>
  );
}
