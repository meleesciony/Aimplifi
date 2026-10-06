import Link from 'next/link';
import { DISCLOSURE_SUMMARY_CLASS, DisclosureChevron } from '@/components/finance/disclosure-chevron';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatISODate, formatMonth } from '@/lib/dates';
import type { DepositDestination, DepositHistory } from '@/lib/engine/investments/deposits';
import {
  DEPOSITS_NO_INVESTMENT_ACCOUNTS,
  DEPOSITS_NO_RECORDS,
  depositLead,
  depositRuleNote,
  destinationLabel,
  monthFigure,
  uncountedReason,
} from '@/lib/engine/investments/deposits-copy';
import { cents, formatCents } from '@/lib/money';

/**
 * "Money you put in" on /investments (DECISIONS #788): what the reader's linked
 * checking and savings sent to (and got back from) their investment accounts,
 * month by month, every counted row one tap away, and every row that names an
 * investment account but was left out — with the reason. Server-rendered; the
 * month rows are native `<details>`, so they open with no client script.
 */
export function DepositHistoryCard({ history, canLink }: { history: DepositHistory; canLink: boolean }) {
  const destinationsByKey = new Map<string, DepositDestination>(history.destinations.map((d) => [d.destination.key, d.destination]));
  const lead = depositLead(history);
  const showMonths = history.hasInvestmentAccounts && history.months.length > 0;
  const offerLink = canLink && (!history.hasInvestmentAccounts || history.uncounted.some((u) => u.reason === 'not-linked'));

  return (
    <Card data-testid="deposit-history-card">
      <CardHeader className="pb-2">
        <CardDescription>From your linked checking and savings</CardDescription>
        <CardTitle className="text-base">Money you put in</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {history.months.length === 0 ? (
          <p className="text-muted-foreground" data-testid="deposit-empty">
            {history.hasInvestmentAccounts ? DEPOSITS_NO_RECORDS : DEPOSITS_NO_INVESTMENT_ACCOUNTS}
          </p>
        ) : (
          <>
            {lead && (
              <p className="font-medium" data-testid="deposit-lead">
                {lead}
              </p>
            )}
            {!history.hasInvestmentAccounts && (
              <p className="text-muted-foreground" data-testid="deposit-empty">
                {DEPOSITS_NO_INVESTMENT_ACCOUNTS}
              </p>
            )}
          </>
        )}

        {showMonths && history.destinations.length > 0 && (
          <div data-testid="deposit-destinations">
            <p className="text-xs text-muted-foreground">Since {formatMonth(history.months[0]!.month)}, by account</p>
            <ul className="mt-1 space-y-1">
              {history.destinations.map((d) => (
                <li key={d.destination.key} className="flex flex-wrap items-baseline justify-between gap-x-3" data-testid="deposit-destination">
                  <span className="min-w-0 break-words">{destinationLabel(d.destination)}</span>
                  <span className="whitespace-nowrap tabular-nums">{monthFigure(d.putInCents, d.takenOutCents)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {showMonths && (
          <div>
            <p className="text-xs text-muted-foreground">Month by month</p>
            <ul className="mt-1 divide-y" data-testid="deposit-months">
              {[...history.months].reverse().map((m) => {
                const label = `${formatMonth(m.month)}${m.partial ? ' so far' : ''}`;
                const figure = monthFigure(m.putInCents, m.takenOutCents);
                if (m.events.length === 0) {
                  return (
                    <li key={m.month} className="flex items-center justify-between gap-3 py-1.5 pl-[22px] text-muted-foreground" data-testid="deposit-month" data-month={m.month}>
                      <span>{label}</span>
                      <span>{figure}</span>
                    </li>
                  );
                }
                return (
                  <li key={m.month} data-testid="deposit-month" data-month={m.month}>
                    <details>
                      <summary className={`${DISCLOSURE_SUMMARY_CLASS} justify-between`} data-testid="deposit-month-summary">
                        <span className="flex items-center gap-1.5">
                          <DisclosureChevron />
                          {label}
                        </span>
                        <span className="whitespace-nowrap tabular-nums">{figure}</span>
                      </summary>
                      <ul className="space-y-2 pb-2 pl-[22px]" data-testid="deposit-month-rows">
                        {m.events.map((e) => {
                          const dest = destinationsByKey.get(e.destinationKey);
                          const where = dest ? destinationLabel(dest) : 'an investment account';
                          return (
                            <li key={e.rowId} className="flex flex-wrap items-baseline justify-between gap-x-3" data-testid="deposit-row">
                              <span className="min-w-0 break-words">
                                <span className="text-muted-foreground">{formatISODate(e.date)} · </span>
                                {e.descriptor}
                                <span className="block text-xs text-muted-foreground">
                                  {e.direction === 'in' ? `${e.sourceLabel} → ${where}` : `${where} → ${e.sourceLabel}`}
                                </span>
                              </span>
                              <span className="whitespace-nowrap tabular-nums">{formatCents(cents(e.cents))}</span>
                            </li>
                          );
                        })}
                      </ul>
                    </details>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {history.uncounted.length > 0 && (
          <details data-testid="deposit-uncounted">
            <summary className={DISCLOSURE_SUMMARY_CLASS}>
              <DisclosureChevron />
              Not counted ({history.uncounted.length})
            </summary>
            <ul className="space-y-2 pb-1 pl-[22px]">
              {history.uncounted.map((u) => (
                <li key={u.rowId} data-testid="deposit-uncounted-row" data-reason={u.reason}>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="min-w-0 break-words">
                      <span className="text-muted-foreground">{formatISODate(u.date)} · </span>
                      {u.descriptor}
                    </span>
                    <span className="whitespace-nowrap tabular-nums">{formatCents(cents(u.cents))}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {u.direction === 'in' ? `Left ${u.sourceLabel}.` : `Arrived in ${u.sourceLabel}.`} {uncountedReason(u)}
                  </p>
                </li>
              ))}
            </ul>
          </details>
        )}

        {offerLink && (
          <Link href="/accounts" className={buttonVariants({ variant: 'outline', size: 'sm' })} data-testid="deposit-link-account">
            Link an account
          </Link>
        )}

        <details className="text-xs text-muted-foreground" data-testid="deposit-rule">
          <summary className={DISCLOSURE_SUMMARY_CLASS}>
            <DisclosureChevron />
            How we read this
          </summary>
          <p className="pb-1 pl-[22px]">{depositRuleNote(history.recordsFromMonth)}</p>
        </details>
      </CardContent>
    </Card>
  );
}
