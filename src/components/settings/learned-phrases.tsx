'use client';

/**
 * Learned phrasings — the visible, undoable half of the vocabulary loop
 * (TASKS 2.3 / DECISIONS #225). The audit §4 constitution requires every adaptation
 * to be a row the user can see and revoke; this is that row.
 *
 * It shows what Aimplifi learned (the phrase), what it does with it (the question it
 * routes to), and where it sits on the ladder — including `shadow` entries, which are
 * learned but NOT yet used to answer anything. Forgetting is terminal.
 */
import { useState, useTransition } from 'react';
import { forgetLearnedPhrase } from '@/server/vocab-actions';
import type { LearnedPhrase } from '@/server/vocab';

/** Plain-language name for each intent kind a learned phrase may route to. */
const KIND_LABEL: Record<string, string> = {
  net_worth: 'your net worth',
  account_balance: 'an account balance',
  spend_total: 'your total spending',
  spend_by_category: 'spending in a category',
  merchant_spend: 'spending at a merchant',
  top_categories: 'your biggest categories',
  largest_purchases: 'your largest purchases',
  income: 'your income',
  safe_to_spend: 'what’s guilt-free to spend',
  cash_needed: 'the cash you need for your cards',
  debt_payoff: 'your debt payoff plan',
  debt_free_by_date: 'being debt-free by a date',
  savings_goal_by_date: 'a savings goal by a date',
  retire_at_age: 'retiring at an age',
  subscriptions: 'your subscriptions',
  forecast: 'your cash forecast',
  savings_rate: 'your savings rate',
};

const STATUS_NOTE: Record<string, string> = {
  shadow: 'Learned, not used yet — still being checked against how you ask.',
  flagged: 'On trial: answers say so, and you can end it any time.',
  active: 'In use, and always undoable.',
};

export function LearnedPhrases({ phrases }: { phrases: readonly LearnedPhrase[] }) {
  const [gone, setGone] = useState<readonly string[]>([]);
  const [pending, startTransition] = useTransition();

  const visible = phrases.filter((p) => !gone.includes(p.id));
  if (visible.length === 0) return null;

  function forget(id: string) {
    if (pending) return;
    startTransition(async () => {
      try {
        await forgetLearnedPhrase(id);
        setGone((g) => [...g, id]);
      } catch {
        /* leave the row in place so the user can retry */
      }
    });
  }

  return (
    <div data-testid="learned-phrases" className="space-y-2 border-t pt-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Phrasings Aimplifi learned from you
      </h3>
      <p className="text-xs text-muted-foreground">
        When you ask the same unrecognized question several times and it routes the same way each
        time, Aimplifi remembers the phrasing. It only ever learns which of its existing answers to
        show — never what the answer says. Every figure is still computed from your own
        transactions. A phrasing you teach Aimplifi is never shared with another person; once a week
        the phrase itself (never your account data) may be re-checked by the same AI routing service
        that routes unrecognized questions, and dropped if it no longer holds up.
      </p>
      <ul className="space-y-1.5">
        {visible.map((p) => (
          <li
            key={p.id}
            data-testid="learned-phrase-row"
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2"
          >
            <div className="min-w-0">
              <p className="truncate text-sm">“{p.phrase}”</p>
              <p className="text-xs text-muted-foreground">
                Answers with {KIND_LABEL[p.kind] ?? p.kind}. {STATUS_NOTE[p.status] ?? ''}
              </p>
            </div>
            <button
              type="button"
              onClick={() => forget(p.id)}
              disabled={pending}
              data-testid="learned-phrase-forget"
              className="shrink-0 rounded-full border px-3 py-1 text-xs text-muted-foreground transition hover:border-foreground/30 hover:text-foreground disabled:opacity-60"
            >
              Forget this
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
