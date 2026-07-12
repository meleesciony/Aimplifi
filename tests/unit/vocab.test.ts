import { describe, expect, it } from 'vitest';
import {
  MAX_ENTRIES_PER_USER,
  MIN_SUPPORT,
  matchVocab,
  mineVocab,
  normalizePhrase,
  type ServableVocabEntry,
  type VocabDecision,
  type VocabEntryState,
  type VocabLedgerRow,
} from '@/lib/engine/vocab/vocab';

/**
 * Learned vocabulary (TASKS 2.3 / DECISIONS #225).
 *
 * Following the #223 lesson (context-carrying features are judged by what they
 * ABSTAIN on), the majority of these cases assert that the miner REFUSES to learn:
 * from too little evidence, from disagreeing evidence, from its OWN answers, from a
 * context-dependent fragment, or from a phrase a user has already rejected.
 */

const MINT_AT = 1_000;
const row = (o: Partial<VocabLedgerRow> = {}): VocabLedgerRow => ({
  scrubbedText: 'how much did i blow on groceries',
  resolvedIntent: 'spend_by_category',
  at: 500,
  ...o,
});
const entry = (o: Partial<VocabEntryState> = {}): VocabEntryState => ({
  id: 'e1',
  phrase: 'how much did i blow on groceries',
  kind: 'spend_by_category',
  status: 'shadow',
  createdAt: MINT_AT,
  // The held-out boundary is the newest SUPPORTING row, not the clock (#226): rows
  // at or before it are support, rows after it are held out.
  evidenceThrough: MINT_AT,
  ...o,
});
const only = (d: VocabDecision[]): VocabDecision => {
  expect(d).toHaveLength(1);
  return d[0];
};

// ─── normalizePhrase — one key space for the raw question and the ledger ──────

describe('normalizePhrase', () => {
  it('scrubs, lowercases and depunctuates a raw question', () => {
    expect(normalizePhrase('How much did I BLOW on groceries?')).toBe('how much did i blow on groceries');
  });

  it('is idempotent on already-scrubbed ledger text (the miner reads scrubbedText)', () => {
    const once = normalizePhrase('Can I retire at 60?');
    expect(once).toBe('can i retire at [num]');
    expect(normalizePhrase(once)).toBe(once);
  });

  it('masks digits, so one key spans the parameters intentFromKind re-derives', () => {
    // The whole point: 60 vs 67 is an AGE the answer path re-parses from the raw
    // question — the phrase must not fork on it.
    expect(normalizePhrase('can i retire at 60')).toBe(normalizePhrase('can i retire at 67'));
  });

  it('masks currency amounts the same way', () => {
    expect(normalizePhrase('can i sock away $15,000 by december')).toBe(
      normalizePhrase('can i sock away $9,000 by december'),
    );
  });

  it('collapses apostrophe spellings onto one key', () => {
    expect(normalizePhrase("what's my burn rate")).toBe(normalizePhrase('whats my burn rate'));
  });

  it('refuses a too-short key', () => {
    expect(normalizePhrase('why not')).toBe('');
  });

  it('refuses a key with fewer than three tokens', () => {
    expect(normalizePhrase('spending breakdown')).toBe('');
  });

  it('refuses an all-placeholder key (no words survived the scrub)', () => {
    expect(normalizePhrase('60 70 80 90')).toBe('');
  });

  it('refuses empty / whitespace input', () => {
    expect(normalizePhrase('')).toBe('');
    expect(normalizePhrase('   ')).toBe('');
  });

  it('refuses an over-long key', () => {
    expect(normalizePhrase('spend '.repeat(60))).toBe('');
  });
});

// ─── matchVocab — kind only, never a parameter ───────────────────────────────

