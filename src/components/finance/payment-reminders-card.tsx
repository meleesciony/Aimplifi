/**
 * Upcoming card payments (ROADMAP #6) — the in-app half of payment reminders.
 * Read-only, derived from the same Cash-Needed obligations as the headline, so
 * the dates and amounts always agree. Urgency is shown as a TEXT label (not
 * color alone) for accessibility.
 */
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  CARD_DUPLICATE_PAIR_TESTID,
  CARD_DUPLICATE_TESTID,
  type CardDuplicatePairInput,
  cardDuplicateListView,
} from '@/lib/engine/account/card-duplicate-view';
import { HOUSEHOLD_COPY } from '@/lib/copy/household-copy';
import { formatCents } from '@/lib/money';
import { formatISODate, formatRelativeDays, isoDate } from '@/lib/dates';
import type { PaymentReminder, ReminderUrgency } from '@/lib/engine/reminders/select';

const URGENCY: Record<ReminderUrgency, { label: string; cls: string }> = {
  today: { label: 'Today', cls: 'border-red-900/50 bg-red-950/40 text-red-300' },
  soon: { label: 'Soon', cls: 'border-amber-900/50 bg-amber-950/40 text-amber-300' },
  upcoming: { label: 'Upcoming', cls: 'border-border bg-accent text-muted-foreground' },
};

/**
 * The autopay/action suffix for one reminder row. A PARTNER-owned reminder
 * (household scope) must never render the second-person phrasing — "you pay
 * $X" on a partner's card is a false money claim that invites a double
 * payment (slice-8 critic F-1, same class as the digest's slice-7 F1).
 */
function howLine(r: PaymentReminder, ownerLabel: string | undefined): string {
  if (ownerLabel) {
    if (r.autopayCovered) return ` · ${HOUSEHOLD_COPY.reminderPartnerAutopayCovered(ownerLabel)}`;
    if (r.autopayCents > 0)
      return ` · ${HOUSEHOLD_COPY.reminderPartnerPartialAutopay(ownerLabel, r.autopayCents, r.userActionCents)}`;
    return ` · ${HOUSEHOLD_COPY.reminderPartnerManual(ownerLabel)}`;
  }
  if (r.autopayCovered) return ' · autopay handles it — keep funds present';
  if (r.autopayCents > 0)
    return ` · autopay covers ${formatCents(r.autopayCents)}, you pay ${formatCents(r.userActionCents)}`;
  return '';
}

