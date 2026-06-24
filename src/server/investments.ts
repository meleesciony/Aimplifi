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
import { cents } from '@/lib/money';
import { type Holding, type Portfolio, summarizePortfolio } from '@/lib/engine/investments/portfolio';
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
};

const toEngineHolding = (h: DbHolding): Holding => ({
  symbol: h.symbol,
  name: h.name ?? undefined,
  quantity: h.quantity,
  costBasisCents: cents(h.costBasisCents),
  priceCents: cents(h.priceCents),
});

/** Build each INVESTMENT account's portfolio + an overall roll-up for the current user. */
export async function getInvestments(): Promise<InvestmentsView> {
  const userId = await requireUserId();
  const accounts = await prisma.account.findMany({
    where: { userId, type: 'INVESTMENT' },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      currentBalanceCents: true,
      holdings: {
        orderBy: { symbol: 'asc' },
        select: { symbol: true, name: true, quantity: true, costBasisCents: true, priceCents: true },
      },
    },
  });

  const views: InvestmentAccountView[] = accounts.map((a) => ({
    accountId: a.id,
    accountName: a.name,
    accountBalanceCents: a.currentBalanceCents,
    portfolio: summarizePortfolio(a.holdings.map(toEngineHolding)),
  }));
  const overall = summarizePortfolio(accounts.flatMap((a) => a.holdings.map(toEngineHolding)));
  return { accounts: views, overall };
}

/** Add or update (by ticker) a holding on one of the user's INVESTMENT accounts. */
export async function addHolding(input: HoldingInput): Promise<{ ok: boolean; error?: string }> {
  const userId = await requireUserId();
  const symbol = input.symbol.trim().toUpperCase();
  const name = input.name?.trim() || null;
  if (!/^[A-Z0-9.\-]{1,20}$/.test(symbol)) {
    return { ok: false, error: 'Enter a valid ticker symbol (letters, digits, “.” or “-”, up to 20 chars).' };
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

  await prisma.holding.upsert({
    where: { accountId_symbol: { accountId: acct.id, symbol } },
    create: { accountId: acct.id, symbol, name, quantity: input.quantity, costBasisCents: input.costBasisCents, priceCents: input.priceCents },
    update: { name, quantity: input.quantity, costBasisCents: input.costBasisCents, priceCents: input.priceCents },
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
