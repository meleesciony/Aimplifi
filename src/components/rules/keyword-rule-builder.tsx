'use client';

/**
 * The rule builder (TASKS O.13a) — the surface the owner has asked for repeatedly:
 *
 *   "Build the categorizer so I can group all 'Cardone' into income. I've clicked
 *    many of these already and categorized. The system clearly isn't smart enough
 *    to identify trends."
 *
 * His Cardone rows are why nothing DERIVED could ever have worked: three different
 * fund names ('Cardone Eq Fund Cef Xv Ppd', 'Cardone Equity F Cef Ix Ppd', …) each
 * carrying a `~ Tran: <id>` suffix that changes every deposit. The merchant
 * canonical differs per row and the descriptor signature differs per row, so every
 * correction he made taught the app about a payee it will never see again. One
 * typed keyword — `cardone` — spans all of them.
 *
 * TWO STEPS, DELIBERATELY. Type the key, see exactly which of your own rows it
 * matches, THEN create it. A rule files money without asking again, so the count
 * belongs in front of the reader before the rule exists rather than in a toast
 * afterwards (Simplifi shows the same review step; we show the number earlier).
 *
 * FORM MECHANICS follow docs/lessons/mutation-form-recipe.md: onSubmit with our own
 * busy flag, never `useActionState` (React 19 resets an uncontrolled form when a
 * form action returns, which silently empties the field the reader is still
 * working in), and the keyword text stays UNCONTROLLED — the DOM owns what he
 * typed, and we read it through FormData — so text typed before hydration is never
 * lost.
 */
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { formatCents } from '@/lib/money';
import { cents } from '@/lib/money';
import {
  type KeywordRulePreview,
  type StoredKeywordRule,
  createKeywordRule,
  deleteKeywordRule,
  previewKeywordRule,
} from '@/server/keyword-rules';
import { undoCorrections } from '@/server/triage-actions';

export interface CategoryOption {
  group: string;
  categories: { id: string; name: string }[];
}

