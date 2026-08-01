import { Gauge } from 'lucide-react';
import { cents, formatCents } from '@/lib/money';
import type { SpendingPlan, SpendingPlanDisclosures } from '@/lib/engine/spending-plan/plan';
import { LONG_CADENCE_WORDS, longCadencesInTerm } from '@/lib/engine/spending-plan/plan';
import type { CardNote } from '@/lib/engine/spending-plan/row-labels';
import { planCardNoteParts } from '@/lib/engine/spending-plan/row-labels';
import { TrackedActedLink } from '@/components/engagement/tracked-acted-link';
import { SURFACE_LINK_CARD_CLASS } from '@/components/finance/surface-card-styles';

/**
 * Dashboard summary of the Spending Plan (DECISIONS #66; #295 guilt-free
 * reframe) — the "guilt-free spending" number at a glance, linking through to
 * the full plan. Tappable card, so the whole thing is the affordance (no
 * nested interactive elements).
 *
 * `disclosures` is REQUIRED (the L.15 lesson: a defaulted disclosure argument
 * fails silent). Every direction word below is stated for THE FIGURE THIS
 * BRANCH RENDERS: the overspent branch shows the OVERAGE — the negation of
 * leftToSpend — so "lower/higher" flips with it (critic P1-2). The excluded
 * cards note also renders on the noData branch (critic P2-8: the user whose
 * ONLY data is an undatable card is the one for whom the disclosure is the
 * only fact).
 */
export function SafeToSpendCard({
  plan,
  disclosures,
}: {
  plan: SpendingPlan;
  disclosures: SpendingPlanDisclosures;
}) {
  // "No data yet" only when there is NO pattern and NO obligations at all — never
  // mislabel a real $0-left (overspent / fully committed) as empty.
  const noData =
    plan.patternIncomeCents === 0 &&
    plan.fixedExpensesCents === 0 &&
    plan.cardObligationsCents === 0 &&
    // The beyond-month term counts here too (cycle-2 P1): a card-only user whose whole
    // obligation is dated past the month's edge was overspent by $14,000 AND
    // told "once this month has income or spending we can count" — the two were
    // simultaneously true, which they never were before this term existed.
    plan.obligationsBeyondMonthCents === 0 &&
    plan.plannedSavingsCents === 0;
  const ok = !plan.overspent;
  // O.18f: these three notes were hand-rolled here, and had drifted from the three
  // other authors of the same four facts — including a hardcoded "Two" that was
  // false for any reader with more than one suspected pair. `planCardNotes` is now
  // the class's only author; this surface states what only it can know.
  const cardNotes = planCardNoteParts(disclosures, {
    // The card prints left-to-spend, or the overage when overspent — and NO figure
    // at all in the no-data state, where neither direction word is true.
    headline: noData ? 'none' : ok ? 'left-to-spend' : 'overage',
    container: 'this figure',
    detail: 'compact',
    // The card shows only the headline; a clause about fixed costs points at nothing.
    fixedCostsName: null,
  });
  // Selected by FACT, never by index: a note that abstains would shift every
  // position after it, so `notes[0]` is only the excluded note by coincidence.
  const noteFor = (fact: CardNote['fact']) => cardNotes.find((n) => n.fact === fact)?.text ?? null;
  const excludedNoteText = noteFor('excluded');
  const duplicateNoteText = noteFor('duplicate');
  const frozenNoteText = noteFor('frozen');
  const excludedNote = excludedNoteText ? (
    <p className="mt-1 text-xs text-amber-600 dark:text-amber-400" data-testid="safe-to-spend-undated-note">
      {excludedNoteText}
    </p>
  ) : null;
  return (
    <TrackedActedLink
      href="/spending-plan"
      subjectKey="safe-to-spend"
      data-testid="dashboard-safe-to-spend"
      className={SURFACE_LINK_CARD_CLASS}
    >
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <Gauge className="size-3.5" aria-hidden />
        {/* ROADMAP COPY-1 / #186: when overspent, the header itself must not
            still claim spending is guilt-free above an overage — reframe both
            label and amount. */}
        {ok || noData ? 'Guilt-free to spend' : 'Over plan'}
      </div>
      {noData ? (
        <>
          <p className="mt-1.5 text-sm text-muted-foreground" data-testid="dashboard-safe-to-spend-empty">
            Once we can see your income — a complete month posted, or a recurring paycheck
            detected — your guilt-free spending amount shows up here.
          </p>
          {excludedNote}
        </>
      ) : (
        <>
          <p
            className={`mt-1.5 text-2xl font-bold tabular-nums ${ok ? 'text-foreground' : 'text-rose-500'}`}
            data-testid="dashboard-safe-to-spend-amount"
          >
            {ok ? (
              formatCents(cents(plan.leftToSpendCents))
            ) : (
              <>Over plan by {formatCents(cents(-plan.leftToSpendCents))}</>
            )}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {ok ? (
              <>this month, after fixed costs, card payments &amp; savings</>
            ) : (
              <>guilt-free is $0 this month</>
            )}
          </p>
          {excludedNote}
          {/* L.11(D). This card sits on the same screen as the cash-needed
              answer, which was announcing a payment this figure did not hold
              back. It does now — and a reader who never opens /spending-plan
              would otherwise have no way to learn that a line he cannot see
              is already inside the number. */}
          {plan.reservesBeyondMonth && (
            <p className="mt-1 text-xs text-muted-foreground" data-testid="safe-to-spend-held-note">
              {formatCents(cents(plan.obligationsBeyondMonthCents))} of your income is already set
              aside for card payments dated after this month, through{' '}
              {plan.obligationsBeyondMonthThroughDate}.
            </p>
          )}
          {/* L.23, for the same reason as the note above it: in the month a yearly
              bill actually lands, the cash-needed answer on this same screen counts
              the whole of it while this figure ever counted a twelfth. A reader who
              never opens /spending-plan would have no way to learn that. Gated on an
              annual bill being IN the term — unconditionally it would name a
              mechanism that did not act, and the detector sees an annual bill only
              after three sightings at a steady price. L.24: the same clause now
              speaks for the quarterly and twice-a-year rhythms it added, each
              naming its OWN fraction from the shared table, still gated on being
              in the term, and each carrying data-cadence so a test can bind ONE of
              them — the testid repeats per cadence, which a strict locator would
              otherwise trip over (L.24 copy critic P2-1; the earlier comment here
              claimed an e2e lock on this testid that does not exist). */}
          {longCadencesInTerm(plan.scheduledFixed).map((c) => (
            <p
              key={c}
              className="mt-1 text-xs text-muted-foreground"
              data-testid="safe-to-spend-annual-note"
              data-cadence={c}
            >
              A {LONG_CADENCE_WORDS[c].adjective} bill is counted here {LONG_CADENCE_WORDS[c].share}{' '}
              at a time, so {LONG_CADENCE_WORDS[c].cardLanding} will cost more than this figure
              allows for.
            </p>
          ))}
          {duplicateNoteText && (
            <p className="mt-1 text-xs text-muted-foreground" data-testid="safe-to-spend-duplicate-note">
              {duplicateNoteText}
            </p>
          )}
          {frozenNoteText && (
            <p className="mt-1 text-xs text-muted-foreground" data-testid="safe-to-spend-frozen-note">
              {frozenNoteText}
            </p>
          )}
        </>
      )}
    </TrackedActedLink>
  );
}
