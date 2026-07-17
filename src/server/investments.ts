'use server';

/**
 * Investments server layer (DECISIONS #78) — the read-path + manual entry that feed
 * the pure investments engine (src/lib/engine/investments/portfolio.ts). Holdings are
 * an optional position breakdown of an INVESTMENT account; the account's
 * currentBalanceCents stays authoritative for net worth (holdings are additive detail).
 * Every path is ownership-scoped via requireUserId + audit-logged.
 */
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { DEMO_ENTRY_BLOCKED, isDemoUser } from '@/lib/demo-user';
import { cents } from '@/lib/money';
import { type Holding, type Portfolio, summarizePortfolio } from '@/lib/engine/investments/portfolio';
import { parseTicker } from '@/lib/engine/investments/ticker';
import { isSupportedCurrency } from '@/lib/providers/currency';
import {
  RETIREMENT_ASSUMPTIONS,
  buildRetirementInputs,
  projectRetirement,
  type RetirementProjection,
} from '@/lib/engine/investments/retirement';
import { getCoachData } from '@/server/coach';
import { auditLog, requireUserId } from '@/server/authz';

export interface InvestmentAccountView {
  accountId: string;
  accountName: string;
  /** The account's provider/manual balance — authoritative for net worth. */
  accountBalanceCents: number;
  portfolio: Portfolio;
}

export interface InvestmentsView {
  accounts: InvestmentAccountView[];
  /** All holdings across every investment account, as one portfolio. */
  overall: Portfolio;
}

export interface HoldingInput {
  accountId: string;
  symbol: string;
  name?: string;
  quantity: number;
  costBasisCents: number;
  priceCents: number;
}

type DbHolding = {
  symbol: string;
  name: string | null;
  quantity: number;
  costBasisCents: number;
  priceCents: number;
  marketValueCents: number | null;
  source: string;
};

const toEngineHolding = (h: DbHolding): Holding => ({
  symbol: h.symbol,
  name: h.name ?? undefined,
  quantity: h.quantity,
  costBasisCents: cents(h.costBasisCents),
  priceCents: cents(h.priceCents),
  // Authoritative total when the feed supplied one (DECISIONS #129); null (manual
  // holdings) → the engine derives round(quantity × priceCents), so demo/golden values
  // are unchanged. cents() validates the stored integer at this read boundary.
  marketValueCents: h.marketValueCents == null ? undefined : cents(h.marketValueCents),
  // Display-only provenance (DECISIONS #180) — 'manual' (default) or a feed key; the UI
  // badges a synced position via holdingProvenance(). Carries no weight in any math.
  source: h.source,
});

/** Build each INVESTMENT account's portfolio + an overall roll-up for the current user. */
export async function getInvestments(): Promise<InvestmentsView> {
  const userId = await requireUserId();
  const accountsRaw = await prisma.account.findMany({
    where: { userId, type: 'INVESTMENT' },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      currency: true,
      currentBalanceCents: true,
      holdings: {
        orderBy: { symbol: 'asc' },
        select: { symbol: true, name: true, quantity: true, costBasisCents: true, priceCents: true, marketValueCents: true, source: true },
      },
    },
  });
  // Currency guard (DECISIONS #135): a non-USD brokerage's holdings must NOT roll into the
  // USD-labeled "Portfolio value" at a fabricated 1:1 — exclude it exactly as net worth and
  // /accounts do, so /investments agrees with the headline + /coach. Demo rows are
  // null-currency = USD → golden-safe no-op.
  const accounts = accountsRaw.filter((a) => isSupportedCurrency(a.currency));

  const views: InvestmentAccountView[] = accounts.map((a) => ({
    accountId: a.id,
    accountName: a.name,
    accountBalanceCents: a.currentBalanceCents,
    portfolio: summarizePortfolio(a.holdings.map(toEngineHolding)),
  }));
  const overall = summarizePortfolio(accounts.flatMap((a) => a.holdings.map(toEngineHolding)));
  return { accounts: views, overall };
}

export interface RetirementOutlook {
  /** Whether there is anything to project (a portfolio balance or ongoing savings). */
  hasData: boolean;
  projection: RetirementProjection;
  /** The exact inputs fed to the engine, so the UI can state every assumption inline. */
  inputs: {
    currentAge: number;
    retirementAge: number;
    endAge: number;
    currentPortfolioCents: number;
    monthlyContributionCents: number;
    annualRetirementSpendingCents: number;
    /** The REAL return fed to the engine (nominal − inflation), so figures are today's dollars. */
    annualReturnBps: number;
    /** The user's nominal expected-return dial, for honest disclosure in the copy. */
    nominalReturnBps: number;
    /** The inflation assumption used to derive the real return. */
    inflationBps: number;
    swrBps: number;
  };
}

/**
 * Project the current user's portfolio through retirement (DECISIONS #122). Inputs are
 * the SAME figures /coach shows — portfolio (investment balances), monthly savings,
 * annual spending, expected return, SWR — so the planner is grounded, not invented.
 * Negative monthly savings (spending > income) floors to a $0 contribution.
 */
