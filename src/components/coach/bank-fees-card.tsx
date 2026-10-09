/**
 * "Fees you paid" on /coach (DECISIONS #796): the bank fees in the last 12 months of the
 * reader's records, by kind, each kind one tap from its rows and from how that kind of fee is
 * usually avoided; what came back; what is left out; the rule, one tap away.
 *
 * Every figure comes from `findBankFees` and every sentence from `bank-fees-copy.ts` — this
 * file only lays them out. A server component: the disclosures are native `<details>`.
 */
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DISCLOSURE_SUMMARY_CLASS, DisclosureChevron } from '@/components/finance/disclosure-chevron';
import type { BankFees, FeeRow } from '@/lib/engine/fi/bank-fees';
import {
  BANK_FEES_CARD_ID,
  BANK_FEES_RULE,
  BANK_FEES_RULE_SUMMARY,
  BANK_FEES_TITLE,
  FEE_KIND_COPY,
  bankFeesLead,
  feeDate,
  feeKindLine,
  feesGivenBackLine,
  feesLeftOutLine,
} from '@/lib/engine/fi/bank-fees-copy';
import {
  HANDOVER_DAY_ROW_MARKER,
  handoverDayAmountsNote,
} from '@/lib/engine/glass-box/category-breakdown';
import { namedPageBack, withForwardedReturn } from '@/lib/engine/transactions/links';
import { formatCents } from '@/lib/money';

function FeeRows({ rows, testid }: { rows: readonly FeeRow[]; testid: string }) {
  return (
    <ul className="mt-1 space-y-1.5" data-testid={testid}>
      {rows.map((r) => (
        <li key={r.transactionId} className="flex min-w-0 items-baseline justify-between gap-2 text-xs">
          <span className="min-w-0">
            <Link
              href={withForwardedReturn(
                `/transactions/${encodeURIComponent(r.transactionId)}`,
                namedPageBack('coach', null),
              )}
              className="break-words underline decoration-dotted underline-offset-2 hover:decoration-solid"
              data-testid="bank-fee-row-link"
            >
              {r.label}
            </Link>
            <span className="text-muted-foreground">
              {' '}
              · {feeDate(r.date)}
              {r.onHandoverDay ? ` ${HANDOVER_DAY_ROW_MARKER}` : ''}
            </span>
            {r.rawDescriptor && (
              <span className="block break-words text-muted-foreground">{r.rawDescriptor}</span>
            )}
          </span>
          <span className="shrink-0 whitespace-nowrap tabular-nums">{formatCents(r.amountCents)}</span>
        </li>
      ))}
    </ul>
  );
}

function Disclosure({ summary, testid, children }: { summary: string; testid: string; children: ReactNode }) {
  return (
    <details data-testid={testid}>
      <summary className={`${DISCLOSURE_SUMMARY_CLASS} text-sm font-medium text-foreground`}>
        <DisclosureChevron />
        <span className="min-w-0 break-words">{summary}</span>
      </summary>
      <div className="space-y-1 pb-2 pl-6">{children}</div>
    </details>
  );
}

export function BankFeesCard({ fees }: { fees: BankFees }) {
  const leftOut = feesLeftOutLine(fees);
  return (
    <Card id={BANK_FEES_CARD_ID} className="scroll-mt-20" data-testid="bank-fees-card">
      <CardHeader className="pb-2">
        <CardTitle as="h3" className="text-base">
          {BANK_FEES_TITLE}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="break-words" data-testid="bank-fees-lead">
          {bankFeesLead(fees)}
        </p>
        {fees.kinds.length > 0 && (
          <div data-testid="bank-fees-kinds">
            {fees.kinds.map((k) => (
              <Disclosure key={k.kind} summary={feeKindLine(k)} testid={`bank-fees-kind-${k.kind}`}>
                <p className="text-xs text-muted-foreground">{FEE_KIND_COPY[k.kind].avoid}</p>
                <FeeRows rows={k.rows} testid={`bank-fees-rows-${k.kind}`} />
              </Disclosure>
            ))}
          </div>
        )}
        {fees.givenBack.length > 0 && (
          <Disclosure summary={feesGivenBackLine(fees)} testid="bank-fees-given-back">
            <FeeRows rows={fees.givenBack} testid="bank-fees-rows-given-back" />
          </Disclosure>
        )}
        {leftOut && (
          <p className="text-xs text-muted-foreground" data-testid="bank-fees-left-out">
            {leftOut}
          </p>
        )}
        {fees.countedOnHandoverDays > 0 && (
          <p className="text-xs text-muted-foreground" data-testid="bank-fees-handover">
            {handoverDayAmountsNote(fees.countedOnHandoverDays)}
          </p>
        )}
        <details data-testid="bank-fees-how">
          <summary className={`${DISCLOSURE_SUMMARY_CLASS} text-xs font-medium text-muted-foreground`}>
            <DisclosureChevron />
            {BANK_FEES_RULE_SUMMARY}
          </summary>
          <p className="pb-1 pl-6 text-xs text-muted-foreground" data-testid="bank-fees-rule">
            {BANK_FEES_RULE}
          </p>
        </details>
      </CardContent>
    </Card>
  );
}