describe('matchVocab', () => {
  const servable = (o: Partial<ServableVocabEntry> = {}): ServableVocabEntry => ({
    id: 'e1',
    phrase: 'how much did i blow on groceries',
    kind: 'spend_by_category',
    status: 'active',
    ...o,
  });

  it('matches the raw question against the stored key and returns the KIND', () => {
    const hit = matchVocab('How much did I blow on groceries?', [servable()]);
    expect(hit).toEqual({
      entryId: 'e1',
      phrase: 'how much did i blow on groceries',
      kind: 'spend_by_category',
      status: 'active',
    });
    // A match carries no timeframe, no target, no merchant — there is nothing else
    // on the object to carry. The answer path re-derives all of it.
    expect(Object.keys(hit!).sort()).toEqual(['entryId', 'kind', 'phrase', 'status']);
  });

  it('matches across a masked parameter (asked at 60, learned at 67)', () => {
    const e = servable({ phrase: 'can i retire at [num]', kind: 'retire_at_age' });
    expect(matchVocab('Can I retire at 60?', [e])?.kind).toBe('retire_at_age');
  });

  it('returns null with no entries (the shipped path is byte-identical)', () => {
    expect(matchVocab('how much did i blow on groceries', [])).toBeNull();
  });

  it('returns null for a question that is not the learned phrase', () => {
    expect(matchVocab('how much did i blow on rent', [servable()])).toBeNull();
  });

  it('refuses an entry whose kind is not in the closed routable set', () => {
    expect(matchVocab('how much did i blow on groceries', [servable({ kind: 'transfer_money' })])).toBeNull();
  });

  it('refuses a question that normalizes to nothing', () => {
    expect(matchVocab('why not', [servable({ phrase: 'why not' })])).toBeNull();
  });
});

// ─── mineVocab — what it REFUSES to learn ────────────────────────────────────

describe('mineVocab — abstention', () => {
  it('does not mint below MIN_SUPPORT agreeing resolutions', () => {
    const rows = Array.from({ length: MIN_SUPPORT - 1 }, (_, i) => row({ at: i }));
    expect(mineVocab(rows, [])).toEqual([]);
  });

  it('does not mint when the independent resolutions disagree', () => {
    const rows = [
      row({ at: 1, resolvedIntent: 'spend_by_category' }),
      row({ at: 2, resolvedIntent: 'spend_by_category' }),
      row({ at: 3, resolvedIntent: 'income' }),
    ];
    expect(mineVocab(rows, [])).toEqual([]);
  });

  it('does not mint from rows nothing could route (`unknown`)', () => {
    const rows = [1, 2, 3, 4].map((at) => row({ at, resolvedIntent: 'unknown' }));
    expect(mineVocab(rows, [])).toEqual([]);
  });

  it('does not mint from its OWN answers — a vocab row is never evidence', () => {
    const rows = [1, 2, 3, 4].map((at) => row({ at, resolvedIntent: 'vocab:spend_by_category' }));
    expect(mineVocab(rows, [])).toEqual([]);
  });

  it('does not mint a context-DEPENDENT phrasing, even with unanimous evidence', () => {
    // "and groceries?" once resolved against the previous turn ⇒ a context-free rule
    // for it would answer a question the user never asked (the #222 note).
    const rows = [
      row({ at: 1, resolvedIntent: 'spend_by_category' }),
      row({ at: 2, resolvedIntent: 'spend_by_category' }),
      row({ at: 3, resolvedIntent: 'spend_by_category' }),
      row({ at: 4, resolvedIntent: 'frame:spend_by_category' }),
    ];
    expect(mineVocab(rows, [])).toEqual([]);
  });

  it('never re-mints a retired phrase, however much evidence arrives', () => {
    const rows = Array.from({ length: 10 }, (_, i) => row({ at: i }));
    expect(mineVocab(rows, [entry({ status: 'retired' })])).toEqual([]);
  });

  it('ignores rows whose text is not a mineable question', () => {
    const rows = [1, 2, 3].map((at) => row({ at, scrubbedText: 'why not' }));
    expect(mineVocab(rows, [])).toEqual([]);
  });
});

