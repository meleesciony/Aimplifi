/**
 * Server-side finance reads: provider → assembler → pure engines.
 * All entry points take the session userId; every underlying query is
 * row-ownership scoped in the provider.
 */
import { holidayTable, type ISODate } from '@/lib/dates';
import { assembleCashNeededInput, netWorthCents } from '@/lib/engine/cash-needed/assemble';
import { computeCashNeeded } from '@/lib/engine/cash-needed/engine';
import { mergeSnapshots } from '@/lib/engine/household/merge-snapshot';
import {
  type LoanObligation,
  type UndatableFrozenLoan,
  selectLoanObligations,
  selectUndatableFrozenLoans,
} from '@/lib/engine/loans/obligations';
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
import { partnerIdsOf, resolveViewer, type Viewer } from '@/server/household-authz';
import { getHouseholdDuplicateCandidates, getSharedSnapshotSlice } from '@/server/household-finance';
import { detectDuplicateAccounts, detectHouseholdDuplicateAccounts } from '@/lib/engine/account/duplicates';
import { duplicatePairDismissKey, getDismissedDuplicateKeys } from '@/server/duplicate-dismissal';
import { isAccountLive } from '@/server/reconciliation';
import { prisma } from '@/lib/db';
import type { PartnerSnapshotSlice } from '@/lib/engine/household/merge-snapshot';

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
   *  decide the onboarding nudge without a second user read. When the stored
   *  choice is a reconciliation predecessor, the assembler has remapped this to
   *  the successor (same real account, live side — Wave 4.6 slice 3). */
  paymentAccountId: string | null;
  payInFull: CashNeededResult;
  minimum: CashNeededResult;
  netWorthCents: Cents;
  netWorthTrend: NetWorthPoint[];
  /** Upcoming card payments this cycle (ROADMAP #6) — derived from the same obligations. */
  reminders: PaymentReminder[];
  /**
   * The next LOAN/MORTGAGE payments (#134), already computed here to build `reminders` and now
   * returned as well (TASKS L.19). `reminders` is WINDOWED, so a frozen loan due outside the window
   * is absent from it — and the all-clear is precisely the branch where that window is empty. The
   * dashboard needs the unwindowed set to say which accounts its "you're all caught up" cannot
   * speak for.
   */
  loanObligations: LoanObligation[];
  /**
   * The frozen LOAN/MORTGAGE accounts that produced no obligation at all, because the bank never
   * sent a due day or a payment amount (TASKS L.20). Disjoint from `loanObligations` by
   * construction. Carried for the same reason that list is: an all-clear must be able to name the
   * accounts it cannot speak for, and this is the one row that reaches NO list.
   */
  undatableFrozenLoans: UndatableFrozenLoan[];
  /**
   * `feedDroppedAt` rides this payload (TASKS L.20) because the PDF export prints these balances
   * into a durable artifact and, until L.20, its footer asserted the opposite — "Balances reflect
   * the data source at export time" is affirmatively false about a row whose bank stopped sending
   * one. A file handed to a lender carries no way to correct itself later, so the qualification has
   * to be inside it.
   */
  accounts: {
    id: string;
    name: string;
    type: string;
    currentBalanceCents: number;
    mask: string | null;
    feedDroppedAt: string | null;
  }[];
  /** cardId -> last-4 for the /cards identity line (#298). Covers HOUSEHOLD scope too:
   *  built from the merged snapshot the obligations are computed over, not the personal one. */
  cardMask: Record<string, string | null>;
  /** The scope actually computed — may fall back to 'mine' if the requested
   *  'household' scope had no live partners to fold in (§4.4). */
  scope: CashNeededScope;
  /** Present whenever the viewer belongs to a household, regardless of scope —
   *  drives the toggle's visibility. Null for solo/demo users (T6). */
  household: { name: string; hasPartners: boolean } | null;
  /** accountId → owning partner's display name, for EVERY account folded in
   *  from a partner's shared slice (TASKS 4.2 slice 5; widened from cards-only
   *  in slice 8 — critic F-1: loans reach `reminders` via `loanObligations`,
   *  and an unlabeled one would render through second-person copy). Empty in
   *  'mine' scope (T6) — the engine stays free of any user concept; this map is
   *  built server-side from the same partner slices the merge already fetched,
   *  never re-derived from the merged/untyped account rows. */
  accountOwnerLabel: Record<string, string>;
  /** Partner shared accounts withheld by the #135 currency guard at household
   *  scope — disclosed, never silent (slice-8 critic F-6). 0 in 'mine' scope. */
  householdWithheldCount: number;
  /** Partner accounts whose bank has STOPPED sharing them (TASKS L.14, critic F-3). Their frozen
   *  balances are inside every household figure on the dashboard, and the viewer's own
   *  feed-dropped banner is own-rows-only, so without this a joint total quietly rests on a stale
   *  number the viewer cannot see, cannot fix, and is not told about. Count only — naming another
   *  member's account here would widen what the viewer sees beyond the sharing consent. */
  householdFeedDroppedCount: number;
  /** Suspected same-real-account-connected-twice pairs across the household's
   *  visible set (slice-8 critic F-5 / T9(b)). ADVISORY: figures are NOT
   *  adjusted; the UI disclosure is the mitigation, mirroring #192's stance.
   *  Empty in 'mine' scope (T6). */
  householdDuplicates: HouseholdDuplicateDisplayPair[];
  /** Suspected same-real-account-twice pairs among the VIEWER'S OWN cards, restricted to the
   *  cards /cards actually lists (TASKS L.6). Ids only: every rendered string is built by
   *  `card-duplicate-view.ts` from the labels the page paints, so the disclosure can never name a
   *  card differently from the card itself. ADVISORY — like `householdDuplicates`, no figure is
   *  adjusted (DECISIONS #289). Empty for everyone with no suspected duplicate. */
  cardDuplicates: CardDuplicateIdPair[];
}

