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
  const [busy, setBusy] = useState<'preview' | 'create' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [applyToExisting, setApplyToExisting] = useState(true);

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
      setDone(
        res.affected > 0
          ? `Rule saved, and ${res.affected} ${res.affected === 1 ? 'transaction' : 'transactions'} filed as ${categoryNameById[categoryId] ?? categoryId}.`
          : 'Rule saved. It will file matching transactions from now on.',
      );
      setPreview(null);
      formRef.current?.reset();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We could not save that rule. Please try again.');
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
      router.refresh();
    } catch {
      setError('We could not remove that rule just now. Please try again.');
    } finally {
      setBusy(null);
    }
  }

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
                Every word you enter must appear somewhere in the transaction&rsquo;s original bank text,
                in any order. Separate words with a space or comma. Store numbers and transaction ids
                change every time, so leave them out — <span className="font-mono">cardone</span> matches
                every Cardone deposit no matter which fund or id follows it.
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
            <p role="status" className="text-sm text-emerald-400" data-testid="kw-done">
              {done}
            </p>
          )}

          {preview && (
            <div className="space-y-2 rounded-lg border p-3" data-testid="kw-preview-result">
              {preview.keywords.length === 0 ? (
                <p className="text-sm">Enter at least one word — an empty rule would match everything.</p>
              ) : preview.matchCount === 0 ? (
                <p className="text-sm" data-testid="kw-preview-none">
                  Nothing in your history contains{' '}
                  {preview.keywords.map((k) => `“${k}”`).join(' and ')}. The rule would still apply to
                  future transactions, but check the spelling against the bank text below a transaction
                  first — the match is literal.
                </p>
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
                      {preview.signMismatchCount} of them run the other way for this category (money out
                      filed as income, or money in filed as spending). Filing those would move the amount
                      to the wrong side of every total.
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
                      Also file {preview.matchCount === 1 ? 'the' : 'all'} {preview.matchCount} existing{' '}
                      {preview.matchCount === 1 ? 'transaction' : 'transactions'} now.
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
        {rules.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="kw-empty">
            You haven&rsquo;t written any rules yet. A rule files matching transactions automatically from
            now on, and it never guesses — it does exactly what you typed.
          </p>
        ) : (
          <ul className="space-y-2" data-testid="kw-list">
            {rules.map((r) => (
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
