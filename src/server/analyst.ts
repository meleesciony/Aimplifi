/**
 * Ask's month-against-month comparison and monthly average: the reads, and the
 * assembly of pure engines into an answer.
 *
 * Every figure comes from `spendingByCategory` over the SAME snapshot rows every other
 * Ask answer uses (through `analyst/spend-figure.ts`); which accounts those rows are
 * taken from is decided by `analyst/same-account.ts` from stored facts only. This
 * module adds no arithmetic and no rule of its own.
 *
 * Not a 'use server' file: nothing here is callable from a browser. The one write —
 * keeping the reader's answer to an account question — is `answerAccountQuestion` in
 * server/assistant.ts, which calls `saveRecordEdgeWord` below after its own checks.
 */
import { prisma } from '@/lib/db';
import { isoDate, type ISODate } from '@/lib/dates';
import type { CategoryMeta } from '@/lib/engine/categorize/categories';
import { accountLabel } from '@/lib/engine/account/display-name';
import { isSpendRow, type ReportTxn } from '@/lib/engine/reports/reports';
import { accountRecords, type AccountFactsInput, type PlaidItemFacts } from '@/lib/engine/analyst/account-records';
import { averageSameAccounts, compareSameAccounts } from '@/lib/engine/analyst/same-account';
import { comparisonPeriods, inTarget, periodOfMonth, spendFigureFor } from '@/lib/engine/analyst/spend-figure';
import { answerSpendAverage, answerSpendCompare } from '@/lib/engine/assistant/answer-analyst';
import type { AssistantAnswer } from '@/lib/engine/assistant/answer';
import type { AssistantIntent } from '@/lib/engine/assistant/intent';
import { addMonthsToMonthKey } from '@/lib/dates';
import type { FinanceSnapshot } from '@/lib/providers/types';

type AnalystIntent = Extract<AssistantIntent, { kind: 'spend_compare' | 'spend_average' }>;

/** The per-account facts the snapshot does not carry: the connection, and the reader's word. */
export interface AccountRecordFacts {
  byAccount: ReadonlyMap<
    string,
    {
      plaidItemId: string | null;
      recordStartWord: { forDate: string; verdict: string } | null;
      recordEndWord: { forDate: string; verdict: string } | null;
    }
  >;
  plaidItems: readonly PlaidItemFacts[];
  /**
   * Each account's first and last row in its OWN stored record, up to today — before a
   * combined account's boundary trims the snapshot. Where two records of one card meet is
   * read from these, not from the trimmed rows (see `accountRecords`).
   */
  rawSpans: ReadonlyMap<string, { first: string; last: string }>;
}

export async function loadAccountRecordFacts(userId: string, today: string): Promise<AccountRecordFacts> {
  const [accounts, plaidItems, spans] = await Promise.all([
    prisma.account.findMany({
      where: { userId },
      select: {
        id: true,
        plaidItemId: true,
        recordStartWordDate: true,
        recordStartWordVerdict: true,
        recordEndWordDate: true,
        recordEndWordVerdict: true,
      },
    }),
    prisma.plaidItem.findMany({
      where: { userId },
      select: { itemId: true, lastSyncedAt: true, lastSyncError: true },
    }),
    prisma.transaction.groupBy({
      by: ['accountId'],
      where: { account: { userId }, date: { lte: today } },
      _min: { date: true },
      _max: { date: true },
    }),
  ]);
  const word = (forDate: string | null, verdict: string | null) => (forDate && verdict ? { forDate, verdict } : null);
  return {
    byAccount: new Map(
      accounts.map((a) => [
        a.id,
        {
          plaidItemId: a.plaidItemId,
          recordStartWord: word(a.recordStartWordDate, a.recordStartWordVerdict),
          recordEndWord: word(a.recordEndWordDate, a.recordEndWordVerdict),
        },
      ]),
    ),
    plaidItems,
    rawSpans: new Map(
      spans.flatMap((x) => (x._min.date != null && x._max.date != null ? [[x.accountId, { first: x._min.date, last: x._max.date }]] : [])),
    ),
  };
}

/** Every month there is; `isSpendRow` is then only asking "is this row spending at all". */
const ALL_TIME = { fromYm: '0000-01', toYm: '9999-12' };

