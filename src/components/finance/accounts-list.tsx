'use client';

/**
 * All-accounts net worth view (DECISIONS #39). Net worth, then assets and
 * liabilities grouped with subtotals — over LINKED accounts (bank, credit,
 * brokerage) AND user-added manual items (home, vehicle, mortgage, …). Linked
 * rows link to their transactions; manual rows are inline-editable (value) and
 * deletable. "Add asset / Add liability" create manual items.
 */
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConnectAccountsButton } from '@/components/finance/connect-accounts-button';
import { ConnectSimplefin } from '@/components/finance/connect-simplefin';
import {
  ManualCardStatementForm,
  type ManualStatementFormValues,
} from '@/components/finance/manual-card-statement-form';
import { cents, formatCents } from '@/lib/money';
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';
import { formatISODate, isoDate } from '@/lib/dates';
import { MANUAL_ASSET_TYPES, MANUAL_LIABILITY_TYPES } from '@/lib/engine/networth/manual';
import {
  addManualAccount,
  deleteManualAccount,
  updateManualAccountValue,
} from '@/server/networth-actions';
import { clearManualCardStatement, setManualCardStatement } from '@/server/card-actions';
import type { AccountGroup, AccountView } from '@/lib/engine/transactions/query';
import type { AccountsView, ManualCardBilling } from '@/server/transactions';

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
          className={`text-2xl tabular-nums sm:text-3xl ${data.netWorthCents < 0 ? 'text-red-400' : ''}`}
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
        <div className="flex gap-6 text-sm text-muted-foreground">
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
  const router = useRouter();
  const [adding, setAdding] = useState<null | 'asset' | 'liability'>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [statementCardId, setStatementCardId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const isEmpty = data.assets.accounts.length === 0 && data.liabilities.accounts.length === 0;

  function refreshAfter(fn: () => Promise<{ ok: boolean; errors?: string[] }>, successMsg?: string) {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      try {
        const res = await fn();
        if (!res.ok) {
          setError(res.errors?.join(' ') ?? 'Something went wrong.');
          return;
        }
        setAdding(null);
        setEditingId(null);
        setStatementCardId(null);
        if (successMsg) setSuccess(successMsg);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Something went wrong.');
      }
    });
  }

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

      <Group
        group={data.assets}
        title="Assets"
        paymentAccountId={data.paymentAccountId}
        cardBilling={data.cardBilling}
        editingId={editingId}
        statementCardId={statementCardId}
        pending={pending}
        onEdit={setEditingId}
        onSaveValue={(accountId, value) => refreshAfter(() => updateManualAccountValue({ accountId, value }))}
        onDelete={(accountId) => refreshAfter(() => deleteManualAccount(accountId))}
        onCancelEdit={() => setEditingId(null)}
        onEditStatement={(id) => { setStatementCardId(id); setError(null); setSuccess(null); }}
        onSaveStatement={(accountId, values) => refreshAfter(() => setManualCardStatement({ accountId, ...values }), 'Statement saved — this card is now in your “how much & when” answer.')}
        onClearStatement={(accountId) => refreshAfter(() => clearManualCardStatement(accountId), 'Statement cleared.')}
        onCancelStatement={() => setStatementCardId(null)}
      />
      <Group
        group={data.liabilities}
        title="Liabilities"
        paymentAccountId={data.paymentAccountId}
        cardBilling={data.cardBilling}
        editingId={editingId}
        statementCardId={statementCardId}
        pending={pending}
        onEdit={setEditingId}
        onSaveValue={(accountId, value) => refreshAfter(() => updateManualAccountValue({ accountId, value }))}
        onDelete={(accountId) => refreshAfter(() => deleteManualAccount(accountId))}
        onCancelEdit={() => setEditingId(null)}
        onEditStatement={(id) => { setStatementCardId(id); setError(null); setSuccess(null); }}
        onSaveStatement={(accountId, values) => refreshAfter(() => setManualCardStatement({ accountId, ...values }), 'Statement saved — this card is now in your “how much & when” answer.')}
        onClearStatement={(accountId) => refreshAfter(() => clearManualCardStatement(accountId), 'Statement cleared.')}
        onCancelStatement={() => setStatementCardId(null)}
      />

      {/* Link real accounts: SimpleFIN (cheaper, no Plaid gatekeeping) or Plaid */}
      <ConnectSimplefin connected={data.simplefin.connected} lastSyncedAt={data.simplefin.lastSyncedAt} />
      <ConnectAccountsButton />

      {/* Add manual items */}
      <div className="flex gap-2">
        <button
          type="button"
          data-testid="add-asset-btn"
          disabled={pending}
          onClick={() => { setAdding(adding === 'asset' ? null : 'asset'); setError(null); }}
          className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
        >
          + Add asset
        </button>
        <button
          type="button"
          data-testid="add-liability-btn"
          disabled={pending}
          onClick={() => { setAdding(adding === 'liability' ? null : 'liability'); setError(null); }}
          className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
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
}: {
  account: AccountView;
  isLiability: boolean;
  isPaymentAccount: boolean;
}) {
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
    <li>
      <Link
        href={href}
        data-testid="account-row"
        className="flex items-center justify-between gap-3 px-3 py-2 hover:bg-accent"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
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
        </div>
        <div className={`shrink-0 tabular-nums ${isLiability ? 'text-red-400' : 'text-foreground'}`}>
          {isLiability ? '−' : ''}
          {formatCents(cents(account.currentBalanceCents))}
        </div>
      </Link>
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
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isCard = account.type === 'CREDIT' && billing !== undefined;
  return (
    <li className="px-3 py-2" data-testid="manual-account-row">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-medium">{account.name}</div>
          <div className="text-xs text-muted-foreground">{typeLabel(account.type)} · manual</div>
        </div>
        {!editing ? (
          <div className="flex items-center gap-2">
            <span className={`shrink-0 tabular-nums ${isLiability ? 'text-red-400' : 'text-foreground'}`}>
              {isLiability ? '−' : ''}
              {formatCents(cents(account.currentBalanceCents))}
            </span>
            <button type="button" data-testid="manual-edit" disabled={pending} onClick={onEdit} className="rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent disabled:opacity-50">Edit</button>
            {!confirmDelete ? (
              <button type="button" data-testid="manual-delete" disabled={pending} onClick={() => setConfirmDelete(true)} className="rounded px-1.5 py-0.5 text-xs text-red-400 hover:bg-accent disabled:opacity-50">Delete</button>
            ) : (
              <span className="flex items-center gap-1 text-xs" data-testid="manual-delete-confirm-row">
                <span className="text-muted-foreground">Delete?</span>
                <button type="button" data-testid="manual-delete-confirm" disabled={pending} onClick={onDelete} className="rounded px-1.5 py-0.5 text-red-400 hover:bg-accent disabled:opacity-50">Yes</button>
                <button type="button" disabled={pending} onClick={() => setConfirmDelete(false)} className="rounded px-1.5 py-0.5 text-muted-foreground hover:bg-accent disabled:opacity-50">Cancel</button>
              </span>
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
            <button type="button" data-testid="manual-value-save" disabled={pending} onClick={() => onSave(value)} className="rounded bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/80 disabled:opacity-50">Save</button>
            <button type="button" disabled={pending} onClick={onCancel} className="rounded px-1.5 py-1 text-xs text-muted-foreground hover:bg-accent disabled:opacity-50">Cancel</button>
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
              <button type="button" data-testid="card-statement-edit" disabled={pending} onClick={onEditStatement} className="rounded px-1.5 py-0.5 text-muted-foreground hover:bg-accent disabled:opacity-50">Edit</button>
              <button type="button" data-testid="card-statement-clear" disabled={pending} onClick={onClearStatement} className="rounded px-1.5 py-0.5 text-red-400 hover:bg-accent disabled:opacity-50">Clear</button>
            </div>
          ) : (
            <button type="button" data-testid="card-statement-add" disabled={pending} onClick={onEditStatement} className="rounded border border-dashed px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent disabled:opacity-50">
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
        <button type="button" data-testid="manual-submit" disabled={pending} onClick={() => onSubmit(name, type, value)} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/80 disabled:opacity-50">
          Add
        </button>
        <button type="button" disabled={pending} onClick={onCancel} className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent disabled:opacity-50">
          Cancel
        </button>
      </div>
    </div>
  );
}
