/**
 * duplicate-card-view.ts — every string and every decision the "Possible duplicate accounts"
 * card renders (#296).
 *
 * PURE and framework-free so it is unit-testable in the node env (the repo has no RTL/jsdom;
 * vitest.config.ts sets environment:'node'). It owns every string and every decision the
 * duplicate card renders; the component renders exactly this view. Both sides of a pair are
 * computed TOGETHER so label distinctness is an invariant of construction, not a property of
 * the user's data (owner-reported 2026-07-24: two live U.S. Bank Plaid connections produced
 * byte-identical "Disconnect U.S. Bank (Plaid ····2927)" buttons AND byte-identical aria-labels,
 * so there was no way to tell which connection a tap would cut).
 *
 * WHY THE OLD SHAPE COULD NOT WORK (#295's sideAction, accounts-list.tsx:468-493): the label was
 * built from institution + provider + mask, and NONE of those differ across two PlaidItems at one
 * bank. The single fact that does differ — how many accounts each connection feeds — was spent
 * only inside the post-tap confirm prompt, i.e. after the choice the user could not make. So the
 * discriminator now lives on the button FACE (ordinal + blast radius), and a mechanical
 * " (row 1)/(row 2)" breaker guarantees two identical controls are impossible for ANY input.
 *
 * The action tree is the #295 tree (delete when the row is deletable, else disconnect the owning
 * Plaid item) with one new guard: `deletable && !canDelete` returns NO action rather than falling
 * through to a Disconnect for an item that is already gone.
 */
import type { SuspectedDuplicatePair } from '@/lib/engine/account/duplicates';
import { cents, formatCents } from '@/lib/money';

export const DUPLICATE_INTRO_TESTID = 'duplicate-intro';
export const DUPLICATE_HOWTO_TESTID = 'duplicate-howto';
export const DUPLICATE_PAIR_WHY_TESTID = 'duplicate-pair-why';
export const DUPLICATE_PAIR_IMPACT_TESTID = 'duplicate-pair-impact';
export const DUPLICATE_SIDE_A_TESTID = 'duplicate-side-a';
export const DUPLICATE_SIDE_B_TESTID = 'duplicate-side-b';
export const DUPLICATE_SIDE_CONNECTION_TESTID = 'duplicate-side-connection';
export const DUPLICATE_SIDE_FEEDS_TESTID = 'duplicate-side-feeds';
export const DUPLICATE_SIDE_NOTE_TESTID = 'duplicate-side-note';

/** Lives here, not in accounts-list.tsx: that file is 'use client' and imports server actions at
 *  module scope, so a node unit test cannot import from it. */
export const PROVIDER_LABEL: Record<string, string> = {
  plaid: 'Plaid',
  simplefin: 'SimpleFIN',
  manual: 'Manual',
  demo: 'Demo',
};

export function providerMask(p: { provider: string; mask: string | null }): string {
  return `${PROVIDER_LABEL[p.provider] ?? p.provider}${p.mask ? ` ····${p.mask}` : ''}`;
}

/** Always rendered. REPLACES #192's "linked through two providers", which is factually FALSE for
 *  the exact case the owner hit (two connections to ONE provider). The per-pair provider truth
 *  now lives in `why`, where it can be conditional. */
export const DUPLICATE_INTRO =
  'Each connection creates its own row, and every row counts on its own — so one real account arriving twice doubles that balance in your net worth and its spending.';

/** Rendered ONLY when some side of some pair offers a Disconnect: for a card whose sides are all
 *  already disconnected the job is one step, and this sentence would be false. Disconnect alone
 *  does NOT stop the double-count — the orphaned row keeps its last balance and keeps counting
 *  until it is deleted (verified: getAccountsView loads accounts unfiltered and the net-worth sum
 *  applies no liveness test). Saying so here is the difference between an instruction and a trap. */
