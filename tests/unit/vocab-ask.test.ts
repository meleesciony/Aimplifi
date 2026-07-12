/**
 * The routing wire-in (server/assistant.ts) with a learned vocabulary present
 * (TASKS 2.3 / DECISIONS #225). These are the properties a hostile critic should
 * try hardest to break:
 *
 *  1. A question the PARSER routes is byte-identical whether a learned entry exists
 *     or not — the vocabulary can never re-interpret a question that stands alone.
 *  2. A learned entry supplies a KIND only; the timeframe is re-derived from the
 *     asker's own words, so the same phrase asked about a different window answers
 *     the window they NAMED.
 *  3. A vocab-resolved ask is ledgered as `vocab:<kind>`, so the miner can never
 *     count its own answer as evidence for itself.
 *  4. Nothing is served silently: the answer carries the learned disclosure.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';

// Hoisted so the mock factory below (which vitest lifts to the top of the file) can
// close over it. The real authz module pulls NextAuth, which has no place in a unit
// run — the same reason the cron path never imports it.
const { USER } = vi.hoisted(() => ({ USER: `vocab-ask-${Date.now()}-${process.pid}` }));
vi.mock('@/server/authz', () => ({
  requireUserId: async () => USER,
  rateLimitDurable: async () => true,
}));

const { askAssistant } = await import('@/server/assistant');

/** A phrasing the deterministic parser genuinely cannot route (asserted below). */
const SLANG = 'Whats the damage on groceries?';
const SLANG_KEY = 'whats the damage on groceries';

const learn = (phrase: string, kind: string, status: 'flagged' | 'active') =>
  prisma.vocabEntry.create({ data: { userId: USER, phrase, kind, status } });

const ledgerRows = () =>
  prisma.unknownQuestion.findMany({ where: { userId: USER }, orderBy: { createdAt: 'asc' } });

