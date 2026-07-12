/**
 * Server-side finance reads: provider → assembler → pure engines.
 * All entry points take the session userId; every underlying query is
 * row-ownership scoped in the provider.
 */
import { holidayTable, type ISODate } from '@/lib/dates';
import { assembleCashNeededInput, netWorthCents } from '@/lib/engine/cash-needed/assemble';
import { computeCashNeeded } from '@/lib/engine/cash-needed/engine';
import { mergeSnapshots } from '@/lib/engine/household/merge-snapshot';
import { selectLoanObligations } from '@/lib/engine/loans/obligations';
import { netWorthSeries } from '@/lib/engine/networth/series';
import { type PaymentReminder, selectPaymentReminders } from '@/lib/engine/reminders/select';
import type { CashNeededResult } from '@/lib/engine/cash-needed/types';
import { getProvider } from '@/lib/providers/demo';
import type { FinanceSnapshot } from '@/lib/providers/types';
import type { Cents } from '@/lib/money';
import { cents } from '@/lib/money';
// Deliberately from `household-authz`, NOT `@/server/authz` — the latter
// imports `@/auth` (next-auth) at module scope, which would drag the full
// NextAuth instance into every caller of getCashNeeded/getDashboardData
// (cron routes included), breaking any test that doesn't mock `@/auth`.
import { partnerIdsOf, resolveViewer } from '@/server/household-authz';
import { getSharedSnapshotSlice } from '@/server/household-finance';

/** Cash-needed scope (TASKS 4.2 slice 4): 'mine' is byte-identical to pre-household
 *  behavior; 'household' folds in every LIVE partner's shared-account obligations. */
export type CashNeededScope = 'mine' | 'household';

export interface NetWorthPoint {
  date: string;
  netWorthCents: number;
}

export interface DashboardData {
  today: string;
  paymentAccountName: string;
  /** The user's stored choice (may be null/unset) — distinct from the resolved
   *  paymentAccountName, which always falls back to a real account. Used to
   *  decide the onboarding nudge without a second user read. */
  paymentAccountId: string | null;
  payInFull: CashNeededResult;
  minimum: CashNeededResult;
  netWorthCents: Cents;
  netWorthTrend: NetWorthPoint[];
  /** Upcoming card payments this cycle (ROADMAP #6) — derived from the same obligations. */
  reminders: PaymentReminder[];
  accounts: { id: string; name: string; type: string; currentBalanceCents: number; mask: string | null }[];
  /** The scope actually computed — may fall back to 'mine' if the requested
   *  'household' scope had no live partners to fold in (§4.4). */
  scope: CashNeededScope;
  /** Present whenever the viewer belongs to a household, regardless of scope —
   *  drives the toggle's visibility. Null for solo/demo users (T6). */
  household: { name: string; hasPartners: boolean } | null;
  /** cardId → owning partner's display name, for every card in `payInFull.cards`/
   *  `minimum.cards` that belongs to a PARTNER's shared account (TASKS 4.2 slice
   *  5). Empty in 'mine' scope (T6) — the engine stays free of any user concept
   *  (`CardObligation` carries no owner field); this map is built server-side
   *  from the same partner slices the merge already fetched, never re-derived
   *  from the merged/untyped account rows. */
  cardOwnerLabel: Record<string, string>;
}

/**
 * THE payment-account resolution — one definition (cycle-1 H1: three pages
 * had drifted copies that could disagree about which account "the answer"
 * is computed against).
 */
export function resolvePaymentAccount(snap: FinanceSnapshot) {
  const paymentAccount =
    snap.accounts.find((a) => a.id === snap.paymentAccountId) ??
    snap.accounts.find((a) => a.type === 'CHECKING') ??
    snap.accounts[0];
  if (!paymentAccount) throw new Error('No accounts found — run `npx prisma db seed`.');
  return paymentAccount;
}