/** A suspected duplicate pair as the server hands it to the UI: identity + basis, never copy. */
export interface CardDuplicateIdPair {
  aId: string;
  bId: string;
  confidence: 'high' | 'medium';
  reasons: string[];
}

export interface HouseholdDuplicateDisplayPair {
  a: { name: string; ownerLabel: string };
  b: { name: string; ownerLabel: string };
  confidence: 'high' | 'medium';
}

/**
 * Household-scope extras shared by `getCashNeeded` and `getDashboardData`
 * (slice 8): the all-types owner-label map (F-1), the withheld-account
 * disclosure count (F-6), and the duplicate-pair disclosure (F-5), with owner
 * ids resolved to display labels ("yours" / "Sam's"). `|| 'Partner'` — not
 * `??` — so an empty-string display name can never yield an unlabeled partner
 * account that falls through to second-person copy (critic F-8).
 */
async function householdExtras(
  userId: string,
  viewer: Viewer,
  partnerIds: string[],
  slices: PartnerSnapshotSlice[],
): Promise<Pick<DashboardData, 'accountOwnerLabel' | 'householdWithheldCount' | 'householdFeedDroppedCount' | 'householdDuplicates'>> {
  const memberNames = viewer.household?.memberNames ?? {};
  const accountOwnerLabel: Record<string, string> = {};
  partnerIds.forEach((partnerId, i) => {
    const label = memberNames[partnerId] || 'Partner';
    for (const a of slices[i].accounts) accountOwnerLabel[a.id] = label;
  });
  const householdWithheldCount = slices.reduce((n, s) => n + s.withheldAccountCount, 0);
  // Counted over the accounts that actually reach the merged figures — the same list the sums
  // above are built from — so the count can never describe a different set than the one counted
  // (the L.15 "a count driving copy must be computed over what will RENDER" rule).
  const householdFeedDroppedCount = slices.reduce(
    (n, s) => n + s.accounts.filter((a) => a.feedDroppedAt != null).length,
    0,
  );
  const ownerLabelOf = (ownerId: string) =>
    ownerId === userId ? 'yours' : `${memberNames[ownerId] || 'Partner'}'s`;
  const householdDuplicates = detectHouseholdDuplicateAccounts(
    await getHouseholdDuplicateCandidates(userId, partnerIds),
  ).map((p) => ({
    a: { name: p.a.name, ownerLabel: ownerLabelOf(p.a.ownerId) },
    b: { name: p.b.name, ownerLabel: ownerLabelOf(p.b.ownerId) },
    confidence: p.confidence,
  }));
  return { accountOwnerLabel, householdWithheldCount, householdFeedDroppedCount, householdDuplicates };
}

