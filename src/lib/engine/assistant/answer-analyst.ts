/**
 * The words for a same-account comparison and a same-account average.
 *
 * Every figure here was computed by `analyst/same-account.ts` over the app's own
 * spending figure; this module only says it. Three rules shape the wording:
 *
 *   1. The answer states its READING — what it took the question to mean — so a reader
 *      who meant something else sees it at once.
 *   2. It says which accounts the figure is on, and names every account that was left
 *      out, with what that account has on record and why it could not be included. An
 *      account is never silently priced at $0.
 *   3. The one assumption the figure rests on is printed with it.
 *
 * Pure: no I/O, no clock (`today` is passed in). Money is formatted here because an
 * answer's sentences are the UI boundary for Ask, as in `answer.ts`.
 */
import { addMonthsToMonthKey, daysBetween, monthKey, type ISODate } from '@/lib/dates';
import { formatCents, type Cents } from '@/lib/money';
import { handoverDayAnswerNote, handoverDayUncountedNote } from '@/lib/engine/glass-box/category-breakdown';
import type {
  AccountQuestion,
  LeftOutReason,
  Refusal,
  SameAccountAverage,
  SameAccountComparison,
} from '@/lib/engine/analyst/same-account';
import type { SpendFigure } from '@/lib/engine/analyst/spend-figure';
import { analystMonthLabel } from './analyst-grammar';
import { humanDate, type AssistantAccountQuestion, type AssistantAnswer, type AssistantFact } from './answer';

const fmt = (n: number) => formatCents(n as Cents);
const signed = (n: number) => formatCents(n as Cents, { signDisplay: 'always' });

/** How many questions an answer asks at once. The largest accounts come first. */
export const MAX_ACCOUNT_QUESTIONS = 3;
/** How many groups / left-out accounts an answer lists as facts. */
const MAX_DRIVER_FACTS = 4;
const MAX_LEFT_OUT = 3;
/** Fewer finished days than this, and a day-for-day comparison says it is a small sample. */
const SMALL_SAMPLE_DAYS = 7;
/** A month that ended this recently can still receive charges that post late. */
const LATE_POSTING_DAYS = 5;

const BASIS = "Purchases only — transfers and income are excluded. It assumes each account's record has no gaps between its first and last transaction.";

export function accountQuestionView(q: AccountQuestion): AssistantAccountQuestion {
  const on = humanDate(q.date);
  return q.edge === 'end'
    ? {
        accountId: q.accountId,
        edge: 'end',
        date: q.date,
        // Asked so that a card still in use can be answered truthfully too ("nothing since"),
        // which is all the rule needs: a later row voids the answer (critic cycle 2, P2-8).
        prompt: `Is ${on} the last time ${q.accountName} was used? That is its last transaction on record.`,
        yesLabel: 'Yes, nothing since',
        noLabel: 'No, there is more',
      }
    : {
        accountId: q.accountId,
        edge: 'start',
        date: q.date,
        prompt: `Is ${on} when you opened ${q.accountName}? That is its first transaction on record.`,
        yesLabel: 'Yes, that is when it began',
        noLabel: 'No, I had it before',
      };
}

function reasonText(r: LeftOutReason): string {
  if (r.edge === 'empty') return 'no transactions on record yet';
  if (r.edge === 'gap') {
    const span = r.from === r.to ? `on ${humanDate(r.from)}` : `from ${humanDate(r.from)} to ${humanDate(r.to)}`;
    if (r.dropped) {
      return `nothing counted ${span} — those days of ${r.before}'s record stopped counting when it was combined with another account`;
    }
    return `nothing on record ${span}, between ${r.before} and ${r.after}${
      r.told ? ', and you told us some of it is missing' : ''
    }`;
  }
  if (r.edge === 'start') {
    return `its records start ${humanDate(r.date)}${r.told ? ', and you told us you had it before then' : ''}`;
  }
  const through = humanDate(r.through);
  if (r.feed === 'failing') return `its bank connection is not updating — on record through ${through}`;
  if (r.feed === 'live') return `its bank connection has updated only through ${through} so far`;
  return `nothing on record after ${through}${r.told ? ', and you told us there is more' : ''}`;
}

const reasonsText = (reasons: readonly LeftOutReason[]) => reasons.map(reasonText).join('; ');

const accountsPhrase = (n: number) => `${n} account${n === 1 ? '' : 's'}`;