/**
 * THE cash-needed assembly — every page goes through this one path.
 *
 * `paymentAccountIdOverride` (household scope, TASKS 4.2 slice 4): the funding
 * account is ALWAYS the viewer's own (HOUSEHOLD_ARCHITECTURE §4.4) — never
 * re-derived from `snap.accounts` when `snap` is a MERGED household snapshot,
 * since `resolvePaymentAccount`'s CHECKING/first-account fallback would then
 * search across a partner's shared accounts too. Callers passing a merged
 * snapshot MUST resolve the id from the viewer's OWN (pre-merge) snapshot and
 * pass it here explicitly (critic-caught P0: without this, a viewer with no
 * checking account of their own could have their household cash-needed funded
 * from — and silently reveal the balance of — a partner's shared checking
 * account). Omitted for the 'mine' path — byte-identical to pre-slice-4 (T6).
 */
export function cashNeededFromSnapshot(
  snap: FinanceSnapshot,
  today: ISODate,
  scenario: 'PAY_IN_FULL' | 'MINIMUM' = 'PAY_IN_FULL',
  paymentAccountIdOverride?: string,
) {
  const year = Number(today.slice(0, 4));
  const holidays = holidayTable(year - 1, year + 1);
  const input = assembleCashNeededInput({
    today,
    scenario,
    paymentAccountId: paymentAccountIdOverride ?? resolvePaymentAccount(snap).id,
    accounts: snap.accounts,
    autopays: snap.autopays,
    statements: snap.statements,
    cardPayments: snap.cardPayments,
    transactions: snap.transactions,
    scheduled: snap.scheduled,
    holidayTable: holidays,
  });
  // The next LOAN/MORTGAGE payments — a SEPARATE surface (calendar + reminders), never
  // folded into the card-framed cash-needed headline (#134). One definition here so the
  // dashboard, calendar, and cron sweep all agree.
  const loanObligations = selectLoanObligations({ accounts: snap.accounts, today, holidays });
  return { input, result: computeCashNeeded(input), loanObligations };
}

/**
 * `mine` is the ORIGINAL code path, untouched (T6 byte-identical). `household`
 * folds in every live partner's shared-account slice via `getSharedSnapshotSlice`
 * + the pure `mergeSnapshots` (HOUSEHOLD_ARCHITECTURE §4.4) — falls back to
 * `mine` (silently, since it's a no-op) when the viewer has no live partners.
 *
 * `household`/`scope` on the return (TASKS 4.2 slice 5): the viewer is resolved
 * regardless of the REQUESTED scope — a cheap, indexed read that never changes
 * the 'mine' computation below — so a caller (the /calendar page) can decide
 * whether to OFFER the household toggle at all, mirroring `getDashboardData`.
 */
export async function getCashNeeded(
  userId: string,
  scenario: 'PAY_IN_FULL' | 'MINIMUM' = 'PAY_IN_FULL',
  requestedScope: CashNeededScope = 'mine',
) {
  const provider = getProvider();
  const today = provider.today(userId);
  const snap = await provider.getFinanceSnapshot(userId);

  const viewer = await resolveViewer(userId);
  const partnerIds = partnerIdsOf(viewer);
  const household = viewer.household
    ? { name: viewer.household.name, hasPartners: partnerIds.length > 0 }
    : null;
  const scope: CashNeededScope = requestedScope === 'household' && partnerIds.length > 0 ? 'household' : 'mine';

  if (scope === 'household') {
    // Resolved from the PERSONAL snapshot, BEFORE merging (critic P0 fix) —
    // never let the merged accounts array influence which account funds this.
    const paymentAccountId = resolvePaymentAccount(snap).id;
    const slices = await Promise.all(partnerIds.map((id) => getSharedSnapshotSlice(id)));
    const merged = mergeSnapshots(today, snap, slices);
    const householdSnap: FinanceSnapshot = { ...snap, ...merged };
    return {
      today,
      snap: householdSnap,
      householdName: viewer.household?.name ?? null,
      scope,
      household,
      ...cashNeededFromSnapshot(householdSnap, today, scenario, paymentAccountId),
    };
  }

  return { today, snap, scope, household, ...cashNeededFromSnapshot(snap, today, scenario) };
}