/**
 * Suspected duplicate CARDS among the viewer's own accounts, restricted to the rows /cards lists
 * (TASKS L.6). The detector is #192's, unchanged — this adds a SURFACE, not a heuristic.
 *
 * Three deliberate scoping decisions:
 * 1. **The viewer's OWN accounts only** (`snap`, never the household-merged snapshot). A partner's
 *    row must never enter the personal detector — the same rule `/accounts` states at its call site;
 *    a household-level duplicate is `detectHouseholdDuplicateAccounts`, already disclosed on the
 *    scope toggle, and feeding partner rows in here would call two people's separate cards at one
 *    bank a duplicate.
 * 2. **Only rows this page displays.** Intersecting with the displayed ids does the suppression
 *    `/accounts` spends queries on, for free: a reconciliation predecessor is already stripped from
 *    the obligations by `cashNeededFromSnapshot`, so it is not displayed and cannot pair. It also
 *    keeps a checking-account pair — real, and disclosed on /accounts — off a page that lists no
 *    checking accounts and could only confuse.
 * 3. **A dismissed pair stays dismissed.** "Not duplicates" was the user's answer to this exact
 *    question; re-asking it on another page, where the dismiss control does not exist, would be
 *    nagging with no way out. The read is skipped entirely when nothing was detected.
 *
 * 4. **BOTH sides must still be live.** This was a hostile-critic fix, and it is the sharpest fence
 *    here. `detectReconciliationCandidates` only ever proposes a pair whose sides DIFFER in
 *    liveness (`duplicates.ts:384`), and /accounts suppresses its duplicate warning for any pair
 *    that has such a candidate — so for a one-side-dead pair /accounts renders the "Combine
 *    accounts" card and NO warning, which means no dismiss control exists for it anywhere. An
 *    unsuppressed banner here would therefore be permanent and undismissable on the money page:
 *    exactly the owner complaint that created the dismissal feature ("the warning had no cancel"),
 *    reintroduced one page over. Both-live is also precisely the reported defect — the only shape
 *    that double-counts with no combine offer — so the fence costs nothing real.
 *    Liveness comes from `isAccountLive`, the same helper the confirm action re-checks in its
 *    transaction, so this can never disagree with /accounts about what is live.
 */
async function detectDisplayedCardDuplicates(
  userId: string,
  snap: FinanceSnapshot,
  displayedIds: ReadonlySet<string>,
): Promise<CardDuplicateIdPair[]> {
  const displayed = snap.accounts.filter((a) => displayedIds.has(a.id));
  if (displayed.length < 2) return [];
  // `AccountLike` does not DECLARE provider/mask/currency/plaidItemId; the rows carry them only
  // because the provider hands back whole Account records. Rather than default a missing
  // `provider` to something plausible, fail CLOSED: a wrong default would both hide every real
  // duplicate (the blanket same-provider skip) and stop `EXCLUDED_PROVIDERS` from fencing out the
  // shared demo rows — silently, and invisibly to tsc. No detection is the safe failure here; a
  // wrong one is printed above a payment instruction.
  const rows = displayed.map(
    (a) =>
      a as typeof a & {
        provider?: string;
        mask?: string | null;
        currency?: string | null;
        plaidItemId?: string | null;
      },
  );
  if (rows.some((r) => typeof r.provider !== 'string')) return [];
  const pairs = detectDuplicateAccounts(
    rows.map((row) => ({
      id: row.id,
      provider: row.provider as string,
      name: row.name,
      type: row.type,
      mask: row.mask ?? null,
      currentBalanceCents: row.currentBalanceCents,
      currency: row.currency ?? null,
      // Same-bank-relinked both-live pairs are the reported case (C-10): without this the
      // detector's blanket same-provider skip would hide exactly the pair we are here for.
      plaidItemId: row.plaidItemId ?? null,
    })),
  );
  if (pairs.length === 0) return [];

  // Both-live only (see 4 above). These two reads happen ONLY when a pair was actually detected,
  // so the no-duplicates path — everyone, almost always — still adds no query at all.
  const [plaidItems, sfConn] = await Promise.all([
    prisma.plaidItem.findMany({ where: { userId }, select: { itemId: true } }),
    prisma.simpleFinConnection.findFirst({ where: { userId }, select: { id: true } }),
  ]);
  const conns = {
    simplefinConnected: sfConn !== null,
    plaidItemIds: new Set(plaidItems.map((i) => i.itemId)),
  };
  const liveById = new Map(
    rows.map((r) => [
      r.id,
      isAccountLive({ provider: r.provider as string, plaidItemId: r.plaidItemId ?? null }, conns),
    ]),
  );

  const dismissed = await getDismissedDuplicateKeys(userId);
  return pairs
    .filter((p) => liveById.get(p.a.id) === true && liveById.get(p.b.id) === true)
    .filter((p) => !dismissed.has(duplicatePairDismissKey(p.a.id, p.b.id)))
    .map((p) => ({ aId: p.a.id, bId: p.b.id, confidence: p.confidence, reasons: p.reasons }));
}