/** "on all 3 accounts you spend from" — or, for one, "on the 1 account you spend from". */
const allAccountsPhrase = (n: number) => (n === 1 ? 'on the 1 account you spend from' : `on all ${n} accounts you spend from`);

/**
 * The headline's own scope when any account is left out: a figure on some accounts must
 * not read as the reader's total, which Ask's one-month answer and Reports print.
 */
const headlineScope = (included: number, leftOut: number) =>
  leftOut === 0 ? '' : `On the ${accountsPhrase(included)} with complete records, `;

/** Sentence-start capital for a headline that may or may not open with its scope. */
const opening = (scope: string, rest: string) => (scope ? scope + rest : rest.charAt(0).toUpperCase() + rest.slice(1));

function latePostingNote(endOfLatest: ISODate, label: string, today: ISODate): string | null {
  const days = daysBetween(endOfLatest, today);
  if (days < 1 || days > LATE_POSTING_DAYS) return null;
  return `${label} ended ${days === 1 ? 'yesterday' : `${days} days ago`} — charges that post late can still land in it.`;
}

function handKeptNote(names: readonly string[]): string | null {
  if (names.length === 0) return null;
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `${list} ${names.length === 1 ? 'is' : 'are'} kept by hand, so ${names.length === 1 ? 'its' : 'their'} part of this counts what has been entered.`;
}

const join = (parts: readonly (string | null | undefined | false)[]) =>
  parts.filter((p): p is string => typeof p === 'string' && p.length > 0).join(' ');

function refusalAnswer(kind: 'spend_compare' | 'spend_average', refusal: Refusal, months: readonly string[]): AssistantAnswer {
  const headline =
    refusal === 'unfinished'
      ? kind === 'spend_average'
        ? `I can only average months that have finished, and ${months.length > 0 ? analystMonthLabel(months[0]!) : 'that month'} is still in progress.`
        : `${months.length > 0 ? analystMonthLabel(months[0]!) : 'That month'} has no finished day yet — from tomorrow I can compare it day for day.`
      : refusal === 'overlap'
        ? 'Those are the same month — name two different months and I will compare them.'
        : refusal === 'too-few'
          ? 'An average needs at least two finished months.'
          : 'I could not read those months as a range.';
  return { kind, headline, facts: [] };
}

// ── Compare ──────────────────────────────────────────────────────────────────────────

