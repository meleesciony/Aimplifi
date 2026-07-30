'use server';

/**
 * The rules the reader can SEE and DELETE (TASKS O.13d, shipped as O.15 slice 3).
 *
 * Before this module, /rules ran a narrower query than the engine: it listed rows
 * with a typed key and nothing else, so every rule minted by the inbox's "Always"
 * button filed money invisibly, and `deleteKeywordRule`'s WHERE was scoped to the
 * same subset, so those rules could not be removed from any surface. This reads
 * through `loadStoredRuleRows` — the SAME query the engine's rule loader uses — and
 * maps it with the SAME mapper, so the page cannot show a set the engine does not
 * run, in either direction.
 *
 * Per docs/lessons (a `'use server'` module exports async functions and nothing
 * else), every constant and pure helper this needs lives in the engine modules it
 * imports.
 */
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { accountLabel } from '@/lib/engine/account/display-name';
import {
  buildRuleInventory,
  type InventoryEntry,
} from '@/lib/engine/categorize/rule-inventory';
import { DEMO_ENTRY_BLOCKED, isDemoUser } from '@/lib/demo-user';
import { auditLog, requireUserId } from '@/server/authz';
import { loadLearnedRules, loadStoredRuleRows } from '@/server/rules';

export interface RuleInventoryView {
  entries: InventoryEntry[];
  /** Display names for the accounts a rule's "only in this account" condition names. */
  accountNameById: Record<string, string>;
  /**
   * Whether the app has LEARNED anything from this reader's corrections (derived
   * rules, no stored row, so nothing to delete here). Neither listed nor COUNTED,
   * both deliberately:
   *
   *  - not listed, because a learned rule is keyed on a descriptor signature, which
   *    has no rendering a reader could act on, and its lever is undoing or re-filing
   *    the correction that taught it;
   *  - not counted, because the derived rules are not one-per-payee. `learn.ts` emits
   *    a signature-keyed rule AND a canonical-keyed one for the same payee (#331), so
   *    a reader who taught the app one merchant would have been told it picked up
   *    "2 patterns" — a false number on a page whose whole premise is that its list is
   *    honest (critic P1-2). A boolean is the claim we can actually support.
   */
  hasLearnedRules: boolean;
  /**
   * The shared demo account, which does not KEEP rules — the fence below returns no
   * entries there, and the page must say why rather than print an empty state that
   * promises a rule will appear (critic P2-4: nothing stops a demo visitor minting one,
   * so the promise is disproved by their own next click).
   */
  isDemo: boolean;
}

/** Every stored rule that files this reader's money, in one stable listing order. */
export async function listRuleInventory(): Promise<RuleInventoryView> {
  const userId = await requireUserId();
  // SHARED-DEMO FENCE, same reason as `listKeywordRules`: every anonymous visitor is
  // the same `user-demo` row, so rendering its rules would show one visitor's typed
  // words — a payee, an employer, a person — to the next. The demo seed writes no
  // rules, so this is empty for the seeded dataset either way; the fence is for what
  // a VISITOR mints with "Always" during their session, which nothing prevents.
  // `isDemo` travels with the empty list so the page can say that instead of
  // promising a rule will show up here.
  if (isDemoUser(userId)) {
    return { entries: [], accountNameById: {}, hasLearnedRules: false, isDemo: true };
  }

  const [{ rules, canonicalById }, learned] = await Promise.all([
    loadStoredRuleRows(userId),
    loadLearnedRules(userId),
  ]);
  const entries = buildRuleInventory(rules, canonicalById);

  const accountIds = [...new Set(entries.map((e) => e.conditions.accountId).filter((x) => !!x))];
  const accounts = accountIds.length
    ? await prisma.account.findMany({
        where: { id: { in: accountIds as string[] }, userId },
        select: { id: true, name: true, displayName: true, type: true },
      })
    : [];

  return {
    entries,
    // `accountLabel` is the one rule for what an account is called, so a condition
    // says what the reader named the account rather than what the bank calls it.
    accountNameById: Object.fromEntries(accounts.map((a) => [a.id, accountLabel(a)])),
    hasLearnedRules: learned.length > 0,
    isDemo: false,
  };
}

/**
 * Delete any rule this reader owns, from the inventory list.
 *
 * IT IS DELIBERATELY NOT SCOPED TO MERCHANT-KEYED ROWS, and the first version of this
 * slice was — which the critic broke (P1-1). The inventory renders every row the
 * builder's list does not, and that includes a TYPED rule whose key decoded to
 * nothing: `matchKeywords: ''` is not `matchKeywords: null`, so a WHERE scoped to the
 * merchant kind matched zero rows, returned `{ deleted: false }` without throwing, and
 * the button spun and did nothing while the copy beside it said "Delete it and write
 * the rule again". A rule that is visible and undeletable is the same dead end this
 * slice exists to close, one screen later.
 *
 * The narrowing bought nothing: `deleteKeywordRule` is reached from a list of the
 * reader's own typed rules and this from a list of the reader's own other rules, so
 * the worst a mis-scope can do is delete a rule its owner can see, on a page whose
 * purpose is deleting rules. The invariant that matters is the one now under test:
 * every entry the inventory renders is removed by the action its button calls.
 *
 * Scoped by userId IN THE WHERE (never fetch-then-delete), and — like its sibling —
 * it deliberately does NOT revert the filings the rule caused. Those are Corrections
 * with their own undo, and silently re-uncategorizing months of rows because a rule
 * was removed is the destructive reading of "delete this rule". The page says so
 * before the click.
 */
export async function deleteRule(ruleId: string): Promise<{ deleted: boolean }> {
  const userId = await requireUserId();
  // The shared demo lists no rules, so this call cannot originate from our own UI
  // there — and in the one row every anonymous visitor shares, a delete would remove
  // a rule ANOTHER visitor is still using. Refused with the same sentence every other
  // demo write refuses with.
  if (isDemoUser(userId)) throw new Error(DEMO_ENTRY_BLOCKED);
  const res = await prisma.categorizationRule.deleteMany({
    where: { id: ruleId, userId },
  });
  if (res.count > 0) await auditLog(userId, 'rule.delete', { ruleId });
  // The same three surfaces `deleteKeywordRule` revalidates: a rule that stops
  // running changes what the inbox proposes and what the register suggests.
  revalidatePath('/rules');
  revalidatePath('/transactions');
  revalidatePath('/triage');
  return { deleted: res.count > 0 };
}
