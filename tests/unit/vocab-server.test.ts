/**
 * Learned vocabulary persistence (server/vocab.ts) against the real DB — the whole
 * ladder end to end, plus the two properties a critic should care about most:
 * a shadow entry is NEVER served, and one user's vocabulary is invisible and
 * untouchable to another (TASKS 2.3 / DECISIONS #225).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { DEMO_USER_ID } from '@/lib/demo-user';
import {
  getServableVocab,
  listLearnedPhrases,
  lookupVocab,
  retireVocabEntry,
  runVocabMining,
} from '@/server/vocab';

const USER_A = `vocab-a-${Date.now()}-${process.pid}`;
const USER_B = `vocab-b-${Date.now()}-${process.pid}`;
const QUESTION = 'How much did I blow on groceries?';
const SCRUBBED = 'how much did i blow on groceries';
const PHRASE = 'how much did i blow on groceries';

/** One ledger row, at an explicit instant (the miner's support/held-out boundary). */
async function ledger(userId: string, resolvedIntent: string, at: Date, scrubbedText = SCRUBBED) {
  await prisma.unknownQuestion.create({
    data: { userId, scrubbedText, resolvedIntent, createdAt: at },
  });
}

const ago = (ms: number) => new Date(Date.now() - ms);

async function entryFor(userId: string) {
  return prisma.vocabEntry.findFirst({ where: { userId, phrase: PHRASE } });
}