describe('mineVocab — minting and the ladder', () => {
  it('mints at shadow on MIN_SUPPORT unanimous independent resolutions', () => {
    const rows = Array.from({ length: MIN_SUPPORT }, (_, i) => row({ at: i }));
    expect(only(mineVocab(rows, []))).toEqual({
      op: 'mint',
      phrase: 'how much did i blow on groceries',
      kind: 'spend_by_category',
      status: 'shadow',
      changed: true,
      evidence: { supportCount: 3, heldOutHits: 0, heldOutMisses: 0, servedCount: 0 },
      evidenceThrough: 2, // the newest supporting row — the held-out line (#226)
    });
  });

  it('promotes shadow → flagged on two HELD-OUT agreements (asks after the mint)', () => {
    const rows = [
      row({ at: 100 }), // support (pre-mint)
      row({ at: 200 }),
      row({ at: 300 }),
      row({ at: MINT_AT + 1 }), // held-out
      row({ at: MINT_AT + 2 }),
    ];
    const d = only(mineVocab(rows, [entry()]));
    expect(d.status).toBe('flagged');
    expect(d.changed).toBe(true);
    expect(d.evidence).toEqual({ supportCount: 3, heldOutHits: 2, heldOutMisses: 0, servedCount: 0 });
  });

  it('does NOT promote on pre-mint agreements — held-out means held out', () => {
    const rows = Array.from({ length: 8 }, (_, i) => row({ at: i })); // all before MINT_AT
    const d = mineVocab(rows, [entry()]);
    expect(d[0]?.status).toBe('shadow');
    expect(d[0]?.changed).toBe(false);
  });

  it('does NOT promote shadow on its own served rows (a shadow entry is never served anyway)', () => {
    const rows = [
      row({ at: MINT_AT + 1, resolvedIntent: 'vocab:spend_by_category' }),
      row({ at: MINT_AT + 2, resolvedIntent: 'vocab:spend_by_category' }),
    ];
    const d = mineVocab(rows, [entry()]);
    expect(d[0]?.status).toBe('shadow');
  });

  it('promotes flagged → active after MIN_SERVED disclosed serves', () => {
    const rows = [
      row({ at: MINT_AT + 1, resolvedIntent: 'vocab:spend_by_category' }),
      row({ at: MINT_AT + 2, resolvedIntent: 'vocab:spend_by_category' }),
    ];
    const d = only(mineVocab(rows, [entry({ status: 'flagged' })]));
    expect(d.status).toBe('active');
    expect(d.changed).toBe(true);
    expect(d.evidence.servedCount).toBe(2);
  });

  it('holds flagged at one serve', () => {
    const rows = [row({ at: MINT_AT + 1, resolvedIntent: 'vocab:spend_by_category' })];
    expect(mineVocab(rows, [entry({ status: 'flagged' })])[0].status).toBe('flagged');
  });

  it('leaves an active entry active', () => {
    const rows = [1, 2, 3].map((i) => row({ at: MINT_AT + i, resolvedIntent: 'vocab:spend_by_category' }));
    expect(mineVocab(rows, [entry({ status: 'active' })])[0].status).toBe('active');
  });
});

describe('mineVocab — fail-safe retirement', () => {
  it('retires a shadow entry on a SINGLE held-out disagreement', () => {
    const rows = [
      row({ at: MINT_AT + 1 }),
      row({ at: MINT_AT + 2 }),
      row({ at: MINT_AT + 3, resolvedIntent: 'income' }),
    ];
    const d = only(mineVocab(rows, [entry()]));
    expect(d.status).toBe('retired');
    expect(d.changed).toBe(true);
    expect(d.evidence.heldOutMisses).toBe(1);
  });

  it('retires a flagged entry on a single held-out disagreement', () => {
    const rows = [row({ at: MINT_AT + 1, resolvedIntent: 'income' })];
    expect(only(mineVocab(rows, [entry({ status: 'flagged' })])).status).toBe('retired');
  });

  it('retires an ACTIVE entry whose phrase turns out to be context-dependent', () => {
    const rows = [row({ at: MINT_AT + 1, resolvedIntent: 'frame:spend_by_category' })];
    expect(only(mineVocab(rows, [entry({ status: 'active' })])).status).toBe('retired');
  });

  it('a disagreement outranks a promotion in the same run', () => {
    const rows = [
      row({ at: MINT_AT + 1 }),
      row({ at: MINT_AT + 2 }), // would have promoted shadow → flagged
      row({ at: MINT_AT + 3, resolvedIntent: 'top_categories' }),
    ];
    expect(only(mineVocab(rows, [entry()])).status).toBe('retired');
  });
});

