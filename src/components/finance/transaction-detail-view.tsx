'use client';

/**
 * The transaction detail view (TASKS O.13b) — "a place to stand on one
 * transaction".
 *
 * Owner, with six Simplifi screenshots: *"Currently we can't even solve the
 * transaction list."* The register edits a row through inline popovers and SPLIT
 * was reachable only from the triage inbox, so a filed transaction the reader
 * wanted to split had no door at all. This page is the one surface carrying the
 * whole field set for a single row.
 *
 * Every control here calls the SAME server action the register or the inbox
 * already calls — `recategorize`, `setTransactionTax`, `splitTransaction`,
 * `undoSplit`. Nothing about how a transaction changes is re-implemented for
 * this screen; only where the reader can reach it is new.
 *
 * Forms follow `docs/lessons/mutation-form-recipe.md`: a plain onSubmit with its
 * own busy flag, never `useActionState` (whose React-19 auto-reset silently
 * reverts an uncontrolled category `<select>` to its first option on the error
 * path — a silent mis-file).
 */
import { useRef, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatISODate, isoDate } from '@/lib/dates';
import { cents, formatCents, parseDollarInput } from '@/lib/money';
import { TAX_CLASSES, TAX_CLASS_LABELS } from '@/lib/engine/tax/classes';
import { TXN_NOTE_MAX_CHARS } from '@/lib/engine/tax/note';
import { setTransactionTax } from '@/server/tax-actions';
import { recategorize, splitTransaction, undoSplit } from '@/server/triage-actions';
import { ActionDeadline, withDeadline } from '@/components/triage/action-deadline';
import { FORM_ACTION_DEADLINE_MS } from '@/components/finance/form-deadline';
import { provenanceBadgeView } from '@/components/finance/provenance-badge';
import { UNCONFIRMED_PARAM } from '@/components/finance/transaction-detail-params';
import type { TransactionDetailView as DetailView } from '@/server/transactions';

interface CategoryGroup {
  group: string;
  categories: { id: string; name: string }[];
}

/**
 * A refusal the SERVER returned as a value, with copy written for the reader —
 * distinct from a thrown error, whose message a production build replaces with a
 * digest. Only this kind is shown verbatim.
 */
class RefusalError extends Error {}

/** One labelled block. The page is a stack of these, in Simplifi's field order. */
function Field({
  label,
  children,
  testid,
}: {
  label: string;
  children: React.ReactNode;
  testid?: string;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b py-2 last:border-b-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="min-w-0 text-sm" data-testid={testid}>
        {children}
      </div>
    </div>
  );
}

