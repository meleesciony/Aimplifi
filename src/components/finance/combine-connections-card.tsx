'use client';

/**
 * "Two connections are pulling the same account" — the /accounts card (TASKS L.6 / L.10).
 *
 * The owner's case, verified from his 2026-07-24 screenshots: two Plaid connections at Chase,
 * each carrying `CREDIT CARD ····0977`, both live, both counting. R3 can never propose this pair
 * (a reconciliation needs one stale side), so before this card the app's only answer was an
 * advisory note and its only remedy was deleting a row along with its history.
 *
 * Two structural rules here, both from the critic pass:
 *
 *   * **Each direction owns its own sentences.** The first version rendered one paragraph — built
 *     from the RECOMMENDED direction — above both buttons, so the alternative button sat under
 *     prose naming the opposite connection as the one about to be disconnected. For an act the
 *     user cannot reverse, the text above the button must describe the button.
 *   * **Two-step confirm**, the repo's `useConfirmArm` pattern, same as every other destructive
 *     control on this page (Delete, Disconnect). The irreversible half is named in the prompt
 *     itself, not only in prose the reader may not have reached.
 *
 * Every sentence comes from `combine-connections-copy.ts` and is tested there. This file decides
 * layout and which control exists, never what a claim says.
 */
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmPrompt, useConfirmArm } from '@/components/ui/confirm-action';
import type { CombineConnectionsProposal, CombineDirection } from '@/lib/engine/account/combine-connections';
import {
  combineCardTitle,
  combineConfirmPrompt,
  combineEvidence,
  combineHeading,
  combineOutcome,
  combineReversibilityNote,
  combineStrandedNote,
  connectionLabel,
} from '@/components/finance/combine-connections-copy';
import { connectionOrdinals } from '@/components/finance/duplicate-card-view';

export interface CombineConnectionsCardProps {
  proposals: readonly CombineConnectionsProposal[];
  /** The page's connection rows — the source of the "connection N of M" label the user can see. */
  items: readonly { itemId: string; institution: string | null }[];
  pending: boolean;
  onCombine: (direction: CombineDirection, keepLabel: string, dropLabel: string) => void;
  /** "These are not the same account." Dismissing a pair suppresses this offer AND the advisory
   *  warning for it — the same judgment, recorded once. Without it this card would be permanent
   *  and undismissable for anyone whose two look-alike rows are genuinely two accounts. */
  onDismiss: (predecessorAccountId: string, successorAccountId: string) => void;
}

export function CombineConnectionsCard({
  proposals,
  items,
  pending,
  onCombine,
  onDismiss,
}: CombineConnectionsCardProps) {
  const { isArmed, arm, disarm } = useConfirmArm();
  if (proposals.length === 0) return null;
  const ordinals = connectionOrdinals(items);
  const institutionOf = new Map(items.map((i) => [i.itemId, i.institution]));
  const label = (itemId: string) => connectionLabel(institutionOf.get(itemId) ?? null, ordinals.get(itemId));

  return (
    <Card data-testid="combine-connections-card" className="border-amber-900/50">
      <CardHeader>
        <CardTitle className="text-base">{combineCardTitle(proposals.length)}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {proposals.map((p) => {
          const accounts = p.recommended.pairs.map((pair) => ({ name: pair.successorName, mask: pair.mask }));
          const reasons = [...new Set(p.recommended.pairs.flatMap((pair) => pair.reasons))];
          const directions = [p.recommended, ...(p.alternative ? [p.alternative] : [])];
          const pairKey = `${p.recommended.keepItemId}|${p.recommended.dropItemId}`;
          return (
            <div key={pairKey} className="space-y-3 text-sm">
              {/* Per proposal, not per card: two proposals can be at two different banks, and one
                  shared heading named whichever bank sorted first (critic P2-7). */}
              <p className="font-medium" data-testid="combine-connections-heading">
                {combineHeading(p.institutionLabel)}
              </p>
              <p data-testid="combine-connections-evidence">{combineEvidence(accounts, reasons)}</p>

              {directions.map((direction, i) => {
                const keepLabel = label(direction.keepItemId);
                const dropLabel = label(direction.dropItemId);
                const armKey = `combine:${direction.keepItemId}|${direction.dropItemId}`;
                const armedNow = isArmed(armKey);
                const testid = i === 0 ? 'combine-connections-confirm' : 'combine-connections-alternative';
                return (
                  <div
                    key={armKey}
                    className="space-y-2 rounded-lg border border-border/60 p-3"
                    data-testid="combine-connections-option"
                  >
                    <p className="text-muted-foreground">
                      {combineOutcome(keepLabel, dropLabel, direction.pairs.map((pair) => ({ name: pair.successorName, mask: pair.mask })))}
                    </p>
                    <p className="text-muted-foreground">{combineReversibilityNote(dropLabel)}</p>
                    {armedNow ? (
                      <ConfirmPrompt
                        prompt={combineConfirmPrompt(keepLabel, dropLabel)}
                        confirmLabel="Yes, combine"
                        confirmTestId={`${testid}-yes`}
                        rowTestId="combine-connections-confirm-row"
                        pending={pending}
                        onConfirm={() => onCombine(direction, keepLabel, dropLabel)}
                        onCancel={disarm}
                      />
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant={i === 0 ? 'default' : 'outline'}
                        disabled={pending}
                        data-testid={testid}
                        onClick={() => arm(armKey)}
                      >
                        Combine — keep {keepLabel}
                      </Button>
                    )}
                  </div>
                );
              })}

              {p.alternative === null && p.alternativeBlockedNames.length > 0 && (
                <p className="text-muted-foreground" data-testid="combine-connections-blocked">
                  {combineStrandedNote(label(p.recommended.dropItemId), p.alternativeBlockedNames)}
                </p>
              )}

              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={pending}
                data-testid="combine-connections-dismiss"
                onClick={() =>
                  onDismiss(p.recommended.pairs[0].predecessorAccountId, p.recommended.pairs[0].successorAccountId)
                }
              >
                Not the same account
              </Button>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
