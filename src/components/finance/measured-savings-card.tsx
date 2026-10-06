import Link from 'next/link';
import type { ReactNode } from 'react';
import { DISCLOSURE_SUMMARY_CLASS, DisclosureChevron } from '@/components/finance/disclosure-chevron';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatISODate, formatMonth } from '@/lib/dates';
import { monthMissingNote } from '@/lib/engine/investments/deposits-copy';
import type { MeasuredMonth, MeasuredSavings, SavingsRowView } from '@/lib/engine/savings/measured';
import {
  MEASURED_NO_RECORDS,
  MEASURED_NO_SAVING_ACCOUNTS,
  MEASURED_NO_SOURCE_ACCOUNTS,
  MEASURED_RULE_NOTE,
  measuredAverageSentence,
  measuredLead,
  signedMoney,
  uncountedInvestmentsNote,
} from '@/lib/engine/savings/measured-copy';

function Line({ label, cents, testid, children }: { label: ReactNode; cents: number; testid: string; children?: ReactNode }) {
  return (
    <li data-testid={testid}>
      <div className="flex items-baseline justify-between gap-x-3">
        <span className="min-w-0 break-words">{label}</span>
        <span className="shrink-0 whitespace-nowrap tabular-nums" data-testid={`${testid}-figure`}>
          {signedMoney(cents)}
        </span>
      </div>
      {children}
    </li>
  );
}

