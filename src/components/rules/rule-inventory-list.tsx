'use client';

/**
 * The rules the reader made WITHOUT the builder (TASKS O.13d / O.15 slice 3).
 *
 * Every row here filed money on no screen before this component existed. Tapping
 * "Always" in the inbox mints a durable rule keyed to one payee; filing a whole
 * merchant from the register does the same; and a rule whose payee was later
 * deleted, or whose typed key decoded to nothing, kept its row while the engine
 * quietly stopped running it. None of the three appeared in "Your rules", and the
 * delete action was scoped so none of them could be removed anywhere.
 *
 * The list is deliberately plain: no edit. Changing what an "Always" rule does means
 * deciding it is a different rule — delete it and file the payee again, or write a
 * typed rule that outranks it. Offering an edit box here would invite the reader to
 * re-point a rule at a category and expect the past to move with it, which is the
 * one thing deleting a rule explicitly does not do.
 *
 * FORM MECHANICS: no form. A single destructive action per row, guarded by its own
 * busy flag (docs/lessons/mutation-form-recipe.md — never `useActionState`).
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { InventoryEntry, RuleRefusal } from '@/lib/engine/categorize/rule-inventory';
import { taxClassLabel } from '@/lib/engine/tax/classes';
import { deleteRule } from '@/server/rule-inventory';
import { describeConditions } from './rule-conditions';

/**
 * Why the engine ignores a stored rule, in the reader's words. Each sentence names
 * the CAUSE and the remedy, because "this rule does nothing" without a reason reads
 * as a bug in the app rather than a consequence of something that happened.
 */
const REFUSAL_COPY: Record<RuleRefusal, string> = {
  'orphan-merchant':
    'This rule points at a payee that is no longer in your data, so it files nothing. Deleting it changes no transaction.',
  'aggregate-merchant':
    'This payee name stands for many different people or businesses — like Venmo, Zelle or a check — so Aimplifi will not let a rule file on that name alone. Write a rule with words from the statement text instead.',
  'empty-keyword-key':
    'The words this rule matched on are gone, and a rule with no words would match every transaction, so it files nothing. Delete it and write the rule again.',
};

/**
 * What this rule is ABOUT, in one phrase.
 *
 * Every branch here was a wrong sentence in the first version of this component: one
 * fallback string called every refused rule "a payee that is no longer here", so an
 * aggregate rule announced a missing payee directly above a sentence naming it as
 * Venmo, a typed rule with a rotted key was described as a payee it never had, and a
 * rule with no conditions at all — the broadest possible row — read as the most
 * harmless one (critic P1-3, P2-5).
 */
function subjectOf(e: InventoryEntry): { lead: string; name: string } {
  // REFUSAL FIRST, then identity — deliberately not origin first, which is how the
  // second version still got it wrong (cycle-2 F1): an `origin === 'typed'` branch
  // placed ahead of these swallowed a typed rule refused for a MERCHANT reason and
  // announced "whose words are gone" above a paragraph explaining the payee was
  // Venmo. The words were not gone. Whatever the engine refused this row FOR is what
  // the row must say, and it is the same fact the paragraph beneath states.
  if (e.refusal === 'empty-keyword-key') {
    return { lead: 'file transactions matching', name: 'words that are no longer stored' };
  }
  if (e.refusal === 'orphan-merchant') {
    return { lead: 'always file', name: 'a payee that is no longer in your data' };
  }
  if (e.refusedCanonical) return { lead: 'always file', name: e.refusedCanonical };
  if (e.merchantCanonical) return { lead: 'always file', name: e.merchantCanonical };
  if (e.matchesEverything) return { lead: 'always file', name: 'every transaction' };
  // An ACTIVE typed rule, which this list never receives (the builder's list owns
  // those). Kept total rather than clever: a phrase is cheaper than a crash if the
  // partition ever changes.
  return { lead: 'file transactions matching', name: 'the words you typed' };
}

