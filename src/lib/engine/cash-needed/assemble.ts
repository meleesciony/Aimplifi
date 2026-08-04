/**
 * Assembles a CashNeededInput snapshot from data-layer rows (Prisma rows or
 * the pure seed dataset — both satisfy these structural types). Pure: no I/O.
 *
 * Rules:
 *  - A card's CURRENT statement is its most recent statement whose issuer due
 *    date is on/after `today`. If none exists, the statement hasn't generated
 *    yet → estimate path (next close/due derived from the card's cycle days).
 *  - Pending transactions on the payment account feed the projection once.
 *  - Scheduled rows are expanded into dated occurrences within [today, today+60d].
 */

import { type Cents, cents } from '@/lib/money';
import { type ISODate, addDays, addMonthsClamped, compareDates, isoDate, nextDayOfMonth } from '@/lib/dates';
import { accountLabel } from '@/lib/engine/account/display-name';
import { isLiabilityType } from '@/lib/engine/transactions/query';
import { monthsPerCadence } from '@/lib/engine/recurring/detect';
import { detectCardPayments, detectedPaymentCentsForStatement } from './detected-payments';
import type { CardSnapshot, CashNeededInput, PendingTx, Scenario, ScheduledItem } from './types';

export interface AccountLike {
  id: string;
  /** The FEED's name. Every comparison reads this one — see engine/account/display-name.ts. */
  name: string;
  /**
   * `Account.provider` ('demo' | 'plaid' | 'manual' | …). Optional because
   * engine fixtures hand-build this shape and describe feed accounts; every
   * row a provider emits carries it (Prisma rows satisfy it structurally).
   * Read ONLY to mark manual cards — whose statement/balance figures are
   * reader-TYPED — for the Glass-Box provenance gate (C.11 critic P0-1).
   */
  provider?: string | null;
  /** The user's own name for this account (TASKS L.7), null/absent when he never set one.
   *  Carried on the snapshot shape itself, exactly like `feedDroppedAt` below, because the
   *  label leaves this assembler for ~20 surfaces and only the assembler can resolve it. */
  displayName?: string | null;
  type: string;
  currentBalanceCents: number;
  aprBps: number | null;
  /** Non-card LOAN/MORTGAGE fixed monthly payment. Optional: Plaid rows / older fixtures may omit it. */
  minimumPaymentCents?: number | null;
  dueDayOfMonth: number | null;
  cycleCloseDayOfMonth: number | null;
  /** YYYY-MM-DD the bank stopped sharing this account (Account.feedDroppedAt), else null. Carried
   *  on the snapshot shape itself because the frozen number flows to ~20 surfaces from here, and a
   *  surface that cannot see the flag cannot qualify the figure (TASKS L.14, critic P1-6). */
  feedDroppedAt?: string | null;
}
export interface AutopayLike {
  accountId: string;
  mode: string;
  fixedAmountCents: number | null;
}
export interface StatementLike {
  id: string;
  accountId: string;
  cycleEnd: string;
  dueDate: string;
  statementBalanceCents: number;
  minimumPaymentCents: number;
}
export interface CardPaymentLike {
  statementId: string;
  date: string;
  amountCents: number;
}
export interface TransactionLike {
  accountId: string;
  date: string;
  amountCents: number;
  rawDescriptor: string;
  status: string;
  isTransfer: boolean;
  /**
   * The three fields below are OPTIONAL and carry no weight in this assembler —
   * they exist so a snapshot consumer can NAME a row rather than only sum it
   * (the category-breakdown panels, 2026-07-31). Optional rather than required
   * because engine fixtures across the suite hand-build this shape and none of
   * them is describing a real database row; every row a provider emits carries
   * all three.
   *
   * Before this, `server/trends.ts` reached `categoryId` through a local cast
   * with a comment explaining why it had to. Declaring the field is the same
   * information written where the next reader will look for it, and that cast is
   * gone rather than joined by a second one.
   */
  id?: string;
  /** The STORED category — the bucket every spending figure sums into. */
  categoryId?: string | null;
  /**
   * The payee name the register displays, when the row was joined to its
   * merchant. Not the normalizer's output: a keyword rule's `renameTo` writes
   * `Merchant.canonical` (O.13a), so this is where a reader's own name for a
   * payee lives, and a surface that fell back to the bank text would show them
   * a name they had deliberately replaced.
   */
  merchant?: { canonical: string } | null;
  /** Container row left behind by a split — its children carry the amounts. */
  isSplitParent?: boolean;
  /**
   * O.15: carried on the snapshot row for BEHAVIORAL consumers (radar burn).
   * This assembler itself deliberately IGNORES it: pending charges and
   * post-close credits are statement reality — the card bill includes an
   * excluded row whether or not the reader wants it in their budgets, so
   * "how much do I need" must keep counting it.
   */
  excludeFromTotals?: boolean | null;
  /**
   * #397: the reader's per-row Fixed/Discretionary verdict ('fixed' |
   * 'guilt-free'); null/absent = the app's guess. Read by the spend-class
   * engine (Plan Fixed, the /budgets lists); this assembler ignores it.
   */
  spendClassOverride?: string | null;
}
export interface ScheduledLike {
  accountId: string;
  description: string;
  amountCents: number;
  nextDate: string;
  cadence: string | null;
}