/**
 * THE displayed-card set a duplicate pair is resolved against — one definition, shared by
 * `getCashNeeded` and `getDashboardData` (TASKS L.15).
 *
 * Two rules are enforced here rather than at each call site, because L.15 adds five more callers and
 * a fence copied per call site will miss call sites (`docs/lessons/fence-by-construction-not-per-call-site.md`):
 *
 * 1. **The PERSONAL snapshot, always.** `personalSnap` is the viewer's own pre-merge snapshot even
 *    when the RESULT was computed over a household-merged one. `detectDisplayedCardDuplicates` stays
 *    module-private precisely so no caller can hand it `householdSnap` and have two people's separate
 *    cards at one bank called a duplicate (scoping decision 1 on the detector). A partner's cardId
 *    simply is not in `personalSnap.accounts`, so the merged result narrows itself.
 * 2. **The union of both card lists**, not whichever list a given surface paints. An undated copy is
 *    still a second row for the same card. Each surface then narrows this superset to what IT
 *    actually shows, through `resolvePairs` in `card-duplicate-view.ts`, which drops any pair whose
 *    two cards are not both on that surface — the proven fence, reused rather than re-derived per
 *    channel.
 */
export async function personalCardDuplicates(
  userId: string,
  personalSnap: FinanceSnapshot,
  result: { cards: readonly { cardId: string }[]; unknownDueDateCards: readonly { cardId: string }[] },
): Promise<CardDuplicateIdPair[]> {
  return detectDisplayedCardDuplicates(
    userId,
    personalSnap,
    new Set([
      ...result.cards.map((c) => c.cardId),
      ...result.unknownDueDateCards.map((c) => c.cardId),
    ]),
  );
}

/**
 * THE payment-account resolution — one definition (cycle-1 H1: three pages
 * had drifted copies that could disagree about which account "the answer"
 * is computed against).
 */