export const DUPLICATE_HOWTO =
  'Removing a copy whose bank is still connected takes two steps: Disconnect stops it updating, then a Delete control appears in its place. Until you delete it, its last balance keeps counting.';

/**
 * One Plaid connection as BOTH the duplicate card and the Bank-sync block see it.
 *
 * `ordinal` is POSITIONAL ONLY — the 1-based position of this item among the user's connections
 * AT THE SAME institution, in server payload order (transactions.ts orders createdAt asc, and
 * Map/array order preserves it). The copy deliberately says "connection N of M" and claims NO
 * date and NO link order, so a future reorder — or two links created in the same second — can
 * never make the sentence false.
 */
export interface DuplicateConnectionInfo {
  itemId: string;
  institution: string | null;
  lastSyncedAt: string | null; // YYYY-MM-DD or null
  ordinal: number; // 1-based, within the same-institution group
  sameBankCount: number; // group size; 1 ⇒ the ordinal is not rendered
  /** EVERY account under this item, INCLUDING rows the #135 currency guard withholds — the honest
   *  blast radius of a Disconnect. Never used to NAME a row (see visibleAccountsByItem). */
  accountCount: number;
}

/** The subset of AccountView this card reads. Optionality matches AccountView exactly, so a
 *  `Map<string, AccountView>` is assignable with no cast. */
export interface DuplicateSideAccount {
  id: string;
  name: string;
  mask: string | null;
  currentBalanceCents: number;
  provider?: string;
  deletable?: boolean;
  plaidItemId?: string | null;
}

export interface DuplicateSideAction {
  kind: 'delete' | 'disconnect';
  /** accountId for 'delete', itemId for 'disconnect'. Closure-free — the component dispatches. */
  targetId: string;
  /** Guaranteed !== the other side's label within a pair (collision breaker). */
  label: string;
  /** Second, muted line on the button face: the blast radius. */
  subLabel: string;
  ariaLabel: string;
  prompt: string;
}

export interface DuplicateSideView {
  n: 1 | 2;
  name: string;
  providerMask: string;
  connectionLine: string; // never null; every state has its own sentence
  feedsLine: string | null; // non-null ONLY when the plaid item resolved
  note: string | null; // non-null exactly when action === null
  action: DuplicateSideAction | null;
}

export interface DuplicatePairView {
  why: string;
  impact: string | null; // null when either row is missing from accountsById
  a: DuplicateSideView;
  b: DuplicateSideView;
}

export interface DuplicatePairContext {
  /** The currency-guarded rows this page renders — the ONLY source of NAMES (#192: the warning
   *  never references a hidden row). */
  accountsById: ReadonlyMap<string, DuplicateSideAccount>;
  itemsById: ReadonlyMap<string, DuplicateConnectionInfo>;
  /** itemId → the currency-guarded rows under it. Derived from accountsById by
   *  visibleAccountsByItem(), never from plaid.items[].accounts (that array is built from the
   *  UNFILTERED account list and would name a withheld row). */
  visibleByItem: ReadonlyMap<string, { id: string; name: string; mask: string | null }[]>;
  canDelete: boolean; // onDelete was wired
  canDisconnect: boolean; // onDisconnect was wired
}

/**
 * 1-based position + group size for every item, grouped by `institution ?? ''`, in the order the
 * items arrive. Shared by the duplicate card AND PlaidConnections so the two surfaces number the
 * same connection identically — "connection 1 of 2" is then verifiable elsewhere on the page
 * rather than being card-local jargon.
 */
export function connectionOrdinals(
  items: readonly { itemId: string; institution: string | null }[],
): Map<string, { ordinal: number; sameBankCount: number }> {
  const key = (institution: string | null) => institution ?? '';
  const counts = new Map<string, number>();
  for (const i of items) counts.set(key(i.institution), (counts.get(key(i.institution)) ?? 0) + 1);
  const seen = new Map<string, number>();
  const out = new Map<string, { ordinal: number; sameBankCount: number }>();
  for (const i of items) {
    const k = key(i.institution);
    const ordinal = (seen.get(k) ?? 0) + 1;
    seen.set(k, ordinal);
    out.set(i.itemId, { ordinal, sameBankCount: counts.get(k) ?? 1 });
  }
  return out;
}