export interface AssembleParams {
  today: ISODate;
  scenario: Scenario;
  paymentAccountId: string;
  accounts: AccountLike[];
  autopays: AutopayLike[];
  statements: StatementLike[];
  cardPayments: CardPaymentLike[];
  transactions: TransactionLike[];
  scheduled: ScheduledLike[];
  holidayTable: ISODate[];
  /** Projection window for expanding scheduled cadences. */
  horizonDays?: number;
}

export function assembleCashNeededInput(p: AssembleParams): CashNeededInput {
  const horizon = addDays(p.today, p.horizonDays ?? 60);
  const paymentAccount = p.accounts.find((a) => a.id === p.paymentAccountId);
  if (!paymentAccount) throw new Error(`assemble: payment account ${p.paymentAccountId} not found`);

  // Split parents are containers — counting them AND their children would
  // double-apply the amount (Hostile Critic finding F1, Phase 2 cycle 2).
  const pending: PendingTx[] = p.transactions
    .filter((t) => t.accountId === p.paymentAccountId && t.status === 'PENDING' && !t.isSplitParent)
    .map((t) => ({ amountCents: cents(t.amountCents), description: t.rawDescriptor }));

  const autopayByAccount = new Map(p.autopays.map((a) => [a.accountId, a]));

  // Mid-cycle card payments the feed can PROVE (TASKS C.6 / audit P0-1). Until
  // this existed, `CardPayment` had no production writer at all — measured, 0
  // rows on the live account — so a bill the reader had already settled kept
  // being demanded in full until the next statement issued, while the
  // checking-side debit was already counted against them. The admission rule and
  // every refusal live in detected-payments.ts; the accounts map is built from
  // the SAME list this assembler trusts, so an account filtered out upstream
  // (superseded, non-USD) cannot prove a payment.
  const accountTypeById = new Map(p.accounts.map((a) => [a.id, a.type]));
  const detectedPayments = detectCardPayments(p.transactions, accountTypeById);
  const detectedIndexes = new Set(detectedPayments.map((d) => d.txnIndex));

  const cards: CardSnapshot[] = p.accounts
    .filter((a) => a.type === 'CREDIT')
    .map((card) => {
      const own = p.statements
        .filter((s) => s.accountId === card.id)
        .sort((a, b) => compareDates(isoDate(b.cycleEnd), isoDate(a.cycleEnd)));
      // Stored rows (the reader's own record: 'manual' / 'autopay') PLUS the
      // payments detected from the feed, deduped against each other. Both halves
      // are read here rather than at the two call sites below, so the statement
      // SELECTION and the amount due can never disagree about what has been paid.
      const storedPaidAgainst = (statementId: string) =>
        p.cardPayments
          .filter((cp) => cp.statementId === statementId)
          .reduce((sum, cp) => sum + cp.amountCents, 0);
      const paidAgainst = (statement: StatementLike) =>
        storedPaidAgainst(statement.id) +
        detectedPaymentCentsForStatement({
          detected: detectedPayments,
          cardAccountId: card.id,
          cycleEnd: statement.cycleEnd,
          storedPayments: p.cardPayments.filter((cp) => cp.statementId === statement.id),
        });
      // Current obligation = the most recent statement that is either not yet
      // due OR still carries an unpaid remainder (delinquent statements must
      // NEVER vanish into the estimate path — Hostile Critic finding P1-2).
      const current =
        own.find(
          (s) =>
            compareDates(isoDate(s.dueDate), p.today) >= 0 ||
            s.statementBalanceCents - paidAgainst(s) > 0,
        ) ?? null;

      let paymentsApplied = 0;
      let postCloseCredit = 0;
      if (current) {
        paymentsApplied = paidAgainst(current);
        postCloseCredit = p.transactions
          .filter(
            (t, i) =>
              t.accountId === card.id &&
              t.status === 'POSTED' &&
              !t.isTransfer &&
              !t.isSplitParent &&
              // A row we just credited as a PAYMENT cannot also be announced as a
              // credit that "reduces your next statement, not this amount due".
              // Disjoint by identity, not by the isTransfer flag — see
              // DetectedCardPayment.txnIndex.
              !detectedIndexes.has(i) &&
              t.amountCents > 0 &&
              compareDates(isoDate(t.date), isoDate(current.cycleEnd)) > 0,
          )
          .reduce((sum, t) => sum + t.amountCents, 0);
      }

      const autopayRow = autopayByAccount.get(card.id);
      const autopay = autopayRow
        ? {
            mode: autopayRow.mode as 'STATEMENT_BALANCE' | 'MINIMUM' | 'FIXED_AMOUNT',
            fixedAmountCents:
              autopayRow.fixedAmountCents !== null ? cents(autopayRow.fixedAmountCents) : undefined,
          }
        : null;

      let nextCycleCloseDate: ISODate | undefined;
      let nextDueDate: ISODate | undefined;
      // BOTH days are required, deliberately. A due day without a close day is not a
      // date: `nextDayOfMonth(dueDay, today)` is the next calendar occurrence, which
      // is a coin flip up to a month wide. Relaxing this (attempted 2026-07-23 to
      // rescue Plaid cards with no statement) was reverted after the cycle-2 critic
      // executed the repro: with cycleClose null and dueDay 25 on 2026-07-23 the
      // engine produced byDate 2026-07-24 — a month early — plus an $842.67
      // shortfall and a live "move $850 into checking today" recommendation, and
      // disclosed the guessed date as the issuer's own. An undatable card must stay
      // undatable and say so (unknownDueDateCards); a fabricated date is worse than
      // an honest gap.
      if (!current && card.cycleCloseDayOfMonth !== null && card.dueDayOfMonth !== null) {
        nextCycleCloseDate = nextDayOfMonth(card.cycleCloseDayOfMonth, p.today);
        nextDueDate = nextDayOfMonth(card.dueDayOfMonth, addDays(nextCycleCloseDate, 1));
      }

      return {
        id: card.id,
        // The label, resolved ONCE here (TASKS L.7) — the same reason `feedDroppedAt` is
        // carried on this shape: the string flows from this assembler to ~20 surfaces
        // (dashboard hero, reminders, calendar, digest, push, receipts, Ask), and a
        // surface that can't see the user's own name for a card prints the bank's.
        name: accountLabel(card),
        aprBps: card.aprBps ?? 0,
        autopay,
        statement: current
          ? {
              statementBalanceCents: cents(current.statementBalanceCents),
              minimumPaymentCents: cents(current.minimumPaymentCents),
              dueDate: isoDate(current.dueDate),
              cycleEnd: isoDate(current.cycleEnd),
            }
          : null,
        currentBalanceCents: cents(card.currentBalanceCents),
        nextCycleCloseDate,
        nextDueDate,
        paymentsAppliedCents: cents(paymentsApplied),
        // `current` is null here for exactly two reasons: this card has no
        // statements at all, or every one it has is past due AND fully paid.
        // Only the assembler can still tell them apart.
        hasSettledStatement: !current && own.length > 0,
        postCloseCreditCents: postCloseCredit > 0 ? cents(postCloseCredit) : undefined,
        frozenSince: card.feedDroppedAt ?? null,
        // C.11 critic P0-1: a manual card's statement/balance is a typed figure;
        // the provenance gate must be able to see it all the way to the panel.
        manual: card.provider === 'manual',
      };
    });

  const scheduled: ScheduledItem[] = [];
  for (const row of p.scheduled) {
    if (row.accountId !== p.paymentAccountId) continue;
    const start = isoDate(row.nextDate);
    // Calendar-month cadences step by whole months: MONTHLY 1, QUARTERLY 3,
    // SEMIANNUAL 6, ANNUAL 12 — from the ONE table in detect.ts, because this
    // chain existed in four copies and a missed branch is silent (the row falls
    // through to the single-occurrence `else` and renders once, forever).
    // (L.23 admitted ANNUAL here; L.24 the two middle cadences.) At every
    // horizon this engine is called with (60 days by default, 90 at the widest)
    // an ANNUAL row has at most ONE occurrence in the window, so for ANNUAL this
    // loop matches the `else` it used to fall through — with two deliberate
    // exceptions, both in the safe direction and both executed by the L.23 money
    // critic: a window spanning a year or more yields the later occurrences (the
    // second needs ~431 days here, NOT 366 — the bound depends on the anchor's
    // phase in the window), and a row whose nextDate is already in the past
    // steps forward instead of being dropped, which is date-scoped rather than
    // window-scoped. Both exceptions apply unchanged to the two cadences L.24
    // added — and note that a QUARTERLY PERIOD (91–92 days) is LONGER than this
    // engine's widest horizon, so a quarterly row also has at most one
    // occurrence here. Measured, not assumed: a draft comment claimed it could
    // recur inside 90 days and the executed test disproved it.
    const monthStep = monthsPerCadence(row.cadence);
    if (monthStep > 0) {
      for (let i = 0; ; i++) {
        const occ = addMonthsClamped(start, i * monthStep);
        if (compareDates(occ, horizon) > 0) break;
        if (compareDates(occ, p.today) >= 0) {
          scheduled.push({ date: occ, amountCents: cents(row.amountCents), description: row.description });
        }
      }
    } else if (row.cadence === 'WEEKLY' || row.cadence === 'BIWEEKLY') {
      const step = row.cadence === 'WEEKLY' ? 7 : 14;
      for (let occ = start; compareDates(occ, horizon) <= 0; occ = addDays(occ, step)) {
        if (compareDates(occ, p.today) >= 0) {
          scheduled.push({ date: occ, amountCents: cents(row.amountCents), description: row.description });
        }
      }
    } else if (compareDates(start, p.today) >= 0 && compareDates(start, horizon) <= 0) {
      scheduled.push({ date: start, amountCents: cents(row.amountCents), description: row.description });
    }
  }

  return {
    today: p.today,
    paymentAccount: {
      name: accountLabel(paymentAccount),
      balanceCents: cents(paymentAccount.currentBalanceCents),
      pending,
      // The projection's whole starting point. If the bank stopped sharing THIS account, the
      // number below is frozen and the engine must say so — see the field's docstring.
      frozenSince: paymentAccount.feedDroppedAt ?? null,
    },
    cards,
    scheduled,
    scenario: p.scenario,
    holidayTable: p.holidayTable,
  };
}

/** Net worth from account rows: assets − liabilities (sign decided by type). */
export function netWorthCents(accounts: { type: string; currentBalanceCents: number }[]): Cents {
  let total = 0;
  for (const a of accounts) {
    total += isLiabilityType(a.type) ? -a.currentBalanceCents : a.currentBalanceCents;
  }
  return cents(total);
}
