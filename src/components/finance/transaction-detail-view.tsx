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
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  RETURN_PARAM,
  merchantRegisterHref,
  withRegisterReturn,
  type RegisterReturn,
} from '@/lib/engine/transactions/links';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatISODate, isoDate } from '@/lib/dates';
import { cents, formatCents, parseDollarInput } from '@/lib/money';
import { TAX_CLASSES, TAX_CLASS_LABELS } from '@/lib/engine/tax/classes';
import { TXN_NOTE_MAX_CHARS } from '@/lib/engine/tax/note';
import { setTransactionTax } from '@/server/tax-actions';
import {
  setExcludeFromTotals,
  setReimbursement,
  setTransactionStatus,
} from '@/server/transaction-flags-actions';
import {
  clearRecurringVerdict,
  markMerchantNotABill,
  markTransactionAsBill,
} from '@/server/recurring-override-actions';
import { DECLARABLE_CADENCES } from '@/lib/engine/recurring/override';
import { recategorize, splitTransaction, undoSplit } from '@/server/triage-actions';
import {
  STATUS_PENDING_EFFECT,
  STATUS_PENDING_TAX_CAUTION,
  txnActionAvailability,
} from '@/lib/engine/transactions/actions';
import { reimbursementState } from '@/lib/engine/transactions/reimbursement';
import {
  ATTACHMENT_TYPES,
  MAX_ATTACHMENTS_PER_TRANSACTION,
  MAX_ATTACHMENT_BYTES,
  attachmentAcceptAttribute,
  attachmentTypeLabel,
  formatAttachmentSize,
  isRenderableInline,
} from '@/lib/engine/attachments/attachment';
import { deleteTransactionAttachment } from '@/server/attachment-actions';
import type { AttachmentListItem } from '@/server/attachments';
import { TxnActionMenuItems } from '@/components/finance/txn-action-menu';
import { FileText, MoreHorizontal } from 'lucide-react';
import { ActionDeadline, withDeadline } from '@/components/triage/action-deadline';
import { FORM_ACTION_DEADLINE_MS } from '@/components/finance/form-deadline';
import { provenanceBadgeView } from '@/components/finance/provenance-badge';
import { SpendClassSelect } from '@/components/finance/spend-class-select';
import {
  PROJECTIONS_STALE_PARAM,
  UNCONFIRMED_PARAM,
} from '@/components/finance/transaction-detail-params';
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

/**
 * How each cadence reads in a sentence (O.13f). One table, beside the closed set
 * it labels, so a cadence can never reach the screen as a raw enum spelling.
 */
const CADENCE_ADVERB: Record<string, string> = {
  WEEKLY: 'every week',
  BIWEEKLY: 'every two weeks',
  MONTHLY: 'every month',
  QUARTERLY: 'every three months',
  SEMIANNUAL: 'twice a year',
  ANNUAL: 'once a year',
};

/** The rhythm picker. Uncontrolled `<select>` + explicit submit, the recipe this
 *  page's other forms follow (never `useActionState` — L.7). */
function RecurringCadenceForm({
  busy,
  initial,
  submitLabel,
  onSubmit,
}: {
  busy: boolean;
  initial: string;
  submitLabel: string;
  onSubmit: (cadence: string) => void;
}) {
  const [cadence, setCadence] = useState(initial);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor="detail-recurring-cadence" className="text-xs text-muted-foreground">
        How often
      </label>
      <select
        id="detail-recurring-cadence"
        data-testid="detail-recurring-cadence"
        className="tap-target rounded-md border bg-background px-2 py-1 text-sm"
        value={cadence}
        disabled={busy}
        onChange={(e) => setCadence(e.target.value)}
      >
        {DECLARABLE_CADENCES.map((c) => (
          <option key={c} value={c}>
            {CADENCE_ADVERB[c]}
          </option>
        ))}
      </select>
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        data-testid="detail-recurring-save"
        onClick={() => onSubmit(cadence)}
      >
        {submitLabel}
      </Button>
    </div>
  );
}