export function resolvePaymentAccount(snap: FinanceSnapshot) {
  // Reconciliation (Wave 4.6 slice 3, critic F1): a superseded predecessor's balance
  // reads 0 — anchoring on it would fabricate a shortfall. The stored id is already
  // remapped by the assembler; the FALLBACK tiers must skip superseded rows too,
  // since the stale row sorts first by creation order and would otherwise win.
  const superseded = new Set(snap.supersededAccountIds ?? []);
  const paymentAccount =
    snap.accounts.find((a) => a.id === snap.paymentAccountId && !superseded.has(a.id)) ??
    snap.accounts.find((a) => a.type === 'CHECKING' && !superseded.has(a.id)) ??
    snap.accounts.find((a) => !superseded.has(a.id)) ??
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
  // Reconciliation (Wave 4.6 slice 4, R4): a superseded predecessor's balance is zeroed
  // but its card CONFIG/autopay and its loan `minimumPaymentCents` are not — so it would
  // still emit a phantom card obligation (via the estimate/autopay path) or a phantom loan
  // payment (`selectLoanObligations` reads a field the boundary never zeroed). The live
  // successor is the one that owes; skip the predecessor from BOTH obligation surfaces in
  // one place. Byte-identical when nothing is superseded (same array reference → R8).
  const superseded = new Set(snap.supersededAccountIds ?? []);
  const obligationAccounts = superseded.size
    ? snap.accounts.filter((a) => !superseded.has(a.id))
    : snap.accounts;
  const input = assembleCashNeededInput({
    today,
    scenario,
    paymentAccountId: paymentAccountIdOverride ?? resolvePaymentAccount(snap).id,
    accounts: obligationAccounts,
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
  const loanObligations = selectLoanObligations({ accounts: obligationAccounts, today, holidays });
  // The loans the line above refuses to date, when their bank has also stopped sharing them
  // (TASKS L.20). Built here, beside the list it is the complement of, so the two can never drift
  // apart — and so every consumer of `loanObligations` is handed the refusal at the same time as
  // the obligations. Without it, "You're all caught up" and "a clear week ahead" are computed over
  // a list a frozen undatable mortgage can never enter.
  const undatableFrozenLoans = selectUndatableFrozenLoans({ accounts: obligationAccounts });
  return { input, result: computeCashNeeded(input), loanObligations, undatableFrozenLoans };
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
    const computed = cashNeededFromSnapshot(householdSnap, today, scenario, paymentAccountId);
    return {
      today,
      snap: householdSnap,
      householdName: viewer.household?.name ?? null,
      scope,
      household,
      ...(await householdExtras(userId, viewer, partnerIds, slices)),
      ...computed,
      // `snap`, not `householdSnap` — see `personalCardDuplicates`, rule 1.
      cardDuplicates: await personalCardDuplicates(userId, snap, computed.result),
    };
  }

  const emptyExtras: Pick<
    DashboardData,
    'accountOwnerLabel' | 'householdWithheldCount' | 'householdFeedDroppedCount' | 'householdDuplicates'
  > = { accountOwnerLabel: {}, householdWithheldCount: 0, householdFeedDroppedCount: 0, householdDuplicates: [] };
  const computed = cashNeededFromSnapshot(snap, today, scenario);
  return {
    today,
    snap,
    scope,
    household,
    ...emptyExtras,
    ...computed,
    // TASKS L.15: every `getCashNeeded` caller — the calendar page and the reminder/digest/notify
    // crons — now receives the same advisory pair the dashboard has had since #306, so a surface
    // the reader acts on OFFLINE can say what the app already says on screen. Costs no query for a
    // user with no candidate pair (the detector's own early return).
    cardDuplicates: await personalCardDuplicates(userId, snap, computed.result),
  };
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
  // accountId → owning partner's name + the household disclosures (TASKS 4.2
  // slice 5, widened slice 8) — built directly from each partner's OWN slice
  // (never from the merged/untyped account rows, which lose the per-partner
  // boundary once unioned).
  let extras: Pick<
    DashboardData,
    'accountOwnerLabel' | 'householdWithheldCount' | 'householdFeedDroppedCount' | 'householdDuplicates'
  > = { accountOwnerLabel: {}, householdWithheldCount: 0, householdFeedDroppedCount: 0, householdDuplicates: [] };
  if (scope === 'household') {
    const slices = await Promise.all(partnerIds.map((id) => getSharedSnapshotSlice(id)));
    extras = await householdExtras(userId, viewer, partnerIds, slices);
    const merged = mergeSnapshots(today, snap, slices);
    cashNeededSnap = { ...snap, ...merged };
  }

  // Explicit override (critic P0 fix): `paymentAccount` is already resolved from
  // the PERSONAL `snap` above — pass its id through so a household-scope merge
  // can never re-derive the funding account from a partner's shared checking.
  const { input, result: payInFull, loanObligations, undatableFrozenLoans } = cashNeededFromSnapshot(
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
    feedDroppedAt: a.feedDroppedAt ?? null,
  }));

  // cardId -> last-4, for the /cards identity line (#298). Built from `cashNeededSnap`, NOT from
  // `accounts` above: `accounts` is the PERSONAL snapshot, while the obligation list is computed
  // over the household-MERGED one, so sourcing it from `accounts` left every partner card without
  // an identity — and, worse, left a partner card and the reader's own card both titled "Venture"
  // looking different only by the reader's mask, which is precisely the state the identity module
  // exists to prevent (#298 critic F1). A partner's last-4 is already part of what a shared account
  // discloses (docs/PRIVACY.md: name, type, last-4 mask, current balance), so this reveals nothing
  // new. Mirrors the `accountOwnerLabel` server-side map (TASKS 4.2 slice 5).
  const cardMask: Record<string, string | null> = {};
  for (const a of cashNeededSnap.accounts) {
    cardMask[a.id] = (a as { mask?: string | null }).mask ?? null;
  }

  // The pair disclosure for /cards (TASKS L.6). Both lists, because an undated copy is still a
  // second row for the same card even though it is in no total — and it is the "No due date yet"
  // panel that most often holds the thin, unnamed rows a duplicate arrives as.
  const cardDuplicates = await personalCardDuplicates(userId, snap, payInFull);

  return {
    today,
    cardMask,
    cardDuplicates,
    paymentAccountName: paymentAccount.name,
    paymentAccountId: snap.paymentAccountId,
    payInFull,
    minimum,
    netWorthCents: cents(current),
    netWorthTrend,
    reminders,
    loanObligations,
    undatableFrozenLoans,
    accounts,
    scope,
    household,
    ...extras,
  };
}