/** The account records for a snapshot — also what `answerAccountQuestion` checks an edge against. */
export function analystAccountRecords(input: {
  snap: FinanceSnapshot;
  facts: AccountRecordFacts;
  meta: ReadonlyMap<string, CategoryMeta>;
  terminalOf: ReadonlyMap<string, string>;
  /** Each combined account's dropped date ranges (`getReconciliationBoundary().droppedOf`). */
  droppedOf?: ReadonlyMap<string, readonly { from: string; to: string }[]>;
  today: ISODate;
}) {
  const { snap, facts, meta, terminalOf, droppedOf, today } = input;
  const rows = snap.transactions as ReportTxn[];
  const excluded = snap.loanPaymentFlowExclusions?.excludeIds;
  const spending = new Set<string>();
  for (const t of rows) if (t.accountId && isSpendRow(t, ALL_TIME, meta, excluded)) spending.add(t.accountId);

  const described: AccountFactsInput[] = snap.accounts.map((a) => {
    const f = facts.byAccount.get(a.id);
    return {
      id: a.id,
      name: accountLabel(a),
      provider: a.provider ?? null,
      plaidItemId: f?.plaidItemId ?? null,
      feedDroppedAt: a.feedDroppedAt ?? null,
      recordStartWord: f?.recordStartWord ?? null,
      recordEndWord: f?.recordEndWord ?? null,
    };
  });
  // A row for an account the snapshot does not list must not become a silent zero OR a
  // crash: it is described as an account nothing is known about, so it is left out by name.
  const known = new Set(described.map((a) => a.id));
  for (const t of snap.transactions) {
    if (known.has(t.accountId)) continue;
    known.add(t.accountId);
    described.push({
      id: t.accountId,
      name: 'An account not listed',
      provider: null,
      plaidItemId: null,
      feedDroppedAt: null,
      recordStartWord: null,
      recordEndWord: null,
    });
  }
  return accountRecords({
    accounts: described,
    rows: snap.transactions,
    spendingAccountIds: spending,
    terminalOf,
    plaidItems: facts.plaidItems,
    rawSpans: facts.rawSpans,
    droppedOf,
    today,
  });
}

export function buildAnalystAnswer(input: {
  intent: AnalystIntent;
  snap: FinanceSnapshot;
  facts: AccountRecordFacts;
  meta: ReadonlyMap<string, CategoryMeta>;
  handoverKeys: ReadonlySet<string>;
  terminalOf: ReadonlyMap<string, string>;
  droppedOf?: ReadonlyMap<string, readonly { from: string; to: string }[]>;
  today: string;
}): AssistantAnswer {
  const { intent, snap, facts, meta, handoverKeys, terminalOf, droppedOf } = input;
  const today = isoDate(input.today);
  const accounts = analystAccountRecords({ snap, facts, meta, terminalOf, droppedOf, today });
  // Only rows the spending figure can count, for this subject, reach the engine — the
  // figure filters the rest anyway — so an account's `rowsInPeriods` never counts a
  // paycheck, or another category's purchase, as something an answer could change
  // (critic cycle 3, both lanes).
  const excludedFlows = snap.loanPaymentFlowExclusions?.excludeIds;
  const rows = (snap.transactions as ReportTxn[])
    .filter((t) => isSpendRow(t, ALL_TIME, meta, excludedFlows) && inTarget(t.categoryId, intent.target, meta))
    .map((t) => ({ ...t, accountId: t.accountId ?? '' }));
  const figure = spendFigureFor({
    meta,
    excludedFlowIds: snap.loanPaymentFlowExclusions?.excludeIds,
    handoverKeys,
    target: intent.target,
  });
  const targetLabel = intent.target?.label ?? null;

  if (intent.kind === 'spend_compare') {
    const { current, baseline, soFarDays } = comparisonPeriods(intent.currentYm, intent.baselineYm, today);
    return answerSpendCompare({
      result: compareSameAccounts({ rows, accounts, current, baseline, today, figure }),
      currentYm: intent.currentYm,
      baselineYm: intent.baselineYm,
      soFarDays,
      targetLabel,
      today,
    });
  }
  const months = Array.from({ length: intent.months }, (_, i) => periodOfMonth(addMonthsToMonthKey(intent.fromYm, i)));
  return answerSpendAverage({
    result: averageSameAccounts({ rows, accounts, months, today, figure }),
    fromYm: intent.fromYm,
    toYm: intent.toYm,
    months: intent.months,
    targetLabel,
    today,
  });
}

/** Keep the reader's word about one edge of one account's record. The caller has checked everything. */
export async function saveRecordEdgeWord(input: {
  userId: string;
  accountId: string;
  edge: 'start' | 'end';
  date: ISODate;
  verdict: 'real' | 'missing';
}): Promise<void> {
  await prisma.account.updateMany({
    where: { id: input.accountId, userId: input.userId },
    data:
      input.edge === 'start'
        ? { recordStartWordDate: input.date, recordStartWordVerdict: input.verdict }
        : { recordEndWordDate: input.date, recordEndWordVerdict: input.verdict },
  });
}