/** Build the duplicate card's itemsById from the page payload. NO server change: every field
 *  already ships for <PlaidConnections>. */
export function connectionsById(
  items: readonly {
    itemId: string;
    institution: string | null;
    lastSyncedAt: string | null;
    accounts: { name: string; mask: string | null }[];
  }[],
): Map<string, DuplicateConnectionInfo> {
  const ordinals = connectionOrdinals(items);
  const out = new Map<string, DuplicateConnectionInfo>();
  for (const i of items) {
    const ord = ordinals.get(i.itemId);
    out.set(i.itemId, {
      itemId: i.itemId,
      institution: i.institution,
      lastSyncedAt: i.lastSyncedAt,
      ordinal: ord?.ordinal ?? 1,
      sameBankCount: ord?.sameBankCount ?? 1,
      accountCount: i.accounts.length,
    });
  }
  return out;
}

/** Group the CURRENCY-GUARDED rows by their Plaid item, sorted by name then mask so the rendered
 *  roster is deterministic. Rows with no plaidItemId are skipped. */
export function visibleAccountsByItem(
  rows: readonly DuplicateSideAccount[],
): Map<string, { id: string; name: string; mask: string | null }[]> {
  const out = new Map<string, { id: string; name: string; mask: string | null }[]>();
  for (const r of rows) {
    if (!r.plaidItemId) continue;
    const bucket = out.get(r.plaidItemId) ?? [];
    bucket.push({ id: r.id, name: r.name, mask: r.mask });
    out.set(r.plaidItemId, bucket);
  }
  for (const bucket of out.values()) {
    bucket.sort((x, y) => x.name.localeCompare(y.name) || (x.mask ?? '').localeCompare(y.mask ?? ''));
  }
  return out;
}

const NO_CONTROL_NOTE = 'No control here yet — use this row’s own controls in the list above.';
const UNSTAMPED_PLAID_NOTE =
  'We can’t tell yet which connection feeds this copy. It resolves after this bank’s next sync.';
/** The same row when NO Plaid connection remains: "after this bank's next sync" would be a wait
 *  for something that can never happen — nothing is left to sync (critic P2). */
const ORPHANED_UNSTAMPED_NOTE =
  'No bank connection is left to update this copy. It still counts until you delete it.';

function nameWithMask(a: { name: string; mask: string | null }): string {
  return a.mask ? `${a.name} ····${a.mask}` : a.name;
}

/** The blast radius of disconnecting one resolved item, split COUNT (server truth, includes rows
 *  the currency guard withholds) from NAMES (only what this page already shows). */
function blastRadius(
  item: DuplicateConnectionInfo,
  visible: readonly { id: string; name: string; mask: string | null }[],
  selfId: string,
): { total: number; others: number; feedsLine: string } {
  // Never claim fewer accounts than we are about to name: accountCount can lag when item→account
  // stamping never completed, and a count under the roster length would read as a lie on screen.
  const total = Math.max(item.accountCount, visible.length);
  const others = Math.max(0, total - 1);
  if (others === 0) return { total, others, feedsLine: 'Feeds only this account.' };

  const siblings = visible.filter((v) => v.id !== selfId);
  const named = siblings.slice(0, 3);
  const hiddenByCap = siblings.length - named.length;
  const withheldByCurrency = Math.max(0, others - siblings.length);
  const plural = others === 1 ? '' : 's';

  if (named.length === 0) {
    // Every sibling is withheld by the #135 currency guard: name none, disclose the gap in words
    // rather than rendering a dangling "Also feeds 2 other accounts:  · ".
    return {
      total,
      others,
      feedsLine: `Also feeds ${others} other account${plural} in another currency, which this page doesn’t show.`,
    };
  }

  const parts = named.map(nameWithMask);
  if (hiddenByCap > 0) parts.push(`and ${hiddenByCap} more`);
  if (withheldByCurrency > 0) parts.push(`plus ${withheldByCurrency} in another currency`);
  return { total, others, feedsLine: `Also feeds ${others} other account${plural}: ${parts.join(' · ')}` };
}