export async function getRetirementOutlook(): Promise<RetirementOutlook> {
  const userId = await requireUserId();
  const [coach, planRow] = await Promise.all([
    getCoachData(userId),
    prisma.user.findUnique({
      where: { id: userId },
      select: { currentAge: true, retirementAge: true, endAge: true, inflationBps: true },
    }),
  ]);

  // Planning assumptions the user can edit (DECISIONS #123). null = unset → the
  // documented default, so an un-customized user projects exactly as in #122. The
  // pair was validated together on save, so the resolved set is always engine-valid.
  const planning = {
    currentAge: planRow?.currentAge ?? RETIREMENT_ASSUMPTIONS.currentAge,
    retirementAge: planRow?.retirementAge ?? RETIREMENT_ASSUMPTIONS.retirementAge,
    endAge: planRow?.endAge ?? RETIREMENT_ASSUMPTIONS.endAge,
    inflationBps: planRow?.inflationBps ?? RETIREMENT_ASSUMPTIONS.inflationBps,
  };

  // The grounded financial figures — the SAME ones /coach shows, so the planner can't
  // drift from /coach. The single buildRetirementInputs builder floors them at 0 and
  // derives the real (after-inflation) return, so the figures are in today's dollars.
  const base = {
    currentPortfolioCents: coach.fi.portfolioCents,
    monthlyContributionCents: coach.fi.monthlySavingsCents,
    annualRetirementSpendingCents: coach.fi.annualExpensesCents,
    nominalReturnBps: coach.fi.expectedReturnBps,
    swrBps: coach.fi.swrBps,
  };
  const engineInputs = buildRetirementInputs(base, planning);
  const projection = projectRetirement(engineInputs);

  return {
    hasData: engineInputs.currentPortfolioCents > 0 || engineInputs.monthlyContributionCents > 0,
    projection,
    inputs: {
      currentAge: planning.currentAge,
      retirementAge: planning.retirementAge,
      endAge: planning.endAge,
      currentPortfolioCents: engineInputs.currentPortfolioCents,
      monthlyContributionCents: engineInputs.monthlyContributionCents,
      annualRetirementSpendingCents: engineInputs.annualRetirementSpendingCents,
      annualReturnBps: engineInputs.annualReturnBps,
      nominalReturnBps: base.nominalReturnBps,
      inflationBps: planning.inflationBps,
      swrBps: base.swrBps,
    },
  };
}

/** Add or update (by ticker) a holding on one of the user's INVESTMENT accounts. */
export async function addHolding(input: HoldingInput): Promise<{ ok: boolean; error?: string }> {
  const userId = await requireUserId();
  // Demo manual-entry fence (#243 follow-up): the demo seeds a brokerage
  // account, so this upsert is reachable — a visitor's real ticker/quantity/cost
  // basis must never land in the shared demo row. `removeHolding` stays open
  // (removes data, never ingests — the remediation path, like disconnectSimplefin).
  if (isDemoUser(userId)) return { ok: false, error: DEMO_ENTRY_BLOCKED };
  const symbol = parseTicker(input.symbol);
  const name = input.name?.trim() || null;
  if (symbol == null) {
    return { ok: false, error: 'Enter a valid ticker symbol (letters, digits, “.”, “-”, or “/”, up to 20 chars).' };
  }
  if (!Number.isSafeInteger(input.costBasisCents) || input.costBasisCents < 0) {
    return { ok: false, error: 'Cost basis must be a whole, non-negative number of cents.' };
  }
  if (!Number.isSafeInteger(input.priceCents) || input.priceCents < 0) {
    return { ok: false, error: 'Price must be a whole, non-negative number of cents.' };
  }
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    return { ok: false, error: 'Quantity must be a positive, finite number.' };
  }
  // Reject at the boundary what the engine's safe-integer guard would later throw on, so
  // one bad row can never break the whole getInvestments read (Hostile Critic P0-1).
  if (Math.abs(input.quantity * input.priceCents) > Number.MAX_SAFE_INTEGER) {
    return { ok: false, error: 'That position value is too large to track.' };
  }

  // Ownership + type gate: the account must belong to this user AND be an investment account.
  const acct = await prisma.account.findFirst({
    where: { id: input.accountId, userId, type: 'INVESTMENT' },
    select: { id: true },
  });
  if (!acct) return { ok: false, error: 'Investment account not found.' };

  // A manual entry is priced per-share by the user, so it carries NO authoritative
  // total — marketValueCents is null and the engine derives round(quantity × price).
  // Clearing it on update too drops any stale feed total for THIS edit, so the
  // hand-entered price is shown immediately (DECISIONS #129). NOTE: a symbol previously
  // ingested from the feed keeps source='simplefin', so a later sync may re-ingest it —
  // that is the existing #124 reconcile behavior, unchanged here.
  await prisma.holding.upsert({
    where: { accountId_symbol: { accountId: acct.id, symbol } },
    create: { accountId: acct.id, symbol, name, quantity: input.quantity, costBasisCents: input.costBasisCents, priceCents: input.priceCents, marketValueCents: null },
    update: { name, quantity: input.quantity, costBasisCents: input.costBasisCents, priceCents: input.priceCents, marketValueCents: null },
  });
  await auditLog(userId, 'holding.upsert', {
    accountId: acct.id,
    symbol,
    quantity: input.quantity,
    priceCents: input.priceCents,
    costBasisCents: input.costBasisCents,
  });
  revalidatePath('/investments');
  revalidatePath('/accounts');
  return { ok: true };
}

/** Remove a holding — ownership-scoped, so a foreign id deletes nothing. */
export async function removeHolding(holdingId: string): Promise<{ ok: boolean; removed: number }> {
  const userId = await requireUserId();
  // Best-effort metadata for the audit trail; the delete itself stays atomic + ownership-scoped.
  const h = await prisma.holding.findFirst({
    where: { id: holdingId, account: { userId } },
    select: { accountId: true, symbol: true },
  });
  const { count } = await prisma.holding.deleteMany({ where: { id: holdingId, account: { userId } } });
  if (count > 0) await auditLog(userId, 'holding.remove', { holdingId, accountId: h?.accountId, symbol: h?.symbol });
  revalidatePath('/investments');
  revalidatePath('/accounts');
  return { ok: true, removed: count };
}
