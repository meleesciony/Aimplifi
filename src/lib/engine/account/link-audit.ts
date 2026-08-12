/**
 * U.15 — re-audit a CONFIRMED supersession against today's rules.
 *
 * A confirmed `AccountReconciliation` says "these two rows are the same real account", and the
 * app acts on it permanently: the predecessor's balance stops counting and the claim span decides
 * which side owns which transactions. Nothing in the app has ever re-examined one of those rows
 * after it was written — so when the detector learns a new refusal, every pair it would now
 * refuse keeps being honoured. Measured on the owner's production data 2026-08-12: nine confirmed
 * links pair accounts that are not the same account (three distinct Schwab 529 plans under one
 * Vanguard 401k, three distinct Schwab IRAs under one Vanguard Roth IRA, two cardholders' cards),
 * and FOUR of them were already ones the shipped detector would refuse to propose. That is
 * `docs/lessons/prevention-is-not-a-remedy.md` exactly: the fix shipped, the instance stayed.
 *
 * Pure: no React, no DB, no `new Date()`, no model calls. Deterministic output ordering.
 *
 * WHAT THIS MAY AND MAY NOT CLAIM. The audit re-runs `detectDuplicateAccounts` — the SAME
 * function that proposes pairs in the first place — rather than re-implementing the matching
 * rules, so there is one author and the audit cannot drift from the proposer. Its verdict is
 * therefore exactly "would the app offer this pair today?", which is a checkable fact about the
 * app. It is NOT a claim that the accounts are different, and this module never renders one: the
 * user confirmed the pair and may know something the feeds do not. The strongest thing it says
 * is what the evidence shows — that the two rows advertise account numbers that do not
 * correspond, or registrations that conflict.
 *
 * ABSENCE IS NOT REFUSAL. The detector abstains on pairs it is not built to judge (two rows from
 * ONE provider connection, where ingest already dedups). An abstention must never be rendered as
 * "we would no longer propose this" — that would flag every same-connection link as suspect. It
 * gets its own verdict, `not-checkable`.
 */

import {
  type DuplicateAccountCandidate,
  accountNumbersConflict,
  advertisedAccountNumbers,
  detectDuplicateAccounts,
} from '@/lib/engine/account/duplicates';
import { registrationsConflict } from '@/lib/engine/account/registration';

/**
 * A confirmed link, as stored. Deliberately the four fields `getActiveReconciliations` already
 * selects: the audit judges the two ACCOUNTS, so `matchSignal` and `confidence` — what the app
 * believed when the pair was proposed — are exactly the stale beliefs it must not defer to.
 */
export interface AuditableLink {
  id: string;
  predecessorAccountId: string;
  successorAccountId: string;
  cutoverDate: string;
}

export type LinkAuditVerdict =
  /** Today's detector would still propose this pair. */
  | 'still-supported'
  /** Today's detector would NOT propose it — the app would not create this link now. */
  | 'unsupported'
  /** The detector does not judge this shape at all; its silence says nothing either way. */
  | 'not-checkable'
  /** A side no longer exists, so the link already has no effect (R7). */
  | 'inert';

export interface LinkAuditRow {
  link: AuditableLink;
  verdict: LinkAuditVerdict;
  predecessorName: string | null;
  successorName: string | null;
  /** Why the detector reached its verdict — the reasons it fired, or the conflicts it found. */
  evidence: string[];
}

/** The specific, checkable conflicts — each a fact about the two rows, never a conclusion. */
function conflictEvidence(lo: DuplicateAccountCandidate, hi: DuplicateAccountCandidate): string[] {
  const out: string[] = [];
  if (lo.type !== hi.type) out.push(`different account kinds (${lo.type} and ${hi.type})`);
  if (registrationsConflict(lo, hi)) {
    out.push('one is a Roth and the other is not — a registration is a fact about the account');
  }
  if (accountNumbersConflict(lo, hi)) {
    const a = advertisedAccountNumbers(lo).join(', ');
    const b = advertisedAccountNumbers(hi).join(', ');
    out.push(`the account numbers don’t match (${a} and ${b})`);
  }
  return out;
}