export function answerSpendCompare(input: {
  result: SameAccountComparison<SpendFigure>;
  currentYm: string;
  baselineYm: string;
  /**
   * Set when one month is still in progress and the answer compares the first this-many
   * days of each (`comparisonPeriods`). Absent / null = two whole months.
   */
  soFarDays?: number | null;
  /** Null = all spending. */
  targetLabel: string | null;
  today: ISODate;
}): AssistantAnswer {
  const { result, currentYm, baselineYm, targetLabel, today } = input;
  const soFar = input.soFarDays ?? null;
  const firstDays = (ym: string) =>
    soFar === null ? analystMonthLabel(ym) : `the first ${soFar === 1 ? 'day' : `${soFar} days`} of ${analystMonthLabel(ym)}`;
  const cur = firstDays(currentYm);
  const base = firstDays(baselineYm);
  // "in May 2026", "in the first 9 days of June 2026", "on the first day of June 2026".
  const inCur = `${soFar === 1 ? 'on' : 'in'} ${cur}`;
  const inBase = `${soFar === 1 ? 'on' : 'in'} ${base}`;
  const both = soFar === null ? 'both months' : 'both periods';
  if (!result.ok) {
    // The month in progress is whichever of the two is later.
    return refusalAnswer('spend_compare', result.refusal, [currentYm > baselineYm ? currentYm : baselineYm]);
  }

  const on = targetLabel ? ` on ${targetLabel}` : '';
  const what = targetLabel ? `${targetLabel} spending` : 'All spending';
  // Asked only where answering could change the figure: an account with nothing on record
  // in either month would come in at $0 whatever the reader says.
  // Only accounts the sentence names: one folded into "and N more" is not asked about by name.
  const questions = result.leftOut
    .slice(0, MAX_LEFT_OUT)
    .filter((a) => a.rowsInPeriods > 0)
    .flatMap((a) => a.questions)
    .slice(0, MAX_ACCOUNT_QUESTIONS)
    .map(accountQuestionView);
  // Each account left out is named with what it has on record and why it is out. In the
  // sentence, not as a fact row: a fact row is a label and a FIGURE, and a reason does not
  // fit in a figure's place on a phone (it ran off the screen and pushed the page sideways).
  const named = result.leftOut.slice(0, MAX_LEFT_OUT);
  const more = result.leftOut.length - named.length;
  const onRecord = (a: (typeof named)[number]) =>
    a.rowsInPeriods === 0
      ? `no spending${on} on record in either month`
      : `${fmt(a.currentCents)} ${inCur}, ${fmt(a.baselineCents)} ${inBase}`;
  const leftOutSentence =
    named.length === 0
      ? null
      : `Left out of ${both}, because their records do not cover both: ${named
          .map((a) => `${a.name} (${onRecord(a)}; ${reasonsText(a.reasons)})`)
          .join('; ')}${more > 0 ? `; and ${more} more` : ''}.`;

  if (result.included.length === 0) {
    return {
      kind: 'spend_compare',
      headline: `I can't compare ${cur} with ${base} yet — no account has complete records for ${both}.`,
      detail: join([`Reading: ${what}, ${cur} against ${base}.`, leftOutSentence]),
      facts: [],
      ...(questions.length > 0 ? { accountQuestions: questions } : {}),
    };
  }

  const { currentCents, baselineCents, deltaCents, percent } = result;
  const lead = headlineScope(result.included.length, result.leftOut.length);
  let headline: string;
  if (currentCents === 0 && baselineCents === 0) {
    headline = opening(lead, soFar === null ? `no spending${on} in ${cur} or ${base}.` : `no spending${on} ${inCur} or ${inBase}.`);
  } else if (deltaCents === 0) {
    headline = opening(lead, `you spent ${fmt(currentCents)}${on} ${inCur} — the same as ${inBase}.`);
  } else {
    const direction = deltaCents > 0 ? 'more' : 'less';
    headline = opening(lead, `you spent ${fmt(currentCents)}${on} ${inCur} — ${fmt(Math.abs(deltaCents))} ${direction} than ${inBase} (${fmt(baselineCents)}).`);
    if (percent !== null && percent !== 0) headline += ` That is ${Math.abs(percent)}% ${deltaCents > 0 ? 'higher' : 'lower'}.`;
  }

  const scope =
    result.leftOut.length === 0
      ? allAccountsPhrase(result.included.length)
      : `on the ${accountsPhrase(result.included.length)} with complete records for ${both}`;
  const handovers = result.currentFigure.countedOnHandoverDays + result.baselineFigure.countedOnHandoverDays;
  const uncounted = result.currentFigure.uncountedOnHandoverDays + result.baselineFigure.uncountedOnHandoverDays;
  const laterYm = currentYm > baselineYm ? currentYm : baselineYm;
  const laterEnd = currentYm > baselineYm ? result.current.end : result.baseline.end;
  // Mid-month: say what is being compared, and that the newest days can still grow.
  const soFarNote =
    soFar === null
      ? null
      : `${analystMonthLabel(laterYm)} is not over, so this compares its first ${soFar === 1 ? 'day' : `${soFar} days`} with the same ${soFar === 1 ? 'day' : 'days'} of ${analystMonthLabel(laterYm === currentYm ? baselineYm : currentYm)}. Charges from the last few days can still post.${
          soFar === 1
            ? ' A single day is a small sample — one purchase can swing it.'
            : soFar < SMALL_SAMPLE_DAYS
              ? ' A few days is a small sample — one large purchase can swing it.'
              : ''
        }`;

  // The groups behind the change — only when there is more than one, and only those that moved.
  const moved = result.drivers.filter((d) => d.deltaCents !== 0);
  const driverFacts: AssistantFact[] =
    result.drivers.length > 1
      ? moved.slice(0, MAX_DRIVER_FACTS).map((d) => ({
          // The figure in the figure's place; its two months in the label, which can wrap.
          label: `${d.label} (${fmt(d.currentCents)} vs ${fmt(d.baselineCents)})`,
          value: signed(d.deltaCents),
        }))
      : [];

  return {
    kind: 'spend_compare',
    headline,
    detail: join([
      `Reading: ${what}, ${cur} against ${base}, ${scope}.`,
      BASIS,
      soFarNote,
      leftOutSentence,
      handKeptNote(result.included.filter((a) => a.handKept).map((a) => a.name)),
      soFar === null ? latePostingNote(laterEnd, analystMonthLabel(laterYm), today) : null,
      handovers > 0 ? handoverDayAnswerNote(handovers) : null,
      uncounted > 0 ? handoverDayUncountedNote(uncounted, targetLabel ?? undefined) : null,
    ]),
    facts: driverFacts,
    ...(questions.length > 0 ? { accountQuestions: questions } : {}),
  };
}