function connectionLineFor(
  acct: DuplicateSideAccount | undefined,
  provider: string,
  item: DuplicateConnectionInfo | null,
  anyConnectionsLeft: boolean,
): string {
  if (!acct) return 'We can’t read this row right now — reload the page.';
  if (provider === 'plaid') {
    if (item) {
      const bank = item.institution ?? 'Connected bank';
      const synced = item.lastSyncedAt ? `last synced ${item.lastSyncedAt}` : 'not synced yet';
      return item.sameBankCount > 1
        ? `Plaid: ${bank} · connection ${item.ordinal} of ${item.sameBankCount} · ${synced}`
        : `Plaid: ${bank} · ${synced}`;
    }
    if (acct.plaidItemId) {
      // The item is gone from the payload. Deletable ⇒ this is the post-disconnect step-2 state
      // and the row still counts; otherwise the page is mid-race and a Disconnect is still safe
      // to offer, but we must not describe a blast radius we cannot read.
      return acct.deletable === true
        ? 'Plaid — this copy’s connection is no longer linked. It stopped updating, but it still counts until you delete it.'
        : 'Plaid — we can’t read this connection’s details right now. Reload the page before disconnecting.';
    }
    // No item linkage recorded (a pre-#256 row). Waiting for "this bank's next sync" is only true
    // while a Plaid connection still exists; with none left, nothing will ever stamp or update it.
    return anyConnectionsLeft
      ? 'Plaid — we can’t tell yet which connection feeds this copy. It resolves after this bank’s next sync.'
      : 'Plaid — no bank connection is left to update this copy. It still counts until you delete it.';
  }
  if (provider === 'simplefin') {
    return acct.deletable === true
      ? 'SimpleFIN — disconnected. This copy stopped updating, but it still counts until you delete it.'
      : 'SimpleFIN — still connected. Disconnect it in Bank sync, below, then a Delete appears here.';
  }
  if (provider === 'manual') return 'Added by hand — edit or delete it on its own row in the list above.';
  return PROVIDER_LABEL[provider] ?? provider;
}

function noteFor(
  acct: DuplicateSideAccount | undefined,
  provider: string,
  anyConnectionsLeft: boolean,
): string {
  if (!acct) return NO_CONTROL_NOTE;
  if (provider === 'manual') {
    return 'You added this one by hand — edit or delete it on its own row in the list above.';
  }
  if (provider === 'simplefin' && acct.deletable !== true) {
    return 'SimpleFIN is still connected. Disconnect it in Bank sync, below, then a Delete appears here.';
  }
  if (provider === 'plaid' && !acct.plaidItemId) {
    return anyConnectionsLeft ? UNSTAMPED_PLAID_NOTE : ORPHANED_UNSTAMPED_NOTE;
  }
  return NO_CONTROL_NOTE;
}

