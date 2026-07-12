'use client';

/**
 * Ask Aimplifi view (DECISIONS #75). A grounded Q&A box over the user's own
 * data: type a question → the server parses it to a typed intent and answers it
 * from the tested engines (never the LLM). This is a thin client shell; all the
 * math + phrasing happen server-side in pure, tested code. Copy follows the
 * coaching guardrails (educational, assumptions stated, no shame).
 */
import { useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { ArrowRight, CornerDownLeft, Sparkles } from 'lucide-react';
import { askAssistant } from '@/server/assistant';
import { saveDebtFreeGoal, saveRetirementAge, saveSavingsGoal } from '@/server/goal-actions';
import { forgetLearnedPhrase } from '@/server/vocab-actions';
import { ASSISTANT_SUGGESTIONS, type AssistantAnswer, type AssistantGoalAction } from '@/lib/engine/assistant/answer';

export function AskView({
  suggestions = ASSISTANT_SUGGESTIONS,
  assistEnabled = false,
}: {
  suggestions?: readonly string[];
  /** True when an LLM provider key is configured (unknown questions may be routed
   *  by the model) — drives the third-party disclosure footnote. */
  assistEnabled?: boolean;
}) {
  const [question, setQuestion] = useState('');
  const [asked, setAsked] = useState<string | null>(null);
  const [answer, setAnswer] = useState<AssistantAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'error'>('idle');
  const [forgotten, setForgotten] = useState(false);
  const [pending, startTransition] = useTransition();
  const [saving, startSaving] = useTransition();
  const [forgetting, startForgetting] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function run(q: string) {
    const trimmed = q.trim();
    if (!trimmed || pending) return;
    setAsked(trimmed);
    setError(null);
    setSaveState('idle');
    setForgotten(false);
    // The previous answer's intent is the conversation frame (TASKS 2.1): it lets
    // the server resolve a follow-up fragment ("what about last month?") against
    // the question it follows. The server re-validates it; a self-sufficient
    // question ignores it entirely.
    const priorIntent = answer?.intent;
    startTransition(async () => {
      try {
        setAnswer(await askAssistant(trimmed, priorIntent));
      } catch {
        setError('Something went wrong answering that. Please try again.');
        setAnswer(null);
      }
    });
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    run(question);
  }

  function pick(s: string) {
    setQuestion(s);
    inputRef.current?.focus();
    run(s);
  }

  function saveGoal(action: AssistantGoalAction) {
    if (saving) return;
    setSaveState('idle');
    startSaving(async () => {
      try {
        switch (action.kind) {
          case 'save_savings_goal':
            await saveSavingsGoal(action.targetDate, action.goalAmountCents);
            break;
          case 'save_debt_free_goal':
            await saveDebtFreeGoal(action.targetDate);
            break;
          case 'save_retirement_age':
            await saveRetirementAge(action.targetAge);
            break;
        }
        setSaveState('saved');
      } catch {
        setSaveState('error');
      }
    });
  }

  /** Reject a learned phrasing (TASKS 2.3). Terminal: the phrase is tombstoned, so the
   *  weekly miner cannot re-learn it from the evidence the user just rejected. */
  function forget(entryId: string) {
    if (forgetting || forgotten) return;
    startForgetting(async () => {
      try {
        await forgetLearnedPhrase(entryId);
        setForgotten(true);
      } catch {
        /* leave the control live so the user can retry */
      }
    });
  }

  /** Retirement plans persist to the planning dial (surfaced on /investments), not a /goals row. */
  const isRetire = answer?.action?.kind === 'save_retirement_age';
  const saveLabel = isRetire ? 'Save as my plan' : 'Save as a goal';
  const savedHref = isRetire ? '/investments' : '/goals';
  const savedLinkLabel = isRetire ? 'View outlook' : 'View goals';

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          <Sparkles className="size-5 text-emerald-500" aria-hidden /> Ask Aimplifi
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Ask about your money in plain language. Every answer is computed from your own accounts and
          transactions — nothing is made up.
        </p>
      </div>

      <form onSubmit={onSubmit} className="flex gap-2">
        <input
          ref={inputRef}
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="e.g. How much did I spend on groceries last month?"
          aria-label="Ask a question about your finances"
          data-testid="ask-input"
          autoComplete="off"
          className="flex-1 rounded-xl border bg-background px-3 py-2 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        />
        <button
          type="submit"
          disabled={pending || !question.trim()}
          data-testid="ask-submit"
          className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-sm font-medium text-primary-foreground shadow-sm transition hover:bg-primary/80 disabled:opacity-50"
        >
          <CornerDownLeft className="size-4" aria-hidden /> Ask
        </button>
      </form>

      <div aria-live="polite" role="status" className="min-h-[1px] space-y-2">
        {pending && <p className="text-sm text-muted-foreground">Thinking…</p>}

        {error && !pending && (
          <p data-testid="ask-error" className="text-sm text-rose-600 dark:text-rose-400">
            {error}
          </p>
        )}

        {/* keep the prior answer visible (dimmed) while a follow-up is pending,
            so re-asking doesn't flash the card away */}
        {answer && !error && (
          <div data-testid="ask-answer" className={`rounded-2xl border bg-card p-4 shadow-sm ${pending ? 'opacity-60' : ''}`}>
            {asked && <p className="mb-2 text-xs text-muted-foreground">“{asked}”</p>}
            {/* A learned phrase carries its own, more specific disclosure below. */}
            {answer.interpreted && !answer.learned && (
              <p className="mb-2 text-xs text-muted-foreground">
                I interpreted your question — double-check this is what you meant.
              </p>
            )}
            <p data-testid="ask-headline" className="text-base font-semibold tabular-nums">
              {answer.headline}
            </p>
            {answer.detail && <p className="mt-1 text-sm text-muted-foreground">{answer.detail}</p>}

            {answer.facts.length > 0 && (
              <dl className="mt-3 space-y-1.5 border-t pt-3">
                {answer.facts.map((f, i) => (
                  <div key={i} className="flex items-center justify-between gap-3 text-sm">
                    <dt className="truncate text-muted-foreground">{f.label}</dt>
                    <dd className="shrink-0 font-medium tabular-nums">{f.value}</dd>
                  </div>
                ))}
              </dl>
            )}

            {answer.source && (
              <Link
                href={answer.source.href}
                data-testid="ask-source"
                className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-emerald-600 hover:underline dark:text-emerald-400"
              >
                {answer.source.label} <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            )}

            {answer.action && (
              // The button stays MOUNTED across states so keyboard focus is preserved on save;
              // the outer aria-live region (above) announces the change, so no nested role="status".
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
                <button
                  type="button"
                  onClick={() => saveGoal(answer.action!)}
                  disabled={saving || pending || saveState === 'saved'}
                  data-testid="ask-save-goal"
                  className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-sm font-medium shadow-sm transition hover:border-foreground/30 disabled:opacity-60"
                >
                  {saveState === 'saved' ? 'Saved ✓' : saving ? 'Saving…' : saveLabel}
                </button>
                {saveState === 'saved' && (
                  <Link
                    href={savedHref}
                    className="text-sm font-medium text-emerald-600 hover:underline dark:text-emerald-400"
                  >
                    {savedLinkLabel}
                  </Link>
                )}
                {saveState === 'error' && (
                  <span className="text-xs text-rose-600 dark:text-rose-400">Couldn’t save that — please try again.</span>
                )}
              </div>
            )}

            {/* Learned vocabulary (TASKS 2.3): never served silently. The entry supplied
                only the intent KIND — every figure above still comes from the same
                engines — and the user can end it in one click. */}
            {answer.learned && (
              <div
                data-testid="ask-learned"
                className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3"
              >
                <p className="text-xs text-muted-foreground">
                  {answer.learned.status === 'active'
                    ? 'Answered using a phrasing Aimplifi learned from how you ask.'
                    : 'Aimplifi is trying a phrasing it learned from how you ask — check this is what you meant.'}
                </p>
                <button
                  type="button"
                  onClick={() => forget(answer.learned!.entryId)}
                  disabled={forgetting || forgotten || pending}
                  data-testid="ask-forget-phrase"
                  className="rounded-full border px-3 py-1 text-xs text-muted-foreground transition hover:border-foreground/30 hover:text-foreground disabled:opacity-60"
                >
                  {forgotten ? 'Forgotten ✓' : forgetting ? 'Forgetting…' : 'Not what I meant'}
                </button>
              </div>
            )}

            {answer.suggestions && answer.suggestions.length > 0 && (
              <ul
                className="mt-3 flex flex-wrap gap-2 border-t pt-3"
                aria-label="Follow-up questions"
              >
                {answer.suggestions.map((s) => (
                  <li key={s}>
                    <button
                      type="button"
                      data-testid="ask-follow-up"
                      onClick={() => pick(s)}
                      disabled={pending}
                      className="rounded-full border px-3 py-1 text-xs text-muted-foreground transition hover:border-foreground/30 hover:text-foreground disabled:opacity-50"
                    >
                      {s}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {!answer && !pending && (
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Try asking</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <li key={s}>
                <button
                  type="button"
                  onClick={() => pick(s)}
                  data-testid="ask-suggestion"
                  className="rounded-full border bg-card px-3 py-1.5 text-sm text-muted-foreground shadow-sm transition hover:border-foreground/30 hover:text-foreground"
                >
                  {s}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {assistEnabled && (
        <p className="text-xs text-muted-foreground">
          Answers come from your own data. Unrecognized questions may be interpreted by an AI model to
          route them; your account data is never sent to it.
        </p>
      )}
    </div>
  );
}