const INPUT_CLASS =
  'w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function KeywordRuleBuilder({
  categoryGroups,
  rules,
  categoryNameById,
}: {
  categoryGroups: CategoryOption[];
  rules: StoredKeywordRule[];
  categoryNameById: Record<string, string>;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [preview, setPreview] = useState<KeywordRulePreview | null>(null);
  const [busy, setBusy] = useState<'preview' | 'create' | 'delete' | 'undo' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [applyToExisting, setApplyToExisting] = useState(false);
  /** Corrections written by the last apply, so the reader can put them back. */
  const [undoable, setUndoable] = useState<string[]>([]);
  /**
   * Rules created in THIS session, merged over the server list. `router.refresh()`
   * alone did not reliably repaint the list after the action (measured: the row was
   * in the database and the page still showed the empty state 20s later, until a
   * reload) — and a reader who just saw "Rule saved" beside "you have no rules"
   * has been told two contradictory things. These values come from the action's own
   * RETURN, not from a guess about what the server stored.
   */
  const [created, setCreated] = useState<StoredKeywordRule[]>([]);
  /** Ids removed in this session, so a delete disappears immediately too. */
  const [removed, setRemoved] = useState<string[]>([]);

  /**
   * Read the live form values without ever making the text input controlled — the
   * DOM owns the typed keywords (mutation-form-recipe). `applyToExisting` is
   * ordinary React state instead: it is a checkbox the reader can only reach
   * AFTER a preview has rendered, so hydration is long finished, and a boolean
   * carries no typed text to lose.
   */
  function read(): { keywordsRaw: string; categoryId: string } {
    const fd = new FormData(formRef.current!);
    return {
      keywordsRaw: String(fd.get('keywords') ?? ''),
      categoryId: String(fd.get('categoryId') ?? ''),
    };
  }

  async function onPreview(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setDone(null);
    setBusy('preview');
    try {
      const { keywordsRaw, categoryId } = read();
      setPreview(await previewKeywordRule({ keywordsRaw, categoryId: categoryId || undefined }));
    } catch {
      setError('We could not check that keyword just now. Please try again.');
    } finally {
      setBusy(null);
    }
  }

  async function onCreate() {
    if (busy) return;
    setError(null);
    setBusy('create');
    try {
      const { keywordsRaw, categoryId } = read();
      const res = await createKeywordRule({ keywordsRaw, categoryId, applyToExisting });
      const label = categoryNameById[categoryId] ?? categoryId;
      const skipped =
        res.skippedWrongSign > 0
          ? ` ${res.skippedWrongSign} money-out ${res.skippedWrongSign === 1 ? 'row was' : 'rows were'} left alone, because filing money out as income would remove it from your spending totals.`
          : '';
      setDone(
        res.affected > 0
          ? `Rule saved, and ${res.affected} ${res.affected === 1 ? 'transaction' : 'transactions'} filed as ${label}.${skipped}`
          : `Rule saved. It will file matching transactions from now on.${skipped}`,
      );
      setUndoable(res.correctionIds);
      setCreated((prev) => [...prev, { id: res.ruleId, keywords: res.keywords, categoryId }]);
      setPreview(null);
      formRef.current?.reset();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We could not save that rule. Please try again.');
    } finally {
      setBusy(null);
    }
  }

  /**
   * Put back what the apply just changed. `undoCorrections` has existed since the
   * inbox was built and the triage card was its ONLY caller, so the one-click
   * rewrite of months of history shipped with no way back (critic P1).
   */
  async function onUndoApply() {
    if (busy || undoable.length === 0) return;
    setBusy('undo');
    setError(null);
    try {
      await undoCorrections(undoable);
      setUndoable([]);
      setDone('Those transactions are back to the categories they had before.');
      router.refresh();
    } catch {
      setError('We could not undo that just now. Please try again.');
    } finally {
      setBusy(null);
    }
  }

  async function onDelete(ruleId: string) {
    if (busy) return;
    setBusy('delete');
    setError(null);
    try {
      await deleteKeywordRule(ruleId);
      setRemoved((prev) => [...prev, ruleId]);
      setCreated((prev) => prev.filter((r) => r.id !== ruleId));
      router.refresh();
    } catch {
      setError('We could not remove that rule just now. Please try again.');
    } finally {
      setBusy(null);
    }
  }

  const shownRules = [...rules, ...created.filter((c) => !rules.some((r) => r.id === c.id))].filter(
    (r) => !removed.includes(r.id),
  );

  return (
    <div className="space-y-4" data-testid="keyword-rules">
      <Card>
        <CardContent className="space-y-3 pt-4">
          <form ref={formRef} onSubmit={onPreview} className="space-y-3">
            <div className="space-y-1">
              <label htmlFor="kw" className="text-sm font-medium">
                When the statement text contains
              </label>
              <input
                id="kw"
                name="keywords"
                required
                placeholder="cardone"
                autoComplete="off"
                data-testid="kw-input"
                className={INPUT_CLASS}
              />
              <p className="break-words text-xs text-muted-foreground">
                Every word you enter must appear somewhere in the bank&rsquo;s own text for the
                transaction, in any order, and the match is literal. Separate words with a space or
                comma. Store numbers and transaction ids change every time, so leave them out —{' '}
                <span className="font-mono">cardone</span> matches every Cardone deposit no matter which
                fund or id follows it. Note that the bank&rsquo;s text is often not the name shown in your
                list: a row displayed as <span className="font-mono">Macy&rsquo;s</span> may arrive as{' '}
                <span className="font-mono">MACYS LENOX SQUARE</span>. Check below — the matches always
                show the bank&rsquo;s text.
              </p>
            </div>

            <div className="space-y-1">
              <label htmlFor="cat" className="text-sm font-medium">
                File it as
              </label>
              <select id="cat" name="categoryId" required data-testid="kw-category" className={INPUT_CLASS}>
                <option value="">Choose a category…</option>
                {categoryGroups.map((g) => (
                  <optgroup key={g.group} label={g.group}>
                    {g.categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>

            <Button type="submit" disabled={busy !== null} data-testid="kw-preview">
              {busy === 'preview' ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden /> Checking…
                </>
              ) : (
                'Check what this matches'
              )}
            </Button>
          </form>

          {error && (
            <p role="alert" className="text-sm text-red-400" data-testid="kw-error">
              {error}
            </p>
          )}
          {done && (
            <div className="space-y-1">
              <p role="status" className="text-sm text-emerald-400" data-testid="kw-done">
                {done}
              </p>
              {undoable.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onUndoApply}
                  disabled={busy !== null}
                  data-testid="kw-undo"
                >
                  {busy === 'undo' ? 'Undoing…' : `Undo those ${undoable.length}`}
                </Button>
              )}
            </div>
          )}

          {preview && (
            <div
              role="status"
              className="space-y-2 rounded-lg border p-3"
              data-testid="kw-preview-result"
            >
              {preview.keywords.length === 0 ? (
                <p className="text-sm">Enter at least one word for the rule to match on.</p>
              ) : preview.matchCount === 0 ? (
                <div className="space-y-1" data-testid="kw-preview-none">
                  <p className="text-sm">
                    Nothing in your history contains{' '}
                    {preview.keywords.map((k) => `“${k}”`).join(' and ')}. The rule would still apply to
                    future transactions, but the match is literal, so it is worth checking against the
                    bank&rsquo;s own text.
                  </p>
                  {preview.recentDescriptors.length > 0 && (
                    <>
                      <p className="text-xs text-muted-foreground">
                        This is how your recent transactions actually arrive — copy a word from one:
                      </p>
                      <ul className="space-y-0.5 text-xs text-muted-foreground">
                        {preview.recentDescriptors.map((d) => (
                          <li key={d} className="min-w-0 break-all font-mono">
                            {d}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              ) : (
                <>
                  <p className="text-sm" data-testid="kw-preview-count">
                    Matches <b>{preview.matchCount}</b>{' '}
                    {preview.matchCount === 1 ? 'transaction' : 'transactions'} in your history —{' '}
                    {preview.unfiledCount} not yet categorized
                    {preview.alreadyFiledElsewhereCount > 0 && (
                      <>, {preview.alreadyFiledElsewhereCount} already filed as something else</>
                    )}
                    .
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {preview.inflowCount} money in · {preview.outflowCount} money out
                  </p>
                  {preview.signMismatchCount !== null && preview.signMismatchCount > 0 && (
                    <p className="text-xs text-amber-400" data-testid="kw-sign-warning">
                      {preview.signMismatchCount} of them are money OUT, and this is an income category.
                      Those will be left alone — filing money out as income would remove it from your
                      spending totals entirely. The rule will skip them in future too.
                    </p>
                  )}
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {preview.samples.map((s, i) => (
                      <li key={`${s.date}-${i}`} className="flex min-w-0 items-baseline justify-between gap-2">
                        <span className="min-w-0 break-all font-mono">{s.rawDescriptor}</span>
                        <span className="shrink-0 tabular-nums">
                          {formatCents(cents(s.amountCents), { signDisplay: 'always' })}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {preview.matchCount > preview.samples.length && (
                    <p className="text-xs text-muted-foreground">
                      + {preview.matchCount - preview.samples.length} more
                    </p>
                  )}
                  <label className="flex items-start gap-2 pt-1 text-sm">
                    <input
                      type="checkbox"
                      checked={applyToExisting}
                      onChange={(e) => setApplyToExisting(e.currentTarget.checked)}
                      data-testid="kw-apply-existing"
                      className="mt-0.5"
                    />
                    <span>
                      Also file the{' '}
                      {preview.wouldFileCount === preview.matchCount
                        ? preview.matchCount
                        : `${preview.wouldFileCount} of ${preview.matchCount}`}{' '}
                      existing {preview.wouldFileCount === 1 ? 'transaction' : 'transactions'} this would
                      change now. You can undo it straight afterwards.
                    </span>
                  </label>
                  <Button onClick={onCreate} disabled={busy !== null} data-testid="kw-create">
                    {busy === 'create' ? (
                      <>
                        <Loader2 className="size-4 animate-spin" aria-hidden /> Saving…
                      </>
                    ) : (
                      <>
                        <Plus className="size-4" aria-hidden /> Create this rule
                      </>
                    )}
                  </Button>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="space-y-2">
        <h2 className="text-sm font-medium">Your rules</h2>
        {shownRules.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="kw-empty">
            You haven&rsquo;t written any rules yet. A rule files matching transactions automatically from
            now on, using the words you typed rather than a guess. Two things still take precedence: a
            payment detected as a transfer between two of your own accounts, and money-out rows you point
            at an income category.
          </p>
        ) : (
          <ul className="space-y-2" data-testid="kw-list">
            {shownRules.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2"
                data-testid="kw-rule-row"
              >
                <div className="min-w-0 text-sm">
                  <span className="text-muted-foreground">contains </span>
                  {r.keywords.map((k) => (
                    <span key={k} className="mr-1 break-all rounded bg-accent px-1.5 py-0.5 font-mono text-xs">
                      {k}
                    </span>
                  ))}
                  <span className="text-muted-foreground"> → </span>
                  <b className="break-words">{categoryNameById[r.categoryId] ?? r.categoryId}</b>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onDelete(r.id)}
                  disabled={busy !== null}
                  aria-label={`Delete the rule for ${r.keywords.join(' ')}`}
                  data-testid="kw-delete"
                  className="shrink-0"
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">
          Deleting a rule stops it filing anything new. Transactions it already filed keep their category
          — nothing is silently un-categorized.
        </p>
      </div>
    </div>
  );
}