/** One side, everything except the collision breaker and the aria label (both need BOTH sides). */
function sideView(
  ref: { id: string; name: string; provider: string; mask: string | null },
  n: 1 | 2,
  ctx: DuplicatePairContext,
): { view: DuplicateSideView; resolvedInstitution: string | null; itemResolved: boolean } {
  const acct = ctx.accountsById.get(ref.id);
  const provider = acct?.provider ?? ref.provider;
  const itemId = acct?.plaidItemId ?? null;
  const item = itemId ? (ctx.itemsById.get(itemId) ?? null) : null;
  const visible = itemId ? (ctx.visibleByItem.get(itemId) ?? []) : [];
  const pm = providerMask(ref);

  const radius = item && acct ? blastRadius(item, visible, acct.id) : null;

  // ACTION TREE — #295's order, plus the `deletable && !canDelete` guard so a row whose item is
  // already gone can never be offered a Disconnect for it.
  let action: DuplicateSideAction | null = null;
  if (acct) {
    if (acct.deletable === true) {
      if (ctx.canDelete) {
        action = {
          kind: 'delete',
          targetId: acct.id,
          label: 'Delete this copy',
          subLabel: 'its history goes too',
          ariaLabel: '',
          prompt: `Delete ${ref.name} (${pm})? Its stored transactions, statements and balance history go with it. The other copy keeps counting.`,
        };
      }
    } else if (itemId && ctx.canDisconnect) {
      // Offered even when `item` is null: the itemId alone runs disconnectPlaidItem. Never regress
      // an affordance to fix a copy bug — instead say the blast radius is unknown.
      const bank = item?.institution ?? 'this bank';
      const label = item
        ? item.sameBankCount > 1
          ? `Disconnect connection ${item.ordinal}`
          : `Disconnect ${bank}`
        : 'Disconnect this connection';
      const subLabel = radius
        ? `${radius.total} account${radius.total === 1 ? '' : 's'} stop${radius.total === 1 ? 's' : ''} updating`
        : 'we can’t tell what else it feeds';
      const tail =
        'Nothing is deleted: this copy keeps its last balance and keeps counting until you delete it. Reconnecting means signing in at your bank again.';
      const soleTail =
        'Nothing is deleted: it keeps its last balance and keeps counting until you delete it. Reconnecting means signing in at your bank again.';
      const head = item && item.sameBankCount > 1 ? `Disconnect connection ${item.ordinal} at ${bank}?` : `Disconnect ${bank}?`;
      const prompt = !item
        ? `Disconnect the connection behind ${ref.name}? We can’t list what else it feeds right now, so other accounts on it may stop updating too. ${tail}`
        : radius && radius.others > 0
          ? `${head} ${radius.total} accounts stop updating — this one and ${radius.others} more. ${tail}`
          : `${head} This account stops updating. ${soleTail}`;
      action = { kind: 'disconnect', targetId: itemId, label, subLabel, ariaLabel: '', prompt };
    }
  }

  return {
    view: {
      n,
      name: ref.name,
      providerMask: pm,
      connectionLine: connectionLineFor(acct, provider, item, ctx.itemsById.size > 0),
      feedsLine: radius ? radius.feedsLine : null,
      note: action ? null : noteFor(acct, provider, ctx.itemsById.size > 0),
      action,
    },
    resolvedInstitution: provider === 'plaid' ? (item?.institution ?? null) : null,
    itemResolved: item !== null,
  };
}

/** What a control actually resolves. Two controls may look identical ONLY if this matches. */
function actionIdentity(s: DuplicateSideView): string {
  return `${s.action!.kind}:${s.action!.targetId}`;
}

/**
 * THE INVARIANT (#296), applied CARD-WIDE rather than per pair.
 *
 * Pair-local breaking is not enough, and the critic pass proved it: the detector is an all-pairs
 * loop with no transitive collapse, so THREE copies of one real account emit three pairs and the
 * same account appears as side `a` of two of them. A per-pair breaker sees no tie in either pair
 * and the card renders identical faces that delete DIFFERENT accounts — the owner's original
 * complaint, one revision later, in the direction that cascades transactions with no undo.
 *
 * So the rule is keyed on what a control RESOLVES, not on where it sits: two faces are identical
 * if and only if they are the same action on the same target. Same target ⇒ identical is correct
 * and wanted (the same object should look the same everywhere it appears); different targets
 * sharing a label get a stable `(copy N)` in first-appearance order.
 */
