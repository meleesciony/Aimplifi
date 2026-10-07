/**
 * Contextual follow-up chips for Ask answers (TASKS 1.2 / DECISIONS #197).
 *
 * Pure, static intent → full NL question strings. No new parsing: every chip is
 * a complete question the existing `parseAssistantQuery` already routes. The UI
 * re-submits via the same `pick()` → `askAssistant()` path as empty-state chips.
 *
 * `unknown` returns [] — the answer formatter already attaches ASSISTANT_SUGGESTIONS.
 */
import { addMonthsToMonthKey, isoDate, monthKey, type ISODate } from '@/lib/dates';
import {
  analystIntent,
  analystIntentText,
  parseAssistantQuery,
  type AssistantIntent,
  type SpendTarget,
  type Timeframe,
} from '@/lib/engine/assistant/intent';

const MAX_CHIPS = 3;

type AnalystIntent = Extract<AssistantIntent, { kind: 'spend_compare' | 'spend_average' }>;

/** Any date after every month a chip can name: reading a chip back must not depend on today. */
const AFTER_EVERYTHING = isoDate('9999-12-31');

/**
 * The sentence a comparison button sends — or null when that sentence would not read
 * back as the same question.
 *
 * A button's text goes through the parser like anything typed, so a button is only
 * offered once its own text has been read back to exactly the intent it stands for.
 * (A category the grammar cannot name back from its label — a custom category, here,
 * since this module is not given the reader's own list — simply gets no such button.)
 */
/** The reader's own category words — what the server reads a tapped chip with. */
type Vocabulary = readonly { id: string; name: string }[];

function analystChip(intent: AnalystIntent, today?: ISODate, vocab: Vocabulary = []): string | null {
  if (today && !answerable(intent, today)) return null;
  const text = analystIntentText(intent);
  // Read back the way the server will read the tap: with the reader's own words (critic
  // cycle 2, N2 — a reader who renamed Groceries "Food" tapped "…Food Delivery…" into Groceries).
  const back = analystIntent(text, today ?? AFTER_EVERYTHING, vocab);
  return back && JSON.stringify(back) === JSON.stringify(intent) ? text : null;
}

/**
 * "How much did I spend on <label> last month?" — only when that sentence is read back as
 * the same subject. A group's label can be read as one of its categories ("bills &
 * utilities" → Utilities), and a chip under an answer about one subject must not answer
 * another (critic cycle 2, N2).
 */
function lastMonthChip(target: SpendTarget | null, today: ISODate | undefined, vocab: Vocabulary): string | null {
  if (!target) return 'How much did I spend last month?';
  const text = `How much did I spend on ${target.label} last month?`;
  const back = parseAssistantQuery(text, today ?? AFTER_EVERYTHING, vocab);
  return back.kind === 'spend_by_category' && JSON.stringify(back.target) === JSON.stringify(target) ? text : null;
}

/**
 * Whether the app would ANSWER this today rather than refuse it — a button that leads to
 * a refusal (and offers itself again) is a dead end. A comparison may include the month
 * in progress once one day of it has finished (it is then compared day for day); an
 * average takes finished months only.
 */
function answerable(intent: AnalystIntent, today: ISODate): boolean {
  const nowYm = monthKey(today);
  if (intent.kind === 'spend_average') return intent.toYm < nowYm;
  if (intent.currentYm === intent.baselineYm || intent.currentYm > nowYm || intent.baselineYm > nowYm) return false;
  const touchesNow = intent.currentYm === nowYm || intent.baselineYm === nowYm;
  return !touchesNow || Number(today.slice(8, 10)) >= 2;
}

/**
 * "Compare this with the month before" for an answer about one calendar month. For the
 * month in progress — which a comparison answers day for day, but which reads best against
 * a whole month — it offers the two finished months behind it instead.
 */
function compareChip(tf: Timeframe, target: SpendTarget | null, today?: ISODate, vocab: Vocabulary = []): string | null {
  if (tf.fromYm !== tf.toYm) return null;
  const currentYm = tf.label === 'this month' ? addMonthsToMonthKey(tf.fromYm, -1) : tf.fromYm;
  return analystChip({ kind: 'spend_compare', currentYm, baselineYm: addMonthsToMonthKey(currentYm, -1), target }, today, vocab);
}

