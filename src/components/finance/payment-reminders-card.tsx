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
import {
  FROZEN_CARD_TESTID,
  type FrozenNothingDueRow,
  currentCycleAmountSource,
  frozenCardsNote,
  frozenLoanNote,
  frozenNothingDueNote,
} from '@/lib/engine/account/feed-dropped-view';
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
  frozenDues,
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
  /**
   * Every account of the viewer's the bank has stopped sharing that could have appeared in this
   * list — cards AND loans (TASKS L.18, widened in L.19), due or not.
   *
   * Used ONLY by the empty branch, whose "You're all caught up" is a positive money claim about
   * accounts whose news can no longer arrive — the same gap `undatedCardCount` closes for a
   * statement that has not arrived YET. The rows themselves need nothing extra: `frozenSince`
   * rides each reminder, so a listed payment qualifies itself.
   *
   * RENAMED from `frozenCards` in L.19, because the old name is what hid the gap: this list is
   * built from the same `reminders` set the all-clear is a claim about, and `selectPaymentReminders`
   * mixes loans into that set. A frozen loan's stored due day is the single field most likely to
   * make "no payments coming up" false, and it was the one thing the prop could not carry.
   */
  frozenDues: readonly FrozenNothingDueRow[];
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
  const frozenAllClear = frozenNothingDueNote(frozenDues, { nextStep: 'accounts-route' });
  // L.20 critic cycle, found independently by all three critics. `frozenAllClear` above was
  // interpolated ONLY into the two `reminders.length === 0` branches — which is right for a frozen
  // CARD or a frozen dated LOAN, because those appear in this list when something is due and each
  // row qualifies itself through `frozenSince`. An `undatable-loan` is the one kind that can never
  // be a reminder — that is the entire premise of the row — so the empty branch was the only place
  // it was ever spoken, and one unrelated card being due silenced it. The mixed case is the LIKELIER
  // one, and the cost is a missed mortgage payment. Only that kind is repeated here: the other two
  // stay resolved against printed bullets, per the standing rule that a claim is resolved against
  // the set the surface renders.
  const frozenUndatable = frozenNothingDueNote(
    frozenDues.filter((r) => r.kind === 'undatable-loan'),
    { nextStep: 'accounts-route' },
  );
  return (
    <Card data-testid="payment-reminders-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Payment reminders</CardTitle>
        <CardDescription>
          {reminders.length === 0
            ? undatedCardCount > 0
              ? // TASKS L.19 critic P1-2. The frozen qualifier used to be appended ONLY to the
                // clean all-clear, so a reader who had both an undatable card AND a frozen account
                // was told about the first gap and not the second — while the weekly digest, from
                // the same row set through the same builder, pushed both. Same state, same data,
                // and the email disclosed what the screen did not. The two gaps are siblings (a
                // statement that has not arrived YET, and one that can no longer arrive at all),
                // so they are stated together.
                `No payments coming up on what we can date — ${undatedCardCount === 1 ? 'one card has' : `${undatedCardCount} cards have`} no due date yet, so ${undatedCardCount === 1 ? 'it isn’t' : 'they aren’t'} included.${frozenAllClear ? ` ${frozenAllClear}` : ''}`
              : // Critic P2-2: the first cut used `??`, which REPLACED the all-clear instead of
                // qualifying it — leaving "…this covers only what we can still see" with no
                // antecedent, and never telling the reader the positive half (that nothing is
                // currently known to be due). The sibling branch above states the claim first and
                // then narrows it; so does the digest, through this same builder.
                `You’re all caught up — no payments coming up.${frozenAllClear ? ` ${frozenAllClear}` : ''}`
            : `Upcoming card & loan payments this cycle. Aimplifi never moves money for you — this is just a heads-up.${
                // The mixed case (cycle-2 critic P2-1): a list of what's due reads as
                // complete unless what's missing is named next to it.
                undatedCardCount > 0
                  ? ` ${undatedCardCount === 1 ? 'One card is' : `${undatedCardCount} cards are`} not shown — no due date yet.`
                  : ''
              }${frozenUndatable ? ` ${frozenUndatable}` : ''}`}
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
                    {/* TASKS L.18 — this row is an instruction ("$X due DATE"), and on a frozen
                        card a payment already made was never subtracted from it. Named with the
                        SAME painted label the row above uses, so the two cannot disagree. */}
                    {r.frozenSince != null && (
                      <p
                        className="mt-0.5 text-xs text-amber-500"
                        data-testid={`${FROZEN_CARD_TESTID}-${r.accountId}`}
                      >
                        {/* A LOAN goes stale differently from a card and gets its own sentence
                            (critic P1-3): nothing subtracts payments from a loan obligation, so
                            "a payment you already made is not in these figures" would name a
                            mechanism that does not exist — and a reader who reads the reminder as
                            stale skips a mortgage payment. */}
                        {r.obligationType === 'loan'
                          ? frozenLoanNote(
                              {
                                label: painted(r),
                                frozenSince: r.frozenSince,
                                // TASKS L.19: until now this call adjusted only the NEXT STEP for a
                                // partner's loan, while the sentence itself still opened "Your bank"
                                // and, being an instruction, still ordered the reader to "check it
                                // with your lender before paying" — over an account they neither own
                                // nor pay. The card branch below has carried ownership since L.18's
                                // critic P1-1; the loan branch is now told the same fact and derives
                                // the subject, the imperative and the remedy from it.
                                ownership: owner ? 'partner' : 'reader',
                              },
                              { role: 'instruction', nextStep: 'accounts-route' },
                            )
                          : frozenCardsNote(
                              [
                                {
                                  cardId: r.accountId,
                                  label: painted(r),
                                  frozenSince: r.frozenSince,
                                  amountSource: currentCycleAmountSource(r.isEstimated),
                                  // Critic P1-1: a partner's card drops the imperative and the
                                  // "your bank" subject, both of which are false for this reader.
                                  ownership: owner ? 'partner' : 'reader',
                                },
                              ],
                              { role: 'instruction', nextStep: 'accounts-route' },
                            )}
                      </p>
                    )}
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