function breakLabelCollisions(views: readonly DuplicatePairView[]): void {
  const sides = views.flatMap((v) => [v.a, v.b]).filter((s) => s.action);
  // Snapshot the labels BEFORE mutating any: grouping on a label we are also rewriting would
  // read a half-updated map and mis-number the tail.
  const originals = sides.map((s) => s.action!.label);
  const byLabel = new Map<string, string[]>();
  sides.forEach((s, i) => {
    const seen = byLabel.get(originals[i]) ?? [];
    const id = actionIdentity(s);
    if (!seen.includes(id)) seen.push(id);
    byLabel.set(originals[i], seen);
  });
  sides.forEach((s, i) => {
    const ids = byLabel.get(originals[i]) ?? [];
    if (ids.length < 2) return;
    s.action!.label = `${originals[i]} (copy ${ids.indexOf(actionIdentity(s)) + 1})`;
  });
}

/**
 * Every pair on the card, computed TOGETHER — which is what makes distinctness structural rather
 * than a property of the user's data. Labels are deduped across the whole card, and each aria
 * label is derived only afterwards so it inherits the final label AND carries `row 1`/`row 2`.
 */
export function duplicateCardView(
  pairs: readonly Pick<SuspectedDuplicatePair, 'a' | 'b'>[],
  ctx: DuplicatePairContext,
): DuplicatePairView[] {
  const views = pairs.map((p) => buildPairView(p, ctx));
  breakLabelCollisions(views);
  for (const v of views) {
    for (const s of [v.a, v.b]) {
      if (s.action) {
        s.action.ariaLabel = `${s.action.label} — ${s.action.subLabel} — row ${s.n}: ${s.name} (${s.providerMask})`;
      }
    }
  }
  return views;
}

/** One pair, as a card of one — so a single-pair caller gets the same guarantees. */
export function duplicatePairView(
  pair: Pick<SuspectedDuplicatePair, 'a' | 'b'>,
  ctx: DuplicatePairContext,
): DuplicatePairView {
  return duplicateCardView([pair], ctx)[0];
}

/** One pair's content, before any card-wide label dedup or aria derivation. */
function buildPairView(
  pair: Pick<SuspectedDuplicatePair, 'a' | 'b'>,
  ctx: DuplicatePairContext,
): DuplicatePairView {
  const a = sideView(pair.a, 1, ctx);
  const b = sideView(pair.b, 2, ctx);

  const label = (p: string) => PROVIDER_LABEL[p] ?? p;
  let why: string;
  if (pair.a.provider === pair.b.provider) {
    const sameBank =
      pair.a.provider === 'plaid' &&
      a.itemResolved &&
      b.itemResolved &&
      a.resolvedInstitution !== null &&
      a.resolvedInstitution === b.resolvedInstitution;
    why = sameBank
      ? `Two separate Plaid connections to ${a.resolvedInstitution} both report this account.`
      : `Two separate ${label(pair.a.provider)} connections both report this account.`;
  } else {
    why = `${label(pair.a.provider)} and ${label(pair.b.provider)} both report this account.`;
  }

  // The cost of doing nothing, in the money the user actually sees. Omitted entirely rather than
  // rendered as a $0.00 placeholder when a row is missing — a wrong number is worse than none.
  const acctA = ctx.accountsById.get(pair.a.id);
  const acctB = ctx.accountsById.get(pair.b.id);
  const impact =
    acctA && acctB
      ? `Both are counted right now: ${formatCents(cents(acctA.currentBalanceCents))} + ${formatCents(
          cents(acctB.currentBalanceCents),
        )} = ${formatCents(cents(acctA.currentBalanceCents + acctB.currentBalanceCents))}.`
      : null;

  return { why, impact, a: a.view, b: b.view };
}

/** True when at least one side of at least one pair offers a Disconnect — gates the two-step
 *  howto sentence, which is FALSE for a card whose sides are all already disconnected. */
export function cardOffersDisconnect(views: readonly DuplicatePairView[]): boolean {
  return views.some((v) => v.a.action?.kind === 'disconnect' || v.b.action?.kind === 'disconnect');
}
