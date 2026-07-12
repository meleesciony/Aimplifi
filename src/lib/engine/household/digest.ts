/**
 * Joint household digest — the shared-account movement summary (TASKS 4.2
 * slice 7, HOUSEHOLD_ARCHITECTURE §5.7 / DECISIONS #201(2)). PURE, no I/O.
 *
 * This is the ONE section of the digest that is symmetric across the household:
 * it is computed over the accounts household members have EXPLICITLY shared, so
 * both partners' emails carry the identical set. (The dues section is
 * viewer-relative by §4.4's definition of household scope — "your accounts and
 * accounts your partner has shared" — and the Money Review stays personal per
 * §4.5. See DECISIONS #220 for why a byte-identical joint email is not
 * constructible without either leaking a private account (T1) or dropping a
 * member's own payment reminders.)
 *
 * Deliberately DESCRIPTIVE, never evaluative: a count and the two totals, with
 * no merchant, no partner attribution, and no comparison to a budget or to last
 * week. §4.5's relational-shame guardrail is enforced by scope, and here also by
 * saying nothing a partner could read as a verdict on the other's spending.
 */
import { compareDates, type ISODate } from '@/lib/dates';
import { cents, type Cents } from '@/lib/money';

/** The minimum a transaction row must expose to be summarized (DB row or fixture). */
export interface MovementRow {
  date: ISODate;
  amountCents: number;
  isTransfer: boolean;
  /** PENDING | POSTED — only POSTED rows are money that actually moved. */
  status: string;
  /** The container row left behind by a split: excluded from ALL sums (its children carry the money). */
  isSplitParent: boolean;
}

export interface SharedMovementSummary {
  /** Shared SPENDING accounts across the household (mine + partners'), post
   *  currency guard — the tally set. NOT all shared accounts: a shared loan is
   *  counted for dues but has no movement here (slice-8 critic F-4 — the old
   *  comment claimed all types and misled a consumer into "nothing is shared"). */
  accountCount: number;
  /** Non-transfer rows inside the window (transfers are neither spend nor income). */
  transactionCount: number;
  /** Sum of outflows in the window, positive-signed. */
  outflowCents: Cents;
  /** Sum of inflows in the window. */
  inflowCents: Cents;
}

/**
 * Summarize movement on the household's shared accounts over an INCLUSIVE
 * [since, today] window.
 *
 * The exclusion set is the SAME one every other money surface uses (coach.ts,
 * radar.ts, engine/transactions/query.ts), so a shared-account total here can
 * never disagree with what the register shows for those accounts:
 *   - transfers are neither spend nor income,
 *   - a split PARENT is a container (its children carry the money — counting
 *     both double-counts),
 *   - PENDING is not money that has moved (and its amount can still change).
 */
export function summarizeSharedMovement(input: {
  rows: readonly MovementRow[];
  accountCount: number;
  since: ISODate;
  today: ISODate;
}): SharedMovementSummary {
  const { rows, accountCount, since, today } = input;

  let transactionCount = 0;
  let outflow = 0;
  let inflow = 0;

  for (const r of rows) {
    if (compareDates(r.date, since) < 0 || compareDates(r.date, today) > 0) continue;
    if (r.isTransfer || r.isSplitParent || r.status !== 'POSTED') continue;
    transactionCount += 1;
    if (r.amountCents < 0) outflow += -r.amountCents;
    else inflow += r.amountCents;
  }

  return {
    accountCount,
    transactionCount,
    outflowCents: cents(outflow),
    inflowCents: cents(inflow),
  };
}
