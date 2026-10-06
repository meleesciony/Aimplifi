import Link from 'next/link';
import type { ReactNode } from 'react';
import { DISCLOSURE_SUMMARY_CLASS, DisclosureChevron } from '@/components/finance/disclosure-chevron';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatISODate, formatMonth } from '@/lib/dates';
import type { DepositDestination, DepositHistory, UncountedRow } from '@/lib/engine/investments/deposits';
import {
  DEPOSITS_NO_INVESTMENT_ACCOUNTS,
  DEPOSITS_NO_RECORDS,
  DEPOSITS_NO_SOURCE_ACCOUNTS,
  depositLead,
  depositRuleNote,
  destinationDetail,
  destinationLabel,
  figureParts,
  matchingNote,
  monthFigureParts,
  monthMissingNote,
  scopeByNameNote,
  scopeNote,
  uncountedDirection,
  uncountedReason,
} from '@/lib/engine/investments/deposits-copy';
import { cents, formatCents } from '@/lib/money';

/** Money chunks wrap between each other, never inside one ("$12,500.00 put in" stays whole). */
function Figure({ parts, testid }: { parts: readonly string[]; testid?: string }) {
  return (
    <span className="ml-auto flex flex-wrap justify-end gap-x-2 tabular-nums" data-testid={testid}>
      {/* The separator ends a chunk, so a wrapped line never starts with "·". */}
      {parts.map((p, i) => (
        <span key={i} className="whitespace-nowrap">
          {i > 0 ? ' ' : ''}
          {p}
          {i < parts.length - 1 ? ' ·' : ''}
        </span>
      ))}
    </span>
  );
}

function UncountedList({ rows }: { rows: readonly UncountedRow[] }) {
  return (
    <details data-testid="deposit-uncounted">
      <summary className={DISCLOSURE_SUMMARY_CLASS}>
        <DisclosureChevron />
        Not counted ({rows.length})
      </summary>
      <ul className="space-y-2 pb-1 pl-[22px]">
        {rows.map((u) => (
          <li key={u.rowId} data-testid="deposit-uncounted-row" data-reason={u.reason}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="min-w-0 break-words">
                <span className="text-muted-foreground">{formatISODate(u.date, 'long')} · </span>
                {u.descriptor}
              </span>
              <span className="whitespace-nowrap tabular-nums">{formatCents(cents(u.cents))}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              {uncountedDirection(u)} {uncountedReason(u)}
            </p>
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * "Money you put in" on /investments (DECISIONS #788): what the reader's linked
 * checking and savings sent to (and got back from) their investment accounts,
 * month by month, every counted row one tap away, and every row that names an
 * investment account but was left out — with the reason. Server-rendered; the
 * month rows are native `<details>`, so they open with no client script.
 */
export function DepositHistoryCard({ history, canLink }: { history: DepositHistory; canLink: boolean }) {
  const destinationsByKey = new Map<string, DepositDestination>(history.destinations.map((d) => [d.destination.key, d.destination]));
  const offerLink =
    canLink &&
    (!history.hasSourceAccounts || !history.hasInvestmentAccounts || history.uncounted.some((u) => u.reason === 'not-linked'));
  const linkButton = offerLink && (
    <Link href="/accounts" className={`${buttonVariants({ variant: 'outline' })} min-h-11`} data-testid="deposit-link-account">
      Link an account
    </Link>
  );
  const ruleNote = (
    <details className="text-xs text-muted-foreground" data-testid="deposit-rule">
      <summary className={DISCLOSURE_SUMMARY_CLASS}>
        <DisclosureChevron />
        How we read this
      </summary>
      <p className="pb-1 pl-[22px]">{depositRuleNote(history.months[0]?.month ?? null)}</p>
    </details>
  );

  let body: ReactNode;
  if (!history.hasSourceAccounts || !history.hasInvestmentAccounts || history.months.length === 0) {
    const message = !history.hasSourceAccounts
      ? DEPOSITS_NO_SOURCE_ACCOUNTS
      : !history.hasInvestmentAccounts
        ? DEPOSITS_NO_INVESTMENT_ACCOUNTS
        : DEPOSITS_NO_RECORDS;
    body = (
      <>
        <p className="text-muted-foreground" data-testid="deposit-empty">
          {message}
        </p>
        {history.uncounted.length > 0 && <UncountedList rows={history.uncounted} />}
      </>
    );
  } else {
    const lead = depositLead(history);
    const scoped = scopeNote(history);
    const byName = scopeByNameNote(history);
    const matching = matchingNote(history);
    body = (
      <>
        {scoped && (
          <p className="text-xs text-muted-foreground" data-testid="deposit-scope">
            {scoped}
          </p>
        )}
        {lead && (
          <p className="font-medium" data-testid="deposit-lead">
            {lead}
          </p>
        )}
        {byName && (
          <p className="text-muted-foreground" data-testid="deposit-scope-by-name">
            {byName}
          </p>
        )}
        {matching && (
          <p className="text-xs text-muted-foreground" data-testid="deposit-matching">
            {matching}
          </p>
        )}

        {history.destinations.length > 0 && (
          <div data-testid="deposit-destinations">
            <p className="text-xs text-muted-foreground">Since {formatMonth(history.months[0]!.month)}, by where it went</p>
            <ul className="mt-1 space-y-1.5">
              {history.destinations.map((d) => (
                <li key={d.destination.key} data-testid="deposit-destination">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="min-w-0 break-words">{destinationLabel(d.destination)}</span>
                    <Figure parts={figureParts(d.putInCents, d.takenOutCents)} />
                  </div>
                  <p className="text-xs text-muted-foreground">{destinationDetail(d.destination)}</p>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <p className="text-xs text-muted-foreground">Month by month</p>
          <ul className="mt-1 divide-y" data-testid="deposit-months">
            {[...history.months].reverse().map((m) => {
              const label = `${formatMonth(m.month)}${m.partial ? ' so far' : ''}`;
              const missing = monthMissingNote(m);
              const note = missing && (
                <p className="pb-1.5 pl-[22px] text-xs text-muted-foreground" data-testid="deposit-month-missing">
                  {missing}
                </p>
              );
              if (m.events.length === 0) {
                return (
                  <li key={m.month} data-testid="deposit-month" data-month={m.month}>
                    <div className="flex flex-wrap items-center justify-between gap-x-3 py-1.5 pl-[22px] text-muted-foreground">
                      <span>{label}</span>
                      <Figure parts={monthFigureParts(m)} testid="deposit-month-figure" />
                    </div>
                    {note}
                  </li>
                );
              }
              return (
                <li key={m.month} data-testid="deposit-month" data-month={m.month}>
                  <details>
                    <summary className={`${DISCLOSURE_SUMMARY_CLASS} flex-wrap justify-between gap-x-3`} data-testid="deposit-month-summary">
                      <span className="flex items-center gap-1.5">
                        <DisclosureChevron />
                        {label}
                      </span>
                      <Figure parts={monthFigureParts(m)} testid="deposit-month-figure" />
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
                  {note}
                </li>
              );
            })}
          </ul>
        </div>

        {history.uncounted.length > 0 && <UncountedList rows={history.uncounted} />}
      </>
    );
  }

  return (
    <Card data-testid="deposit-history-card">
      <CardHeader className="pb-2">
        <CardDescription>From your linked checking and savings</CardDescription>
        <CardTitle className="text-base">Money you put in</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {body}
        {linkButton}
        {ruleNote}
      </CardContent>
    </Card>
  );
}