describe('mineVocab — recomputed from scratch, never incremented', () => {
  const rows = [
    row({ at: 100 }),
    row({ at: 200 }),
    row({ at: 300 }),
    row({ at: MINT_AT + 1 }),
    row({ at: MINT_AT + 5, resolvedIntent: 'vocab:spend_by_category' }),
  ];

  it('re-deriving the same ledger twice yields identical counts (no ratchet)', () => {
    const a = mineVocab(rows, [entry()]);
    const b = mineVocab(rows, [entry()]);
    expect(a).toEqual(b);
    expect(a[0].evidence).toEqual({ supportCount: 3, heldOutHits: 1, heldOutMisses: 0, servedCount: 1 });
  });

  it('writes nothing when neither the status nor the counts moved', () => {
    const stored = new Map([['e1', { supportCount: 3, heldOutHits: 1, heldOutMisses: 0, servedCount: 1 }]]);
    expect(mineVocab(rows, [entry()], stored)).toEqual([]);
  });

  it('recomputes counts DOWN when the evidence shrinks', () => {
    const stored = new Map([['e1', { supportCount: 9, heldOutHits: 9, heldOutMisses: 0, servedCount: 9 }]]);
    const d = only(mineVocab([row({ at: 100 })], [entry()], stored));
    expect(d.evidence).toEqual({ supportCount: 1, heldOutHits: 0, heldOutMisses: 0, servedCount: 0 });
    expect(d.changed).toBe(false);
  });

  it('mines each phrase independently', () => {
    const mixed = [
      ...Array.from({ length: 3 }, (_, i) => row({ at: i })),
      ...Array.from({ length: 3 }, (_, i) => row({ at: i, scrubbedText: 'what is my burn rate', resolvedIntent: 'spend_total' })),
    ];
    const d = mineVocab(mixed, []);
    expect(d.map((x) => [x.phrase, x.kind]).sort()).toEqual([
      ['how much did i blow on groceries', 'spend_by_category'],
      ['what is my burn rate', 'spend_total'],
    ]);
  });
});

// ─── #226 hostile-critic regressions (fresh-context Fable, cycle 1) ───────────

describe('test_regression__vocab_non_ascii_key_collapse (#226)', () => {
  it('refuses to key a phrase with non-ASCII content — two payees are not one rule', () => {
    // Normalization deletes everything outside [a-z0-9[]], so these two questions —
    // naming DIFFERENT people — used to collapse to the identical key
    // "how much do i owe for rent share" and share one learned rule.
    expect(normalizePhrase('how much do i owe 田中 for rent share')).toBe('');
    expect(normalizePhrase('how much do i owe 房东 for rent share')).toBe('');
  });

  it('still keys a curly apostrophe (non-ASCII, but nothing is being dropped)', () => {
    expect(normalizePhrase('what’s the damage on groceries')).toBe('whats the damage on groceries');
  });
});

describe('test_regression__vocab_heldout_boundary_is_data_not_clock (#226)', () => {
  // The boundary is the newest SUPPORTING row, not the miner's wall clock. A row
  // stamped by a fast-clocked instance used to land "after" the mint time and be
  // recounted as held-out evidence for a rule it helped create — self-validation
  // through clock skew, defeating the one gate that makes a promotion mean anything.
  it('counts a row at or before the evidence boundary as SUPPORT, never held-out', () => {
    const e = entry({ createdAt: 500, evidenceThrough: 3_000 }); // mint clock ran EARLY
    const rows = [row({ at: 1_000 }), row({ at: 2_000 }), row({ at: 3_000 })];
    const d = mineVocab(rows, [e]);
    expect(d[0].evidence).toEqual({ supportCount: 3, heldOutHits: 0, heldOutMisses: 0, servedCount: 0 });
    expect(d[0].status).toBe('shadow'); // NOT promoted on its own supporting rows
  });

  it('mints with the boundary set to the newest supporting row', () => {
    const rows = [row({ at: 10 }), row({ at: 900 }), row({ at: 400 })];
    expect(only(mineVocab(rows, [])).evidenceThrough).toBe(900);
  });
});

describe('test_regression__vocab_entry_cap (#226)', () => {
  it('mints no more than MAX_ENTRIES_PER_USER live entries, best-supported first', () => {
    const live = Array.from({ length: MAX_ENTRIES_PER_USER - 1 }, (_, i) =>
      entry({ id: `live-${i}`, phrase: `existing phrase number ${i}`, status: 'active' }),
    );
    // Two candidates, one slot: the better-supported phrase wins, deterministically.
    const rows = [
      ...Array.from({ length: 3 }, (_, i) => row({ at: i, scrubbedText: 'what is my burn rate' })),
      ...Array.from({ length: 5 }, (_, i) => row({ at: i, scrubbedText: 'whats the damage on groceries' })),
    ];
    const minted = mineVocab(rows, live).filter((d) => d.op === 'mint');
    expect(minted).toHaveLength(1);
    expect(minted[0].phrase).toBe('whats the damage on groceries');
  });
});
