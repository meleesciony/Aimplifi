/**
 * READ-ONLY production probe — O.18: before hiding the combine/duplicate
 * machinery on /accounts, MEASURE what that page actually renders for the
 * owner today.
 *
 * The task row's hypothesis is that "13 connections across 7 institutions ⇒
 * many same-bank lookalike pairs, and every pair that produces no offer renders
 * its own explanation block". That is a hypothesis about a count. This probe
 * calls the page's OWN loader (`getAccountsView`) rather than re-deriving the
 * predicates in SQL — re-deriving them would be a guess about the very
 * suppression rules (`suppressCombineProposals`, dismissed-pair keys) the
 * design has to preserve.
 *
 * Questions, before any code is written:
 *   Q1  How many of the five cards are non-empty for him — i.e. how tall is the
 *       wall above his actual accounts?
 *   Q2  How many blocked-reason blocks RENDER? The card filters
 *       `kind !== 'already-linked'` (combine-connections-card.tsx:77), so the
 *       stored count and the rendered count are different numbers.
 *   Q3  Which blocks carry a claim about a MONEY FIGURE printed on this same
 *       page (a double-count warning, an already-applied combine) versus an
 *       offer of an action? That decides what may go behind a tap silently and
 *       what the summary line must still say.
 *   Q4  Is a deepen-shaped pair live right now (constraint (b): the deepen
 *       flow's closing step is combine)?
 *
 * Every statement is a SELECT; nothing is written.
 */
import { readFileSync } from 'node:fs';

const env = readFileSync(new URL('../../.env.prod.tmp', import.meta.url), 'utf8');
for (const raw of env.split(/\r?\n/)) {
  const line = raw.trim();
  if (!line || line.startsWith('#')) continue;
  const eq = line.indexOf('=');
  if (eq <= 0) continue;
  const key = line.slice(0, eq).trim();
  const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
  if (key === 'DATABASE_URL' || key === 'DATA_ENCRYPTION_KEY') process.env[key] = value;
}

const { prisma } = await import('../../src/lib/db');
const { getAccountsView } = await import('../../src/server/transactions');

const users = await prisma.user.findMany({ select: { id: true, email: true } });

for (const u of users) {
  const accountCount = await prisma.account.count({ where: { userId: u.id } });
  if (accountCount === 0) continue;

  const v = await getAccountsView(u.id);

  const offers = v.combinableConnections.length;
  const blockedStored = v.uncombinableConnections.length;
  // The card's own filter — the number of explanation blocks that REACH the screen.
  const blockedRendered = v.uncombinableConnections.filter(
    (b: { kind?: string }) => b.kind !== 'already-linked',
  ).length;
  const candidates = v.reconciliationCandidates.length;
  const ambiguities = v.reconciliationAmbiguities.length;
  const combined = v.reconciliations.length;
  const duplicates = v.duplicates.length;

  const cardsRendered = [
    offers + blockedRendered > 0,
    candidates > 0,
    ambiguities > 0,
    combined > 0,
    duplicates > 0,
  ].filter(Boolean).length;

  console.log(`\n=== ${u.email} (${accountCount} accounts, ${v.plaid.items.length} plaid connections) ===`);
  console.log(`  CARDS RENDERED ABOVE THE ACCOUNT LIST: ${cardsRendered} of 5`);
  console.log(`  combine offers .................. ${offers}`);
  console.log(`  blocked reasons: stored ${blockedStored} / RENDERED ${blockedRendered}`);
  console.log(`  reconciliation candidates ....... ${candidates}`);
  console.log(`  reconciliation ambiguities ...... ${ambiguities}`);
  console.log(`  combined (active, w/ Undo) ...... ${combined}`);
  console.log(`  advisory duplicate pairs ........ ${duplicates}`);

  if (blockedRendered > 0) {
    const byKind = new Map<string, number>();
    for (const b of v.uncombinableConnections as { kind?: string }[]) {
      if (b.kind === 'already-linked') continue;
      byKind.set(b.kind ?? '(none)', (byKind.get(b.kind ?? '(none)') ?? 0) + 1);
    }
    console.log(`  blocked-reason kinds: ${[...byKind].map(([k, n]) => `${k}×${n}`).join(', ')}`);
  }

  // Q4 — is a deepen-shaped pair live (two same-bank connections, one holding
  // deeper feed history)? The planner already computes feed depth per direction.
  for (const p of v.combinableConnections as { directions?: { keepItemId: string; dropItemId: string; keepFeedFirst?: string | null; dropFeedFirst?: string | null }[] }[]) {
    for (const d of p.directions ?? []) {
      console.log(`  direction keep=${d.keepItemId.slice(0, 8)} drop=${d.dropItemId.slice(0, 8)} keepFeedFirst=${d.keepFeedFirst ?? 'null'} dropFeedFirst=${d.dropFeedFirst ?? 'null'}`);
    }
  }
}

await prisma.$disconnect();
