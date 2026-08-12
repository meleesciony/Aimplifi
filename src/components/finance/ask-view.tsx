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
import { askAssistant, correctFromAsk, undoAskCorrection } from '@/server/assistant';
import { saveDebtFreeGoal, saveRetirementAge, saveSavingsGoal } from '@/server/goal-actions';
import { forgetLearnedPhrase } from '@/server/vocab-actions';
import {
  ASSISTANT_SUGGESTIONS,
  humanDate,
  type AssistantAnswer,
  type AssistantGoalAction,
  type AssistantSource,
} from '@/lib/engine/assistant/answer';
// Type-only (erased): the trace object arrives already serialized on the answer
// payload; importing the shape doesn't pull the engine into the client bundle.
import type { RowSumTrace, TraceRow } from '@/lib/engine/assistant/trace';
import type { DerivationRow, DerivationTrace } from '@/lib/engine/assistant/derivation';
// Pure, dependency-light — safe to bundle client-side; keeps the "what
// reconciles a figure" decision in tested functions, not inline logic.
import {
  CORRECTABLE_KINDS,
  bpsToPct1dp,
  derivationView,
  factView,
  reconciledView,
} from '@/lib/engine/assistant/trace-view';
import { formatCents, type Cents } from '@/lib/money';

/** Everything a trace row needs to offer the one-tap correction (slice 2b);
 *  absent → rows render read-only (non-correctable intents, no options). */
interface CorrectionControls {
  correctingTxnId: string | null;
  onStart: (txnId: string) => void;
  onCancel: () => void;
  onApply: (txnId: string, toCategoryId: string) => void;
  busy: boolean;
  options: readonly { id: string; name: string }[];
}