/**
 * The shared Button is `whitespace-nowrap`, which turns a long label into a page
 * 55px wider than a 360px phone — measured by tests/e2e/mobile-overflow.spec.ts on
 * this very section. Any button here whose text is a sentence carries this.
 */
const WRAPPING_BUTTON = 'h-auto whitespace-normal text-left';

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

/**
 * Where to land after a write on this page.
 *
 * `assign(pathname)` — dropping the whole query string — is deliberate and
 * predates O.16: a plain `reload()` preserves the query, so a confirmed save
 * arriving after an unconfirmed one would re-render the "we could not confirm
 * it" banner about a write that just succeeded (critic cycle 2, F6). But the
 * reader's PLACE also rides in the query now, and it must survive a write the
 * way the banner flags must not — otherwise marking a row pending silently
 * costs him the queue he was working, which is the exact complaint O.16 exists
 * to answer.
 *
 * So the rule is no longer "keep everything" or "drop everything": carry
 * `back` forward, and re-add a status flag only when this write is what set it.
 */
function afterWriteHref(flag?: string): string {
  const carried = new URLSearchParams(window.location.search).get(RETURN_PARAM);
  const params = new URLSearchParams();
  if (carried) params.set(RETURN_PARAM, carried);
  if (flag) params.set(flag, '1');
  const qs = params.toString();
  return qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
}