describe('server/vocab — the learning ladder', () => {
  beforeAll(async () => {
    await prisma.user.create({ data: { id: USER_A, email: `${USER_A}@test.local` } });
    await prisma.user.create({ data: { id: USER_B, email: `${USER_B}@test.local` } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [USER_A, USER_B] } } });
  });

  beforeEach(async () => {
    await prisma.vocabEntry.deleteMany({ where: { userId: { in: [USER_A, USER_B] } } });
    await prisma.unknownQuestion.deleteMany({ where: { userId: { in: [USER_A, USER_B] } } });
  });

  it('mints a SHADOW entry from three independent agreeing rescues — and does not serve it', async () => {
    for (const ms of [30_000, 20_000, 10_000]) await ledger(USER_A, 'spend_by_category', ago(ms));

    expect(await runVocabMining(USER_A)).toEqual({ minted: 1, promoted: 0, retired: 0, updated: 0, recheckRetired: 0 });

    const e = await entryFor(USER_A);
    expect(e?.status).toBe('shadow');
    expect(e?.kind).toBe('spend_by_category');
    expect(e?.supportCount).toBe(3);
    // The whole point of the shadow band: learned, but answering nothing yet.
    expect(await getServableVocab(USER_A)).toEqual([]);
    expect(await lookupVocab(USER_A, QUESTION)).toBeNull();
    // …and still visible to the user, so nothing is learned in secret.
    expect((await listLearnedPhrases(USER_A)).map((p) => p.status)).toEqual(['shadow']);
  });

  it('promotes to FLAGGED only on held-out agreement, and then serves the KIND', async () => {
    for (const ms of [30_000, 20_000, 10_000]) await ledger(USER_A, 'spend_by_category', ago(ms));
    await runVocabMining(USER_A);
    const minted = await entryFor(USER_A);

    // Two asks that arrived AFTER the mint, routed by the LLM, which the rule never
    // influenced — the audit's "held-out replay".
    await ledger(USER_A, 'spend_by_category', new Date(minted!.createdAt.getTime() + 1_000));
    await ledger(USER_A, 'spend_by_category', new Date(minted!.createdAt.getTime() + 2_000));

    expect(await runVocabMining(USER_A)).toEqual({ minted: 0, promoted: 1, retired: 0, updated: 0, recheckRetired: 0 });

    const e = await entryFor(USER_A);
    expect(e?.status).toBe('flagged');
    expect(e?.heldOutHits).toBe(2);
    expect(e?.promotedAt).not.toBeNull();

    const hit = await lookupVocab(USER_A, QUESTION);
    expect(hit).toEqual({ entryId: e!.id, phrase: PHRASE, kind: 'spend_by_category', status: 'flagged' });
  });

  it('promotes FLAGGED → ACTIVE on its own disclosed serves, which are never evidence', async () => {
    for (const ms of [30_000, 20_000, 10_000]) await ledger(USER_A, 'spend_by_category', ago(ms));
    await runVocabMining(USER_A);
    const minted = await entryFor(USER_A);
    await ledger(USER_A, 'spend_by_category', new Date(minted!.createdAt.getTime() + 1_000));
    await ledger(USER_A, 'spend_by_category', new Date(minted!.createdAt.getTime() + 2_000));
    await runVocabMining(USER_A);

    // Two answers the entry itself gave (tagged vocab:) — served, never held-out hits.
    await ledger(USER_A, 'vocab:spend_by_category', new Date(minted!.createdAt.getTime() + 3_000));
    await ledger(USER_A, 'vocab:spend_by_category', new Date(minted!.createdAt.getTime() + 4_000));

    expect(await runVocabMining(USER_A)).toEqual({ minted: 0, promoted: 1, retired: 0, updated: 0, recheckRetired: 0 });
    const e = await entryFor(USER_A);
    expect(e?.status).toBe('active');
    expect(e?.servedCount).toBe(2);
    expect(e?.heldOutHits).toBe(2); // NOT 4 — its own answers did not confirm it
  });

  it('retires on a single held-out disagreement, and stops serving immediately', async () => {
    for (const ms of [30_000, 20_000, 10_000]) await ledger(USER_A, 'spend_by_category', ago(ms));
    await runVocabMining(USER_A);
    const minted = await entryFor(USER_A);
    await ledger(USER_A, 'income', new Date(minted!.createdAt.getTime() + 1_000));

    expect(await runVocabMining(USER_A)).toEqual({ minted: 0, promoted: 0, retired: 1, updated: 0, recheckRetired: 0 });
    expect((await entryFor(USER_A))?.status).toBe('retired');
    expect(await lookupVocab(USER_A, QUESTION)).toBeNull();
    expect(await listLearnedPhrases(USER_A)).toEqual([]);
  });

  it('a user rejection is TERMINAL — no amount of later evidence resurrects the phrase', async () => {
    for (const ms of [30_000, 20_000, 10_000]) await ledger(USER_A, 'spend_by_category', ago(ms));
    await runVocabMining(USER_A);
    const e = await entryFor(USER_A);

    expect(await retireVocabEntry(USER_A, e!.id)).toBe(true);
    expect(await retireVocabEntry(USER_A, e!.id)).toBe(false); // idempotent

    // Ten more agreeing asks — the miner must still refuse to re-learn it.
    for (let i = 1; i <= 10; i += 1) {
      await ledger(USER_A, 'spend_by_category', new Date(e!.createdAt.getTime() + i * 1_000));
    }
    expect(await runVocabMining(USER_A)).toEqual({ minted: 0, promoted: 0, retired: 0, updated: 0, recheckRetired: 0 });
    expect(await prisma.vocabEntry.count({ where: { userId: USER_A } })).toBe(1);
    expect((await entryFor(USER_A))?.status).toBe('retired');
    expect(await lookupVocab(USER_A, QUESTION)).toBeNull();
  });

  it('re-running the miner on unchanged evidence writes nothing (recomputed, not ratcheted)', async () => {
    for (const ms of [30_000, 20_000, 10_000]) await ledger(USER_A, 'spend_by_category', ago(ms));
    await runVocabMining(USER_A);
    const first = await entryFor(USER_A);

    expect(await runVocabMining(USER_A)).toEqual({ minted: 0, promoted: 0, retired: 0, updated: 0, recheckRetired: 0 });
    const second = await entryFor(USER_A);
    expect(second).toEqual(first);
  });

  it('never mints from a context-dependent (frame-resolved) phrasing', async () => {
    for (const ms of [30_000, 20_000, 10_000]) await ledger(USER_A, 'spend_by_category', ago(ms), 'and what about groceries');
    await ledger(USER_A, 'frame:spend_by_category', ago(5_000), 'and what about groceries');
    expect(await runVocabMining(USER_A)).toEqual({ minted: 0, promoted: 0, retired: 0, updated: 0, recheckRetired: 0 });
    expect(await prisma.vocabEntry.count({ where: { userId: USER_A } })).toBe(0);
  });
});

