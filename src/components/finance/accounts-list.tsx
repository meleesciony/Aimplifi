'use client';

/**
 * All-accounts net worth view (DECISIONS #39). Net worth, then assets and
 * liabilities grouped with subtotals — over LINKED accounts (bank, credit,
 * brokerage) AND user-added manual items (home, vehicle, mortgage, …). Linked
 * rows link to their transactions; manual rows are inline-editable (value) and
 * deletable. "Add asset / Add liability" create manual items.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmPrompt, useConfirmArm } from '@/components/ui/confirm-action';
import { ConnectAccountsButton } from '@/components/finance/connect-accounts-button';
import { ConnectSimplefin } from '@/components/finance/connect-simplefin';
import { PlaidConnections } from '@/components/finance/plaid-connections';
import {
  ManualCardStatementForm,
  type ManualStatementFormValues,
} from '@/components/finance/manual-card-statement-form';
import { cents, formatCents } from '@/lib/money';
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';
import { formatISODate, isoDate } from '@/lib/dates';
import { MANUAL_ASSET_TYPES, MANUAL_LIABILITY_TYPES } from '@/lib/engine/networth/manual';
import type { SuspectedDuplicatePair } from '@/lib/engine/account/duplicates';
import { freshnessMessage } from '@/lib/engine/sync/health';
import {
  addManualAccount,
  deleteDisconnectedSyncedAccount,
  deleteManualAccount,
  updateManualAccountValue,
} from '@/server/networth-actions';
import { clearManualCardStatement, setManualCardStatement } from '@/server/card-actions';
import { confirmReconciliation, undoReconciliation } from '@/server/reconciliation-actions';
import { ActionDeadline, withDeadline } from '@/components/triage/action-deadline';
import { FORM_ACTION_DEADLINE_MS } from '@/components/finance/form-deadline';
import { setFlash, takeFlash } from '@/components/finance/flash';
import type { AccountGroup, AccountView } from '@/lib/engine/transactions/query';
import type { AccountsView, ManualCardBilling, ReconciledPairView, ReconciliationCandidateView } from '@/server/transactions';

const TYPE_LABEL: Record<string, string> = {
  CHECKING: 'Checking',
  SAVINGS: 'Savings',
  CREDIT: 'Credit card',
  INVESTMENT: 'Investment',
  LOAN: 'Loan',
  REAL_ESTATE: 'Real estate',
  VEHICLE: 'Vehicle',
  CASH: 'Cash',
  OTHER_ASSET: 'Other asset',
  MORTGAGE: 'Mortgage',
  OTHER_LIABILITY: 'Other debt',
};

function typeLabel(t: string): string {
  return TYPE_LABEL[t] ?? t;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Net worth headline + over-time trend (DECISIONS #40). */