describe('askAssistant — learned vocabulary routing', () => {
  const origXai = process.env.XAI_API_KEY;
  const origAnthropic = process.env.ANTHROPIC_API_KEY;

  beforeAll(async () => {
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
  });
  afterAll(async () => {
    await prisma.user.delete({ where: { id: USER } });
  });
  beforeEach(async () => {
    // No provider key: the LLM route is off, so anything that answers here answered
    // DETERMINISTICALLY — the learned rule, or nothing.
    delete process.env.XAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    await prisma.vocabEntry.deleteMany({ where: { userId: USER } });
    await prisma.unknownQuestion.deleteMany({ where: { userId: USER } });
  });
  afterEach(() => {
    if (origXai === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = origXai;
    if (origAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = origAnthropic;
  });

  it('leaves a PARSER-routed question untouched, even with a learned entry for it', async () => {
    const q = 'How much did I blow on groceries?';
    const before = await askAssistant(q);
    // Now teach a rule that maps the SAME phrasing somewhere else entirely. The parser
    // routes this question on its own, so the rule must never get a turn.
    await learn('how much did i blow on groceries', 'net_worth', 'active');
    const after = await askAssistant(q);

    expect(after).toEqual(before);
    expect(after.kind).toBe('spend_by_category');
    expect(after.learned).toBeUndefined();
    // A self-sufficient question is not a vocabulary gap: nothing is ledgered.
    expect(await ledgerRows()).toEqual([]);
  });

  it('routes an unparseable phrasing via the learned KIND and discloses it', async () => {
    expect((await askAssistant(SLANG)).kind).toBe('unknown'); // baseline: nothing routes it
    await learn(SLANG_KEY, 'spend_by_category', 'active');
    const a = await askAssistant(SLANG);

    expect(a.kind).toBe('spend_by_category');
    expect(a.learned?.status).toBe('active');
    expect(a.learned?.phrase).toBe(SLANG_KEY);
    // The CATEGORY was re-derived from the user's own word ("groceries") — the entry
    // stores no category, and could not have supplied one.
    expect(a.intent).toMatchObject({ target: { categoryId: 'groceries' } });
    // `active` is disclosed as learned, not hedged as an LLM guess.
    expect(a.interpreted).toBeUndefined();
  });

  it('a learned KIND cannot invent a category the question does not name', async () => {
    // Same kind, but the phrase names no category the user has. intentFromKind returns
    // null rather than falling back to "all spending" (the #166 hijack), so the answer
    // stays honestly unknown.
    await learn('am i bleeding cash', 'spend_by_category', 'active');
    const a = await askAssistant('Am I bleeding cash?');
    expect(a.kind).toBe('unknown');
    expect(a.learned).toBeUndefined();
  });

  it('hedges a FLAGGED entry exactly like an LLM guess (an inference on trial)', async () => {
    await learn(SLANG_KEY, 'spend_by_category', 'flagged');
    const a = await askAssistant(SLANG);
    expect(a.learned?.status).toBe('flagged');
    expect(a.interpreted).toBe(true);
  });

  it('re-derives the TIMEFRAME from the asker’s words — the entry carries no window', async () => {
    // One phrase, learned once. Asked about two different windows, it must answer the
    // window each question NAMES; the rule supplies only the kind.
    await learn('give me the grocery damage for last month', 'spend_by_category', 'active');
    await learn('give me the grocery damage this month', 'spend_by_category', 'active');

    const last = await askAssistant('Give me the grocery damage for last month');
    const now = await askAssistant('Give me the grocery damage this month');

    expect(last.intent).toMatchObject({ kind: 'spend_by_category' });
    expect(now.intent).toMatchObject({ kind: 'spend_by_category' });
    const lastTf = (last.intent as { timeframe: { fromYm: string } }).timeframe;
    const nowTf = (now.intent as { timeframe: { fromYm: string } }).timeframe;
    expect(lastTf.fromYm).not.toBe(nowTf.fromYm);
  });

  it('ledgers a vocab-resolved ask as `vocab:<kind>` — never as independent evidence', async () => {
    await learn(SLANG_KEY, 'spend_by_category', 'active');
    await askAssistant(SLANG);

    const rows = await ledgerRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.resolvedIntent).toBe('vocab:spend_by_category');
    expect(rows[0]!.llmGuessKind).toBeNull();
  });

  it('falls through to the honest `unknown` when the learned kind cannot be re-derived', async () => {
    // retire_at_age needs an AGE in the question. The phrase has none, so the rule is
    // useless here — and abstaining beats answering a question we can't ground.
    await learn('when can i finally hang it up', 'retire_at_age', 'active');
    const a = await askAssistant('When can I finally hang it up?');

    expect(a.kind).toBe('unknown');
    expect(a.learned).toBeUndefined();
    expect((await ledgerRows())[0]!.resolvedIntent).toBe('unknown');
  });

  it('never serves a shadow entry', async () => {
    await prisma.vocabEntry.create({
      data: { userId: USER, phrase: SLANG_KEY, kind: 'spend_by_category', status: 'shadow' },
    });
    const a = await askAssistant(SLANG);
    expect(a.kind).toBe('unknown');
    expect(a.learned).toBeUndefined();
  });

  it('never serves a retired entry', async () => {
    await prisma.vocabEntry.create({
      data: { userId: USER, phrase: SLANG_KEY, kind: 'spend_by_category', status: 'retired' },
    });
    const a = await askAssistant(SLANG);
    expect(a.kind).toBe('unknown');
    expect(a.learned).toBeUndefined();
  });

  it('with no learned entries at all, an unknown question is unchanged (golden-safe)', async () => {
    const a = await askAssistant('blorp the flibbertigibbet please');
    expect(a.kind).toBe('unknown');
    expect(a.learned).toBeUndefined();
    expect((await ledgerRows())[0]!.resolvedIntent).toBe('unknown');
  });

  it('test_regression__vocab_kind_must_round_trip (#226 P2)', async () => {
    // The phrase key masks digits, so "can i pay off my car by 2027" (a DATE) and
    // "…by 65" (an AGE) collapse to ONE key: `can i pay off my car by [num]`. A rule
    // mined from the date form used to match the age form, where intentFromKind cannot
    // parse a date and silently degrades to `debt_payoff` — answering "you'll be
    // debt-free around <month>" to someone who asked a yes/no question about 65.
    // Nothing had read the actual words: the model never saw them, and the rule was
    // learned from the other form. The kind must ROUND-TRIP or we abstain.
    await learn('can i pay off my car by [num]', 'debt_free_by_date', 'active');

    const dateForm = await askAssistant('Can I pay off my car by 2027?');
    expect(dateForm.kind).toBe('debt_free_by_date'); // round-trips: still a date
    expect(dateForm.learned?.status).toBe('active');

    const ageForm = await askAssistant('Can I pay off my car by 65?');
    expect(ageForm.kind).toBe('unknown'); // does NOT round-trip → abstain
    expect(ageForm.learned).toBeUndefined();
    const rows = await ledgerRows();
    expect(rows[rows.length - 1]!.resolvedIntent).toBe('unknown');
  });
});

describe('test_regression__spend_at_non_ascii_merchant (#226 P1, pre-existing)', () => {
  it('abstains instead of answering the ALL-spending total for a merchant it cannot read', async () => {
    // `extractMerchantPhrase` strips every non-[a-z0-9] character, so "spent at 星巴克"
    // tokenized to nothing, the ascii-only `on <object>` guard never fired, and control
    // fell through to spend_total: the user's TOTAL monthly spending, presented as the
    // answer to a question about ONE store, with no hedge. A true figure under a false
    // question — the cardinal sin. Now it abstains, and the LLM route (which reads the
    // raw words) still gets its turn.
    const a = await askAssistant('How much did I spend at 星巴克 last month?');
    expect(a.kind).toBe('unknown');

    const b = await askAssistant('How much did I spend on 食料品 last month?');
    expect(b.kind).toBe('unknown');

    // The ascii merchant path is untouched.
    const c = await askAssistant('How much did I spend at Costco last month?');
    expect(c.kind).toBe('merchant_spend');
  });
});
