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
import { formatISODate, isoDate } from '@/lib/dates';
import { parseKeywords } from '@/lib/engine/categorize/keyword-rule';
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

/**
 * One OR-line: the keywords already committed to CHIPS plus the word still being
 * typed (owner, 2026-07-29, with Simplifi's Create Rule on screen: the keywords
 * belong on screen as deletable chips — `costco` `whse` `1084` — because deleting
 * the volatile ones is the entire point of a typed key). The chips are the
 * authoritative value; a hidden input carries `[...tokens, draft]` space-joined so
 * the FormData contract `read()` uses is unchanged.
 */
interface OrLine {
  key: number;
  tokens: string[];
  draft: string;
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

/**
 * The transaction this rule is being written FROM (TASKS O.13b), when the reader
 * arrived by clicking a row instead of opening `/rules` cold. Everything here is
 * READ-ONLY context plus starting values — the reader still previews and still
 * saves, because a rule minted by a click is exactly the silent filing this wave
 * exists to stop.
 */
export interface RulePrefillView {
  transactionId: string;
  rawDescriptor: string;
  merchantName: string | null;
  accountName: string;
  date: string;
  amountCents: number;
  categoryId: string | null;
  keywords: string[];
  /** Keywords that look statement-specific; hinted on the chip, never removed. */
  volatile: string[];
  /** Why a rule would not file this row, when that is true of it. */
  excludedReason: string | null;
}

export function KeywordRuleBuilder({
  categoryGroups,
  rules,
  categoryNameById,
  accounts,
  prefill = null,
}: {
  categoryGroups: CategoryOption[];
  rules: StoredKeywordRule[];
  categoryNameById: Record<string, string>;
  accounts: AccountOption[];
  prefill?: RulePrefillView | null;
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
  const [orLines, setOrLines] = useState<OrLine[]>([
    { key: 0, tokens: prefill?.keywords ?? [], draft: '' },
  ]);
  const nextLineKey = useRef(1);
  /**
   * O.13b: the chips that arrived from the clicked row's own statement text and
   * usually change between visits. A HINT on a chip he can see — the deletion is
   * always his gesture, because a key we widened silently is a key he never
   * typed (see `rule-prefill.ts`).
   */
  const volatileHint = new Set(prefill?.volatile ?? []);

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

  function freshLines(defs: string[]): OrLine[] {
    return (defs.length > 0 ? defs : ['']).map((def) => ({
      key: nextLineKey.current++,
      tokens: parseKeywords(def),
      draft: '',
    }));
  }

  /** Commit whatever separator-terminated words the reader just typed into chips. */
  function onDraftChange(lineKey: number, raw: string) {
    setOrLines((prev) =>
      prev.map((l) => {
        if (l.key !== lineKey) return l;
        // A separator ENDS a keyword (Simplifi: "Commas or spaces enter a new
        // keyword"), so everything before the final separator becomes chips and the
        // tail stays in the box as the word still being typed.
        const endsWithSeparator = /[,\s|]$/.test(raw);
        const committed = parseKeywords(endsWithSeparator ? raw : raw.replace(/[^,\s|]*$/, ''));
        const tail = endsWithSeparator ? '' : (/[^,\s|]*$/.exec(raw)?.[0] ?? '');
        // `parseKeywords` dedupes within its own input; dedupe against the chips
        // already on the line too, so typing a word twice is one condition.
        const merged = [...l.tokens];
        for (const t of committed) if (!merged.includes(t)) merged.push(t);
        return { ...l, tokens: merged, draft: tail };
      }),
    );
  }

  function removeToken(lineKey: number, token: string) {
    setOrLines((prev) =>
      prev.map((l) => (l.key === lineKey ? { ...l, tokens: l.tokens.filter((t) => t !== token) } : l)),
    );
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
      const keptNote =
        res.preservedHandFiled > 0
          ? ` ${res.preservedHandFiled} ${res.preservedHandFiled === 1 ? 'transaction you filed yourself was' : 'transactions you filed yourself were'} left as ${res.preservedHandFiled === 1 ? 'it was' : 'they were'}.`
          : '';
      setDone(
        res.affected > 0
          ? `Rule ${editing ? 'updated' : 'saved'}, and ${res.affected} ${res.affected === 1 ? 'transaction' : 'transactions'} filed as ${label}.${renamedNote}${keptNote}${skipped}`
          : `Rule ${editing ? 'updated' : 'saved'}. It will file matching transactions from now on.${renamedNote}${keptNote}${skipped}`,
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
          {/* O.13b — the statement PROVENANCE line for the row he clicked. The
              register shows the app's cleaned-up name (`Macy's`), the rule matches
              the bank's text (`MACYS LENOX SQUARE`), and until now no screen
              showed the second one. This is that screen. */}
          {prefill && !editing && (
            <div
              className="space-y-1 rounded-md border border-dashed px-3 py-2 text-sm"
              data-testid="kw-prefill-banner"
            >
              <p>
                Writing a rule from{' '}
                <span className="font-medium">{prefill.merchantName ?? 'this transaction'}</span> —{' '}
                {formatCents(cents(prefill.amountCents), { signDisplay: 'always' })} on{' '}
                {formatISODate(isoDate(prefill.date), 'long')}.
              </p>
              <p className="break-words text-xs text-muted-foreground">
                Appears on your {prefill.accountName} statement as{' '}
                <span className="font-mono" data-testid="kw-prefill-descriptor">
                  {prefill.rawDescriptor}
                </span>
                . Those words are already filled in below. Remove the parts that change every visit —
                a store number or a transaction id — and the rule will cover the next one too.
              </p>
              {prefill.excludedReason && (
                <p className="text-xs text-amber-700 dark:text-amber-300" data-testid="kw-prefill-excluded">
                  {prefill.excludedReason} The count below will not include it.
                </p>
              )}
            </div>
          )}
          <form ref={formRef} onSubmit={onPreview} className="space-y-3" key={formKey}>
            <div className="space-y-1">
              <label htmlFor="kw" className="text-sm font-medium">
                When the statement text contains
              </label>
              {orLines.map((line, i) => (
                <div key={line.key} className="flex items-start gap-2">
                  {i > 0 && <span className="pt-2 text-xs text-muted-foreground">or</span>}
                  <div className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                        Contains
                      </span>
                      {/* The reader's keywords AS CHIPS, each deletable — the owner's
                          named ask, verbatim: delete the store number and the
                          sequence, keep `tjmaxx`, and the rule holds forever. */}
                      {line.tokens.map((t) => (
                        <span
                          key={t}
                          data-testid="kw-chip"
                          data-volatile={i === 0 && volatileHint.has(t) ? 'true' : undefined}
                          title={
                            i === 0 && volatileHint.has(t)
                              ? 'This part of the bank’s text usually changes between visits — removing it makes the rule match more of them.'
                              : undefined
                          }
                          className={`inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 font-mono text-xs ${
                            i === 0 && volatileHint.has(t)
                              ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                              : 'bg-accent'
                          }`}
                        >
                          {t}
                          <button
                            type="button"
                            onClick={() => removeToken(line.key, t)}
                            aria-label={`Remove the keyword ${t}`}
                            data-testid={`kw-chip-remove-${t}`}
                            className="tap-target inline-flex items-center justify-center rounded hover:text-red-400"
                          >
                            <X className="size-3" aria-hidden />
                          </button>
                        </span>
                      ))}
                      <input
                        id={i === 0 ? 'kw' : `kw-or-${i}`}
                        // Deliberately NOT `required`: an empty key must earn OUR
                        // sentence ("type at least one word…") from the preview,
                        // which is the tested refusal path, rather than a browser
                        // validation bubble that says nothing about why a rule with
                        // no words would match nothing.
                        placeholder={line.tokens.length > 0 ? 'another word' : i === 0 ? 'costco whse 1084' : 'cardone equity'}
                        autoComplete="off"
                        value={line.draft}
                        onChange={(e) => onDraftChange(line.key, e.target.value)}
                        data-testid={i === 0 ? 'kw-input' : `kw-input-or-${i}`}
                        aria-label={
                          i === 0 ? 'Keywords the statement text must contain' : `Alternative keywords ${i + 1}`
                        }
                        className="min-w-[8rem] flex-1 bg-transparent px-1 py-0.5 text-sm outline-none"
                      />
                    </div>
                    {/* The authoritative value the form submits: chips plus the word
                        still in the box, so a reader who never types a trailing space
                        still gets the word he typed. One entry per OR line, which is
                        exactly what `read()` joins with the stored `|` divider. */}
                    <input type="hidden" name="keywords" value={[...line.tokens, line.draft].join(' ')} />
                  </div>
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
                onClick={() =>
                  setOrLines((prev) => [...prev, { key: nextLineKey.current++, tokens: [], draft: '' }])
                }
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
                defaultValue={editing?.categoryId ?? prefill?.categoryId ?? ''}
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
                  {/* The reader's own outliers. Owner, 2026-07-30: "occasionally we
                      may change a single transaction (outlier) for a diff category.
                      Keep that intact." They are excluded from the apply, and an
                      exclusion he is not TOLD about is its own kind of surprise. */}
                  {preview.handFiledCount !== null && preview.handFiledCount > 0 && (
                    <p className="text-xs text-muted-foreground" data-testid="kw-hand-filed-note">
                      {preview.handFiledCount}{' '}
                      {preview.handFiledCount === 1
                        ? 'of them you filed yourself into another category, and it stays'
                        : 'of them you filed yourself into other categories, and they stay'}{' '}
                      exactly as you left {preview.handFiledCount === 1 ? 'it' : 'them'}. The rule
                      still files new transactions that match.
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
