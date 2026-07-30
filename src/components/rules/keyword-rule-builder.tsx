'use client';

/**
 * The rule builder (TASKS O.13a, extended O.13c to Simplifi parity) — the surface
 * the owner has asked for repeatedly:
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
 * O.13c adds the rest of Simplifi's Create Rule, against his screenshot of it:
 *  - OR lines ("Add 'OR' conditions to target different keyword combinations") —
 *    extra keyword inputs, any one of which matching files the row;
 *  - RENAME PAYEE — the THEN action that groups every descriptor variant under
 *    one payee name he chose (the bank's own text is always kept and shown);
 *  - ACCOUNT and AMOUNT conditions — the columns the rule row has carried since
 *    Phase 2, finally exposed;
 *  - EDIT — a rule can be changed in place instead of delete-and-retype.
 *
 * TWO STEPS, DELIBERATELY. Type the key, see exactly which of your own rows it
 * matches, THEN create it. A rule files money without asking again, so the count
 * belongs in front of the reader before the rule exists rather than in a toast
 * afterwards (Simplifi shows the same review step; we show the number earlier).
 *
 * FORM MECHANICS follow docs/lessons/mutation-form-recipe.md: onSubmit with our own
 * busy flag, never `useActionState` (React 19 resets an uncontrolled form when a
 * form action returns, which silently empties the field the reader is still
 * working in), and the typed text stays UNCONTROLLED — the DOM owns what he
 * typed, and we read it through FormData — so text typed before hydration is never
 * lost. Edit-mode prefills work WITH that recipe, not against it: entering edit
 * remounts the form (a `key` bump) with `defaultValue`s from the stored rule, so
 * the inputs stay uncontrolled afterwards.
 */
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
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
  updateKeywordRule,
} from '@/server/keyword-rules';
import { undoCorrections } from '@/server/triage-actions';

export interface CategoryOption {
  group: string;
  categories: { id: string; name: string }[];
}

export interface AccountOption {
  id: string;
  name: string;
}

const INPUT_CLASS =
  'w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** One rule's IF-side as the human-readable line the list renders. */
function describeConditions(
  r: StoredKeywordRule,
  accountNameById: Record<string, string>,
): string[] {
  const extras: string[] = [];
  if (r.accountId) extras.push(`only in ${accountNameById[r.accountId] ?? 'one account'}`);
  if (r.minAmountCents !== null && r.maxAmountCents !== null) {
    extras.push(
      `${formatCents(cents(r.minAmountCents))}–${formatCents(cents(r.maxAmountCents))}`,
    );
  } else if (r.minAmountCents !== null) {
    extras.push(`at least ${formatCents(cents(r.minAmountCents))}`);
  } else if (r.maxAmountCents !== null) {
    extras.push(`at most ${formatCents(cents(r.maxAmountCents))}`);
  }
  return extras;
}