describe('server/vocab — ownership isolation', () => {
  beforeAll(async () => {
    await prisma.user.create({ data: { id: `${USER_A}-iso`, email: `${USER_A}-iso@test.local` } });
    await prisma.user.create({ data: { id: `${USER_B}-iso`, email: `${USER_B}-iso@test.local` } });
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [`${USER_A}-iso`, `${USER_B}-iso`] } } });
  });

  const A = `${USER_A}-iso`;
  const B = `${USER_B}-iso`;

  it("one user's asks never teach another user's parser, and B cannot retire A's entry", async () => {
    for (const ms of [30_000, 20_000, 10_000]) await ledger(A, 'spend_by_category', ago(ms));
    await runVocabMining(A);
    await runVocabMining(B);

    // B's ledger is empty, so B learned nothing from A's repeated asks.
    expect(await prisma.vocabEntry.count({ where: { userId: B } })).toBe(0);
    expect(await lookupVocab(B, QUESTION)).toBeNull();
    expect(await listLearnedPhrases(B)).toEqual([]);

    // And B cannot reach into A's vocabulary with a known id.
    const aEntry = await entryFor(A);
    expect(await retireVocabEntry(B, aEntry!.id)).toBe(false);
    expect((await entryFor(A))?.status).toBe('shadow');
  });
});

// ─── #226 hostile-critic regressions (fresh-context Fable, cycle 1) ───────────

describe('test_regression__vocab_miner_clobbers_tombstone (#226 P1)', () => {
  const U = `${USER_A}-race`;
  beforeAll(async () => {
    await prisma.user.create({ data: { id: U, email: `${U}@test.local` } });
  });
  afterAll(async () => {
    await prisma.user.delete({ where: { id: U } });
  });

  it('a rejection landing mid-mining-run is NOT reverted by the stale write', async () => {
    // The miner READS, decides, then WRITES. A user who clicked "Not what I meant"
    // inside that window used to have their rejection overwritten by the stale
    // decision — and the rejection lives nowhere else, so it was gone for good, the
    // entry resumed serving, and it went on to self-promote.
    for (const ms of [30_000, 20_000, 10_000]) await ledger(U, 'spend_by_category', ago(ms));
    await runVocabMining(U);
    const e = await prisma.vocabEntry.findFirstOrThrow({ where: { userId: U } });
    await ledger(U, 'spend_by_category', new Date(e.createdAt.getTime() + 1_000));
    await ledger(U, 'spend_by_category', new Date(e.createdAt.getTime() + 2_000));

    // The race, exactly: the user retires the entry while a run that has already
    // decided "promote to flagged" is about to write.
    expect(await retireVocabEntry(U, e.id)).toBe(true);
    await runVocabMining(U);

    const after = await prisma.vocabEntry.findFirstOrThrow({ where: { userId: U } });
    expect(after.status).toBe('retired'); // the tombstone always wins
    expect(await lookupVocab(U, QUESTION)).toBeNull();
  });
});