/**
 * Re-audit every confirmed link. `accounts` must be the user's FULL account set — a link whose
 * side is missing from it is reported `inert` rather than judged, which is the same direction
 * `effectiveReconciliationLinks` takes for a deleted or currency-withheld side.
 *
 * Ordering is deterministic: unsupported first (the only actionable verdict), then by the
 * predecessor's name, then by link id — never by a raw id alone, which would order the list by
 * something the reader cannot see.
 */
export function auditConfirmedLinks(
  accounts: readonly DuplicateAccountCandidate[],
  links: readonly AuditableLink[],
): LinkAuditRow[] {
  const byId = new Map(accounts.map((a) => [a.id, a]));

  const rows = links.map((link): LinkAuditRow => {
    const pred = byId.get(link.predecessorAccountId);
    const succ = byId.get(link.successorAccountId);
    if (!pred || !succ) {
      return {
        link,
        verdict: 'inert',
        predecessorName: pred?.name ?? null,
        successorName: succ?.name ?? null,
        evidence: ['one of these accounts is no longer here, so the link already has no effect'],
      };
    }

    // The detector skips pairs inside ONE provider connection because ingest already dedups
    // there. That is an abstention, not a refusal, and must not be read as one.
    const sameConnection =
      pred.provider === succ.provider &&
      !(
        pred.provider === 'plaid' &&
        pred.plaidItemId != null &&
        succ.plaidItemId != null &&
        pred.plaidItemId !== succ.plaidItemId
      );
    if (sameConnection) {
      return {
        link,
        verdict: 'not-checkable',
        predecessorName: pred.name,
        successorName: succ.name,
        evidence: ['both rows come from one connection, which these checks don’t judge'],
      };
    }

    // TWO independent grounds, because they answer different questions and the app needs both.
    //
    // The detector's refusal answers "would we offer this today?" — but the detector is a GATE on
    // what the app proposes, and U.14 proved a gate must stay conservative: widening it to read
    // account numbers out of names hid a genuine duplicate and turned a withheld L.9 ambiguity into
    // a one-click Combine (reverted the same session; see `duplicates.ts`). Evidence too dangerous
    // to gate on is not too dangerous to SHOW, because the failure directions are not the same. A
    // wrong flag here is a visible sentence beside an Undo the reader already had, and they can
    // ignore it; a wrong gate silently changes what counts.
    //
    // So the audit reads that evidence directly, and the copy says which ground it stands on.
    const conflicts = conflictEvidence(pred, succ);
    const proposed = detectDuplicateAccounts([pred, succ]);
    if (proposed.length > 0 && conflicts.length === 0) {
      return {
        link,
        verdict: 'still-supported',
        predecessorName: pred.name,
        successorName: succ.name,
        evidence: proposed[0].reasons,
      };
    }

    return {
      link,
      verdict: 'unsupported',
      predecessorName: pred.name,
      successorName: succ.name,
      // A pair can fail to be proposed with no NAMED conflict — the positive signals simply stopped
      // firing (a feed renamed the account). Say that, rather than implying evidence we don't have.
      evidence: conflicts.length > 0 ? conflicts : ['nothing about these two rows matches any more'],
    };
  });

  const rank: Record<LinkAuditVerdict, number> = {
    unsupported: 0,
    'still-supported': 1,
    'not-checkable': 2,
    inert: 3,
  };
  return rows.sort(
    (p, q) =>
      rank[p.verdict] - rank[q.verdict] ||
      (p.predecessorName ?? '').localeCompare(q.predecessorName ?? '') ||
      p.link.id.localeCompare(q.link.id),
  );
}

/** How many links the app would not create today — the number a surface leads with. */
export function unsupportedLinkCount(rows: readonly LinkAuditRow[]): number {
  return rows.filter((r) => r.verdict === 'unsupported').length;
}
