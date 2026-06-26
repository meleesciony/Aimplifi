/**
 * Backfill LLM second pass (DECISIONS #117) — drives the REAL core
 * `runBackfillForUser` with an INJECTED LLM stub (no network, no auth mock).
 * Proves: pass 1 (deterministic) still resolves what the rules know; pass 2 (LLM)
 * names a genuinely-unknown row; the #44 inflow sign guard blocks an LLM pick on a
 * positive amount; a row the LLM declines stays in review; and a second run adds
 * nothing.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Mock @/auth to short-circuit the next-auth module load on import (the core
// imports @/server/authz → @/auth); runBackfillForUser takes userId directly, so
// no session is resolved at runtime.
vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { runBackfillForUser, type SuggestCategoryFn } from '@/server/backfill';
import { prisma } from '@/lib/db';

// Names OBSIDIAN as software (above the LLM auto-file bar); declines everything else.
const stubSuggest: SuggestCategoryFn = async ({ rawDescriptor }) =>
  /OBSIDIAN/i.test(rawDescriptor) ? { categoryId: 'software', confidenceBps: 9500 } : null;

describe('runBackfillForUser — LLM second pass (DECISIONS #117)', () => {
  const stamp = `${Date.now()}-${process.pid}`;
  const USER = `backfill-llm-${stamp}`;
  const ids: Record<string, string> = {};

  async function wipe() {
    await prisma.user.deleteMany({ where: { id: USER } });
  }

  beforeAll(async () => {
    await wipe();
    for (const c of [
      { id: 'uncategorized', name: 'Uncategorized' },
      { id: 'dental-insurance', name: 'Dental Insurance' },
      { id: 'software', name: 'Software & Cloud' },
    ]) {
      await prisma.category.upsert({ where: { id: c.id }, update: {}, create: { id: c.id, name: c.name, isSystem: true } });
    }
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
    const acct = await prisma.account.create({
      data: { userId: USER, provider: 'demo', name: 'T', type: 'CHECKING', currentBalanceCents: 0 },
    });
    async function txn(key: string, rawDescriptor: string, amountCents: number) {
      const t = await prisma.transaction.create({
        data: { accountId: acct.id, date: '2026-06-10', rawDescriptor, amountCents, categoryId: 'uncategorized', needsReview: true, confidenceBps: 5000 },
      });
      ids[key] = t.id;
    }
    await txn('det', 'DELTA DENTAL OF GA PREMIUM', -4500); // pass 1 → dental-insurance
    await txn('llm', 'PADDLE.NET* OBSIDIAN', -1200); // pass 2 (LLM) → software
    await txn('inflowLlm', 'PADDLE.NET* OBSIDIAN', 1200); // LLM says software but inflow → sign guard blocks
    await txn('unknown', 'ACME WIDGETS LLC 7781', -2000); // LLM declines → stays in review
  });
  afterAll(wipe);

  const cat = async (id: string) => (await prisma.transaction.findUnique({ where: { id } }))!;

  it('resolves rules in pass 1 and the unknown tail via the LLM in pass 2', async () => {
    const res = await runBackfillForUser(USER, stubSuggest);
    expect(res.scanned).toBe(4);
    expect(res.refiled).toBe(2); // dental (rules) + obsidian (LLM)
    expect(res.llmRefiled).toBe(1);
    expect(res.stillUnsure).toBe(2); // inflow-blocked + declined

    const det = await cat(ids.det);
    expect(det.categoryId).toBe('dental-insurance');
    expect(det.needsReview).toBe(false);
    expect(det.confidenceBps).toBe(8500); // deterministic generic-rule confidence

    const llm = await cat(ids.llm);
    expect(llm.categoryId).toBe('software');
    expect(llm.needsReview).toBe(false);
    expect(llm.confidenceBps).toBe(9500); // the LLM's own confidence

    // sign guard: a positive-amount OBSIDIAN is NOT booked as software spend
    const inflow = await cat(ids.inflowLlm);
    expect(inflow.categoryId).toBe('uncategorized');
    expect(inflow.needsReview).toBe(true);

    // the LLM declined this one → stays in review
    const unknown = await cat(ids.unknown);
    expect(unknown.needsReview).toBe(true);
  });

  it('is idempotent — a second run re-files nothing new', async () => {
    const res = await runBackfillForUser(USER, stubSuggest);
    expect(res.refiled).toBe(0);
    expect(res.scanned).toBe(2); // only the two still-unsure rows remain to scan
  });
});