describe('test_regression__vocab_demo_user_never_learns (#226 P1)', () => {
  afterEach(async () => {
    await prisma.vocabEntry.deleteMany({ where: { userId: DEMO_USER_ID } });
    await prisma.unknownQuestion.deleteMany({ where: { userId: DEMO_USER_ID } });
  });

  it('the shared demo account mines nothing, serves nothing, and lists nothing', async () => {
    // The demo login is credential-free and ONE-CLICK: every anonymous visitor is the
    // SAME user row. A learned phrase is text a visitor TYPED — mining it would render
    // one stranger's words in the next visitor's /settings, under copy promising the
    // opposite. (The scrub masks emails, amounts and digits — not names or clinics.)
    for (const ms of [30_000, 20_000, 10_000]) {
      await ledger(DEMO_USER_ID, 'spend_by_category', ago(ms), 'can melissa and i afford the clinic');
    }
    expect(await runVocabMining(DEMO_USER_ID)).toEqual({
      minted: 0,
      promoted: 0,
      retired: 0,
      updated: 0,
      recheckRetired: 0,
    });
    expect(await prisma.vocabEntry.count({ where: { userId: DEMO_USER_ID } })).toBe(0);

    // Belt and braces: even a hand-planted entry is never served or listed for demo.
    await prisma.vocabEntry.create({
      data: { userId: DEMO_USER_ID, phrase: PHRASE, kind: 'spend_by_category', status: 'active' },
    });
    expect(await getServableVocab(DEMO_USER_ID)).toEqual([]);
    expect(await lookupVocab(DEMO_USER_ID, QUESTION)).toBeNull();
    expect(await listLearnedPhrases(DEMO_USER_ID)).toEqual([]);
  });
});

describe('test_regression__vocab_weekly_independent_recheck (#226 P1)', () => {
  const U = `${USER_A}-recheck`;
  const origXai = process.env.XAI_API_KEY;
  const origAnthropic = process.env.ANTHROPIC_API_KEY;

  beforeAll(async () => {
    await prisma.user.create({ data: { id: U, email: `${U}@test.local` } });
  });
  afterAll(async () => {
    await prisma.user.delete({ where: { id: U } });
  });
  beforeEach(async () => {
    await prisma.vocabEntry.deleteMany({ where: { userId: U } });
    await prisma.unknownQuestion.deleteMany({ where: { userId: U } });
  });
  afterEach(() => {
    if (origXai === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = origXai;
    if (origAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = origAnthropic;
    vi.restoreAllMocks();
  });

  /** Once an entry SERVES it short-circuits the LLM, so the ledger can never
   *  contradict it again. This weekly replay is the only thing that can — the audit's
   *  constitution (e), "reverted automatically on metric regression". */
  const serving = () =>
    prisma.vocabEntry.create({
      data: { userId: U, phrase: PHRASE, kind: 'spend_by_category', status: 'active' },
    });

  const mockClassifier = (kind: string) => {
    process.env.XAI_API_KEY = 'xai-test-key';
    return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify({ intent: kind }) } }] }),
        { status: 200 },
      ),
    );
  };

  it('retires a SERVING entry the independent resolver now disagrees with, and says so', async () => {
    await serving();
    mockClassifier('income');

    expect((await runVocabMining(U)).recheckRetired).toBe(1);
    expect((await prisma.vocabEntry.findFirstOrThrow({ where: { userId: U } })).status).toBe('retired');
    expect(await lookupVocab(U, QUESTION)).toBeNull();

    // A machine-initiated un-learning is never silent, and is distinguishable from the
    // user's own "Not what I meant" in the trail (#226 cycle 2).
    const log = await prisma.auditLog.findFirst({ where: { userId: U, action: 'vocab.retired.recheck' } });
    expect(log).not.toBeNull();
    expect(JSON.parse(log!.meta as string)).toMatchObject({ learnedKind: 'spend_by_category', verdict: 'income' });
  });

  it('leaves it serving when the independent resolver agrees', async () => {
    await serving();
    mockClassifier('spend_by_category');

    expect((await runVocabMining(U)).recheckRetired).toBe(0);
    expect((await prisma.vocabEntry.findFirstOrThrow({ where: { userId: U } })).status).toBe('active');
  });

  it('changes nothing with no provider key — no opinion is not a disagreement', async () => {
    await serving();
    delete process.env.XAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    expect((await runVocabMining(U)).recheckRetired).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect((await prisma.vocabEntry.findFirstOrThrow({ where: { userId: U } })).status).toBe('active');
  });
});