export async function getDashboardData(
  userId: string,
  requestedScope: CashNeededScope = 'mine',
): Promise<DashboardData> {
  const provider = getProvider();
  const today = provider.today(userId);
  const snap = await provider.getFinanceSnapshot(userId);
  const paymentAccount = resolvePaymentAccount(snap);

  // Household context: resolved regardless of requested scope so the page can
  // decide whether to OFFER the toggle at all — a cheap, indexed read that
  // never changes the 'mine' computation below (T6).
  const viewer = await resolveViewer(userId);
  const partnerIds = partnerIdsOf(viewer);
  const household = viewer.household
    ? { name: viewer.household.name, hasPartners: partnerIds.length > 0 }
    : null;
  const scope: CashNeededScope = requestedScope === 'household' && partnerIds.length > 0 ? 'household' : 'mine';

  // 'mine': `cashNeededSnap` IS `snap` — the exact same object the pre-slice-4
  // code computed over. 'household': a merged copy: same disjoint-union merge
  // as `getCashNeeded`'s household branch (§4.4).
  let cashNeededSnap = snap;
  // cardId → owning partner's name (TASKS 4.2 slice 5) — built directly from
  // each partner's OWN slice (never from the merged/untyped account rows,
  // which lose the per-partner boundary once unioned).
  const cardOwnerLabel: Record<string, string> = {};
  if (scope === 'household') {
    const slices = await Promise.all(partnerIds.map((id) => getSharedSnapshotSlice(id)));
    partnerIds.forEach((partnerId, i) => {
      const label = viewer.household?.memberNames[partnerId] ?? 'Partner';
      for (const a of slices[i].accounts) {
        if (a.type === 'CREDIT') cardOwnerLabel[a.id] = label;
      }
    });
    const merged = mergeSnapshots(today, snap, slices);
    cashNeededSnap = { ...snap, ...merged };
  }

  // Explicit override (critic P0 fix): `paymentAccount` is already resolved from
  // the PERSONAL `snap` above — pass its id through so a household-scope merge
  // can never re-derive the funding account from a partner's shared checking.
  const { input, result: payInFull, loanObligations } = cashNeededFromSnapshot(
    cashNeededSnap,
    today,
    'PAY_IN_FULL',
    paymentAccount.id,
  );
  const minimum = computeCashNeeded({ ...input, scenario: 'MINIMUM' });

  // Upcoming payment reminders — the card obligations the headline counts PLUS the next
  // loan/mortgage payments (#134), as a dated list (the in-app half of ROADMAP #6; the
  // cron route emails the same). `cards` is the COMPLETE obligation set (real + estimated);
  // `upcoming` is a subset of it, so spreading both would double-count estimated cards.
  const reminders = selectPaymentReminders({ obligations: payInFull.cards, loanObligations, today });

  // Net-worth trend from month-end snapshots (assets − liabilities per date),
  // via the one shared series builder (DECISIONS #40) — same classifier as the
  // headline + the /accounts page, so manual liabilities can't be miscounted.
  const current = netWorthCents(snap.accounts);
  const netWorthTrend = netWorthSeries({
    snapshots: snap.balanceSnapshots,
    accounts: snap.accounts,
    today,
  });

  const accounts = snap.accounts.map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type,
    currentBalanceCents: a.currentBalanceCents,
    mask: (a as { mask?: string | null }).mask ?? null,
  }));

  return {
    today,
    paymentAccountName: paymentAccount.name,
    paymentAccountId: snap.paymentAccountId,
    payInFull,
    minimum,
    netWorthCents: cents(current),
    netWorthTrend,
    reminders,
    accounts,
    scope,
    household,
    cardOwnerLabel,
  };
}