export function PaymentRemindersCard({
  reminders,
  today,
  accountOwnerLabel = {},
  undatedCardCount = 0,
  cardDuplicates = [],
  cardIdentity = {},
}: {
  reminders: PaymentReminder[];
  today: string;
  /** accountId → owning partner's name at household scope (empty for 'mine'). */
  accountOwnerLabel?: Record<string, string>;
  /**
   * Cards excluded from `reminders` because nothing could date them
   * (CashNeededResult.unknownDueDateCards). A reminder can only exist for a card
   * with a due date, so "you're all caught up" would be a false all-clear while
   * these are outstanding — the empty set means "nothing we can date", not
   * "nothing owed" (owner-reported 2026-07-23).
   */
  undatedCardCount?: number;
  /**
   * Suspected same-card-twice pairs among the viewer's own cards (TASKS L.8). One real card
   * arriving through two live connections produces two obligations, so it asks to be paid twice
   * here — the same day, the same amount, under the same name. This list is what lets the card say
   * so; ids only, every string built by `card-duplicate-view.ts` from the labels painted below.
   */
  cardDuplicates?: CardDuplicatePairInput[];
  /**
   * accountId → the identity line this PAGE assigned that card (#298 / TASKS L.8). Handed down
   * rather than computed here: `cardIdentityLabels` numbers by position in the list it is given,
   * so a second pass over this card's own rows would number them from 1 independently and "1."
   * would mean a different account here than in the hero above — the #299 residual, reproduced by
   * a critic across components. One pass, one page, one meaning.
   */
  cardIdentity?: Record<string, string>;
}) {
  const t = isoDate(today);
  // The disclosure below names rows by exactly these strings, so this is the ONE expression for
  // what a row is called.
  const rowName = (r: PaymentReminder) => {
    const owner = accountOwnerLabel[r.accountId];
    return `${r.accountName}${owner ? ` (${owner}'s)` : ''}`;
  };
  const painted = (r: PaymentReminder) =>
    cardIdentity[r.accountId] ? `${rowName(r)} ${cardIdentity[r.accountId]}` : rowName(r);
  // This card states no total of its own, so the harm is not an inflated figure but a duplicated
  // INSTRUCTION — hence the list wording, which makes no claim about any total.
  const duplicates = cardDuplicateListView(
    cardDuplicates,
    reminders.map((r) => ({ cardId: r.accountId, label: painted(r) })),
  );
  return (
    <Card data-testid="payment-reminders-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Payment reminders</CardTitle>
        <CardDescription>
          {reminders.length === 0
            ? undatedCardCount > 0
              ? `No payments coming up on what we can date — ${undatedCardCount === 1 ? 'one card has' : `${undatedCardCount} cards have`} no due date yet, so ${undatedCardCount === 1 ? 'it isn’t' : 'they aren’t'} included.`
              : 'You’re all caught up — no payments coming up.'
            : `Upcoming card & loan payments this cycle. Aimplifi never moves money for you — this is just a heads-up.${
                // The mixed case (cycle-2 critic P2-1): a list of what's due reads as
                // complete unless what's missing is named next to it.
                undatedCardCount > 0
                  ? ` ${undatedCardCount === 1 ? 'One card is' : `${undatedCardCount} cards are`} not shown — no due date yet.`
                  : ''
              }`}
        </CardDescription>
      </CardHeader>
      {reminders.length > 0 && (
        <CardContent className="px-0 pb-2">
          {duplicates && (
            // Above the list it qualifies: the rows below read as two separate payments, and that
            // is the reading this sentence exists to interrupt.
            <div
              // Deliberately NOT role="alert", unlike the hero's. Both cards are on screen at load
              // and carry the same title and near-identical body, so two alert regions announce the
              // same sentence twice in a row before the reader reaches either list. The hero keeps
              // the announcement because it qualifies a money figure and a transfer instruction;
              // this one is read in document order, where its own rows are.
              className="mx-4 mb-2 rounded-lg border border-amber-900/50 bg-amber-950/20 px-3 py-2 text-sm"
              data-testid={CARD_DUPLICATE_TESTID}
            >
              <p className="font-medium">{duplicates.title}</p>
              <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
                {duplicates.pairs.map((p) => (
                  <li key={p.key} data-testid={`${CARD_DUPLICATE_PAIR_TESTID}-${p.key}`}>
                    {p.sentence} {p.impact} <span className="italic">{p.basis}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-xs text-muted-foreground">
                {duplicates.howTo}{' '}
                <Link href="/accounts" className="underline hover:text-foreground">
                  Go to Accounts
                </Link>
                .
              </p>
            </div>
          )}
          <ul className="divide-y">
            {reminders.map((r) => {
              const u = URGENCY[r.urgency];
              const owner = accountOwnerLabel[r.accountId];
              return (
                <li key={`${r.accountId}:${r.dueDate}`} className="flex items-center justify-between gap-3 px-4 py-2" data-testid="reminder-row">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium ${u.cls}`}>{u.label}</span>
                      <span className="truncate font-medium" data-testid="reminder-card-name">
                        {painted(r)}
                      </span>
                      {r.obligationType === 'loan' && <span className="shrink-0 text-[10px] text-muted-foreground">loan</span>}
                      {r.isEstimated && <span className="shrink-0 text-[10px] text-muted-foreground">est.</span>}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      due {formatISODate(isoDate(r.dueDate))} · {formatRelativeDays(t, isoDate(r.dueDate))}
                      {howLine(r, owner)}
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