export function TransactionDetailView({
  detail,
  categoryGroups,
  ruleExcludedReason,
  unconfirmed,
}: {
  detail: DetailView;
  categoryGroups: CategoryGroup[];
  /** The previous write timed out before it could be confirmed (see `run`). */
  unconfirmed: boolean;
  /** Why a rule cannot be written from this row, from the rule builder's OWN
   *  predicate (`getRuleSourceTransaction`) — never a second copy of it here. */
  ruleExcludedReason: string | null;
}) {
  const { row } = detail;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [splitOpen, setSplitOpen] = useState(false);
  const [firstPart, setFirstPart] = useState('');
  const errorRef = useRef<HTMLParagraphElement>(null);

  const flatCategories = categoryGroups.flatMap((g) => g.categories);
  const pv = provenanceBadgeView(row.provenance);
  const total = Math.abs(row.amountCents);

  /**
   * Run one mutation with the shared deadline, then reload so every derived
   * figure on the page (and the register behind it) re-reads from the server
   * rather than from an optimistic guess held here.
   *
   * The catch deliberately does NOT render `e.message`. `recategorize`,
   * `splitTransaction` and `undoSplit` THROW their refusals (against this repo's
   * own mutation-form recipe), and Next replaces a thrown server-action message
   * with an opaque digest in a production build — so `e.message` would show the
   * reader a digest string in the one environment that matters. A refusal the
   * reader can act on has to arrive as a RETURNED value; `setTransactionTax`
   * does that, and its copy is surfaced verbatim through `RefusalError`.
   */
  async function run(fn: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await withDeadline(fn(), FORM_ACTION_DEADLINE_MS);
      // assign(pathname), not reload(): a plain reload PRESERVES the query string,
      // so a confirmed save arriving after an unconfirmed one would re-render the
      // "we could not confirm it" banner about a write we just confirmed
      // (critic cycle 2, F6).
      window.location.assign(window.location.pathname);
    } catch (e) {
      if (e instanceof ActionDeadline) {
        // The write may well have committed. Reload to show whatever is true now,
        // and say so — a reload identical to a successful one tells the reader
        // nothing. The flag rides in the URL rather than in state restored by an
        // effect: `docs/lessons/mutation-form-recipe.md` records that a
        // set-state-in-effect resync was a smell that became the bug two
        // increments later, and a server-rendered banner needs no such rehydration.
        window.location.assign(`${window.location.pathname}?${UNCONFIRMED_PARAM}=1`);
        return;
      }
      setError(
        e instanceof RefusalError
          ? e.message
          : 'That did not go through. Reload the page to see the latest, then try again.',
      );
      setBusy(false);
      // The panels sit below the fold at 380px, so an error rendered at the top
      // of the page is an error the reader never sees.
      requestAnimationFrame(() => errorRef.current?.scrollIntoView({ block: 'center' }));
    }
  }

  const firstCents = parseDollarInput(firstPart);
  const splitValid = firstCents !== null && firstCents > 0 && firstCents < total;

  return (
    <div className="space-y-4" data-testid="txn-detail">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold" data-testid="detail-payee">
            {row.merchantName}
          </h1>
          {row.status === 'PENDING' && (
            <Badge variant="outline" className="text-[10px]">
              Pending
            </Badge>
          )}
          {row.isTransfer && (
            <Badge variant="outline" className="text-[10px]">
              Transfer
            </Badge>
          )}
        </div>
        <div
          className={`mt-1 text-2xl tabular-nums ${row.amountCents > 0 ? 'text-emerald-500' : ''}`}
          data-testid="detail-amount"
        >
          {formatCents(cents(row.amountCents), { signDisplay: 'always' })}
        </div>
      </div>

      {/* The provenance line — SIMPLIFI_PARITY row 16, and the reason a rule is
          teachable at all: this is the exact text a keyword matches against, and
          until O.13b it appeared on no screen the reader could reach for an
          already-filed row (the register shows the normalizer's cleaned-up name,
          which O.13i's brand work made even less literal).

          The wording is branched on where the text actually CAME FROM, because
          the first cut said "Appears on your … statement as …" for every row
          (critic cycle 1, P1). On a manual account that sentence is a claim about
          a bank, generated from the reader's own keystrokes — and there is no
          statement to appear on. A PENDING row has not reached a statement yet
          either, so it says so rather than asserting the past tense. */}
      <p className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
        {detail.descriptorOrigin === 'entered' ? (
          <>
            You entered this on <span className="text-foreground">{row.accountName}</span> as{' '}
          </>
        ) : row.status === 'PENDING' ? (
          <>
            Your bank sent this pending charge on{' '}
            <span className="text-foreground">{row.accountName}</span> as{' '}
          </>
        ) : (
          <>
            Your bank sent this on <span className="text-foreground">{row.accountName}</span> as{' '}
          </>
        )}
        <code className="break-all text-foreground" data-testid="detail-raw-descriptor">
          {row.rawDescriptor}
        </code>
        . A rule matches these words, not the tidied-up name above.
      </p>

      <div className="rounded-md border px-3">
        <Field label="Date">{formatISODate(isoDate(row.date), 'long')}</Field>
        <Field label="Account" testid="detail-account">
          {row.accountName}
        </Field>
        <Field label="Status">{row.status === 'PENDING' ? 'Pending' : 'Cleared'}</Field>
        <Field label="Why this category">
          <Badge
            variant="outline"
            className={`text-[10px] ${
              pv.tone === 'attention' ? 'border-amber-500/60 text-amber-700 dark:text-amber-300' : ''
            }`}
          >
            {pv.label}
          </Badge>
        </Field>
      </div>

      {/* `role="alert"` matches every sibling error site in this app (the auth
          form, accounts-list, add-transaction, budget-target). Without it a
          refused save is announced to nobody, and at 380px it paints above a fold
          the reader is not looking at — hence the scrollIntoView in `run`. */}
      {error && (
        <p
          ref={errorRef}
          role="alert"
          className="rounded-md border border-red-500/50 p-2 text-sm text-red-500"
          data-testid="detail-error"
        >
          {error}
        </p>
      )}
      {unconfirmed && !error && (
        <p
          role="alert"
          className="rounded-md border border-amber-500/60 p-2 text-sm text-amber-700 dark:text-amber-300"
          data-testid="detail-unconfirmed"
        >
          That took longer than expected, so we could not confirm it. This page has been reloaded —
          check the values below before trying again, because the change may already have been saved.
        </p>
      )}

      {/* CATEGORY — scope 'one'. Merchant-wide filing deliberately stays on the
          register (which computes the "apply to N" count from the row set it has
          already loaded) and on /rules (which previews its own count before the
          rule exists). Offering an all-rows action here without a count would be
          this wave's governing failure direction: a silent over-match. */}
      {!detail.isSplitParent && (
        <form
          className="space-y-2 rounded-md border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            const chosen = new FormData(e.currentTarget).get('categoryId');
            if (typeof chosen !== 'string' || chosen === '') return;
            void run(() => recategorize({ transactionId: row.id, categoryId: chosen, scope: 'one' }));
          }}
        >
          <label htmlFor="detail-category" className="text-sm font-medium">
            Category
          </label>
          <div className="flex flex-wrap gap-2">
            <select
              id="detail-category"
              name="categoryId"
              defaultValue={flatCategories.some((c) => c.id === row.categoryId) ? row.categoryId : ''}
              className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1 text-sm"
              data-testid="detail-category-select"
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
            <Button
              type="submit"
              size="sm"
              disabled={busy}
              aria-label="Save category"
              data-testid="detail-category-save"
            >
              Save
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Files this transaction only. To file every transaction like it — now and in future — write a
            rule, which shows you exactly how many rows it matches first.
          </p>
        </form>
      )}

      {/* NOTE + TAX TAG — one gesture, one action, exactly as the register pairs
          them (`setTransactionTax` writes both or neither).

          The TAG is withheld on a split container (critic cycle 1, P1): the tax
          export drops `isSplitParent` rows outright — it does not even list their
          year — so tagging one would have saved successfully, said so, and
          produced nothing in the only report that reads the field. The pieces are
          what the export sees, so that is where the reader is sent. No prior
          surface offered this at all; this page would have invented the hole. */}
      <form
        className="space-y-2 rounded-md border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const note = String(fd.get('note') ?? '').trim();
          const taxClass = String(fd.get('taxClass') ?? '');
          void run(async () => {
            const res = await setTransactionTax({
              transactionId: row.id,
              taxClass: taxClass === '' ? null : taxClass,
              note: note === '' ? null : note,
            });
            // This action REPORTS refusals (the demo fence, an unknown class)
            // rather than throwing them, so its copy is written for the reader and
            // is shown verbatim. A note that silently did not save is a note the
            // reader believes is there.
            if (!res.ok) throw new RefusalError(res.error);
          });
        }}
      >
        <label htmlFor="detail-note" className="text-sm font-medium">
          Note
        </label>
        <textarea
          id="detail-note"
          name="note"
          rows={2}
          maxLength={TXN_NOTE_MAX_CHARS}
          defaultValue={row.note ?? ''}
          placeholder="What was this for?"
          className="w-full rounded-md border bg-background px-2 py-1 text-sm"
          data-testid="detail-note"
        />
        <div className="flex flex-wrap items-center gap-2">
          {detail.isSplitParent ? (
            <>
              {/* The container's stored tag is sent back UNCHANGED. `setTransactionTax`
                  writes both fields on every call, so omitting the control entirely
                  made saving a NOTE silently erase a tag the reader never touched
                  (critic cycle 2, F5). */}
              <input type="hidden" name="taxClass" value={row.taxClass ?? ''} />
              <p className="text-xs text-muted-foreground" data-testid="detail-tax-on-parent">
                A tax tag belongs on the pieces, not on this container — the tax report leaves a split
                container out entirely, so a tag here would never reach it.
              </p>
            </>
          ) : (
            <>
              <label htmlFor="detail-tax" className="text-xs text-muted-foreground">
                Tax tag
              </label>
              <select
                id="detail-tax"
                name="taxClass"
                defaultValue={row.taxClass ?? ''}
                className="rounded-md border bg-background px-2 py-1 text-sm"
                data-testid="detail-tax"
              >
                <option value="">Untagged</option>
                {TAX_CLASSES.map((c) => (
                  <option key={c} value={c}>
                    {TAX_CLASS_LABELS[c]}
                  </option>
                ))}
              </select>
            </>
          )}
          <Button
            type="submit"
            size="sm"
            disabled={busy}
            aria-label={detail.isSplitParent ? 'Save note' : 'Save note and tax tag'}
            data-testid="detail-note-save"
          >
            Save
          </Button>
        </div>
      </form>

      {/* SPLIT — SIMPLIFI_PARITY row 11. The engine, the action and the two-part
          gesture are the triage inbox's; what O.13b adds is that a row already
          filed in the register can reach them at all. */}
      <div className="space-y-2 rounded-md border p-3" data-testid="detail-split">
        <div className="text-sm font-medium">Split</div>
        {detail.isSplitParent ? (
          <>
            <p className="text-xs text-muted-foreground">
              You split this transaction. The pieces below carry the money — this row itself is left out
              of every total so the split is never counted twice.
            </p>
            <ul className="text-sm" data-testid="detail-split-parts">
              {detail.parts.map((p) => (
                <li key={p.id} className="flex justify-between gap-3 border-b py-1 last:border-b-0">
                  <span className="min-w-0 truncate">{p.categoryName}</span>
                  <span className="tabular-nums">{formatCents(cents(p.amountCents))}</span>
                </li>
              ))}
            </ul>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              data-testid="detail-undo-split"
              onClick={() => void run(() => undoSplit(row.id))}
            >
              Undo split
            </Button>
          </>
        ) : detail.splitParentId ? (
          <>
            {/* THE WAY BACK. Both critics found this independently: a container is
                hidden from the register AND from the inbox, and `undoSplit` has no
                other durable caller — so once the reader navigated away from the
                parent's URL, the split was permanent and the undo lived at an
                address nothing linked to. The id was already being returned; only
                the link was missing. */}
            <p className="text-xs text-muted-foreground">{detail.splitBlockedReason}</p>
            <Link
              href={`/transactions/${encodeURIComponent(detail.splitParentId)}`}
              data-testid="detail-split-parent-link"
              className="tap-target inline-flex items-center justify-center rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
            >
              Open the whole transaction (and undo the split)
            </Link>
          </>
        ) : detail.splitBlockedReason ? (
          <p className="text-xs text-muted-foreground">{detail.splitBlockedReason}</p>
        ) : !splitOpen ? (
          <Button size="sm" variant="outline" data-testid="detail-split-open" onClick={() => setSplitOpen(true)}>
            Split into two categories
          </Button>
        ) : (
          <>
            {/* BEFORE the money moves, not after (critic cycle 2, F4). The tax
                report leaves a split container out entirely and the pieces inherit
                no tag, so splitting a tagged row silently removes it from that
                year's deductions. O.13b is what made an already-tagged register row
                splittable at all, so this is the moment the reader has to be told. */}
            {row.taxClass && (
              <p
                className="rounded-md border border-amber-500/60 p-2 text-xs text-amber-700 dark:text-amber-300"
                data-testid="detail-split-tax-warning"
              >
                This transaction is tagged for tax. Splitting it takes the whole{' '}
                {formatCents(cents(total))} out of your tax report — the pieces start untagged, so
                tag whichever ones still belong there.
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="detail-split-amount" className="text-xs text-muted-foreground">
                First part $
              </label>
              <input
                id="detail-split-amount"
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                value={firstPart}
                onChange={(e) => setFirstPart(e.target.value)}
                className="w-24 rounded-md border bg-background px-2 py-1 text-sm"
                data-testid="detail-split-amount"
              />
              <label htmlFor="detail-split-first-cat" className="sr-only">
                First part category
              </label>
              <select
                id="detail-split-first-cat"
                className="rounded-md border bg-background px-2 py-1 text-sm"
                data-testid="detail-split-first-cat"
              >
                {flatCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <span className="text-xs text-muted-foreground">· rest →</span>
              <label htmlFor="detail-split-second-cat" className="sr-only">
                Second part category
              </label>
              <select
                id="detail-split-second-cat"
                className="rounded-md border bg-background px-2 py-1 text-sm"
                data-testid="detail-split-second-cat"
                defaultValue={flatCategories[1]?.id ?? flatCategories[0]?.id}
              >
                {flatCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-xs text-muted-foreground" data-testid="detail-split-preview">
              {splitValid
                ? `${formatCents(cents(firstCents as number))} + ${formatCents(cents(total - (firstCents as number)))}`
                : `Enter a first part between ${formatCents(cents(1))} and ${formatCents(cents(total - 1))} — the rest goes to the second category.`}
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={busy || !splitValid}
                data-testid="detail-split-confirm"
                onClick={() => {
                  const first = (
                    document.getElementById('detail-split-first-cat') as HTMLSelectElement | null
                  )?.value;
                  const second = (
                    document.getElementById('detail-split-second-cat') as HTMLSelectElement | null
                  )?.value;
                  if (!first || !second || firstCents === null) return;
                  // The sign rule the action enforces, applied here so the parts
                  // it is handed are already the parent's sign (triage-inbox's
                  // doSplit does the identical arithmetic).
                  const sign = row.amountCents < 0 ? -1 : 1;
                  const a = sign * Math.abs(firstCents);
                  const b = row.amountCents - a;
                  void run(() =>
                    splitTransaction({
                      transactionId: row.id,
                      parts: [
                        { amountCents: a, categoryId: first },
                        { amountCents: b, categoryId: second },
                      ],
                    }),
                  );
                }}
              >
                Split
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSplitOpen(false)}>
                Cancel
              </Button>
            </div>
          </>
        )}
      </div>

      {/* THE RULE LEVER — the durable instruction, pre-filled from this row's own
          statement text (O.13b first slice). */}
      <div className="space-y-2 rounded-md border p-3">
        <div className="text-sm font-medium">Rule</div>
        {ruleExcludedReason ? (
          <p className="text-xs text-muted-foreground" data-testid="detail-rule-blocked">
            {ruleExcludedReason}
          </p>
        ) : (
          <>
            {/* The first cut promised "the ones already here and the ones still
                to arrive" (critic cycle 1, P1): the builder's apply-to-history
                box is deliberately OFF by default — a prior critic filed a P1
                when it defaulted on — so the retroactive half was a promise the
                default path does not keep. It is now described as the choice it
                actually is. */}
            <p className="text-xs text-muted-foreground">
              Write a rule that files transactions whose bank text contains the words you choose. You
              will see how many of your own transactions match before it saves, and whether to re-file
              the ones you already have is your choice at that point.
            </p>
            <Link
              href={`/rules?from=${encodeURIComponent(row.id)}`}
              data-testid="detail-rule-link"
              className="tap-target inline-flex items-center justify-center rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
            >
              Create a rule from this transaction
            </Link>
          </>
        )}
      </div>

      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        <Link href="/transactions" className="underline underline-offset-2 hover:text-foreground">
          Back to transactions
        </Link>
        <Link
          href={`/transactions?merchant=${encodeURIComponent(row.merchantName)}`}
          className="underline underline-offset-2 hover:text-foreground"
          data-testid="detail-merchant-link"
        >
          Every {row.merchantName} transaction
        </Link>
      </div>
    </div>
  );
}
