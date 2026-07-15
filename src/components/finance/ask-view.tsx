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
import { ArrowRight, Check, ChevronDown, CornerDownLeft, Sparkles } from 'lucide-react';
import { askAssistant } from '@/server/assistant';
import { saveDebtFreeGoal, saveRetirementAge, saveSavingsGoal } from '@/server/goal-actions';
import { forgetLearnedPhrase } from '@/server/vocab-actions';
import {
  ASSISTANT_SUGGESTIONS,
  type AssistantAnswer,
  type AssistantGoalAction,
  type AssistantSource,
} from '@/lib/engine/assistant/answer';
// Type-only (erased): the trace object arrives already serialized on the answer
// payload; importing the shape doesn't pull the engine into the client bundle.
import type { RowSumTrace, TraceRow } from '@/lib/engine/assistant/trace';
// Pure, dependency-light (type-only imports) — safe to bundle client-side; keeps
// the "what reconciles the headline" decision one tested function, not inline logic.
import { reconciledView } from '@/lib/engine/assistant/trace-view';
import { formatCents, type Cents } from '@/lib/money';

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
  const [traceOpen, setTraceOpen] = useState(false);
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
    setTraceOpen(false); // a new answer starts with its trace panel collapsed
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
            {/* Glass-Box (GLASSBOX_PLAN slice 2): a row-sum figure is tappable —
                it opens the reconciliation panel showing the exact rows behind it.
                Derivation figures carry no trace and stay a plain, untappable <p>. */}
            {answer.trace?.kind === 'row_sum' ? (
              <>
                <button
                  type="button"
                  data-testid="ask-headline"
                  onClick={() => setTraceOpen((o) => !o)}
                  aria-expanded={traceOpen}
                  // Only reference the panel while it exists in the DOM (open) — a
                  // collapsed disclosure carries no dangling IDREF.
                  aria-controls={traceOpen ? 'ask-trace-panel' : undefined}
                  className="flex w-full items-start justify-between gap-2 rounded-sm text-left text-base font-semibold tabular-nums decoration-dotted underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <span>{answer.headline}</span>
                  <ChevronDown
                    className={`mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform ${traceOpen ? 'rotate-180' : ''}`}
                    aria-hidden
                  />
                </button>
                {!traceOpen && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {answer.trace.reconciled
                      ? 'Tap to see the transactions behind this number.'
                      : 'Tap for details on this number.'}
                  </p>
                )}
              </>
            ) : (
              <p data-testid="ask-headline" className="text-base font-semibold tabular-nums">
                {answer.headline}
              </p>
            )}
            {answer.detail && <p className="mt-1 text-sm text-muted-foreground">{answer.detail}</p>}

            {answer.trace?.kind === 'row_sum' && traceOpen && (
              <TracePanel trace={answer.trace} source={answer.source} />
            )}

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

const fmtCents = (c: number) => formatCents(c as Cents);

/** The cited rows behind a trace figure — date · merchant … contribution. Money is
 *  formatted here (the one UI boundary); the cents come straight from the engine. */
function TraceRows({ rows }: { rows: readonly TraceRow[] }) {
  return (
    <dl className="space-y-1.5">
      {rows.map((r, i) => (
        <div
          key={`${r.date}-${r.merchant}-${i}`}
          data-testid="ask-trace-row"
          className="flex items-baseline justify-between gap-3 text-sm"
        >
          <dt className="min-w-0 truncate text-muted-foreground">
            <span className="tabular-nums">{r.date}</span> · {r.merchant}
          </dt>
          <dd className="shrink-0 font-medium tabular-nums">{fmtCents(r.contributionCents)}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Glass-Box reconciliation panel (GLASSBOX_PLAN slice 2): the exact transaction
 * rows behind a tapped figure, reconciled to the penny. When the trace can't be
 * reconciled (answer→data drift), it says so honestly and points to the full view
 * — it NEVER shows a green check next to a number it can't stand behind.
 */
function TracePanel({ trace, source }: { trace: RowSumTrace; source?: AssistantSource }) {
  if (!trace.reconciled) {
    return (
      <div
        id="ask-trace-panel"
        data-testid="ask-trace"
        role="region"
        aria-label="Reconciliation"
        className="mt-3 rounded-xl border border-dashed bg-muted/30 p-3 text-sm text-muted-foreground"
      >
        <p data-testid="ask-trace-unreconciled">
          I can’t fully reconcile this number right now — the underlying transactions may have changed
          since this answer.
          {source && (
            <>
              {' '}
              Open{' '}
              <Link
                href={source.href}
                className="font-medium text-emerald-600 hover:underline dark:text-emerald-400"
              >
                {source.label.toLowerCase()}
              </Link>{' '}
              for the full breakdown.
            </>
          )}
        </p>
      </div>
    );
  }

  // Everything shown under the ✓ must sum to the headline: `reconciledView` returns
  // the group breakdown ONLY when the groups sum to it (spend_total, umbrella), else
  // the flat reconciled rows (top_categories' non-top groups are NOT the headline).
  const { rows, groups } = reconciledView(trace);
  const rowCount = groups ? groups.reduce((n, g) => n + g.rows.length, 0) : rows.length;

  return (
    <div
      id="ask-trace-panel"
      data-testid="ask-trace"
      role="region"
      aria-label="Reconciliation"
      className="mt-3 space-y-3 rounded-xl border bg-muted/30 p-3"
    >
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <Check className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
        <span data-testid="ask-trace-reconciled">
          {rowCount === 1 ? '1 transaction adds' : `${rowCount} transactions add`} up to{' '}
          {fmtCents(trace.sumCents)}
        </span>
      </p>

      {groups ? (
        <div className="space-y-3">
          {groups.map((g) => (
            <div key={g.key} data-testid="ask-trace-group">
              <div className="flex items-baseline justify-between gap-3 border-b pb-1 text-sm font-semibold">
                <span className="min-w-0 truncate">{g.label}</span>
                <span className="shrink-0 tabular-nums">{fmtCents(g.amountCents)}</span>
              </div>
              <div className="mt-1.5">
                <TraceRows rows={g.rows} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <TraceRows rows={rows} />
      )}

      {trace.basis.length > 0 && (
        <ul className="space-y-1 border-t pt-2">
          {trace.basis.map((b, i) => (
            <li key={i} className="text-xs text-muted-foreground">
              {b}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