// ── Average ──────────────────────────────────────────────────────────────────────────

export function answerSpendAverage(input: {
  result: SameAccountAverage<SpendFigure>;
  fromYm: string;
  toYm: string;
  months: number;
  targetLabel: string | null;
  today: ISODate;
}): AssistantAnswer {
  const { result, fromYm, toYm, months, targetLabel, today } = input;
  if (!result.ok) return refusalAnswer('spend_average', result.refusal, [toYm]);
  // "the last N months" only while it is: an answer re-asked later (a follow-up, an account
  // question answered next month) keeps its months and must not claim they are the latest.
  const latest = toYm === addMonthsToMonthKey(monthKey(today), -1);

  const range = `${analystMonthLabel(fromYm)} to ${analystMonthLabel(toYm)}`;
  const on = targetLabel ? ` on ${targetLabel}` : '';
  const what = targetLabel ? `${targetLabel} spending` : 'All spending';
  const questions = result.leftOut
    .slice(0, MAX_LEFT_OUT)
    .filter((a) => a.rowsInPeriods > 0)
    .flatMap((a) => a.questions)
    .slice(0, MAX_ACCOUNT_QUESTIONS)
    .map(accountQuestionView);
  const named = result.leftOut.slice(0, MAX_LEFT_OUT);
  const more = result.leftOut.length - named.length;
  const leftOutSentence =
    named.length === 0
      ? null
      : `Left out, because their records do not cover all ${months} months: ${named
          .map(
            (a) =>
              `${a.name} (${a.rowsInPeriods === 0 ? `no spending${on} on record` : `${fmt(a.totalCents)} on record`} across these months; ${reasonsText(a.reasons)})`,
          )
          .join('; ')}${more > 0 ? `; and ${more} more` : ''}.`;

  if (result.included.length === 0) {
    return {
      kind: 'spend_average',
      headline: `I can't average ${range} yet — no account has complete records for all ${months} months.`,
      detail: join([`Reading: ${what}, the monthly average over ${range}.`, leftOutSentence]),
      facts: [],
      ...(questions.length > 0 ? { accountQuestions: questions } : {}),
    };
  }

  const scope =
    result.leftOut.length === 0
      ? allAccountsPhrase(result.included.length)
      : `on the ${accountsPhrase(result.included.length)} with complete records for all ${months} months`;
  const lead = headlineScope(result.included.length, result.leftOut.length);
  const handovers = result.months.reduce((n, m) => n + m.figure.countedOnHandoverDays, 0);
  const uncounted = result.months.reduce((n, m) => n + m.figure.uncountedOnHandoverDays, 0);
  const last = result.months[result.months.length - 1]!;

  return {
    kind: 'spend_average',
    headline:
      result.totalCents === 0
        ? opening(lead, `no spending${on} from ${range}.`)
        : latest
          ? opening(lead, `you spent an average of ${fmt(result.meanCents)} a month${on} over the last ${months} months (${range}).`)
          : opening(lead, `you spent an average of ${fmt(result.meanCents)} a month${on} over the ${months} months ${range}.`),
    detail: join([
      `Reading: ${what}, the monthly average over the ${months} finished months ${range}, ${scope}.`,
      BASIS,
      leftOutSentence,
      handKeptNote(result.included.filter((a) => a.handKept).map((a) => a.name)),
      latePostingNote(last.period.end, analystMonthLabel(toYm), today),
      handovers > 0 ? handoverDayAnswerNote(handovers) : null,
      uncounted > 0 ? handoverDayUncountedNote(uncounted, targetLabel ?? undefined) : null,
    ]),
    facts: [
      ...result.months.map((m) => ({ label: analystMonthLabel(m.period.start.slice(0, 7)), value: fmt(m.cents) })),
    ],
    ...(questions.length > 0 ? { accountQuestions: questions } : {}),
  };
}