export function AskView({
  suggestions = ASSISTANT_SUGGESTIONS,
  assistEnabled = false,
  categoryOptions = [],
}: {
  suggestions?: readonly string[];
  /** True when an LLM provider key is configured (unknown questions may be routed
   *  by the model) — drives the third-party disclosure footnote. */
  assistEnabled?: boolean;
  /** Correction-chip picker options (slice 2b) — the page's visible-groups read.
   *  Empty → the chip is simply not offered (rows stay read-only). */
  categoryOptions?: readonly { id: string; name: string }[];
}) {
  const [question, setQuestion] = useState('');
  const [asked, setAsked] = useState<string | null>(null);
  const [answer, setAnswer] = useState<AssistantAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'error'>('idle');
  const [forgotten, setForgotten] = useState(false);
  const [traceOpen, setTraceOpen] = useState(false);
  const [openFactKey, setOpenFactKey] = useState<string | null>(null);
  const [correctingTxnId, setCorrectingTxnId] = useState<string | null>(null);
  const [lastCorrectionId, setLastCorrectionId] = useState<string | null>(null);
  // 'savedStale' / 'undoneStale': the write COMMITTED but the refreshed answer
  // couldn't be composed (critic 2b F1) — the panels are closed (never a green
  // check standing on moved data) and the figures on screen are disclosed stale.
  const [correctionState, setCorrectionState] = useState<
    'idle' | 'saved' | 'savedStale' | 'undone' | 'undoneStale' | 'error'
  >('idle');
  const [pending, startTransition] = useTransition();
  const [saving, startSaving] = useTransition();
  const [forgetting, startForgetting] = useTransition();
  const [correcting, startCorrecting] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function run(q: string) {
    const trimmed = q.trim();
    // `correcting` guard (critic 2b cycle-2 F2): a new ask racing an in-flight
    // correction lets whichever transition lands last render under the wrong
    // caption — the same guard saveGoal/applyCorrection already carry.
    if (!trimmed || pending || correcting) return;
    setAsked(trimmed);
    setError(null);
    setSaveState('idle');
    setForgotten(false);
    setTraceOpen(false); // a new answer starts with its trace panel collapsed
    setOpenFactKey(null);
    setCorrectingTxnId(null);
    setLastCorrectionId(null);
    setCorrectionState('idle');
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

  /**
   * One-tap correction (Glass-Box slice 2b): re-file ONE cited row, then show
   * the SAME question re-answered — the server re-dispatches the resolved
   * intent straight to the engines (no LLM anywhere on this path) and the
   * replaced answer's fresh trace shows the figure moved. Undoable in place.
   */
  function applyCorrection(txnId: string, toCategoryId: string) {
    const intent = answer?.intent;
    if (!intent || correcting) return;
    setCorrectionState('idle');
    startCorrecting(async () => {
      try {
        const res = await correctFromAsk({ transactionId: txnId, toCategoryId, intent });
        setLastCorrectionId(res.correctionId);
        setCorrectingTxnId(null);
        if (res.answer) {
          setAnswer(res.answer);
          setCorrectionState('saved');
        } else {
          // Committed but not refreshed (critic 2b F1): close every reconciliation
          // panel — a green check must never stand next to figures the write just
          // moved — and disclose the split. Undo stays one tap away.
          setTraceOpen(false);
          setOpenFactKey(null);
          setCorrectionState('savedStale');
        }
      } catch {
        setCorrectionState('error'); // nothing committed; editor stays open so the user can retry
      }
    });
  }

  function undoCorrection() {
    const intent = answer?.intent;
    if (!intent || !lastCorrectionId || correcting) return;
    startCorrecting(async () => {
      try {
        const res = await undoAskCorrection({ correctionId: lastCorrectionId, intent });
        setLastCorrectionId(null);
        if (res.answer) {
          setAnswer(res.answer);
          setCorrectionState('undone');
        } else {
          setTraceOpen(false);
          setOpenFactKey(null);
          setCorrectionState('undoneStale');
        }
      } catch {
        // The undo may or may not have committed (it is idempotent server-side,
        // so retrying is always safe) — keep the handle and let the user retry.
        setCorrectionState('error');
      }
    });
  }

  /** The chip is offered ONLY where the write's effect is visible in this very
   *  panel: a reconciled category-sum trace (CORRECTABLE_KINDS), an echoed
   *  intent to re-dispatch, and categories to pick from. */
  const correctionControls: CorrectionControls | undefined =
    answer?.trace?.kind === 'row_sum' &&
    answer.trace.reconciled &&
    CORRECTABLE_KINDS.has(answer.trace.intentKind) &&
    answer.intent &&
    categoryOptions.length > 0
      ? {
          correctingTxnId,
          onStart: (txnId) => {
            setCorrectionState('idle');
            setCorrectingTxnId(txnId);
          },
          onCancel: () => setCorrectingTxnId(null),
          onApply: applyCorrection,
          busy: correcting || pending,
          options: categoryOptions,
        }
      : undefined;

  /** After a committed write whose recompute failed, every figure on screen is
   *  PRE-WRITE data (critic 2b cycle-2 F1): reconciliation taps are withheld —
   *  a green check must never be reachable over rows the write just moved. */
  const staleAnswer = correctionState === 'savedStale' || correctionState === 'undoneStale';

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
          disabled={pending || correcting || !question.trim()}
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
            {/* Glass-Box (GLASSBOX_PLAN slices 2–3): a traced figure is tappable —
                a row-sum trace opens the transaction reconciliation panel; a
                derivation trace (net_worth / cash_needed / savings_rate) opens the
                "formula + inputs" panel. Untraced figures (forecast, safe_to_spend,
                …) carry no trace and stay a plain, untappable <p> — the UI never
                offers an explanation the engine didn't build. */}
            {(answer.trace?.kind === 'row_sum' || answer.trace?.kind === 'derivation') && !staleAnswer ? (
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
                    {!answer.trace.reconciled
                      ? 'Tap for details on this number.'
                      : answer.trace.kind === 'derivation'
                        ? 'Tap to see how this number is computed.'
                        : 'Tap to see the transactions behind this number.'}
                  </p>
                )}
              </>
            ) : (
              <p data-testid="ask-headline" className="text-base font-semibold tabular-nums">
                {answer.headline}
              </p>
            )}
            {answer.detail && <p className="mt-1 text-sm text-muted-foreground">{answer.detail}</p>}

            {/* Correction outcome (slice 2b): the figures above ARE the re-answered
                question — say so plainly, and keep the undo one tap away. */}
            {(correctionState === 'saved' || correctionState === 'savedStale') && (
              <div
                data-testid="ask-correction-saved"
                className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-600/30 bg-emerald-500/5 px-3 py-2 text-sm"
              >
                <span className="flex items-center gap-1.5">
                  <Check className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
                  {correctionState === 'saved'
                    ? 'Category updated — this answer now reflects it.'
                    : 'Category updated, but this answer couldn’t be refreshed — ask again to see the new numbers.'}
                </span>
                <button
                  type="button"
                  onClick={undoCorrection}
                  disabled={correcting || pending}
                  data-testid="ask-correction-undo"
                  className="rounded-full border px-3 py-1 text-xs text-muted-foreground transition hover:border-foreground/30 hover:text-foreground disabled:opacity-60"
                >
                  {correcting ? 'Undoing…' : 'Undo'}
                </button>
              </div>
            )}
            {(correctionState === 'undone' || correctionState === 'undoneStale') && (
              <p data-testid="ask-correction-undone" className="mt-2 text-sm text-muted-foreground">
                {correctionState === 'undone'
                  ? 'Change undone — this answer is back to how it was. That transaction returns to your review queue so you can re-decide its category.'
                  : 'Change undone, but this answer couldn’t be refreshed — ask again to see the current numbers. That transaction returns to your review queue so you can re-decide its category.'}
              </p>
            )}
            {correctionState === 'error' && (
              <p data-testid="ask-correction-error" className="mt-2 text-sm text-rose-600 dark:text-rose-400">
                Couldn’t update that category — please try again.
              </p>
            )}

            {answer.trace?.kind === 'row_sum' && traceOpen && (
              <TracePanel trace={answer.trace} source={answer.source} correction={correctionControls} />
            )}
            {answer.trace?.kind === 'derivation' && traceOpen && (
              <DerivationPanel trace={answer.trace} source={answer.source} />
            )}

            {answer.facts.length > 0 && (
              <ul className="mt-3 space-y-1.5 border-t pt-3">
                {answer.facts.map((f, i) => {
                  // Per-fact tap gate (slice 2b): builders TAG facts with their trace
                  // key + own cents; factView opens a panel only when that fact's
                  // group reconciles to exactly the displayed figure. Untagged or
                  // unreconciled facts render as plain text — never a dead tap.
                  const fv = staleAnswer ? null : factView(answer.trace, f.traceKey, f.cents);
                  const open = fv !== null && openFactKey === f.traceKey;
                  return (
                    <li key={i} data-testid="ask-fact">
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="truncate text-muted-foreground">{f.label}</span>
                        {fv ? (
                          <button
                            type="button"
                            data-testid="ask-fact-value"
                            onClick={() => setOpenFactKey(open ? null : f.traceKey!)}
                            aria-expanded={open}
                            aria-controls={open ? `ask-fact-panel-${f.traceKey}` : undefined}
                            aria-label={`${f.label}: ${f.value}`}
                            className="flex shrink-0 items-center gap-1 rounded-sm font-medium tabular-nums decoration-dotted underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                          >
                            {f.value}
                            <ChevronDown
                              className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
                              aria-hidden
                            />
                          </button>
                        ) : (
                          <span data-testid="ask-fact-value" className="shrink-0 font-medium tabular-nums">
                            {f.value}
                          </span>
                        )}
                      </div>
                      {open && fv && (
                        <div
                          id={`ask-fact-panel-${f.traceKey}`}
                          data-testid="ask-fact-trace"
                          role="region"
                          aria-label={`Reconciliation for ${f.label}`}
                          className="mt-2 space-y-3 rounded-xl border bg-muted/30 p-3"
                        >
                          <p className="flex items-center gap-1.5 text-sm font-medium">
                            <Check className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
                            <span data-testid="ask-fact-reconciled">
                              {fv.rows.length === 1 ? '1 transaction adds' : `${fv.rows.length} transactions add`} up
                              to {fmtCents(fv.amountCents)}
                            </span>
                          </p>
                          <TraceRows rows={fv.rows} correction={correctionControls} />
                          {answer.trace?.kind === 'row_sum' && <BasisList basis={answer.trace.basis} />}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
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
                      disabled={pending || correcting}
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
          route them; it sees only the question text, never your account data.
        </p>
      )}
    </div>
  );
}

const fmtCents = (c: number) => formatCents(c as Cents);

/** The cited rows behind a trace figure — date · merchant … contribution. Money is
 *  formatted here (the one UI boundary); the cents come straight from the engine.
 *  With `correction` present, rows that carry a txnId offer the one-tap
 *  "this should be <category>" editor (slice 2b). */
function TraceRows({ rows, correction }: { rows: readonly TraceRow[]; correction?: CorrectionControls }) {
  return (
    <ul className="space-y-1.5">
      {rows.map((r, i) => {
        const fixable = !!correction && !!r.txnId;
        const editing = fixable && correction.correctingTxnId === r.txnId;
        return (
          <li key={`${r.date}-${r.merchant}-${i}`} data-testid="ask-trace-row">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate text-muted-foreground">
                <span className="tabular-nums">{r.date}</span> · {r.merchant}
                {/* U.16: the basis sentence below says N rows fall on a day a
                    combined account changed connections; the two lines it is
                    about are identical by construction, so without this the
                    reader cannot tell which of the cited rows it means — and
                    the green check above certifies all of them equally. */}
                {r.onHandoverDay && (
                  <span className="ml-1.5 text-xs" data-testid="ask-trace-handover-row">
                    (connection changeover)
                  </span>
                )}
              </span>
              <span className="flex shrink-0 items-baseline gap-2">
                <span data-testid="ask-trace-row-amount" className="font-medium tabular-nums">
                  {fmtCents(r.contributionCents)}
                </span>
                {fixable && (
                  <button
                    type="button"
                    data-testid="ask-trace-fix"
                    onClick={() => (editing ? correction.onCancel() : correction.onStart(r.txnId!))}
                    disabled={correction.busy}
                    aria-expanded={editing}
                    aria-label={
                      editing
                        ? `Cancel fixing ${r.merchant} (${r.date})`
                        : `Fix category for ${r.merchant} (${r.date})`
                    }
                    className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground transition hover:border-foreground/30 hover:text-foreground disabled:opacity-60"
                  >
                    {editing ? 'Cancel' : 'Fix category'}
                  </button>
                )}
              </span>
            </div>
            {editing && correction && <CorrectionEditor row={r} correction={correction} />}
          </li>
        );
      })}
    </ul>
  );
}

/** "This should be <category>" — the one-tap correction editor (slice 2b). The pick
 *  list is the page's visible-groups read, minus the category the row is already in. */
function CorrectionEditor({ row, correction }: { row: TraceRow; correction: CorrectionControls }) {
  const [picked, setPicked] = useState('');
  const selectId = `ask-correction-${row.txnId}`;
  const choices = correction.options.filter((o) => o.id !== row.categoryId);
  return (
    <div
      data-testid="ask-correction-editor"
      className="mt-1.5 flex flex-wrap items-center gap-2 rounded-lg border bg-background p-2"
    >
      <label htmlFor={selectId} className="text-xs text-muted-foreground">
        This should be
      </label>
      <select
        id={selectId}
        value={picked}
        onChange={(e) => setPicked(e.target.value)}
        data-testid="ask-correction-select"
        className="rounded-lg border bg-background px-2 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <option value="" disabled>
          Choose a category…
        </option>
        {choices.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={!picked || correction.busy}
        onClick={() => correction.onApply(row.txnId!, picked)}
        data-testid="ask-correction-apply"
        className="rounded-full border px-3 py-1 text-xs font-medium transition hover:border-foreground/30 disabled:opacity-60"
      >
        {correction.busy ? 'Updating…' : 'Update category'}
      </button>
    </div>
  );
}

/** The trace's include/exclude lines (assumption transparency), shared by the
 *  headline panel and every per-fact panel. */
function BasisList({ basis }: { basis: readonly string[] }) {
  if (basis.length === 0) return null;
  return (
    <ul className="space-y-1 border-t pt-2">
      {basis.map((b, i) => (
        <li key={i} className="text-xs text-muted-foreground">
          {b}
        </li>
      ))}
    </ul>
  );
}

/**
 * Glass-Box reconciliation panel (GLASSBOX_PLAN slice 2): the exact transaction
 * rows behind a tapped figure, reconciled to the penny. When the trace can't be
 * reconciled (answer→data drift), it says so honestly and points to the full view
 * — it NEVER shows a green check next to a number it can't stand behind.
 */
function TracePanel({
  trace,
  source,
  correction,
}: {
  trace: RowSumTrace;
  source?: AssistantSource;
  correction?: CorrectionControls;
}) {
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
                <TraceRows rows={g.rows} correction={correction} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <TraceRows rows={rows} correction={correction} />
      )}

      <BasisList basis={trace.basis} />
    </div>
  );
}

/** One derivation input line: optional date · label … signed amount. Money is
 *  formatted here (the one UI boundary); the signed cents come straight from
 *  the engine's trace — never re-signed or prettified. */
function DerivationLines({ rows }: { rows: readonly DerivationRow[] }) {
  return (
    <ul className="space-y-1.5">
      {rows.map((r, i) => (
        <li key={`${r.label}-${i}`} data-testid="ask-deriv-row" className="flex items-baseline justify-between gap-3 text-sm">
          {/* min-w-0 WITHOUT truncate (critic-2 P2-1): the label WRAPS like the
              dashboard glass-box, so the credit-balance / (autopay) / est.
              disclosures can never be clipped away at 380px — a marker that
              exists to prevent confusion must always be visible. */}
          <span className="min-w-0 text-muted-foreground">
            {/* Dates formatted through the same humanDate as the footer and the
                headline (critic-2 P2-2): one claim, one format, everywhere. */}
            {r.date && <span className="tabular-nums">{humanDate(r.date)} · </span>}
            {r.label}
            {/* Same "(autopay)" marker the dashboard glass-box shows for this
                row — Ask must never suggest manual action autopay covers. */}
            {(r.autopayCents ?? 0) > 0 && <span className="ml-1.5 text-xs">(autopay)</span>}
            {r.isEstimated && (
              <span className="ml-1.5 rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-wide">est.</span>
            )}
          </span>
          <span data-testid="ask-deriv-row-amount" className="shrink-0 font-medium tabular-nums">
            {fmtCents(r.amountCents)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** A labeled subtotal line under a group of derivation lines. */
function DerivationSubtotal({ label, cents, testId }: { label: string; cents: number; testId: string }) {
  return (
    <p className="mt-1.5 flex items-baseline justify-between gap-3 border-t pt-1.5 text-sm font-semibold">
      <span>{label}</span>
      <span data-testid={testId} className="shrink-0 tabular-nums">
        {fmtCents(cents)}
      </span>
    </p>
  );
}

/**
 * Glass-Box derivation panel (GLASSBOX_PLAN slice 3): the formula and its input
 * lines behind a derivation figure — net worth (assets − liabilities), cash
 * needed (per-card due amounts), savings rate (income − expenses, ÷ income).
 * `derivationView` re-verifies the whole chain locally before anything renders
 * under a ✓; when it can't (answer→data drift or a payload that doesn't add
 * up), the panel says so honestly and points to the full view — it NEVER shows
 * a formula that does not produce the number on screen.
 */
function DerivationPanel({ trace, source }: { trace: DerivationTrace; source?: AssistantSource }) {
  const view = derivationView(trace);
  if (!view) {
    return (
      <div
        id="ask-trace-panel"
        data-testid="ask-trace"
        role="region"
        aria-label="How this number is computed"
        className="mt-3 rounded-xl border border-dashed bg-muted/30 p-3 text-sm text-muted-foreground"
      >
        <p data-testid="ask-trace-unreconciled">
          I can’t fully verify this number right now — the underlying data may have changed since this
          answer.
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
              for the full picture.
            </>
          )}
        </p>
      </div>
    );
  }

  return (
    <div
      id="ask-trace-panel"
      data-testid="ask-trace"
      role="region"
      aria-label="How this number is computed"
      className="mt-3 space-y-3 rounded-xl border bg-muted/30 p-3"
    >
      {view.intentKind === 'net_worth' && <NetWorthDerivation trace={view} />}
      {view.intentKind === 'cash_needed' && <CashNeededDerivation trace={view} />}
      {view.intentKind === 'savings_rate' && <SavingsRateDerivation trace={view} />}
      <BasisList basis={view.basis} />
    </div>
  );
}

function NetWorthDerivation({ trace }: { trace: DerivationTrace & { intentKind: 'net_worth' } }) {
  // Split by the engine-set group tag (derivationView guarantees every line has
  // one). Subtotals are plain sums of the displayed lines; the gate verified
  // assets + liabilityContributions === netCents, so the formula line below is
  // the displayed lines' own arithmetic, not a new number.
  const assets = trace.rows.filter((r) => r.group === 'asset');
  const liabilities = trace.rows.filter((r) => r.group === 'liability');
  const assetsCents = assets.reduce((s, r) => s + r.amountCents, 0);
  // Liability lines carry NEGATED balances (their sum is the formula's minus
  // term); show each as the positive amount owed under the "owe" heading.
  const owedCents = -liabilities.reduce((s, r) => s + r.amountCents, 0);
  return (
    <>
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <Check className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
        <span data-testid="ask-deriv-reconciled">What you own minus what you owe</span>
      </p>
      <div data-testid="ask-deriv-assets">
        <p className="border-b pb-1 text-sm font-semibold">What you own</p>
        <div className="mt-1.5">
          <DerivationLines rows={assets} />
        </div>
        <DerivationSubtotal label="Total owned" cents={assetsCents} testId="ask-deriv-assets-total" />
      </div>
      <div data-testid="ask-deriv-liabilities">
        <p className="border-b pb-1 text-sm font-semibold">What you owe</p>
        <div className="mt-1.5">
          <DerivationLines
            rows={liabilities.map((r) => {
              // Show the amount OWED (the negated contribution). An overpaid card
              // legitimately shows negative owed — label it so "−$50.00 owed"
              // reads as the credit it is, not a sign error (critic F2).
              const owed = -r.amountCents || 0;
              return {
                ...r,
                amountCents: owed,
                label: owed < 0 ? `${r.label} (credit balance — the card owes you)` : r.label,
              };
            })}
          />
        </div>
        <DerivationSubtotal label="Total owed" cents={owedCents} testId="ask-deriv-owed-total" />
      </div>
      <p className="flex items-baseline justify-between gap-3 border-t pt-2 text-sm font-semibold">
        <span>
          {fmtCents(assetsCents)} − {fmtCents(owedCents)}
        </span>
        <span data-testid="ask-deriv-total" className="shrink-0 tabular-nums">
          {fmtCents(trace.netCents)}
        </span>
      </p>
    </>
  );
}

function CashNeededDerivation({ trace }: { trace: DerivationTrace & { intentKind: 'cash_needed' } }) {
  return (
    <>
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <Check className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
        <span data-testid="ask-deriv-reconciled">
          {trace.rows.length === 1 ? '1 card payment adds' : `${trace.rows.length} card payments add`} up to{' '}
          {fmtCents(trace.sumCents)}
        </span>
      </p>
      <DerivationLines rows={trace.rows} />
      <p className="flex items-baseline justify-between gap-3 border-t pt-2 text-sm font-semibold">
        {/* The footer restates the headline's "by DATE" claim — formatted through
            the SAME humanDate the headline used, never a second rendering. */}
        <span>{trace.byDate ? `Needed by ${humanDate(trace.byDate)}` : 'Needed'}</span>
        <span data-testid="ask-deriv-total" className="shrink-0 tabular-nums">
          {fmtCents(trace.requiredCents)}
        </span>
      </p>
    </>
  );
}

function SavingsRateDerivation({ trace }: { trace: DerivationTrace & { intentKind: 'savings_rate' } }) {
  return (
    <>
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <Check className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
        <span data-testid="ask-deriv-reconciled">What you kept of your income, as a share of it</span>
      </p>
      <DerivationLines rows={trace.rows} />
      <DerivationSubtotal label="Kept" cents={trace.savedCents} testId="ask-deriv-saved" />
      <p className="flex items-baseline justify-between gap-3 border-t pt-2 text-sm font-semibold">
        <span>
          {fmtCents(trace.savedCents)} ÷ {fmtCents(trace.incomeCents)}
        </span>
        <span data-testid="ask-deriv-rate" className="shrink-0 tabular-nums">
          {bpsToPct1dp(trace.rateBps)}%
        </span>
      </p>
    </>
  );
}