function SavingsRows({ rows, testid }: { rows: readonly SavingsRowView[]; testid: string }) {
  if (rows.length === 0) return null;
  return (
    <details>
      <summary className={`${DISCLOSURE_SUMMARY_CLASS} text-xs text-muted-foreground`} data-testid={`${testid}-toggle`}>
        <DisclosureChevron />
        {rows.length === 1 ? 'The row' : `The ${rows.length} rows`}
      </summary>
      <ul className="space-y-1.5 pb-1 pl-[22px]" data-testid={testid}>
        {rows.map((r) => (
          <li key={r.rowId} className="flex items-baseline justify-between gap-x-3 text-xs" data-testid="measured-savings-row">
            <span className="min-w-0 break-words">
              <span className="text-muted-foreground">{formatISODate(r.date)} · </span>
              {r.descriptor}
              <span className="block text-muted-foreground">{r.accountLabel}</span>
            </span>
            <span className="shrink-0 whitespace-nowrap tabular-nums">{signedMoney(r.cents)}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * One month's lines: savings accounts, investment accounts (each only when the reader
 * links one — a line for an account kind they do not have is a $0.00 that says
 * nothing), and earnings left out.
 */
function MonthLines({ m, prefix, measured }: { m: MeasuredMonth; prefix: string; measured: MeasuredSavings }) {
  const uncounted = uncountedInvestmentsNote(m);
  const showInvestments = measured.hasInvestmentAccounts || m.investmentsNetCents !== 0 || m.uncountedInvestmentRows > 0;
  return (
    <ul className="space-y-1.5">
      {(measured.hasSavingsAccounts || m.savingsNetCents !== 0) && (
        <Line label="Savings accounts, net" cents={m.savingsNetCents} testid={`${prefix}-savings`}>
          <SavingsRows rows={m.savingsRows} testid={`${prefix}-savings-rows`} />
        </Line>
      )}
      {showInvestments && (
        <Line label="Investment accounts, net" cents={m.investmentsNetCents} testid={`${prefix}-investments`}>
          <Link
            href="/investments"
            className="inline-flex min-h-11 items-center text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
            data-testid={`${prefix}-investments-link`}
          >
            The rows are under “Money you put in” on Investments
          </Link>
          {uncounted && (
            <p className="text-xs text-muted-foreground" data-testid={`${prefix}-uncounted`}>
              {uncounted}
            </p>
          )}
        </Line>
      )}
      {m.earningsCents !== 0 && (
        <Line label="Interest and dividends, left out" cents={m.earningsCents} testid={`${prefix}-earnings`}>
          <SavingsRows rows={m.earningsRows} testid={`${prefix}-earnings-rows`} />
        </Line>
      )}
    </ul>
  );
}

/**
 * "Money you set aside" on Guilt-free (DECISIONS #790): what the reader actually moved
 * into their linked savings and investment accounts — this month so far against the
 * plan's savings line, then month by month — every figure one tap from its rows.
 * Server-rendered; the months are native `<details>`, so they open with no client script.
 */
export function MeasuredSavingsCard({ measured, canLink }: { measured: MeasuredSavings; canLink: boolean }) {
  const ruleNote = (
    <details className="text-xs text-muted-foreground" data-testid="measured-rule">
      <summary className={DISCLOSURE_SUMMARY_CLASS}>
        <DisclosureChevron />
        How we measure this
      </summary>
      <p className="pb-1 pl-[22px]">{MEASURED_RULE_NOTE}</p>
    </details>
  );

  let body: ReactNode;
  const noSavingAccounts = !measured.hasSavingsAccounts && !measured.hasInvestmentAccounts;
  if (!measured.hasSourceAccounts || noSavingAccounts || !measured.thisMonth) {
    const message = !measured.hasSourceAccounts
      ? MEASURED_NO_SOURCE_ACCOUNTS
      : noSavingAccounts
        ? MEASURED_NO_SAVING_ACCOUNTS
        : MEASURED_NO_RECORDS;
    body = (
      <>
        <p className="text-muted-foreground" data-testid="measured-empty">
          {message}
        </p>
        {canLink && (noSavingAccounts || !measured.hasSourceAccounts) && (
          <Link href="/accounts" className="inline-flex min-h-11 items-center underline underline-offset-2" data-testid="measured-link-account">
            Link an account
          </Link>
        )}
      </>
    );
  } else {
    const m = measured.thisMonth;
    const missing = monthMissingNote(m);
    const average = measuredAverageSentence(measured);
    const history = measured.months.filter((x) => !x.partial).reverse();
    body = (
      <>
        <p className="font-medium" data-testid="measured-lead">
          {measuredLead(measured)}
        </p>
        <div data-testid="measured-this-month">
          <MonthLines m={m} prefix="measured-this-month" measured={measured} />
          {missing && (
            <p className="mt-1 text-xs text-muted-foreground" data-testid="measured-this-month-missing">
              {missing}
            </p>
          )}
        </div>
        {average && (
          <p className="text-muted-foreground" data-testid="measured-average">
            {average}
          </p>
        )}
        {history.length > 0 && (
          <div>
            <p className="text-xs text-muted-foreground">Month by month</p>
            <ul className="mt-1 divide-y" data-testid="measured-months">
              {history.map((x) => {
                const note = monthMissingNote(x);
                return (
                  <li key={x.month} data-testid="measured-month" data-month={x.month}>
                    <details>
                      <summary className={`${DISCLOSURE_SUMMARY_CLASS} flex-wrap justify-between gap-x-3`} data-testid="measured-month-summary">
                        <span className="flex items-center gap-1.5">
                          <DisclosureChevron />
                          {formatMonth(x.month)}
                        </span>
                        <span className="whitespace-nowrap tabular-nums" data-testid="measured-month-figure">
                          {signedMoney(x.totalCents)}
                        </span>
                      </summary>
                      <div className="pb-2 pl-[22px]">
                        <MonthLines m={x} prefix="measured-month" measured={measured} />
                      </div>
                    </details>
                    {note && (
                      <p className="pb-1.5 pl-[22px] text-xs text-muted-foreground" data-testid="measured-month-missing">
                        {note}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </>
    );
  }

  return (
    <Card id="money-set-aside" data-testid="measured-savings">
      <CardHeader className="pb-2">
        <CardDescription>From your linked savings and investment accounts</CardDescription>
        <CardTitle className="text-base">Money you set aside</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {body}
        {ruleNote}
      </CardContent>
    </Card>
  );
}