export function RuleInventoryList({
  entries,
  categoryNameById,
  accountNameById,
  hasLearnedRules,
  isDemo,
}: {
  entries: InventoryEntry[];
  categoryNameById: Record<string, string>;
  accountNameById: Record<string, string>;
  hasLearnedRules: boolean;
  isDemo: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onDelete(id: string) {
    if (busy) return;
    setBusy(id);
    setError(null);
    try {
      await deleteRule(id);
      router.refresh();
    } catch {
      setError('That rule could not be deleted just now — please try again.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2" data-testid="rule-inventory">
      {/* Not "Rules from filing a payee": a typed rule whose key rotted is listed here
          too, and it was not made by filing a payee (cycle-2 F8). */}
      <h2 className="text-sm font-medium">Everything else filing your money</h2>
      {entries.length === 0 ? (
        isDemo ? (
          <p className="text-sm text-muted-foreground" data-testid="inventory-empty-demo">
            The demo account is shared by everyone trying Aimplifi, so rules made here aren&rsquo;t
            saved to your account and won&rsquo;t file anything later. Choosing <b>Always</b> while
            filing still files the transactions in front of you. Sign up for your own account to keep
            rules.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground" data-testid="inventory-empty">
            When you choose <b>Always</b> while filing a transaction, Aimplifi saves a rule for that
            payee and it will appear here.
          </p>
        )
      ) : (
        <ul className="space-y-2" data-testid="inventory-list">
          {entries.map((e) => {
            const extras = describeConditions(e.conditions, accountNameById);
            const { lead, name } = subjectOf(e);
            const categoryName = categoryNameById[e.categoryId] ?? e.categoryId;
            // `aria-label` REPLACES the button's content for a screen reader, so it
            // carries the conditions the visible row shows. Without them, two rules
            // differing only by condition had identical accessible names and the
            // non-sighted reader got strictly less than the sighted one (cycle-2 F3).
            // The tag action rides the SAME string the screen reader gets and the
            // same line the sighted reader sees (O.15 slice 6) — a rule that writes
            // a tax tag may not be described by a sentence that mentions only the
            // category, on either surface.
            const taxLabel = taxClassLabel(e.setTaxClass);
            const described = [
              lead,
              name,
              extras.length ? `(${extras.join(', ')})` : '',
              `as ${categoryName}${taxLabel ? `, tagged ${taxLabel} for taxes` : ''}`,
            ]
              .filter(Boolean)
              .join(' ');
            return (
              <li
                key={e.id}
                className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2"
                data-testid="inventory-rule-row"
                data-active={e.active ? 'true' : 'false'}
              >
                <div className="min-w-0 text-sm">
                  <span className="text-muted-foreground">{lead} </span>
                  <b className="break-words">{name}</b>
                  {extras.length > 0 && (
                    <span className="text-xs text-muted-foreground"> ({extras.join(', ')})</span>
                  )}
                  <span className="text-muted-foreground"> as </span>
                  <b className="break-words">{categoryName}</b>
                  {taxLabel && (
                    <span className="text-muted-foreground" data-testid="inventory-rule-tax">
                      , tagged <b className="break-words text-foreground">{taxLabel}</b> for taxes
                    </span>
                  )}
                  {!e.active && e.refusal && (
                    <p className="mt-1 text-xs text-muted-foreground" data-testid="inventory-inert">
                      <b className="text-foreground">Not running. </b>
                      {REFUSAL_COPY[e.refusal]}
                    </p>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0"
                  onClick={() => onDelete(e.id)}
                  disabled={busy !== null}
                  aria-label={`Delete the rule: ${described}`}
                  data-testid="inventory-delete"
                >
                  {busy === e.id ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <Trash2 className="size-4" aria-hidden />
                  )}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {error && (
        <p className="text-sm text-destructive" role="alert" data-testid="inventory-error">
          {error}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Deleting a rule stops it filing anything new. Transactions it already filed keep the category
        and any tax tag it gave them — nothing is silently un-categorized or un-tagged.
      </p>
      {hasLearnedRules && (
        <p className="text-xs text-muted-foreground" data-testid="inventory-learned">
          Aimplifi has also picked up patterns from categories you corrected yourself — when you file
          the same payee the same way a few times, it starts filing it for you. Those are not rules
          you wrote, so they are not listed here and there is nothing to delete: they are worked out
          again from your corrections every time, and they change when you re-file a transaction or
          undo a change.
        </p>
      )}
    </div>
  );
}