export function KeywordRuleBuilder({
  categoryGroups,
  rules,
  categoryNameById,
  accounts,
}: {
  categoryGroups: CategoryOption[];
  rules: StoredKeywordRule[];
  categoryNameById: Record<string, string>;
  accounts: AccountOption[];
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
   * EDIT MODE (O.13c). The rule being edited, or null when creating. Entering
   * edit bumps `formKey` so the uncontrolled form remounts with the rule's
   * stored values as defaults — the mutation-form recipe's uncontrolled inputs
   * stay uncontrolled.
   */
  const [editing, setEditing] = useState<StoredKeywordRule | null>(null);
  const [formKey, setFormKey] = useState(0);
  /**
   * The OR-lines currently on screen: one entry per keyword input, holding a
   * STABLE key plus its DEFAULT value only (the DOM owns the live text). The
   * key must be stable per line — an index key would hand line N+1's DOM input
   * (and the stale text inside it) to line N when a middle line is removed,
   * because the inputs are uncontrolled by design (mutation-form-recipe).
   */
  const [orLines, setOrLines] = useState<{ key: number; def: string }[]>([{ key: 0, def: '' }]);
  const nextLineKey = useRef(1);

  const accountNameById = Object.fromEntries(accounts.map((a) => [a.id, a.name] as const));

  /**
   * Read the live form values without ever making the text inputs controlled —
   * the DOM owns the typed keywords (mutation-form-recipe). Multiple OR-lines
   * share the `keywords` field name and are joined with the same `|` divider the
   * stored encoding uses, so one typed pipe and one extra line mean the same
   * thing. `applyToExisting` is ordinary React state instead: a checkbox the
   * reader can only reach AFTER a preview has rendered, so hydration is long
   * finished, and a boolean carries no typed text to lose.
   */
  function read() {
    const fd = new FormData(formRef.current!);
    return {
      keywordsRaw: fd
        .getAll('keywords')
        .map((v) => String(v))
        .filter((v) => v.trim() !== '')
        .join(' | '),
      categoryId: String(fd.get('categoryId') ?? ''),
      renameTo: String(fd.get('renameTo') ?? ''),
      accountId: String(fd.get('accountId') ?? '') || null,
      minAmountRaw: String(fd.get('minAmount') ?? ''),
      maxAmountRaw: String(fd.get('maxAmount') ?? ''),
    };
  }

  function freshLines(defs: string[]): { key: number; def: string }[] {
    return (defs.length > 0 ? defs : ['']).map((def) => ({ key: nextLineKey.current++, def }));
  }

  function resetForm() {
    setEditing(null);
    setOrLines(freshLines(['']));
    setPreview(null);
    setApplyToExisting(false);
    setFormKey((k) => k + 1);
  }

  function startEdit(rule: StoredKeywordRule) {
    setError(null);
    setDone(null);
    setPreview(null);
    setApplyToExisting(false);
    setEditing(rule);
    setOrLines(freshLines(rule.groups.map((g) => g.join(' '))));
    setFormKey((k) => k + 1);
  }

  async function onPreview(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setDone(null);
    setBusy('preview');
    try {
      const { keywordsRaw, categoryId, accountId, minAmountRaw, maxAmountRaw } = read();
      setPreview(
        await previewKeywordRule({
          keywordsRaw,
          categoryId: categoryId || undefined,
          accountId,
          minAmountRaw,
          maxAmountRaw,
        }),
      );
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : 'We could not check that keyword just now. Please try again.',
      );
    } finally {
      setBusy(null);
    }
  }

  async function onCreate() {
    if (busy) return;
    setError(null);
    setBusy('create');
    try {
      const values = read();
      const res = editing
        ? await updateKeywordRule(editing.id, { ...values, applyToExisting })
        : await createKeywordRule({ ...values, applyToExisting });
      const label = categoryNameById[values.categoryId] ?? values.categoryId;
      const skipped =
        res.skippedWrongSign > 0
          ? ` ${res.skippedWrongSign} money-out ${res.skippedWrongSign === 1 ? 'row was' : 'rows were'} left alone, because filing money out as income would remove it from your spending totals.`
          : '';
      const renamedNote =
        res.renamed > 0
          ? ` ${res.renamed} ${res.renamed === 1 ? 'payee was' : 'payees were'} renamed — the bank’s original text stays on every one.`
          : '';
      setDone(
        res.affected > 0
          ? `Rule ${editing ? 'updated' : 'saved'}, and ${res.affected} ${res.affected === 1 ? 'transaction' : 'transactions'} filed as ${label}.${renamedNote}${skipped}`
          : `Rule ${editing ? 'updated' : 'saved'}. It will file matching transactions from now on.${renamedNote}${skipped}`,
      );
      setUndoable(res.correctionIds);
      // Built from the action's own RETURN, never a guess about what was stored.
      const stored: StoredKeywordRule = {
        id: res.ruleId,
        groups: res.groups,
        categoryId: values.categoryId,
        renameTo: res.renameTo,
        accountId: res.accountId,
        minAmountCents: res.minAmountCents,
        maxAmountCents: res.maxAmountCents,
      };
      setCreated((prev) => [...prev.filter((r) => r.id !== stored.id), stored]);
      if (editing) setRemoved((prev) => prev.filter((id) => id !== editing.id));
      resetForm();
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
      if (editing?.id === ruleId) resetForm();
      router.refresh();
    } catch {
      setError('We could not remove that rule just now. Please try again.');
    } finally {
      setBusy(null);
    }
  }

  const shownRules = [
    ...rules.filter((r) => !created.some((c) => c.id === r.id)),
    ...created,
  ].filter((r) => !removed.includes(r.id));

  return (
    <div className="space-y-4" data-testid="keyword-rules">
      <Card>
        <CardContent className="space-y-3 pt-4">
          {editing && (
            <div
              className="flex items-center justify-between gap-2 rounded-md border border-dashed px-3 py-2 text-sm"
              data-testid="kw-editing-banner"
            >
              <span>
                Editing the rule for{' '}
                <span className="font-mono">{editing.groups.map((g) => g.join(' ')).join(' or ')}</span>
                . Changes apply when you save.
              </span>
              <Button variant="ghost" size="sm" onClick={resetForm} data-testid="kw-edit-cancel">
                Cancel
              </Button>
            </div>
          )}
          <form ref={formRef} onSubmit={onPreview} className="space-y-3" key={formKey}>
            <div className="space-y-1">
              <label htmlFor="kw" className="text-sm font-medium">
                When the statement text contains
              </label>
              {orLines.map((line, i) => (
                <div key={line.key} className="flex items-center gap-2">
                  {i > 0 && <span className="text-xs text-muted-foreground">or</span>}
                  <input
                    id={i === 0 ? 'kw' : `kw-or-${i}`}
                    name="keywords"
                    required={i === 0}
                    placeholder={i === 0 ? 'cardone eq' : 'cardone equity'}
                    autoComplete="off"
                    defaultValue={line.def}
                    data-testid={i === 0 ? 'kw-input' : `kw-input-or-${i}`}
                    aria-label={i === 0 ? undefined : `Alternative keywords ${i + 1}`}
                    className={INPUT_CLASS}
                  />
                  {i > 0 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setOrLines((prev) => prev.filter((l) => l.key !== line.key))}
                      aria-label={`Remove alternative keywords ${i + 1}`}
                      data-testid={`kw-remove-or-${i}`}
                      className="shrink-0"
                    >
                      <X className="size-4" aria-hidden />
                    </Button>
                  )}
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setOrLines((prev) => [...prev, { key: nextLineKey.current++, def: '' }])}
                data-testid="kw-add-or"
              >
                <Plus className="size-4" aria-hidden /> Add an &ldquo;or&rdquo; line
              </Button>
              <p className="break-words text-xs text-muted-foreground">
                Every word on a line must appear somewhere in the bank&rsquo;s own text for the
                transaction, in any order, and the match is literal. If you add &ldquo;or&rdquo; lines,
                matching any one line is enough. Separate words with a space or comma. Store numbers and
                transaction ids change every time, so leave them out —{' '}
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
              <select
                id="cat"
                name="categoryId"
                required
                defaultValue={editing?.categoryId ?? ''}
                data-testid="kw-category"
                className={INPUT_CLASS}
              >
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

            <div className="space-y-1">
              <label htmlFor="kw-rename" className="text-sm font-medium">
                Rename the payee to <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <input
                id="kw-rename"
                name="renameTo"
                placeholder="Cardone"
                autoComplete="off"
                defaultValue={editing?.renameTo ?? ''}
                data-testid="kw-rename"
                className={INPUT_CLASS}
              />
              <p className="text-xs text-muted-foreground">
                Every matching transaction shows this one payee name instead of the bank&rsquo;s changing
                text, and they group together everywhere — the register, the merchant lens, recurring.
                The bank&rsquo;s original text is always kept on the transaction.
              </p>
            </div>

            <details
              className="rounded-md border px-3 py-2"
              open={Boolean(
                editing &&
                  (editing.accountId || editing.minAmountCents !== null || editing.maxAmountCents !== null),
              )}
            >
              <summary className="cursor-pointer text-sm font-medium">
                Only in some cases <span className="font-normal text-muted-foreground">(optional)</span>
              </summary>
              <div className="mt-2 space-y-3">
                <div className="space-y-1">
                  <label htmlFor="kw-account" className="text-sm font-medium">
                    Only in this account
                  </label>
                  <select
                    id="kw-account"
                    name="accountId"
                    defaultValue={editing?.accountId ?? ''}
                    data-testid="kw-account"
                    className={INPUT_CLASS}
                  >
                    <option value="">Any account</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label htmlFor="kw-min" className="text-sm font-medium">
                      Amount at least
                    </label>
                    <input
                      id="kw-min"
                      name="minAmount"
                      placeholder="No minimum"
                      autoComplete="off"
                      inputMode="decimal"
                      defaultValue={
                        editing?.minAmountCents != null ? (editing.minAmountCents / 100).toFixed(2) : ''
                      }
                      data-testid="kw-min"
                      className={INPUT_CLASS}
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="kw-max" className="text-sm font-medium">
                      Amount at most
                    </label>
                    <input
                      id="kw-max"
                      name="maxAmount"
                      placeholder="No maximum"
                      autoComplete="off"
                      inputMode="decimal"
                      defaultValue={
                        editing?.maxAmountCents != null ? (editing.maxAmountCents / 100).toFixed(2) : ''
                      }
                      data-testid="kw-max"
                      className={INPUT_CLASS}
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Amounts compare on the size of the transaction, whichever direction the money moved.
                </p>
              </div>
            </details>

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
              {preview.groups.length === 0 ? (
                <p className="text-sm">Enter at least one word for the rule to match on.</p>
              ) : preview.matchCount === 0 ? (
                <div className="space-y-1" data-testid="kw-preview-none">
                  <p className="text-sm">
                    Nothing in your history contains{' '}
                    {preview.groups
                      .map((g) => g.map((k) => `“${k}”`).join(' and '))
                      .join(', or ')}
                    . The rule would still apply to future transactions, but the match is literal, so it
                    is worth checking against the bank&rsquo;s own text.
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
                      change now (a rename, if you set one, applies to{' '}
                      {preview.matchCount - (preview.signMismatchCount ?? 0)} of them — money-out rows
                      pointed at an income category are left alone entirely). You can undo the category
                      changes straight afterwards.
                    </span>
                  </label>
                  <Button onClick={onCreate} disabled={busy !== null} data-testid="kw-create">
                    {busy === 'create' ? (
                      <>
                        <Loader2 className="size-4 animate-spin" aria-hidden /> Saving…
                      </>
                    ) : editing ? (
                      <>
                        <Pencil className="size-4" aria-hidden /> Save changes
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
            {shownRules.map((r) => {
              const extras = describeConditions(r, accountNameById);
              return (
                <li
                  key={r.id}
                  className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2"
                  data-testid="kw-rule-row"
                >
                  <div className="min-w-0 text-sm">
                    <span className="text-muted-foreground">contains </span>
                    {r.groups.map((g, gi) => (
                      <span key={gi}>
                        {gi > 0 && <span className="text-muted-foreground"> or </span>}
                        {g.map((k) => (
                          <span
                            key={k}
                            className="mr-1 break-all rounded bg-accent px-1.5 py-0.5 font-mono text-xs"
                          >
                            {k}
                          </span>
                        ))}
                      </span>
                    ))}
                    {extras.length > 0 && (
                      <span className="text-xs text-muted-foreground">({extras.join(', ')}) </span>
                    )}
                    <span className="text-muted-foreground"> → </span>
                    <b className="break-words">{categoryNameById[r.categoryId] ?? r.categoryId}</b>
                    {r.renameTo && (
                      <span className="text-muted-foreground">
                        , shown as <b className="break-words text-foreground">{r.renameTo}</b>
                      </span>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => startEdit(r)}
                      disabled={busy !== null}
                      aria-label={`Edit the rule for ${r.groups.map((g) => g.join(' ')).join(' or ')}`}
                      data-testid="kw-edit"
                    >
                      <Pencil className="size-4" aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onDelete(r.id)}
                      disabled={busy !== null}
                      aria-label={`Delete the rule for ${r.groups.map((g) => g.join(' ')).join(' or ')}`}
                      data-testid="kw-delete"
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">
          Deleting a rule stops it filing anything new. Editing one changes what it does from now on.
          Either way, transactions it already filed keep the category and the payee name it gave them —
          nothing is silently un-categorized, and clearing the payee name here does not put the bank&rsquo;s
          text back on rows that were already renamed.
        </p>
      </div>
    </div>
  );
}