function NetWorthCard({ data }: { data: AccountsView }) {
  const chartData = data.trend.map((p) => ({
    label: `${MONTHS[+p.date.slice(5, 7) - 1]} '${p.date.slice(2, 4)}`,
    fullDate: p.date,
    dollars: p.netWorthCents / 100,
  }));
  const t = data.trend;
  const deltaCents = t.length >= 2 ? t[t.length - 1].netWorthCents - t[t.length - 2].netWorthCents : null;

  return (
    <Card data-testid="accounts-net-worth">
      <CardHeader className="pb-2">
        <CardDescription>Net worth (assets − liabilities)</CardDescription>
        <CardTitle
          className={`text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl ${data.netWorthCents < 0 ? 'text-red-400' : ''}`}
          data-testid="accounts-net-worth-amount"
        >
          {formatCents(data.netWorthCents)}
        </CardTitle>
        {deltaCents !== null && (
          <p
            className={`text-xs ${deltaCents >= 0 ? 'text-emerald-500' : 'text-red-400'}`}
            data-testid="accounts-net-worth-delta"
          >
            {formatCents(cents(deltaCents), { signDisplay: 'always' })} vs last month-end
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {/* flex-wrap so two large figures (e.g. $1.7M assets + $998K liabilities)
            stack instead of forcing the document wider than a phone. */}
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
          <span>Assets {formatCents(data.assets.subtotalCents)}</span>
          <span>Liabilities {formatCents(data.liabilities.subtotalCents)}</span>
        </div>
        <p className="text-xs text-muted-foreground" data-testid="assets-vs-liabilities">
          {COACH_COPY.assetsVsLiabilities()}
        </p>
        {chartData.length >= 2 && (
          <div className="h-36 w-full sm:h-44" data-testid="accounts-net-worth-trend">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                <defs>
                  <linearGradient id="nwacct" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" tickLine={false} axisLine={false} />
                <YAxis hide domain={['dataMin - 5000', 'dataMax + 5000']} />
                <Tooltip
                  formatter={(value) => [formatCents(cents(Math.round((value as number) * 100))), 'Net worth']}
                  labelFormatter={(_, payload) => payload?.[0]?.payload?.fullDate ?? ''}
                  contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
                />
                <Area type="monotone" dataKey="dollars" stroke="#10b981" strokeWidth={2} fill="url(#nwacct)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Zero-account first-run: a $0.00 net-worth headline is meaningless, so welcome
 *  the user and let the connect/add affordances below carry the action.
 *
 *  All-foreign edge (#135 checker): when every account is withheld by the currency guard,
 *  the disclosure banner above this card says those accounts exist and are saved — so
 *  "No accounts yet / Add your first account" would contradict it on the same screen.
 *  That user gets copy that agrees with the banner instead. */
function AccountsEmptyState({ withheldCount }: { withheldCount: number }) {
  if (withheldCount > 0) {
    return (
      <Card data-testid="accounts-empty">
        <CardHeader>
          <CardDescription>No U.S.-dollar accounts yet</CardDescription>
          <CardTitle className="text-xl">Add a U.S.-dollar account</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Your connected accounts are saved, but none is in U.S. dollars, so there are no
            totals to show yet. Connect a U.S.-dollar bank or brokerage below, or add one
            manually, and your net worth will appear here.
          </p>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card data-testid="accounts-empty">
      <CardHeader>
        <CardDescription>No accounts yet</CardDescription>
        <CardTitle className="text-xl">Add your first account</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Connect a bank or brokerage below, or add an account manually — even things a bank feed
          can&apos;t see, like your home or car. Once an account is here you&apos;ll see your net
          worth, and Aimplifi can tell you exactly how much you need to pay every card in full, and
          by when.
        </p>
      </CardContent>
    </Card>
  );
}

export function AccountsList({ data }: { data: AccountsView }) {
  const [adding, setAdding] = useState<null | 'asset' | 'liability'>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [statementCardId, setStatementCardId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  // Deliberately NOT useTransition (#167, the #164/#166 recipe): the pending
  // flag is plain state, the await is deadline-bounded, and success is a FULL
  // reload — every row and total on this page is server-derived, and
  // router.refresh()'s application was a coin-flip at human pacing
  // (scripts/audit-probes/recategorize-mutation.ts witnessed the class 0/2;
  // accounts-mutation.ts shares this wiring).
  const [pending, setPending] = useState(false);
  const isEmpty = data.assets.accounts.length === 0 && data.liabilities.accounts.length === 0;

  // A success message set before the confirming reload (e.g. "Statement saved")
  // rides sessionStorage across it — the reload IS the confirmation, the flash
  // is the caption.
  useEffect(() => {
    const m = takeFlash('accounts');
    // eslint-disable-next-line react-hooks/set-state-in-effect -- post-hydration one-shot sessionStorage read (#167); a lazy useState initializer would hydration-mismatch (server renders no flash)
    if (m) setSuccess(m);
  }, []);

  function refreshAfter(fn: () => Promise<{ ok: boolean; errors?: string[] }>, successMsg?: string) {
    if (pending) return;
    setError(null);
    setSuccess(null);
    setPending(true);
    void (async () => {
      try {
        const res = await withDeadline(fn(), FORM_ACTION_DEADLINE_MS);
        if (!res.ok) {
          setError(res.errors?.join(' ') ?? 'Something went wrong.');
          setPending(false);
          return;
        }
        if (successMsg) setFlash('accounts', successMsg);
        // Reload, not router.refresh() — the re-rendered list can't lie.
        // pending stays true so controls remain disabled until the new page.
        window.location.reload();
      } catch (e) {
        if (e instanceof ActionDeadline) {
          // The write usually COMMITTED and only the confirmation stream was
          // severed — re-sync rather than report a false failure (#164 rule).
          window.location.reload();
          return;
        }
        setError(e instanceof Error ? e.message : 'Something went wrong.');
        setPending(false);
      }
    })();
  }

  // A reconciled predecessor is folded OUT of the asset/liability groups: its balance is $0 and it
  // is disclosed as one logical account in ContinuedAccountsCard, so a confusing "$0.00 ghost" row
  // never appears. Net worth + subtotals are unchanged by this (the row already contributes 0).
  const supersededIds = new Set(data.reconciliations.map((r) => r.predecessor.id));
  const filterGroup = (g: AccountGroup): AccountGroup =>
    supersededIds.size === 0 ? g : { ...g, accounts: g.accounts.filter((a) => !supersededIds.has(a.id)) };
  const assetsShown = filterGroup(data.assets);
  const liabilitiesShown = filterGroup(data.liabilities);

  return (
    <div className="space-y-4">
      {isEmpty ? <AccountsEmptyState withheldCount={data.withheld.count} /> : <NetWorthCard data={data} />}

      {!isEmpty && (
        <div className="flex justify-end">
          <Link
            href="/investments"
            data-testid="investments-link"
            className="text-xs text-muted-foreground hover:text-foreground hover:underline"
          >
            View investments →
          </Link>
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-md border border-red-900/50 bg-red-950/40 px-3 py-2 text-sm text-red-300" data-testid="manual-error">
          {error}
        </p>
      )}

      {success && (
        <p role="status" className="rounded-md border border-emerald-900/50 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300" data-testid="manual-success">
          {success}
        </p>
      )}

      <ReconciliationCandidatesCard
        candidates={data.reconciliationCandidates}
        today={data.today}
        pending={pending}
        onConfirm={(c, cutoverDate) =>
          refreshAfter(
            () =>
              confirmReconciliation({
                predecessorAccountId: c.predecessor.id,
                successorAccountId: c.successor.id,
                cutoverDate,
                matchSignal: c.matchSignal,
                confidence: c.confidence,
              }).then((r) => (r.ok ? { ok: true } : { ok: false, errors: [r.error] })),
            'Accounts combined — the old balance now counts once.',
          )
        }
      />
      <ContinuedAccountsCard
        reconciliations={data.reconciliations}
        pending={pending}
        onUndo={(id) =>
          refreshAfter(
            () => undoReconciliation(id).then((r) => (r.ok ? { ok: true } : { ok: false, errors: [r.error] })),
            'Undone — both accounts count on their own again.',
          )
        }
      />

      <DuplicateAccountsWarning pairs={data.duplicates} />

      <Group
        group={assetsShown}
        title="Assets"
        paymentAccountId={data.paymentAccountId}
        cardBilling={data.cardBilling}
        editingId={editingId}
        statementCardId={statementCardId}
        pending={pending}
        onEdit={setEditingId}
        onSaveValue={(accountId, value) => refreshAfter(() => updateManualAccountValue({ accountId, value }))}
        onDelete={(accountId) => refreshAfter(() => deleteManualAccount(accountId))}
        onDeleteSynced={(accountId) => refreshAfter(() => deleteDisconnectedSyncedAccount(accountId))}
        onCancelEdit={() => setEditingId(null)}
        onEditStatement={(id) => { setStatementCardId(id); setError(null); setSuccess(null); }}
        onSaveStatement={(accountId, values) => refreshAfter(() => setManualCardStatement({ accountId, ...values }), 'Statement saved — this card is now in your “how much & when” answer.')}
        onClearStatement={(accountId) => refreshAfter(() => clearManualCardStatement(accountId), 'Statement cleared.')}
        onCancelStatement={() => setStatementCardId(null)}
      />
      <Group
        group={liabilitiesShown}
        title="Liabilities"
        paymentAccountId={data.paymentAccountId}
        cardBilling={data.cardBilling}
        editingId={editingId}
        statementCardId={statementCardId}
        pending={pending}
        onEdit={setEditingId}
        onSaveValue={(accountId, value) => refreshAfter(() => updateManualAccountValue({ accountId, value }))}
        onDelete={(accountId) => refreshAfter(() => deleteManualAccount(accountId))}
        onDeleteSynced={(accountId) => refreshAfter(() => deleteDisconnectedSyncedAccount(accountId))}
        onCancelEdit={() => setEditingId(null)}
        onEditStatement={(id) => { setStatementCardId(id); setError(null); setSuccess(null); }}
        onSaveStatement={(accountId, values) => refreshAfter(() => setManualCardStatement({ accountId, ...values }), 'Statement saved — this card is now in your “how much & when” answer.')}
        onClearStatement={(accountId) => refreshAfter(() => clearManualCardStatement(accountId), 'Statement cleared.')}
        onCancelStatement={() => setStatementCardId(null)}
      />

      {/* Link real accounts: SimpleFIN (cheaper, no Plaid gatekeeping) or Plaid */}
      <ConnectSimplefin connected={data.simplefin.connected} health={data.simplefin.health} />
      <PlaidConnections items={data.plaid.items} />
      <ConnectAccountsButton />

      {/* Add manual items */}
      <div className="flex gap-2">
        <button
          type="button"
          data-testid="add-asset-btn"
          disabled={pending}
          onClick={() => { setAdding(adding === 'asset' ? null : 'asset'); setError(null); }}
          className="tap-target inline-flex items-center justify-center rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
        >
          + Add asset
        </button>
        <button
          type="button"
          data-testid="add-liability-btn"
          disabled={pending}
          onClick={() => { setAdding(adding === 'liability' ? null : 'liability'); setError(null); }}
          className="tap-target inline-flex items-center justify-center rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
        >
          + Add liability
        </button>
      </div>

      {adding && (
        <AddForm
          kind={adding}
          pending={pending}
          onCancel={() => { setAdding(null); setError(null); }}
          onSubmit={(name, type, value) => refreshAfter(() => addManualAccount({ name, type, value }))}
        />
      )}

      <p className="text-xs text-muted-foreground">
        Add any account — checking, savings, credit, brokerage, loan — plus things a feed can’t see like
        your home or car. Set a balance for net worth, then import a CSV (Transactions → Import) to fill in
        a bank/credit account’s activity. Connecting a bank does all of this automatically.
      </p>
    </div>
  );
}

const PROVIDER_LABEL: Record<string, string> = {
  plaid: 'Plaid',
  simplefin: 'SimpleFIN',
  manual: 'Manual',
  demo: 'Demo',
};

/**
 * Advisory warning for suspected same-account-via-two-providers duplicates (DECISIONS #192).
 * Display-only: the app has no cross-provider dedup, so a duplicate double-counts until the
 * user disconnects one side (via the existing SimpleFIN disconnect / Plaid / manual-delete
 * flows). Never auto-deletes — which side to keep is the user's call.
 */
function DuplicateAccountsWarning({ pairs }: { pairs: SuspectedDuplicatePair[] }) {
  if (pairs.length === 0) return null;
  const label = (p: { provider: string; mask: string | null }) =>
    `${PROVIDER_LABEL[p.provider] ?? p.provider}${p.mask ? ` ····${p.mask}` : ''}`;
  return (
    <Card
      data-testid="duplicate-accounts-warning"
      className="border-amber-900/50 bg-amber-950/30"
      role="alert"
    >
      <CardHeader className="pb-2">
        <CardDescription className="text-amber-300">Possible duplicate accounts</CardDescription>
        <CardTitle className="text-base">One account may be connected twice</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          These look like the same real account linked through two providers. Each connection is
          counted separately, so a duplicate <strong>doubles</strong> that balance in your net worth
          and its spending. Keep one and disconnect or delete the other.
        </p>
        <ul className="space-y-2" role="list">
          {pairs.map((p) => (
            <li
              key={`${p.a.id}-${p.b.id}`}
              data-testid="duplicate-pair"
              className="rounded-md border border-amber-900/40 px-3 py-2"
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-medium">{p.a.name}</span>
                <span className="text-xs text-muted-foreground">({label(p.a)})</span>
                <span aria-hidden className="text-muted-foreground">
                  ↔
                </span>
                <span className="font-medium">{p.b.name}</span>
                <span className="text-xs text-muted-foreground">({label(p.b)})</span>
                <span
                  className={`ml-auto rounded px-1.5 py-0.5 text-xs ${p.confidence === 'high' ? 'bg-amber-900/60 text-amber-100' : 'bg-amber-900/30 text-amber-200'}`}
                >
                  {p.confidence === 'high' ? 'likely' : 'possible'}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{p.reasons.join(' · ')}</p>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function providerMask(p: { provider: string; mask: string | null }): string {
  return `${PROVIDER_LABEL[p.provider] ?? p.provider}${p.mask ? ` ····${p.mask}` : ''}`;
}

/**
 * "Continue this account?" — cross-provider reconciliation proposals (Wave 4.6 slice 5, R3).
 * Shown only when exactly one side of a suspected duplicate is live (successor) and the other is
 * disconnected (predecessor). Confirming links them so the stale balance stops counting twice;
 * every projection states its assumption inline (cutover window + what it supersedes), per the
 * coaching guardrails. This is the actionable version of DuplicateAccountsWarning, which is
 * suppressed server-side for any pair that has a candidate.
 */
function ReconciliationCandidatesCard({
  candidates,
  today,
  pending,
  onConfirm,
}: {
  candidates: ReconciliationCandidateView[];
  today: string;
  pending: boolean;
  onConfirm: (candidate: ReconciliationCandidateView, cutoverDate: string) => void;
}) {
  if (candidates.length === 0) return null;
  return (
    <Card data-testid="reconcile-candidates" className="border-sky-900/50 bg-sky-950/30">
      <CardHeader className="pb-2">
        <CardDescription className="text-sky-300">Same account, new connection?</CardDescription>
        <CardTitle className="text-base">Continue an account you already had</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          One of your live connections looks like an account you linked before. Continue it so its
          history stays and its balance stops counting twice — we keep both records and only ever
          count the live one.
        </p>
        <ul className="space-y-3" role="list">
          {candidates.map((c) => (
            <CandidateRow
              key={`${c.predecessor.id}-${c.successor.id}`}
              candidate={c}
              today={today}
              pending={pending}
              onConfirm={onConfirm}
            />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function CandidateRow({
  candidate,
  today,
  pending,
  onConfirm,
}: {
  candidate: ReconciliationCandidateView;
  today: string;
  pending: boolean;
  onConfirm: (candidate: ReconciliationCandidateView, cutoverDate: string) => void;
}) {
  // Default cutover = the predecessor's LAST transaction date (spec §6) — `today` maximized
  // the boundary-straddle window and made the disclosure wrong for the default pick (slice-6
  // critics A-F10/C-12). Span start is the editable minimum (C-13): the server refuses an
  // earlier date, so the input shouldn't offer one.
  const span = candidate.predecessorTxnSpan;
  const [cutover, setCutover] = useState(span?.last ?? today);
  const { predecessor, successor } = candidate;
  // What the engine will actually claim for the predecessor: [first, min(cutover, last)].
  // ISO YYYY-MM-DD strings compare correctly as strings.
  const claimEnd = span !== null ? (cutover < span.last ? cutover : span.last) : null;
  const cedesTail = span !== null && cutover < span.last;
  return (
    <li data-testid="reconcile-candidate" className="rounded-md border border-sky-900/40 px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-medium">{predecessor.name}</span>
        <span className="text-xs text-muted-foreground">({providerMask(predecessor)})</span>
        <span aria-hidden className="text-muted-foreground">
          →
        </span>
        <span className="font-medium">{successor.name}</span>
        <span className="text-xs text-muted-foreground">({providerMask(successor)})</span>
        <span
          className={`ml-auto rounded px-1.5 py-0.5 text-xs ${candidate.confidence === 'high' ? 'bg-sky-900/60 text-sky-100' : 'bg-sky-900/30 text-sky-200'}`}
        >
          {candidate.confidence === 'high' ? 'likely' : 'possible'}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{candidate.reasons.join(' · ')}</p>
      <div className="mt-2 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          History cutover date
          <input
            type="date"
            data-testid="reconcile-cutover"
            value={cutover}
            min={span?.first}
            max={today}
            disabled={pending}
            onChange={(e) => setCutover(e.target.value)}
            className="tap-target rounded-md border bg-background px-2 py-1 text-sm text-foreground disabled:opacity-50"
          />
        </label>
        <button
          type="button"
          data-testid="reconcile-confirm"
          disabled={pending}
          onClick={() => onConfirm(candidate, cutover)}
          className="tap-target inline-flex items-center justify-center rounded-md border border-sky-700 bg-sky-900/40 px-3 py-1.5 text-sm text-sky-100 hover:bg-sky-900/70 disabled:opacity-50"
        >
          Combine accounts
        </button>
      </div>
      {/* Honest span disclosure (slice-6 critics C-6/A-F5): state the REAL claim window
          [first txn, min(cutover, last txn)] — the successor keeps everything outside it,
          including OLDER re-imported history — plus the boundary-skew caveat the spec's §6
          "accept-and-disclose" choice requires. Copy derived from the same values the
          engine uses, never a paraphrase of the default. */}
      {span !== null && claimEnd !== null ? (
        <p className="mt-2 text-xs text-muted-foreground" data-testid="reconcile-span-disclosure">
          We’ll keep <strong>{predecessor.name}</strong>’s records from {span.first} through {claimEnd} —
          inside that window they replace anything <strong>{successor.name}</strong> re-imported.{' '}
          <strong>{successor.name}</strong> counts everywhere else, including older history it brought
          back.{cedesTail ? (
            <>
              {' '}
              <strong>{predecessor.name}</strong>’s records after {claimEnd} stop counting —{' '}
              <strong>{successor.name}</strong>’s version of those days counts instead.
            </>
          ) : null}{' '}
          If the two banks dated the same purchase differently right at the boundary, it can briefly
          appear twice. You can undo this anytime.
        </p>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground" data-testid="reconcile-span-disclosure">
          <strong>{predecessor.name}</strong> has no recorded transactions, so its balance simply stops
          counting and <strong>{successor.name}</strong> counts everything. You can undo this anytime.
        </p>
      )}
    </li>
  );
}

/**
 * "Combined accounts" — active reconciliations, each rendered as ONE logical account (R6/R9). The
 * predecessor's own row is folded out of the asset/liability groups by the parent; this card
 * discloses the merge and offers Undo (reversible — both sides count on their own again).
 */
function ContinuedAccountsCard({
  reconciliations,
  pending,
  onUndo,
}: {
  reconciliations: ReconciledPairView[];
  pending: boolean;
  onUndo: (id: string) => void;
}) {
  if (reconciliations.length === 0) return null;
  return (
    <Card data-testid="reconcile-combined" className="border-emerald-900/40 bg-emerald-950/20">
      <CardHeader className="pb-2">
        <CardDescription className="text-emerald-300">Combined accounts</CardDescription>
        <CardTitle className="text-base">Counted once, on the live connection</CardTitle>
      </CardHeader>
      <CardContent className="text-sm">
        <ul className="space-y-2" role="list">
          {reconciliations.map((r) => (
            <li
              key={r.id}
              data-testid="reconcile-combined-pair"
              className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-emerald-900/40 px-3 py-2"
            >
              <span className="font-medium">{r.successor.name}</span>
              <span className="text-xs text-muted-foreground">({providerMask(r.successor)})</span>
              <span className="text-xs text-muted-foreground">
                continued from your old {providerMask(r.predecessor)} account — history kept through{' '}
                {r.cutoverDate}, balance counted here.
              </span>
              <button
                type="button"
                data-testid="reconcile-undo"
                disabled={pending}
                onClick={() => onUndo(r.id)}
                className="tap-target ml-auto inline-flex items-center justify-center rounded-md border px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
              >
                Undo
              </button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function Group({
  group,
  title,
  paymentAccountId,
  cardBilling,
  editingId,
  statementCardId,
  pending,
  onEdit,
  onSaveValue,
  onDelete,
  onDeleteSynced,
  onCancelEdit,
  onEditStatement,
  onSaveStatement,
  onClearStatement,
  onCancelStatement,
}: {
  group: AccountGroup;
  title: string;
  paymentAccountId: string | null;
  cardBilling: Record<string, ManualCardBilling>;
  editingId: string | null;
  statementCardId: string | null;
  pending: boolean;
  onEdit: (id: string) => void;
  onSaveValue: (id: string, value: string) => void;
  onDelete: (id: string) => void;
  onDeleteSynced: (id: string) => void;
  onCancelEdit: () => void;
  onEditStatement: (id: string) => void;
  onSaveStatement: (id: string, values: ManualStatementFormValues) => void;
  onClearStatement: (id: string) => void;
  onCancelStatement: () => void;
}) {
  const isLiability = group.kind === 'liability';
  if (group.accounts.length === 0) return null;
  return (
    <Card data-testid={`account-group-${group.kind}`}>
      <CardHeader className="flex-row items-center justify-between pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        <span className={`tabular-nums text-sm ${isLiability ? 'text-red-400' : ''}`}>
          {isLiability ? '−' : ''}
          {formatCents(group.subtotalCents)}
        </span>
      </CardHeader>
      <CardContent className="px-0 pb-2">
        <ul className="divide-y">
          {group.accounts.map((a) =>
            a.manual ? (
              <ManualRow
                key={a.id}
                account={a}
                isLiability={isLiability}
                billing={cardBilling[a.id]}
                editing={editingId === a.id}
                statementOpen={statementCardId === a.id}
                pending={pending}
                onEdit={() => onEdit(a.id)}
                onSave={(value) => onSaveValue(a.id, value)}
                onDelete={() => onDelete(a.id)}
                onCancel={onCancelEdit}
                onEditStatement={() => onEditStatement(a.id)}
                onSaveStatement={(values) => onSaveStatement(a.id, values)}
                onClearStatement={() => onClearStatement(a.id)}
                onCancelStatement={onCancelStatement}
              />
            ) : (
              <LinkedRow
                key={a.id}
                account={a}
                isLiability={isLiability}
                isPaymentAccount={a.id === paymentAccountId}
                // Deletable ONLY once its bank connection is disconnected — while
                // connected, the next sync would re-create the row. Computed
                // SERVER-side with the same predicate the delete action enforces
                // (#253/#256, account-delete.ts syncedDeleteBlockReason).
                deletable={a.deletable ?? false}
                pending={pending}
                onDelete={() => onDeleteSynced(a.id)}
              />
            ),
          )}
        </ul>
      </CardContent>
    </Card>
  );
}

function LinkedRow({
  account,
  isLiability,
  isPaymentAccount,
  deletable,
  pending,
  onDelete,
}: {
  account: AccountView;
  isLiability: boolean;
  isPaymentAccount: boolean;
  deletable: boolean;
  pending: boolean;
  onDelete: () => void;
}) {
  // #253: two-tap confirm, same pattern as ManualRow. The cluster is a SIBLING of
  // the row Link (never nested inside it — interactive-in-interactive is invalid
  // and this file already avoids it for ManualRow).
  const confirm = useConfirmArm();
  // #159: a linked brokerage (INVESTMENT) has holdings / performance / a retirement
  // projection on /investments — a far more useful destination than its transaction
  // ledger — so its row navigates there. Every other linked account still opens its
  // transactions. (A manual INVESTMENT account is just a typed balance with no
  // holdings and carries inline edit/delete controls, so it renders as a ManualRow
  // and is intentionally not linked here — that also avoids nesting buttons in a link.)
  const isInvestment = account.type === 'INVESTMENT';
  // #160: carry the account id so /investments narrows to THIS account's holdings for a
  // multi-brokerage user (inert with one account — the demo lands on the full portfolio).
  const href = isInvestment ? `/investments?account=${account.id}` : `/transactions?account=${account.id}`;
  return (
    // min-w-0 down the whole flex chain so a long synced name TRUNCATES instead
    // of pushing the balance + Delete off the right edge. Chromium shrinks a
    // min-width:auto flex item on its own, but real iOS Safari does NOT — the
    // reported /accounts overflow (owner screenshots 2026-07-21, e.g. "Charles
    // Schwab US Community Property …383"). The number is shrink-0 and never clips
    // (a half-visible figure is a wrong figure); the NAME yields first.
    <li className="flex min-w-0 items-center">
      <Link
        href={href}
        data-testid="account-row"
        className="flex min-w-0 flex-1 items-center justify-between gap-3 px-3 py-2 hover:bg-accent"
      >
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate font-medium">{account.name}</span>
            {isPaymentAccount && (
              <span className="shrink-0 rounded bg-accent px-1.5 py-0.5 text-[10px] text-muted-foreground">Pays cards</span>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            {typeLabel(account.type)}
            {account.mask ? ` ····${account.mask}` : ''}
            {isInvestment && <span data-testid="account-row-investment-cue"> · View holdings →</span>}
          </div>
          {account.freshness && (
            <div
              data-testid="account-freshness"
              className={`text-xs ${account.freshness.level === 'very_stale' ? 'text-amber-500' : 'text-muted-foreground'}`}
            >
              {freshnessMessage(account.freshness)}
            </div>
          )}
        </div>
        <div className={`shrink-0 tabular-nums ${isLiability ? 'text-red-400' : 'text-foreground'}`}>
          {isLiability ? '−' : ''}
          {formatCents(cents(account.currentBalanceCents))}
        </div>
      </Link>
      {deletable &&
        (!confirm.isArmed('delete') ? (
          <button
            type="button"
            data-testid="synced-delete"
            aria-label={`Delete ${account.name}`}
            disabled={pending}
            onClick={() => confirm.arm('delete')}
            className="tap-target mr-3 inline-flex shrink-0 items-center justify-center rounded px-1.5 py-0.5 text-xs text-red-400 hover:bg-accent disabled:opacity-50"
          >
            Delete
          </button>
        ) : (
          <ConfirmPrompt
            className="mr-3 shrink-0"
            rowTestId="synced-delete-confirm-row"
            prompt="Delete, with its history?"
            confirmTestId="synced-delete-confirm"
            confirmAriaLabel={`Yes, delete ${account.name} and its history`}
            pending={pending}
            onConfirm={onDelete}
            onCancel={confirm.disarm}
          />
        ))}
    </li>
  );
}

function ManualRow({
  account,
  isLiability,
  billing,
  editing,
  statementOpen,
  pending,
  onEdit,
  onSave,
  onDelete,
  onCancel,
  onEditStatement,
  onSaveStatement,
  onClearStatement,
  onCancelStatement,
}: {
  account: AccountView;
  isLiability: boolean;
  billing?: ManualCardBilling;
  editing: boolean;
  statementOpen: boolean;
  pending: boolean;
  onEdit: () => void;
  onSave: (value: string) => void;
  onDelete: () => void;
  onCancel: () => void;
  onEditStatement: () => void;
  onSaveStatement: (values: ManualStatementFormValues) => void;
  onClearStatement: () => void;
  onCancelStatement: () => void;
}) {
  const [value, setValue] = useState((account.currentBalanceCents / 100).toFixed(2));
  const confirm = useConfirmArm();
  const isCard = account.type === 'CREDIT' && billing !== undefined;
  return (
    <li className="px-3 py-2" data-testid="manual-account-row">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-medium">{account.name}</div>
          <div className="text-xs text-muted-foreground">{typeLabel(account.type)} · manual</div>
        </div>
        {!editing ? (
          <div className="flex shrink-0 items-center gap-2">
            <span className={`shrink-0 tabular-nums ${isLiability ? 'text-red-400' : 'text-foreground'}`}>
              {isLiability ? '−' : ''}
              {formatCents(cents(account.currentBalanceCents))}
            </span>
            <button type="button" data-testid="manual-edit" disabled={pending} onClick={onEdit} className="tap-target inline-flex items-center justify-center rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent disabled:opacity-50">Edit</button>
            {!confirm.isArmed('delete') ? (
              <button type="button" data-testid="manual-delete" disabled={pending} onClick={() => confirm.arm('delete')} className="tap-target inline-flex items-center justify-center rounded px-1.5 py-0.5 text-xs text-red-400 hover:bg-accent disabled:opacity-50">Delete</button>
            ) : (
              <ConfirmPrompt
                rowTestId="manual-delete-confirm-row"
                prompt="Delete?"
                confirmTestId="manual-delete-confirm"
                pending={pending}
                onConfirm={onDelete}
                onCancel={confirm.disarm}
              />
            )}
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground">$</span>
            <input
              type="text"
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              data-testid="manual-value-input"
              className="w-24 rounded-md border bg-background px-2 py-1 text-sm"
            />
            <button type="button" data-testid="manual-value-save" disabled={pending} onClick={() => onSave(value)} className="tap-target inline-flex items-center justify-center rounded bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/80 disabled:opacity-50">Save</button>
            <button type="button" disabled={pending} onClick={onCancel} className="tap-target inline-flex items-center justify-center rounded px-1.5 py-1 text-xs text-muted-foreground hover:bg-accent disabled:opacity-50">Cancel</button>
          </div>
        )}
      </div>

      {isCard && (
        <div className="mt-1.5" data-testid="manual-card-billing">
          {billing!.hasStatement ? (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span data-testid="card-statement-summary">
                Statement {formatCents(cents(billing!.statementBalanceCents ?? 0))} · due{' '}
                {billing!.dueDate ? formatISODate(isoDate(billing!.dueDate)) : '—'} · min{' '}
                {formatCents(cents(billing!.minimumPaymentCents ?? 0))}
              </span>
              <button type="button" data-testid="card-statement-edit" disabled={pending} onClick={onEditStatement} className="tap-target inline-flex items-center justify-center rounded px-1.5 py-0.5 text-muted-foreground hover:bg-accent disabled:opacity-50">Edit</button>
              <button type="button" data-testid="card-statement-clear" disabled={pending} onClick={onClearStatement} className="tap-target inline-flex items-center justify-center rounded px-1.5 py-0.5 text-red-400 hover:bg-accent disabled:opacity-50">Clear</button>
            </div>
          ) : (
            <button type="button" data-testid="card-statement-add" disabled={pending} onClick={onEditStatement} className="tap-target inline-flex items-center justify-center rounded border border-dashed px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent disabled:opacity-50">
              + Add statement — get “how much &amp; when” for this card
            </button>
          )}
          {statementOpen && (
            <ManualCardStatementForm
              billing={billing}
              pending={pending}
              onCancel={onCancelStatement}
              onSubmit={onSaveStatement}
            />
          )}
        </div>
      )}
    </li>
  );
}

function AddForm({
  kind,
  pending,
  onCancel,
  onSubmit,
}: {
  kind: 'asset' | 'liability';
  pending: boolean;
  onCancel: () => void;
  onSubmit: (name: string, type: string, value: string) => void;
}) {
  const types = kind === 'asset' ? MANUAL_ASSET_TYPES : MANUAL_LIABILITY_TYPES;
  const [name, setName] = useState('');
  const [type, setType] = useState(types[0].id);
  const [value, setValue] = useState('');
  return (
    <div className="space-y-2 rounded-lg border p-3" data-testid="manual-add-form">
      <p className="text-sm font-medium">Add {kind === 'asset' ? 'an asset' : 'a liability'}</p>
      <input
        type="text"
        placeholder={kind === 'asset' ? 'e.g. Primary home' : 'e.g. Mortgage'}
        value={name}
        onChange={(e) => setName(e.target.value)}
        data-testid="manual-name"
        className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
      />
      <div className="flex gap-2">
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          data-testid="manual-type"
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
        >
          {types.map((t) => (
            <option key={t.id} value={t.id}>{t.label}</option>
          ))}
        </select>
        <div className="flex items-center gap-1">
          <span className="text-sm text-muted-foreground">$</span>
          <input
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            data-testid="manual-value"
            className="w-28 rounded-md border bg-background px-2 py-1.5 text-sm"
          />
        </div>
      </div>
      <div className="flex gap-2">
        <button type="button" data-testid="manual-submit" disabled={pending} onClick={() => onSubmit(name, type, value)} className="tap-target inline-flex items-center justify-center rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/80 disabled:opacity-50">
          Add
        </button>
        <button type="button" disabled={pending} onClick={onCancel} className="tap-target inline-flex items-center justify-center rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent disabled:opacity-50">
          Cancel
        </button>
      </div>
    </div>
  );
}
