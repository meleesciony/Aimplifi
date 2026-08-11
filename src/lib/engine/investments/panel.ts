/**
 * The allocation drilldown (O.20d): "tap a segment of the allocation bar, see
 * which accounts hold that symbol".
 *
 * Segments are grouped by symbol from the SAME per-account positions the page
 * renders, in the same pass that sums each segment — so Σ rows === segment
 * market value by construction (the O.18c/O.20d carry-out rule), and a panel's
 * "matched to the penny" sentence is a real check. Grouping by symbol rather
 * than rendering one segment per holding row means a symbol held in two
 * accounts reads as ONE allocation — which is what an allocation is — with the
 * per-account rows underneath it.
 *
 * Rows are structurally the same shape as the Glass-Box `BreakdownRow` (same
 * field names), so a panel that takes `BreakdownRow[]` accepts them directly;
 * `date`/`rawDescriptor` are stubs because holdings have neither — the panel
 * renders with `hideRowDates`.
 */
import { type Cents, cents, formatCents } from '@/lib/money';

export interface AllocationRow {
  key: string;
  transactionId: null;
  date: string;
  label: string;
  rawDescriptor: null;
  amountCents: Cents;
  isPending: false;
}

export interface AllocationSegment {
  symbol: string;
  name: string | null;
  marketValueCents: Cents;
  /** Share of the whole portfolio by market value (0 when the portfolio is empty). */
  weight: number;
  /** Distinct accounts holding this symbol — what the basis sentence names. */
  accountCount: number;
  rows: AllocationRow[];
}

export function allocationSegments(input: {
  accounts: readonly {
    accountId: string;
    accountName: string;
    portfolio: {
      positions: readonly { symbol: string; name?: string | null; marketValueCents: Cents }[];
    };
  }[];
}): AllocationSegment[] {
  const bySymbol = new Map<string, AllocationSegment>();
  let total = 0;
  for (const a of input.accounts) {
    for (const p of a.portfolio.positions) {
      total += p.marketValueCents;
      let seg = bySymbol.get(p.symbol);
      if (!seg) {
        seg = {
          symbol: p.symbol,
          name: p.name ?? null,
          marketValueCents: cents(0),
          weight: 0,
          accountCount: 0,
          rows: [],
        };
        bySymbol.set(p.symbol, seg);
      }
      seg.rows.push({
        key: `${a.accountId}:${seg.rows.length}`,
        transactionId: null,
        date: '',
        label: a.accountName,
        rawDescriptor: null,
        amountCents: p.marketValueCents,
        isPending: false,
      });
    }
  }
  const out = [...bySymbol.values()];
  for (const s of out) {
    // Same pass: the figure is the Σ of the rows it carries, never a re-sum.
    s.marketValueCents = cents(s.rows.reduce((sum, r) => sum + r.amountCents, 0));
    s.accountCount = new Set(s.rows.map((r) => r.key.split(':')[0])).size;
    s.weight = total > 0 ? s.marketValueCents / total : 0;
  }
  return out; // first-appearance order — a no-duplicate portfolio renders byte-identically
}

export function allocationPanelBasis(
  symbol: string,
  figureCents: Cents,
  accountCount: number,
): readonly [string, ...string[]] {
  const acct = accountCount === 1 ? 'one account' : `${accountCount} accounts`;
  return [
    `The ${formatCents(figureCents)} is the market value of ${symbol} across ${acct} — from your holdings.`,
    `A holding’s market value is quantity × price per share, or your brokerage’s own total when it reports one.`,
    `Holdings are an optional breakdown — your account balance stays the source of truth for net worth.`,
  ];
}