function flipTimeframeLabel(label: string): string {
  if (label === 'this month') return 'last month';
  if (label === 'last month') return 'this month';
  return 'this month';
}

/**
 * "Average over the last six months" — which means the six FINISHED months before
 * today, so it can only be offered by a caller that says what today is.
 */
function averageChip(target: SpendTarget | null, today?: ISODate, vocab: Vocabulary = []): string | null {
  if (!today) return null;
  const toYm = addMonthsToMonthKey(monthKey(today), -1);
  return analystChip({ kind: 'spend_average', fromYm: addMonthsToMonthKey(toYm, -5), toYm, months: 6, target }, today, vocab);
}

/** Up to three follow-up question strings for a resolved intent. */
export function followUpQuestions(intent: AssistantIntent, today?: ISODate, vocab: Vocabulary = []): readonly string[] {
  switch (intent.kind) {
    case 'unknown':
      return [];

    case 'spend_total': {
      const other = flipTimeframeLabel(intent.timeframe.label);
      return take([
        `How much did I spend ${other}?`,
        `What were my top spending categories ${intent.timeframe.label}?`,
        // A one-month figure invites "against what?" — the comparison is one tap away.
        compareChip(intent.timeframe, null, today, vocab) ?? `What was my biggest purchase ${intent.timeframe.label}?`,
      ]);
    }

    case 'spend_by_category': {
      const other = flipTimeframeLabel(intent.timeframe.label);
      return take([
        `How much did I spend on ${intent.target.label} ${other}?`,
        `What were my top spending categories ${intent.timeframe.label}?`,
        compareChip(intent.timeframe, intent.target, today, vocab) ?? `What was my biggest purchase ${intent.timeframe.label}?`,
      ]);
    }

    case 'spend_compare': {
      const nowYm = today ? monthKey(today) : null;
      // On the 1st the month just begun cannot be compared yet; offer the two finished
      // months behind it instead of a dead end (critic cycle 2, P2).
      const fallback =
        today && !answerable(intent, today) && nowYm && (intent.currentYm === nowYm || intent.baselineYm === nowYm)
          ? analystChip(
              { kind: 'spend_compare', currentYm: addMonthsToMonthKey(nowYm, -1), baselineYm: addMonthsToMonthKey(nowYm, -2), target: intent.target },
              today,
              vocab,
            )
          : null;
      return take(
        [
          fallback,
          // The same month a year earlier — the comparison a season-shaped category wants —
          // unless that is the comparison just answered.
          intent.baselineYm === addMonthsToMonthKey(intent.currentYm, -12)
            ? null
            : analystChip({ ...intent, baselineYm: addMonthsToMonthKey(intent.currentYm, -12) }, today, vocab),
          averageChip(intent.target, today, vocab),
          lastMonthChip(intent.target, today, vocab),
          'What were my top spending categories last month?',
        ].filter((c): c is string => c !== null),
      );
    }

    case 'spend_average': {
      return take(
        [
          analystChip(
            {
              kind: 'spend_compare',
              currentYm: intent.toYm,
              baselineYm: addMonthsToMonthKey(intent.toYm, -1),
              target: intent.target,
            },
            today,
            vocab,
          ),
          lastMonthChip(intent.target, today, vocab),
          'What were my top spending categories last month?',
        ].filter((c): c is string => c !== null),
      );
    }

    case 'merchant_spend': {
      const other = flipTimeframeLabel(intent.timeframe.label);
      // Title-case the cleaned merchant for a natural chip (parser is case-insensitive).
      const merchant = titleCase(intent.merchant);
      return take([
        `How much did I spend at ${merchant} ${other}?`,
        `What were my top spending categories ${intent.timeframe.label}?`,
        `What was my biggest purchase ${intent.timeframe.label}?`,
      ]);
    }

    case 'top_categories':
      return take([
        `How much did I spend ${intent.timeframe.label}?`,
        `What was my biggest purchase ${intent.timeframe.label}?`,
        'How much did I spend on groceries this month?',
      ]);

    case 'largest_purchases':
      return take([
        `How much did I spend ${intent.timeframe.label}?`,
        `What were my top spending categories ${intent.timeframe.label}?`,
        'How much did I spend at Costco this month?',
      ]);

    case 'income':
      return take([
        "What's my savings rate?",
        'How much did I spend this month?',
        'What is my net worth?',
      ]);

    case 'net_worth':
      return take([
        'How much did I spend this month?',
        "What's my savings rate?",
        'How much is guilt-free to spend this month?',
      ]);

    case 'account_balance':
      return take([
        'What is my net worth?',
        'How much is guilt-free to spend this month?',
        'How much do I need to pay my cards?',
      ]);

    case 'safe_to_spend':
      return take([
        'How much did I spend this month?',
        'What were my top spending categories this month?',
        'What is my net worth?',
      ]);

    case 'cash_needed':
      return take([
        'Will I run out of money in the next 90 days?',
        'How much is guilt-free to spend this month?',
        'When will I be debt-free?',
      ]);

    case 'debt_payoff':
      return take([
        'Can I be debt-free by December 2028?',
        'How much do I need to pay my cards?',
        'What is my net worth?',
      ]);

    case 'debt_free_by_date':
      return take([
        'When will I be debt-free?',
        'How much is guilt-free to spend this month?',
        'What is my net worth?',
      ]);

    case 'savings_goal_by_date':
      return take([
        intent.targetCents == null
          ? 'Can I save $20,000 by December 2028?'
          : "What's my savings rate?",
        'How much is guilt-free to spend this month?',
        'What is my net worth?',
      ]);

    case 'goal_status':
      return take([
        "What's my savings rate?",
        'How much is guilt-free to spend this month?',
        'What is my net worth?',
      ]);

    case 'retire_at_age':
      return take([
        'Can I retire at 60?',
        'When can I retire?',
        "What's my savings rate?",
      ]);

    case 'fi_status':
      return take([
        'Can I retire at 60?',
        "What's my savings rate?",
        'What should I cut?',
      ]);

    case 'wealth_target':
      return take([
        'Can I save $20,000 by December 2028?',
        "What's my savings rate?",
        'What is my net worth?',
      ]);

    case 'subscriptions':
      return take([
        'How much did I spend this month?',
        'How much is guilt-free to spend this month?',
        'Will I run out of money in the next 90 days?',
      ]);

    case 'what_to_cut':
      return take([
        'What subscriptions am I paying for?',
        "What's my savings rate?",
        'How much is guilt-free to spend this month?',
      ]);

    case 'lifestyle_creep':
      return take([
        'What should I cut?',
        "What's my savings rate?",
        'How much is guilt-free to spend this month?',
      ]);

    case 'runway':
      return take([
        "What's my savings rate?",
        'Will I run out of money in the next 90 days?',
        'How much is guilt-free to spend this month?',
      ]);

    case 'conscious_spending':
      return take([
        'How much is guilt-free to spend this month?',
        "What's my savings rate?",
        'What should I cut?',
      ]);

    case 'stay_wealthy':
      return take([
        'How many months of runway do I have?',
        'Is my lifestyle creeping?',
        'When can I retire?',
      ]);

    case 'rich_life':
      // Every chip must parse non-unknown (the follow-ups test's hard gate) —
      // these three all route.
      return take(['When can I retire?', 'Am I staying wealthy?', 'What should I cut?']);

    case 'next_dollar':
      return take([
        'When will I be debt-free?',
        'How many months of runway do I have?',
        'When can I retire?',
      ]);

    case 'forecast':
      return take([
        'How much do I need to pay my cards?',
        'How much is guilt-free to spend this month?',
        'What subscriptions am I paying for?',
      ]);

    case 'cash_flow_radar':
      return take([
        'How much do I need to pay my cards?',
        'How much is guilt-free to spend this month?',
        "What's my cash flow forecast?",
      ]);

    case 'savings_rate': {
      // #796: the other common period one tap away, then where the money goes and
      // what to cut — never a chip naming a period the answer may have found empty.
      const tf = intent.timeframe;
      const calendarYear = !!tf && tf.fromYm.endsWith('-01') && tf.toYm.endsWith('-12') && tf.fromYm.slice(0, 4) === tf.toYm.slice(0, 4);
      return take([
        calendarYear ? 'What was my savings rate over the last 12 months?' : 'What was my savings rate last year?',
        'Where does my money go?',
        'What should I cut?',
      ]);
    }
  }
}

function take(chips: string[]): readonly string[] {
  return chips.slice(0, MAX_CHIPS);
}

function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}
