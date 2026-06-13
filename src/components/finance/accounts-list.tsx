/**
 * Presentational all-accounts view: net worth, then assets and liabilities
 * grouped with subtotals. Each account links to its filtered transaction list.
 */
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cents, formatCents } from '@/lib/money';
import type { AccountGroup, AccountView } from '@/lib/engine/transactions/query';
import type { AccountsView } from '@/server/transactions';

const TYPE_LABEL: Record<string, string> = {
  CHECKING: 'Checking',
  SAVINGS: 'Savings',
  CREDIT: 'Credit card',
  INVESTMENT: 'Investment',
  LOAN: 'Loan',
};

function AccountRow({
  account,
  isLiability,
  isPaymentAccount,
}: {
  account: AccountView;
  isLiability: boolean;
  isPaymentAccount: boolean;
}) {
  return (
    <li>
      <Link
        href={`/transactions?account=${account.id}`}
        data-testid="account-row"
        className="flex items-center justify-between gap-3 px-3 py-2 hover:bg-accent"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{account.name}</span>
            {isPaymentAccount && (
              <span className="shrink-0 rounded bg-accent px-1.5 py-0.5 text-[10px] text-muted-foreground">
                Pays cards
              </span>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            {TYPE_LABEL[account.type] ?? account.type}
            {account.mask ? ` ····${account.mask}` : ''}
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

function Group({
  group,
  title,
  paymentAccountId,
}: {
  group: AccountGroup;
  title: string;
  paymentAccountId: string | null;
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
          {group.accounts.map((a) => (
            <AccountRow
              key={a.id}
              account={a}
              isLiability={isLiability}
              isPaymentAccount={a.id === paymentAccountId}
            />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export function AccountsList({ data }: { data: AccountsView }) {
  return (
    <div className="space-y-4">
      <Card data-testid="accounts-net-worth">
        <CardHeader className="pb-2">
          <CardDescription>Net worth (assets − liabilities)</CardDescription>
          <CardTitle
            className={`text-2xl tabular-nums sm:text-3xl ${
              data.netWorthCents < 0 ? 'text-red-400' : ''
            }`}
            data-testid="accounts-net-worth-amount"
          >
            {formatCents(data.netWorthCents)}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex gap-6 text-sm text-muted-foreground">
          <span>Assets {formatCents(data.assets.subtotalCents)}</span>
          <span>Liabilities {formatCents(data.liabilities.subtotalCents)}</span>
        </CardContent>
      </Card>

      <Group group={data.assets} title="Assets" paymentAccountId={data.paymentAccountId} />
      <Group group={data.liabilities} title="Liabilities" paymentAccountId={data.paymentAccountId} />
    </div>
  );
}