export function TransactionDetailView({
  detail,
  categoryGroups,
  ruleExcludedReason,
  unconfirmed,
  recurringVerdict,
  projectionsStale,
  returnTo,
  attachments,
  canEditSpendClass = true,
}: {
  detail: DetailView;
  categoryGroups: CategoryGroup[];
  /** The previous write timed out before it could be confirmed (see `run`). */
  unconfirmed: boolean;
  /** Why a rule cannot be written from this row, from the rule builder's OWN
   *  predicate (`getRuleSourceTransaction`) — never a second copy of it here. */
  ruleExcludedReason: string | null;
  /** O.13f — the reader's standing verdict on this row's payee, already read back
   *  through the engine's parser (so an unreadable row arrives as no verdict). */
  recurringVerdict: {
    merchantCanonical: string | null;
    decision: string | null;
    cadence: string | null;
    /** Why this row may not be declared recurring — the engine's own sentence. */
    blockedReason: string | null;
  };
  /** The last verdict saved but its projection rebuild did not run. */
  projectionsStale: boolean;
  /** O.16 — the filtered register the reader left, already validated and named
   *  by the engine, or null when he did not arrive from a narrowed view. */
  returnTo: RegisterReturn | null;
  /** O.13h — this row's receipts, METADATA ONLY. The bytes live in their own
   *  table and are fetched one at a time by `/api/attachments/<id>`, so rendering
   *  this page never loads a file. */
  attachments: AttachmentListItem[];
  /** #378 — Fixed/Discretionary selector; false on the shared demo. */
  canEditSpendClass?: boolean;
}) {
  const { row } = detail;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [splitOpen, setSplitOpen] = useState(false);
  const [firstPart, setFirstPart] = useState('');
  // The one action menu (O.15) — single-row page, so plain local state is fine.
  const [menuOpen, setMenuOpen] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const reimb = reimbursementState(row.reimbursement);

  const flatCategories = categoryGroups.flatMap((g) => g.categories);
  const pv = provenanceBadgeView(row.provenance);
  // ONE availability computation for this page: the action menu and the Status
  // field below both read it. Two calls would be two surfaces one inch apart
  // able to disagree about whether the reader may mark this row.
  const actions = txnActionAvailability({
    amountCents: row.amountCents,
    isTransfer: row.isTransfer,
    isSplitParent: detail.isSplitParent,
    splitParentId: detail.splitParentId,
    taxClass: row.taxClass,
    excludeFromTotals: row.excludeFromTotals,
    reimbursement: row.reimbursement,
    status: row.status,
    descriptorOrigin: row.descriptorOrigin,
  });
  const statusAction = actions.find((a) => a.kind === 'status')!;
  /**
   * O.16 — this page is a WAYPOINT, not only a destination: from here the reader
   * can go on to `/rules`, and losing his place at the second hop is the same
   * defect as losing it at the first. Re-encoded from the already-validated
   * `returnTo.href` rather than from raw `window.location`, so nothing that
   * failed the decode can be laundered back into a link.
   */
  const carriedQuery = returnTo ? (returnTo.href.split('?')[1] ?? '') : '';
  // The effect copy answers "what does pending DO to my figures" — shown while the
  // row IS pending (the state the reader is in) and while the live action WOULD
  // make it pending (what he is about to do), so it is never only after the fact.
  //
  // OUTFLOWS ONLY (critic A, P1): the cash clause is true of money going out and
  // false of money coming in, because cash-needed sums pending SIGNED — a pending
  // deposit reads as cash that has already arrived. The reader can no longer mark
  // an inflow pending, but a provider can, so this gate is what keeps us from
  // printing an outflow's sentence over a bank's pending deposit.
  const showsPendingEffect =
    row.amountCents < 0 && (row.status === 'PENDING' || statusAction.nextStatus === 'PENDING');
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
      window.location.assign(afterWriteHref());
    } catch (e) {
      if (e instanceof ActionDeadline) {
        // The write may well have committed. Reload to show whatever is true now,
        // and say so — a reload identical to a successful one tells the reader
        // nothing. The flag rides in the URL rather than in state restored by an
        // effect: `docs/lessons/mutation-form-recipe.md` records that a
        // set-state-in-effect resync was a smell that became the bug two
        // increments later, and a server-rendered banner needs no such rehydration.
        window.location.assign(afterWriteHref(UNCONFIRMED_PARAM));
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

  /**
   * Uploading a file, deliberately WITHOUT `withDeadline` — the one mutation on
   * this page that does not use it.
   *
   * That deadline exists for a specific failure: a server action's confirmation
   * stream being severed under load (#164/#166), where waiting longer gains
   * nothing because the write already committed. A `fetch` to a route handler has
   * no such stream; it resolves or rejects on its own. Applying the 8s deadline
   * here would abandon the await on a perfectly healthy 5 MB upload over a phone
   * connection and tell the reader we could not confirm a file that was still
   * being sent — a false alarm on the commonest case this feature has.
   */
  async function runUpload(form: HTMLFormElement) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const body = new FormData(form);
    body.set('transactionId', row.id);
    try {
      const response = await fetch('/api/attachments', { method: 'POST', body });
      // A signed-out upload is a LIKELY path, not an edge case: sessions idle out
      // after 30 minutes (O.4), and a detail page left open across lunch is exactly
      // where someone comes back and attaches a receipt. The middleware answers
      // `{"error":"Unauthorized"}` for any /api route, and this form shows the
      // server's message verbatim — so without this branch the reader is told
      // "Unauthorized" instead of what to do about it.
      if (response.status === 401) {
        throw new RefusalError(
          'You have been signed out — nothing was saved. Sign in again, then attach the file.',
        );
      }
      const result: unknown = await response.json().catch(() => null);
      const ok =
        typeof result === 'object' && result !== null && (result as { ok?: unknown }).ok === true;
      if (!ok) {
        const message = (result as { error?: unknown } | null)?.error;
        // The route writes every refusal for the reader, so it is shown verbatim —
        // the size cap, the type list and the demo fence all explain themselves.
        throw new RefusalError(
          typeof message === 'string' && message.length > 0
            ? message
            : 'That file did not upload — nothing was saved.',
        );
      }
      window.location.assign(afterWriteHref());
    } catch (e) {
      setError(
        e instanceof RefusalError
          ? e.message
          : 'That file did not upload — nothing was saved. Check your connection and try again.',
      );
      setBusy(false);
      requestAnimationFrame(() => errorRef.current?.scrollIntoView({ block: 'center' }));
    }
  }

  const firstCents = parseDollarInput(firstPart);
  const splitValid = firstCents !== null && firstCents > 0 && firstCents < total;

  useEffect(() => {
    if (!menuOpen) return;
    function onDocMouseDown(e: MouseEvent) {
      if (busy) return; // never dismiss mid-write — the reload confirms it
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [menuOpen, busy]);

  /** Wrap a flag write so its returned refusal renders verbatim (the
   *  `setTransactionTax` pattern — these actions REPORT, they don't throw). */
  function runFlag(fn: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setMenuOpen(false);
    void run(async () => {
      const res = await fn();
      if (!res.ok) throw new RefusalError(res.error);
    });
  }

  /**
   * A recurring verdict (O.13f). Same REPORTED-refusal handling as `runFlag`,
   * plus the one thing this action can half-do: the row is saved but the
   * projection rebuild that carries it to /calendar, /forecast and the spending
   * plan may not have run. That is not a failure — the instruction is stored and
   * the next sync applies it — so it reloads with a flag instead of an error, and
   * the page says which screens have not caught up yet.
   */
  function runVerdict(
    fn: () => Promise<{ ok: true; projectionsRefreshed: boolean } | { ok: false; error: string }>,
  ) {
    setMenuOpen(false);
    if (busy) return;
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        const res = await withDeadline(fn(), FORM_ACTION_DEADLINE_MS);
        if (!res.ok) throw new RefusalError(res.error);
        window.location.assign(
          afterWriteHref(res.projectionsRefreshed ? undefined : PROJECTIONS_STALE_PARAM),
        );
      } catch (e) {
        if (e instanceof ActionDeadline) {
          window.location.assign(afterWriteHref(UNCONFIRMED_PARAM));
          return;
        }
        setError(
          e instanceof RefusalError
            ? e.message
            : 'That did not go through. Reload the page to see the latest, then try again.',
        );
        setBusy(false);
        requestAnimationFrame(() => errorRef.current?.scrollIntoView({ block: 'center' }));
      }
    })();
  }

  /** Bring one of this page's own editors to the reader (the menu's "one
   *  place for every verb" promise — here the verbs live on this page). */
  function focusEditor(selector: string) {
    setMenuOpen(false);
    const el = document.querySelector<HTMLElement>(selector);
    el?.scrollIntoView({ block: 'center' });
    el?.focus();
  }

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
          {row.excludeFromTotals && (
            <Badge
              variant="outline"
              data-testid="detail-excluded-badge"
              className="border-amber-500/60 text-[10px] text-amber-700 dark:text-amber-300"
            >
              Excluded from totals
            </Badge>
          )}
          {reimb === 'awaiting' && (
            <Badge variant="outline" data-testid="detail-reimb-badge" className="text-[10px]">
              Awaiting reimbursement
            </Badge>
          )}
          {reimb === 'received' && (
            <Badge variant="outline" data-testid="detail-reimb-badge" className="text-[10px]">
              Reimbursed
            </Badge>
          )}
          {/* O.15 — the same action menu every register row carries, so this
              page and the register never disagree about what a row can do. */}
          <div ref={menuRef} className="relative ml-auto">
            <button
              type="button"
              data-testid="txn-action-trigger"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label={`All actions for this ${row.merchantName} transaction`}
              className="tap-target inline-flex items-center justify-center rounded border px-1.5 py-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={() => setMenuOpen((v) => !v)}
            >
              <MoreHorizontal className="size-4" aria-hidden />
            </button>
            {menuOpen && (
              <div
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setMenuOpen(false);
                    menuRef.current
                      ?.querySelector<HTMLButtonElement>('[data-testid="txn-action-trigger"]')
                      ?.focus();
                  }
                }}
                className="absolute right-0 z-50 mt-1 max-h-80 w-64 overflow-auto rounded-lg border bg-card text-foreground shadow-lg ring-1 ring-foreground/10"
              >
                <TxnActionMenuItems
                  actions={actions}
                  excluded={row.excludeFromTotals}
                  busy={busy}
                  handlers={{
                    onCategory: () => focusEditor('[data-testid="detail-category-select"]'),
                    onNoteTax: () => focusEditor('[data-testid="detail-note"]'),
                    onSplit: () => {
                      setMenuOpen(false);
                      setSplitOpen(true);
                      requestAnimationFrame(() =>
                        document
                          .querySelector('[data-testid="detail-split"]')
                          ?.scrollIntoView({ block: 'center' }),
                      );
                    },
                    onReimbursement: (state) =>
                      runFlag(() => setReimbursement({ transactionId: row.id, state })),
                    onExclude: (exclude) =>
                      runFlag(() => setExcludeFromTotals({ transactionId: row.id, exclude })),
                    onStatus: (status) =>
                      runFlag(() => setTransactionStatus({ transactionId: row.id, status })),
                    onRecurring: () => focusEditor('[data-testid="detail-recurring"]'),
                    ruleHref: withRegisterReturn(
                      `/rules?from=${encodeURIComponent(row.id)}`,
                      carriedQuery,
                    ),
                    renameHref: withRegisterReturn(
                      `/rules?from=${encodeURIComponent(row.id)}#kw-rename`,
                      carriedQuery,
                    ),
                  }}
                />
              </div>
            )}
          </div>
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
        {/* O.13g / Simplifi parity row 13. The value first, then either the
            control or the sentence saying why there isn't one — the same
            disabled-with-reason rule the action menu follows, because a status
            that silently cannot be edited is indistinguishable from one nobody
            built. */}
        <Field label="Status">
          <span className="flex flex-wrap items-center gap-2">
            <span data-testid="detail-status-value">
              {row.status === 'PENDING' ? 'Pending' : 'Cleared'}
            </span>
            {statusAction.enabled ? (
              <button
                type="button"
                data-testid="detail-status-toggle"
                disabled={busy}
                className="tap-target rounded border px-2 py-0.5 text-xs hover:bg-accent disabled:opacity-50"
                onClick={() =>
                  runFlag(() =>
                    setTransactionStatus({
                      transactionId: row.id,
                      status: statusAction.nextStatus ?? 'POSTED',
                    }),
                  )
                }
              >
                {statusAction.label}
              </button>
            ) : (
              <span data-testid="detail-status-reason" className="text-xs text-muted-foreground">
                {statusAction.reason}
              </span>
            )}
          </span>
        </Field>
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

      {/* L.29 — a surface that starts hiding money says so, and says WHICH money.
          Rendered from the engine's exported sentences so the page, the menu and
          any test share one author. */}
      {showsPendingEffect && (
        <p data-testid="detail-status-effect" className="mt-2 text-xs text-muted-foreground">
          {STATUS_PENDING_EFFECT}
          {row.taxClass !== null && (
            <>
              {' '}
              <span data-testid="detail-status-tax-caution" className="text-amber-700 dark:text-amber-300">
                {STATUS_PENDING_TAX_CAUTION}
              </span>
            </>
          )}
        </p>
      )}

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

      {/* #397 — Fixed / Discretionary for Plan, per transaction. */}
      <div
        className="flex flex-wrap items-center gap-2 rounded-md border p-3"
        data-testid="detail-spend-class"
      >
        <span className="text-sm font-medium">For your Plan</span>
        <SpendClassSelect
          transactionId={row.id}
          spendClass={row.spendClass}
          canEdit={canEditSpendClass}
          merchantName={row.merchantName}
        />
        <p className="basis-full text-xs text-muted-foreground">
          We guess recurring bills as Fixed and everything else from its category. Change the
          selector if the guess is wrong — it applies to this transaction only.
        </p>
      </div>

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

      {/* RECEIPTS & DOCUMENTS — O.13h, the last Simplifi-parity field with no
          column at all.

          Placed beside the note on purpose: both answer "what was this?", and the
          note exists partly because there was nowhere to put the receipt.

          No restriction on a split container, unlike the tax tag above. That
          withholding exists because the tax EXPORT drops a parent row, so a tag
          there would reach no report — an attachment is summed by nothing and
          read by nobody but the reader, and a split purchase has exactly one
          real-world receipt, which belongs on the charge. */}
      <div className="space-y-2 rounded-md border p-3" data-testid="detail-attachments">
        <div className="text-sm font-medium">Receipts &amp; documents</div>

        {attachments.length === 0 ? (
          <p className="text-xs text-muted-foreground" data-testid="detail-attachments-empty">
            Nothing attached to this transaction yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {attachments.map((a) => (
              <li key={a.id} className="flex items-center gap-2" data-testid="detail-attachment-row">
                {isRenderableInline(a.mimeType) ? (
                  // A plain <img>, not next/image: this is a private, authenticated,
                  // per-user route, not an asset the optimizer can fetch or cache.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/attachments/${a.id}`}
                    alt={a.filename}
                    className="h-12 w-12 shrink-0 rounded border object-cover"
                    data-testid="detail-attachment-preview"
                  />
                ) : (
                  // No preview is offered for a type no browser paints — a broken
                  // image frame would read as a corrupted upload.
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded border text-muted-foreground">
                    <FileText className="h-5 w-5" aria-hidden="true" />
                  </span>
                )}
                {/* min-w-0 at every level down to the truncating text: without it a
                    long filename pushes the Remove button off the right edge on a
                    phone (the M.1 iOS Safari flexbox lesson). */}
                <div className="min-w-0 flex-1">
                  <a
                    href={`/api/attachments/${a.id}`}
                    className="block truncate text-sm underline"
                    data-testid="detail-attachment-link"
                  >
                    {a.filename}
                  </a>
                  <p className="truncate text-xs text-muted-foreground">
                    {attachmentTypeLabel(a.mimeType)} · {formatAttachmentSize(a.byteSize)}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  className="shrink-0"
                  aria-label={`Remove ${a.filename}`}
                  data-testid="detail-attachment-delete"
                  onClick={() =>
                    void run(async () => {
                      const res = await deleteTransactionAttachment({ attachmentId: a.id });
                      if (!res.ok) throw new RefusalError(res.error);
                    })
                  }
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}

        {attachments.length >= MAX_ATTACHMENTS_PER_TRANSACTION ? (
          <p className="text-xs text-muted-foreground" data-testid="detail-attachment-full">
            This transaction is holding {MAX_ATTACHMENTS_PER_TRANSACTION} files, which is the limit.
            Remove one to add another.
          </p>
        ) : (
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void runUpload(e.currentTarget);
            }}
          >
            <input
              type="file"
              name="file"
              required
              accept={attachmentAcceptAttribute()}
              className="min-w-0 flex-1 text-xs"
              aria-label="Choose a receipt or document"
              data-testid="detail-attachment-input"
            />
            <Button type="submit" size="sm" disabled={busy} data-testid="detail-attachment-save">
              Attach
            </Button>
          </form>
        )}

        {/* The basis, stated where the control is (L.29). The visibility sentence is
            a real guarantee and not a nicety: shared-account access shows a partner
            this row's amount and merchant, and never these files. */}
        <p className="text-xs text-muted-foreground">
          {ATTACHMENT_TYPES.map((t) => t.label).join(', ')} — up to{' '}
          {formatAttachmentSize(MAX_ATTACHMENT_BYTES)} each,{' '}
          {MAX_ATTACHMENTS_PER_TRANSACTION} per transaction. Files are stored with your data and deleted
          with it — including if your bank withdraws this transaction. Only you can open them, even
          on an account you share with a partner.
        </p>
      </div>

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

      {/* REIMBURSEMENT (O.15) — shown once the reader is tracking this row.
          The untracked state's door is the action menu above, like the register. */}
      {reimb !== null && (
        <div className="space-y-2 rounded-md border p-3" data-testid="detail-reimbursement">
          <div className="text-sm font-medium">Reimbursement</div>
          {reimb === 'awaiting' ? (
            <>
              <p className="text-xs text-muted-foreground">
                You marked this {formatCents(cents(total))} purchase as awaiting reimbursement. It
                still counts as spending until you exclude it — being owed money back doesn&apos;t
                change what left your account.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={busy}
                  data-testid="detail-reimb-received"
                  onClick={() => runFlag(() => setReimbursement({ transactionId: row.id, state: 'received' }))}
                >
                  Reimbursement received
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  data-testid="detail-reimb-clear"
                  onClick={() => runFlag(() => setReimbursement({ transactionId: row.id, state: null }))}
                >
                  Stop tracking
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                Marked as reimbursed.{' '}
                {detail.reimbursementMatch ? (
                  <span data-testid="detail-reimb-match">
                    Likely this deposit: <b>{detail.reimbursementMatch.merchantName}</b> on{' '}
                    {formatISODate(isoDate(detail.reimbursementMatch.date), 'long')} for{' '}
                    {formatCents(cents(detail.reimbursementMatch.amountCents))} — a suggestion from
                    the matching amount, not a stored link.
                  </span>
                ) : (
                  <span data-testid="detail-reimb-no-match">
                    No matching deposit found yet ({formatCents(cents(total))} back within 90 days) —
                    that can simply mean it hasn&apos;t arrived.
                  </span>
                )}
              </p>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                data-testid="detail-reimb-clear"
                onClick={() => runFlag(() => setReimbursement({ transactionId: row.id, state: null }))}
              >
                Stop tracking
              </Button>
            </>
          )}
        </div>
      )}

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
              href={withRegisterReturn(`/rules?from=${encodeURIComponent(row.id)}`, carriedQuery)}
              data-testid="detail-rule-link"
              className="tap-target inline-flex items-center justify-center rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
            >
              Create a rule from this transaction
            </Link>
          </>
        )}
      </div>

      {/* RECURRING — SIMPLIFI_PARITY row 12 (TASKS O.13f). Detection needs three
          charges at a steady rhythm before it will call anything a bill, which is
          the right bar for a guess but leaves the reader unable to state what he
          already knows. This is where he states it, and where he takes it back. */}
      {/* `id` is load-bearing: the register's menu links to `#recurring`, so
          without it that link lands at the top of the page and the reader has to
          hunt for the control he just asked for. */}
      <div id="recurring" className="space-y-2 rounded-md border p-3" data-testid="detail-recurring">
        <div className="text-sm font-medium">Recurring</div>
        {projectionsStale && (
          <p
            role="alert"
            className="rounded-md border border-amber-500/60 p-2 text-xs text-amber-700 dark:text-amber-300"
            data-testid="detail-recurring-stale"
          >
            Saved. Your forecast, calendar and spending plan could not be rebuilt just now — they will
            pick this up on your next sync.
          </p>
        )}
        {recurringVerdict.merchantCanonical === null ? (
          <p className="text-xs text-muted-foreground" data-testid="detail-recurring-no-payee">
            Aimplifi has no payee name for this transaction yet, and a bill is tracked by payee — so
            there is nothing to mark here.
          </p>
        ) : recurringVerdict.blockedReason !== null && recurringVerdict.decision === null ? (
          <>
            {/* The menu already refuses to DECLARE this row; the section must
                refuse in the SAME sentence rather than offering a form three
                inches below a disabled control (reader critic P1-2). The server
                enforces the same rule. */}
            <p className="text-xs text-muted-foreground" data-testid="detail-recurring-blocked">
              {recurringVerdict.blockedReason}
            </p>
            {/* …but the DEMOTION stays: it can only remove a projection, never
                invent one, and an aggregate payee like Venmo is exactly the kind
                the detector can get wrong. Refusing both levers here would take
                away the safe one to protect against the unsafe one. */}
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              data-testid="detail-recurring-not-a-bill"
              className={WRAPPING_BUTTON}
              onClick={() =>
                runVerdict(() =>
                  markMerchantNotABill({ merchantCanonical: recurringVerdict.merchantCanonical! }),
                )
              }
            >
              Not recurring
            </Button>
          </>
        ) : recurringVerdict.decision === 'BILL' ? (
          <>
            {/* States the INSTRUCTION and nothing about what is projected. This
                page cannot see `classifySeriesProjection`, and the earlier draft
                asserted "it is projected … in your forecasts" for every BILL — false
                where the series is on a card, where the charges earned their own
                (different) cadence, or where the only charge is still pending. The
                page that CAN name the effect says so, and links here. */}
            <p className="text-xs text-muted-foreground" data-testid="detail-recurring-state">
              You told Aimplifi that {recurringVerdict.merchantCanonical} repeats{' '}
              {CADENCE_ADVERB[recurringVerdict.cadence ?? ''] ?? 'on a schedule'}.{' '}
              <Link href="/recurring" className="underline underline-offset-2">
                Recurring
              </Link>{' '}
              shows what Aimplifi is doing with that.
            </p>
            <RecurringCadenceForm
              busy={busy}
              initial={recurringVerdict.cadence ?? 'MONTHLY'}
              submitLabel="Change how often"
              onSubmit={(cadence) => runVerdict(() => markTransactionAsBill({ transactionId: row.id, cadence }))}
            />
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              data-testid="detail-recurring-clear"
              className={WRAPPING_BUTTON}
              onClick={() => runVerdict(() => clearRecurringVerdict({ merchantCanonical: recurringVerdict.merchantCanonical! }))}
            >
              Remove this instruction
            </Button>
          </>
        ) : recurringVerdict.decision === 'NOT_BILL' ? (
          <>
            <p className="text-xs text-muted-foreground" data-testid="detail-recurring-state">
              You told Aimplifi that {recurringVerdict.merchantCanonical} does not repeat. It is left
              out of Recurring and out of every forward projection, however its charges line up.
            </p>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              data-testid="detail-recurring-clear"
              className={WRAPPING_BUTTON}
              onClick={() => runVerdict(() => clearRecurringVerdict({ merchantCanonical: recurringVerdict.merchantCanonical! }))}
            >
              Remove this instruction
            </Button>
          </>
        ) : (
          <>
            {/* The amount is deliberately NOT quoted from THIS row: the engine
                anchors a declared series on the payee's most recent charge in the
                same direction, which after a rent rise is not the row he is
                standing on (critic P2-5). It promises the rule, not a figure. */}
            <p className="text-xs text-muted-foreground" data-testid="detail-recurring-state">
              Aimplifi calls a payee recurring after three charges a steady time apart. If you already
              know {recurringVerdict.merchantCanonical} repeats, say so: it will be projected at the
              rhythm you pick, from your most recent charge to that payee.
            </p>
            <RecurringCadenceForm
              busy={busy}
              initial="MONTHLY"
              submitLabel="Mark as recurring"
              onSubmit={(cadence) => runVerdict(() => markTransactionAsBill({ transactionId: row.id, cadence }))}
            />
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              data-testid="detail-recurring-not-a-bill"
              className={WRAPPING_BUTTON}
              onClick={() =>
                runVerdict(() =>
                  markMerchantNotABill({ merchantCanonical: recurringVerdict.merchantCanonical! }),
                )
              }
            >
              Not recurring
            </Button>
          </>
        )}
      </div>

      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        {/*
          O.16 — split, "Recurring…" and the status control all arrive here from
          the register, and this was a bare `/transactions`: following it dropped
          the reader's filter and page, which is the friction the owner reported
          ("I have to click activity again and needs category"). With a view
          carried it names that view and returns to it; with none it is the same
          link it always was.
        */}
        <Link
          href={returnTo?.href ?? '/transactions'}
          data-testid="detail-back-link"
          className="underline underline-offset-2 hover:text-foreground"
        >
          {returnTo ? `Back to ${returnTo.label}` : 'Back to transactions'}
        </Link>
        <Link
          href={merchantRegisterHref(row.merchantName)}
          className="underline underline-offset-2 hover:text-foreground"
          data-testid="detail-merchant-link"
        >
          Every {row.merchantName} transaction
        </Link>
      </div>
    </div>
  );
}
