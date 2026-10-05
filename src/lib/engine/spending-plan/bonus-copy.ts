/**
 * The bonus line's words (DECISIONS #784/#787) — ONE author for every surface
 * that states it: the Guilt-free page and its glass box, Ask, the Home card, and
 * the /budgets card and strip (the tax-copy.ts precedent; L.23: two surfaces
 * describing one fact drift).
 *
 * Copy guardrails: educational, not advisory. Every amount printed is a deposit
 * or the plan's own arithmetic. What is left after savings is named as the
 * reader's to decide, with the usual uses listed and none recommended. The one
 * assumption the credit rests on — the deposit has not already gone elsewhere
 * — is stated inline. The rule is stated in the code's own terms. Never a
 * lever that files pay as Bonus: two such filings teach a rule that files the
 * payer's next paycheck as Bonus too (#787 critic cycle 1, P1-1).
 *
 * DIRECTION (cycle 1, P2-1): every sentence follows the plan's own state — in
 * an over-plan month the credit makes the overage smaller, it does not make
 * guilt-free "higher", and the leftover's first use named is the overage.
 */
import { cents, formatCents } from '@/lib/money';
import { formatISODate } from '@/lib/dates';
import type { SpendingPlan } from '@/lib/engine/spending-plan/plan';
import type { BonusDeposit } from '@/lib/engine/spending-plan/bonus';

/** The plan row that adds the bonus credit back to guilt-free. */
export const BONUS_ROW_LABEL = 'Bonus this month, toward savings first';

const fmt = (n: number) => formatCents(cents(n));

function depositPhrase(d: BonusDeposit, categoryName: string): string {
  const day = formatISODate(d.date);
  switch (d.kind) {
    case 'filed':
      if (d.depositCents < 0) return `${day}: ${fmt(-d.depositCents)} filed ${categoryName}, taken back`;
      return d.paycheckCents === null
        ? `${day}: ${fmt(d.depositCents)} filed ${categoryName}`
        : `${day}: ${fmt(d.depositCents)} filed ${categoryName} from the payer of your regular paycheck, counted only above its usual ${fmt(d.paycheckCents)} because no paycheck has landed after it yet`;
    case 'above-paycheck':
      return `${day}: ${fmt(d.depositCents)} from the payer of your regular paycheck, ${fmt(d.bonusCents)} more than its usual ${fmt(d.paycheckCents ?? 0)}`;
    case 'taken-back':
      return `${day}: ${fmt(-d.depositCents)} taken back by the same payer`;
  }
}

/** Why a basis other than regular pay counts none of it — each clause true of
 *  that basis for every reader on it. */
function notCountedClause(plan: SpendingPlan): string {
  switch (plan.incomeBasis) {
    case 'trailing-median':
      return `income right now is the median of your last ${plan.incomeMonths} complete month${plan.incomeMonths === 1 ? '' : 's'}, and those months can already include bonus pay`;
    case 'user-set':
      return 'income is the monthly figure you set, which may already include bonus pay';
    case 'detected-series':
      return 'income is your detected recurring income, which can include a bonus that repeats';
    default:
      return 'there is no income figure yet';
  }
}

/**
 * The full sentence: what landed, what it did to this month's plan, and the
 * rule. Null when no bonus money landed this month — a month with no bonus has
 * nothing to say here.
 */
export function bonusSentence(plan: SpendingPlan): string | null {
  const b = plan.bonusesThisMonth;
  if (!b || b.deposits.length === 0) return null;
  const items = b.deposits.map((d) => depositPhrase(d, b.categoryName));
  // A month whose only rows are money taken back had no bonus land in it.
  const lead = b.deposits.some((d) => d.bonusCents > 0 || (d.kind === 'filed' && d.depositCents > 0))
    ? 'Bonus money landed this month'
    : 'A bonus was taken back this month';
  const landed =
    items.length === 1 ? `${lead} — ${items[0]}.` : `${lead} — ${items.join('; ')}: ${fmt(b.netCents)} in all.`;
  const what = ` Counted as bonus money, in the account your income figure reads: deposits filed ${b.categoryName}, and — once a paycheck has landed after it — a day the payer of your regular paycheck deposits more than one and a half paychecks, for the part above one paycheck; money the same payer takes back nets against it.`;
  if (b.totalCents <= 0) return `${landed}${what} It nets to ${fmt(b.netCents)}, so none of it is counted here.`;

  const over = plan.overspent;
  const uses = over
    ? 'covering this month’s overage, more savings or investing, or money put aside for taxes'
    : 'more savings or investing, money put aside for taxes, or something you have been wanting';
  const yours = `it is yours to decide: ${uses}.`;

  if (plan.incomeBasis !== 'regular-pay') {
    return `${landed}${what} A bonus never plans the month, and it pays this month's savings first only while income is your regular pay, which leaves every bonus out; ${notCountedClause(plan)}, so none of it is counted here.`;
  }
  const credit = plan.bonusTowardSavingsCents;
  if (credit === 0) {
    return `${landed}${what} A bonus never plans the month; it pays this month's savings first, and this plan has no savings planned this month, so none of it is counted here — ${yours}`;
  }
  const covers =
    credit === plan.plannedSavingsCents
      ? `all ${fmt(plan.plannedSavingsCents)} of this month's planned savings`
      : `${fmt(credit)} of this month's ${fmt(plan.plannedSavingsCents)} planned savings`;
  const effect = over
    ? `so this month's overage is ${fmt(credit)} smaller than your pay alone would make it`
    : `so guilt-free this month is ${fmt(credit)} higher than your pay alone allows`;
  const rest = b.totalCents - credit;
  return `${landed}${what} A bonus never plans the month — it pays this month's savings first: it covers ${covers}, ${effect}.${rest > 0 ? ` The other ${fmt(rest)} is not counted anywhere in this plan — ${yours}` : ''} This reads the deposits, not where the money went after it landed.`;
}

/**
 * The short form for a surface that prints the guilt-free figure without its
 * breakdown (Home, the /budgets card and strip, Ask's split). Null unless a
 * bonus actually moved this month's figure — a sentence about a credit that did
 * not happen would qualify nothing.
 */
export function bonusShortNote(plan: SpendingPlan): string | null {
  const credit = plan.bonusTowardSavingsCents;
  if (credit <= 0) return null;
  return plan.overspent
    ? `This month's bonus paid ${fmt(credit)} of your savings, so the overage is ${fmt(credit)} smaller than your pay alone would make it.`
    : `This month's bonus paid ${fmt(credit)} of your savings, so guilt-free is ${fmt(credit)} higher than your pay alone allows.`;
}

/**
 * The name of the figure a planner reads (DECISIONS #787, cycle 1, P2-5). Every
 * solver reads the guilt-free figure WITHOUT this month's bonus credit; in a
 * month a bonus paid savings that is a different number from the one Home and
 * Guilt-free print, so the planners say which one they mean.
 */
export function plannerGuiltFreeNoun(bonusMonth: boolean): string {
  return bonusMonth ? 'guilt-free spending from pay' : 'guilt-free spending';
}
