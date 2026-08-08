/**
 * TASKS H.6b(a) — the pure carry planner: which reader-owned fields move from the rows the
 * boundary disowns onto their successor counterparts, and which never do.
 *
 * The matching is deliberately the most conservative thing that works (C.6's lesson: a loose
 * pair rule once credited 11 refunds as payments): exact (date, amount), and only when exactly
 * one disowned predecessor row and exactly one successor row hold the key. Every data condition
 * skips its row or family — the planner never throws, so a carry can never refuse a combine.
 */
import { describe, expect, it } from 'vitest';

import { isoDate } from '@/lib/dates';
import { type CarryRow, planReaderFieldCarry } from '@/server/combine-connections';

const CUTOVER = isoDate('2026-07-10');

const row = (over: Partial<CarryRow> & { id: string; date: string; amountCents: number }): CarryRow => ({
  isSplitParent: false,
  splitParentId: null,
  categoryId: null,
  confidenceBps: null,
  needsReview: true,
  isTransfer: false,
  reviewPinned: false,
  note: null,
  taxClass: null,
  excludeFromTotals: false,
  reimbursement: null,
  status: 'POSTED',
  rawDescriptor: 'COSTCO',
  merchantId: null,
  hasCorrection: false,
  ...over,
});

describe('planReaderFieldCarry — matching', () => {
  it('carries the reader’s filing onto the uniquely-matched successor row', () => {
    const pred = row({
      id: 'p1', date: '2026-07-11', amountCents: -31_000,
      categoryId: 'groceries', confidenceBps: 10_000, needsReview: false,
      note: 'birthday cake', taxClass: 'FOOD', excludeFromTotals: true, reimbursement: 'EMPLOYER',
      hasCorrection: true,
    });
    const succ = row({ id: 's1', date: '2026-07-11', amountCents: -31_000 });

    const writes = planReaderFieldCarry([pred], [succ], CUTOVER);

    expect(writes).toEqual([
      {
        targetId: 's1',
        data: {
          categoryId: 'groceries', confidenceBps: 10_000, needsReview: false, isTransfer: false,
          note: 'birthday cake', taxClass: 'FOOD', excludeFromTotals: true, reimbursement: 'EMPLOYER',
        },
        moveCorrectionsFrom: ['p1'],
      },
    ]);
  });

  it('never overwrites the successor’s own reader values', () => {
    const pred = row({
      id: 'p1', date: '2026-07-11', amountCents: -31_000,
      categoryId: 'groceries', needsReview: false, note: 'old note', taxClass: 'FOOD',
      excludeFromTotals: true, reimbursement: 'EMPLOYER', hasCorrection: true,
    });
    // The survivor was filed by the reader too, and has its own tags and exclusions.
    const succ = row({
      id: 's1', date: '2026-07-11', amountCents: -31_000,
      categoryId: 'dining', needsReview: false, note: 'mine', taxClass: 'BUSINESS',
      excludeFromTotals: true, reimbursement: 'SELF', hasCorrection: true,
    });

    const writes = planReaderFieldCarry([pred], [succ], CUTOVER);

    // Nothing carried, nothing moved — the survivor's own state is never touched.
    expect(writes).toEqual([]);
  });

  it('the successor’s ENGINE guess does not block the reader’s verdict', () => {
    const pred = row({
      id: 'p1', date: '2026-07-11', amountCents: -31_000,
      categoryId: 'groceries', confidenceBps: 10_000, needsReview: false, hasCorrection: true,
    });
    // The survivor's fresh copy was auto-filed by the pipeline — no Correction, so no reader
    // history — the reader's explicit verdict outranks it, as it outranks the bank's fresh row
    // in the pending→posted transplant.
    const succ = row({
      id: 's1', date: '2026-07-11', amountCents: -31_000,
      categoryId: 'engine-guess', confidenceBps: 5_000, needsReview: false,
    });

    const writes = planReaderFieldCarry([pred], [succ], CUTOVER);

    expect(writes[0]).toEqual({
      targetId: 's1',
      data: { categoryId: 'groceries', confidenceBps: 10_000, needsReview: false, isTransfer: false },
      moveCorrectionsFrom: ['p1'],
    });
  });

  it('a row the engine filed but the reader never decided carries flats only', () => {
    const pred = row({
      id: 'p1', date: '2026-07-11', amountCents: -31_000,
      categoryId: 'groceries', needsReview: false, note: 'weekly shop', hasCorrection: false,
    });
    const succ = row({ id: 's1', date: '2026-07-11', amountCents: -31_000 });

    const writes = planReaderFieldCarry([pred], [succ], CUTOVER);

    // No Correction = no reader decision on the category — the engine's own filing does not
    // travel; the note (a reader value) does.
    expect(writes).toEqual([{ targetId: 's1', data: { note: 'weekly shop' } }]);
  });

  it('a corrected row still flagged for review is not settled — no verdict', () => {
    const pred = row({
      id: 'p1', date: '2026-07-11', amountCents: -31_000,
      categoryId: 'groceries', needsReview: true, hasCorrection: true,
    });
    const succ = row({ id: 's1', date: '2026-07-11', amountCents: -31_000 });

    const writes = planReaderFieldCarry([pred], [succ], CUTOVER);

    expect(writes).toEqual([]);
  });

  it('matches by EXACT date and amount — a drifted copy is skipped, never fuzzy-matched', () => {
    const pred = row({ id: 'p1', date: '2026-07-11', amountCents: -31_000, hasCorrection: true, needsReview: false });
    const succ = row({ id: 's1', date: '2026-07-12', amountCents: -31_000 });
    const succAmount = row({ id: 's2', date: '2026-07-11', amountCents: -31_001 });

    expect(planReaderFieldCarry([pred], [succ], CUTOVER)).toEqual([]);
    expect(planReaderFieldCarry([pred], [succAmount], CUTOVER)).toEqual([]);
  });

  it('two identical charges on either side skip the key — never guess which is which', () => {
    const filed = row({
      id: 'p1', date: '2026-07-15', amountCents: -1_200, categoryId: 'groceries', needsReview: false, hasCorrection: true,
    });
    const twin = row({ id: 'p2', date: '2026-07-15', amountCents: -1_200 });
    const s1 = row({ id: 's1', date: '2026-07-15', amountCents: -1_200 });
    const s2 = row({ id: 's2', date: '2026-07-15', amountCents: -1_200 });

    // Two predecessor copies → the carry cannot assign the filing to either survivor.
    expect(planReaderFieldCarry([filed, twin], [s1], CUTOVER)).toEqual([]);
    // Two survivor copies → same ambiguity.
    expect(planReaderFieldCarry([filed], [s1, s2], CUTOVER)).toEqual([]);
  });

  it('rows the boundary keeps (on or before the cutover) are never carried', () => {
    const kept = row({
      id: 'p1', date: '2026-07-10', amountCents: -200_000, categoryId: 'rent', needsReview: false, hasCorrection: true,
    });
    const succ = row({ id: 's1', date: '2026-07-10', amountCents: -200_000 });

    const writes = planReaderFieldCarry([kept], [succ], CUTOVER);

    // The kept predecessor row stays live — its own filing already applies, no carry needed.
    expect(writes).toEqual([]);
  });
});

describe('planReaderFieldCarry — split families', () => {
  it('carries a split family whole onto the survivor’s plain copy', () => {
    const parent = row({
      id: 'p1', date: '2026-07-15', amountCents: -10_000, isSplitParent: true,
      categoryId: 'dining', needsReview: false, note: 'dinner', hasCorrection: true,
    });
    const c1 = row({
      id: 'c1', date: '2026-07-15', amountCents: -6_000, splitParentId: 'p1',
      categoryId: 'groceries', needsReview: false,
    });
    const c2 = row({
      id: 'c2', date: '2026-07-15', amountCents: -4_000, splitParentId: 'p1',
      categoryId: 'gas', needsReview: false,
    });
    const succ = row({ id: 's1', date: '2026-07-15', amountCents: -10_000 });

    const writes = planReaderFieldCarry([parent, c1, c2], [succ], CUTOVER);

    expect(writes).toEqual([
      {
        targetId: 's1',
        data: {
          categoryId: 'dining', confidenceBps: null, needsReview: false, isTransfer: false,
          note: 'dinner', isSplitParent: true,
        },
        children: [
          expect.objectContaining({ amountCents: -6_000, categoryId: 'groceries', moveCorrectionsFrom: [] }),
          expect.objectContaining({ amountCents: -4_000, categoryId: 'gas', moveCorrectionsFrom: [] }),
        ],
        moveCorrectionsFrom: ['p1'],
      },
    ]);
  });

  it('a family whose parts no longer sum is a STALE split: forced into review, no pre-split verdict', () => {
    const parent = row({
      id: 'p1', date: '2026-07-15', amountCents: -10_000, isSplitParent: true,
      categoryId: 'dining', needsReview: false, note: 'dinner', hasCorrection: true,
    });
    const c1 = row({ id: 'c1', date: '2026-07-15', amountCents: -6_000, splitParentId: 'p1', categoryId: 'groceries', needsReview: false });
    const c2 = row({ id: 'c2', date: '2026-07-15', amountCents: -3_000, splitParentId: 'p1', categoryId: 'gas', needsReview: false });
    const succ = row({ id: 's1', date: '2026-07-15', amountCents: -10_000 });

    const writes = planReaderFieldCarry([parent, c1, c2], [succ], CUTOVER);

    // The reader's allocation is destroyed (the bank amended the charge) — the transplant's
    // dissolve precedent: a destroyed reader decision must re-decide. The flats travel; the
    // pre-split verdict does not, and the survivor is FORCED into review, durably.
    expect(writes).toEqual([
      {
        targetId: 's1',
        data: { note: 'dinner', needsReview: true, reviewPinned: true },
      },
    ]);
  });

  it('a family carried onto a survivor with its OWN filing keeps the survivor’s own review state', () => {
    const parent = row({
      id: 'p1', date: '2026-07-15', amountCents: -10_000, isSplitParent: true,
      categoryId: 'dining', needsReview: false, note: 'dinner', hasCorrection: true,
    });
    const c1 = row({ id: 'c1', date: '2026-07-15', amountCents: -6_000, splitParentId: 'p1', categoryId: 'groceries', needsReview: false });
    const c2 = row({ id: 'c2', date: '2026-07-15', amountCents: -4_000, splitParentId: 'p1', categoryId: 'gas', needsReview: false });
    // The survivor's copy was ALSO hand-filed, and still sits in review — that is its own state.
    const succ = row({
      id: 's1', date: '2026-07-15', amountCents: -10_000,
      categoryId: 'dining', needsReview: true, hasCorrection: true,
    });

    const writes = planReaderFieldCarry([parent, c1, c2], [succ], CUTOVER);

    // The family still carries (the pieces are the reader's allocation on the old copy), the flat
    // note travels, but there is no verdict and no forced needsReview: the survivor's own review
    // demand is never clobbered.
    expect(writes).toEqual([
      {
        targetId: 's1',
        data: { isSplitParent: true, note: 'dinner' },
        children: [
          expect.objectContaining({ amountCents: -6_000, categoryId: 'groceries', moveCorrectionsFrom: [] }),
          expect.objectContaining({ amountCents: -4_000, categoryId: 'gas', moveCorrectionsFrom: [] }),
        ],
      },
    ]);
  });

  it('the survivor’s OWN flat flags follow the money onto the re-created pieces (NEW-1)', () => {
    // The critic's P1: converting a plain survivor into a container made its own reader-owned
    // flags stop being read anywhere — the register lists only children, the tax report leaves
    // containers out entirely (TAX_BLOCKED_SPLIT_PARENT), and the reimbursement line skips
    // containers. The children inherit them, O.15 P1-1's exclusion rule extended to all four:
    // an excluded charge must not count again, a money-owed claim must not vanish, a tax tag
    // must reach the pieces, a note must stay visible.
    const parent = row({
      id: 'p1', date: '2026-07-15', amountCents: -10_000, isSplitParent: true,
      categoryId: 'dining', needsReview: false, note: 'dinner', hasCorrection: true,
    });
    const c1 = row({ id: 'c1', date: '2026-07-15', amountCents: -6_000, splitParentId: 'p1', categoryId: 'groceries', needsReview: false });
    const c2 = row({ id: 'c2', date: '2026-07-15', amountCents: -4_000, splitParentId: 'p1', categoryId: 'gas', needsReview: false });
    // Hand-filed on the NEW side: excluded, awaiting reimbursement, BUSINESS tag, own note.
    const succ = row({
      id: 's1', date: '2026-07-15', amountCents: -10_000,
      excludeFromTotals: true, reimbursement: 'awaiting', taxClass: 'BUSINESS', note: 'my charge',
    });

    const writes = planReaderFieldCarry([parent, c1, c2], [succ], CUTOVER);

    // The container write carries the verdict as usual; every piece inherits the survivor's
    // four flags (the old pieces have none of their own here). The survivor's note also blocks
    // the pred parent's 'dinner' note from reaching the container — survivor wins.
    expect(writes).toEqual([
      {
        targetId: 's1',
        data: {
          categoryId: 'dining', confidenceBps: null, needsReview: false, isTransfer: false,
          isSplitParent: true,
        },
        children: [
          expect.objectContaining({
            amountCents: -6_000,
            note: 'my charge', taxClass: 'BUSINESS', excludeFromTotals: true, reimbursement: 'awaiting',
          }),
          expect.objectContaining({
            amountCents: -4_000,
            note: 'my charge', taxClass: 'BUSINESS', excludeFromTotals: true, reimbursement: 'awaiting',
          }),
        ],
        moveCorrectionsFrom: ['p1'],
      },
    ]);
  });

  it('a SETTLED filing on the survivor wins over a STALE pred family too — no forced review (P1-2 × P1-3)', () => {
    const parent = row({
      id: 'p1', date: '2026-07-15', amountCents: -10_000, isSplitParent: true,
      categoryId: 'dining', needsReview: false, note: 'dinner', hasCorrection: true,
    });
    const c1 = row({ id: 'c1', date: '2026-07-15', amountCents: -6_000, splitParentId: 'p1', categoryId: 'groceries', needsReview: false });
    const c2 = row({ id: 'c2', date: '2026-07-15', amountCents: -3_000, splitParentId: 'p1', categoryId: 'gas', needsReview: false }); // stale: −9,000 ≠ −10,000
    const succ = row({
      id: 's1', date: '2026-07-15', amountCents: -10_000,
      categoryId: 'dining', needsReview: false, hasCorrection: true,
    });

    const writes = planReaderFieldCarry([parent, c1, c2], [succ], CUTOVER);

    // The survivor's own completed decision stands: no family, no verdict, and — despite the
    // stale pred family — NO forced review, because nothing was destroyed on the survivor's own
    // copy. The flats still travel.
    expect(writes).toEqual([
      { targetId: 's1', data: { note: 'dinner' } },
    ]);
  });

  it('a SETTLED filing on the survivor blocks the family — the row would become a container no sum reads (P1-2)', () => {
    const parent = row({
      id: 'p1', date: '2026-07-15', amountCents: -10_000, isSplitParent: true,
      categoryId: 'dining', needsReview: false, note: 'dinner', hasCorrection: true,
    });
    const c1 = row({ id: 'c1', date: '2026-07-15', amountCents: -6_000, splitParentId: 'p1', categoryId: 'groceries', needsReview: false });
    const c2 = row({ id: 'c2', date: '2026-07-15', amountCents: -4_000, splitParentId: 'p1', categoryId: 'gas', needsReview: false });
    // The survivor's copy was completed by the reader: a filing, confirmed, out of review.
    const succ = row({
      id: 's1', date: '2026-07-15', amountCents: -10_000,
      categoryId: 'dining', needsReview: false, hasCorrection: true,
    });

    const writes = planReaderFieldCarry([parent, c1, c2], [succ], CUTOVER);

    // No family, no verdict, no correction move: the survivor's own settled decision stands
    // untouched — the mirror of the clobber this slice exists to fix. The flats still travel.
    expect(writes).toEqual([
      { targetId: 's1', data: { note: 'dinner' } },
    ]);
  });

  it('a split on BOTH sides: the survivor’s own family is untouched, pieces carry flats by unique match', () => {
    const parent = row({
      id: 'p1', date: '2026-07-15', amountCents: -10_000, isSplitParent: true,
      categoryId: 'dining', needsReview: false, note: 'dinner', hasCorrection: true,
    });
    const c1 = row({ id: 'c1', date: '2026-07-15', amountCents: -6_000, splitParentId: 'p1', categoryId: 'groceries', needsReview: false, note: 'veggies' });
    const c2 = row({ id: 'c2', date: '2026-07-15', amountCents: -4_000, splitParentId: 'p1', categoryId: 'gas', needsReview: false });
    const sParent = row({ id: 'sp', date: '2026-07-15', amountCents: -10_000, isSplitParent: true });
    const sc1 = row({ id: 'sc1', date: '2026-07-15', amountCents: -6_000, splitParentId: 'sp', categoryId: 'groceries', needsReview: false });
    const sc2 = row({ id: 'sc2', date: '2026-07-15', amountCents: -4_000, splitParentId: 'sp', categoryId: 'gas', needsReview: false });

    const writes = planReaderFieldCarry([parent, c1, c2], [sParent, sc1, sc2], CUTOVER);

    // The pieces' own categories are the reader's on BOTH sides and are never clobbered —
    // c1's note travels to its match, and the old container's charge-level note (read nowhere
    // once it is a container — Finding A) fills the gap on the piece that took nothing.
    // The container itself takes nothing: the verdict and its Correction are blocked on a
    // container from ANY source (Finding A — the pieces are the reader's own allocation).
    expect(writes).toEqual([
      { targetId: 'sc1', data: { note: 'veggies' } },
      { targetId: 'sc2', data: { note: 'dinner' } },
    ]);
  });

  it('a REFILED old piece never replaces the survivor piece’s own split category (P1-1)', () => {
    const parent = row({
      id: 'p1', date: '2026-07-15', amountCents: -10_000, isSplitParent: true,
      categoryId: 'dining', needsReview: false, hasCorrection: true,
    });
    // The reader refiled the OLD −6000 piece to 'groceries' (a Correction sits on it)…
    const c1 = row({
      id: 'c1', date: '2026-07-15', amountCents: -6_000, splitParentId: 'p1',
      categoryId: 'groceries', needsReview: false, note: 'veggies', hasCorrection: true,
    });
    const c2 = row({ id: 'c2', date: '2026-07-15', amountCents: -4_000, splitParentId: 'p1', categoryId: 'gas', needsReview: false });
    // …while the survivor's −6000 piece was allocated 'dining' by the reader's own split on the
    // new side — a reader value, and the verdict guard must never replace one reader value with
    // another. Only the flat note travels.
    const sParent = row({ id: 'sp', date: '2026-07-15', amountCents: -10_000, isSplitParent: true });
    const sc1 = row({ id: 'sc1', date: '2026-07-15', amountCents: -6_000, splitParentId: 'sp', categoryId: 'dining', needsReview: false });
    const sc2 = row({ id: 'sc2', date: '2026-07-15', amountCents: -4_000, splitParentId: 'sp', categoryId: 'gas', needsReview: false });

    const writes = planReaderFieldCarry([parent, c1, c2], [sParent, sc1, sc2], CUTOVER);

    expect(writes).toEqual([
      // c1's correction and category stay on the disowned copy — sc1's 'dining' is the reader's.
      // The old parent's verdict + Correction are blocked on the container from ANY source
      // (Finding A — the pieces are the reader's own allocation), and the parent has no flats.
      { targetId: 'sc1', data: { note: 'veggies' } },
    ]);
  });

  it('a dangling predecessor child carries as itself', () => {
    const pred = row({
      id: 'p1', date: '2026-07-15', amountCents: -6_000, splitParentId: 'ghost-parent',
      categoryId: 'groceries', needsReview: false, hasCorrection: true,
    });
    const succ = row({ id: 's1', date: '2026-07-15', amountCents: -6_000 });

    const writes = planReaderFieldCarry([pred], [succ], CUTOVER);

    expect(writes).toEqual([
      { targetId: 's1', data: { categoryId: 'groceries', confidenceBps: null, needsReview: false, isTransfer: false }, moveCorrectionsFrom: ['p1'] },
    ]);
  });

  it('a pinned survivor accepts flats but no verdict and no family', () => {
    const parent = row({
      id: 'p1', date: '2026-07-15', amountCents: -10_000, isSplitParent: true,
      categoryId: 'dining', needsReview: false, note: 'dinner', hasCorrection: true,
    });
    const c1 = row({ id: 'c1', date: '2026-07-15', amountCents: -6_000, splitParentId: 'p1', categoryId: 'groceries', needsReview: false });
    const c2 = row({ id: 'c2', date: '2026-07-15', amountCents: -4_000, splitParentId: 'p1', categoryId: 'gas', needsReview: false });
    // The survivor is under a dissolve-forced review: the reader must re-decide it.
    const succ = row({ id: 's1', date: '2026-07-15', amountCents: -10_000, reviewPinned: true });

    const writes = planReaderFieldCarry([parent, c1, c2], [succ], CUTOVER);

    expect(writes).toEqual([{ targetId: 's1', data: { note: 'dinner' } }]);
  });

  it('an un-filed parent does not gate its pieces’ flats in a family→family combine (F1)', () => {
    // The critic's P1: splitting never mints a Correction, so the old container is almost
    // always UN-filed — its own write changes nothing, but its pieces carry notes, tax
    // classes, exclusions and reimbursements. Those must still travel.
    const parent = row({
      id: 'p1', date: '2026-07-15', amountCents: -10_000, isSplitParent: true,
    });
    const c1 = row({ id: 'c1', date: '2026-07-15', amountCents: -6_000, splitParentId: 'p1', categoryId: 'groceries', needsReview: false, note: 'veggies' });
    const c2 = row({ id: 'c2', date: '2026-07-15', amountCents: -4_000, splitParentId: 'p1', categoryId: 'gas', needsReview: false, note: 'road trip' });
    const sParent = row({ id: 'sp', date: '2026-07-15', amountCents: -10_000, isSplitParent: true });
    const sc1 = row({ id: 'sc1', date: '2026-07-15', amountCents: -6_000, splitParentId: 'sp', categoryId: 'groceries', needsReview: false });
    const sc2 = row({ id: 'sc2', date: '2026-07-15', amountCents: -4_000, splitParentId: 'sp', categoryId: 'gas', needsReview: false });

    const writes = planReaderFieldCarry([parent, c1, c2], [sParent, sc1, sc2], CUTOVER);

    // No write for the container itself (nothing to change); the pieces' notes travel alone.
    expect(writes).toEqual([
      { targetId: 'sc1', data: { note: 'veggies' } },
      { targetId: 'sc2', data: { note: 'road trip' } },
    ]);
  });

  it('duplicate pieces on the PREDECESSOR side also skip the key — never guess which is which (F2)', () => {
    // The critic's P2: the multiplicity gate ran only on the survivor side, so two identical
    // old pieces (a $10 charge split into two $5s) both wrote the same survivor piece, the
    // second silently overwriting the first. C.6's gate now runs on both sides.
    const parent = row({
      id: 'p1', date: '2026-07-15', amountCents: -10_000, isSplitParent: true, note: 'dinner',
    });
    const c1 = row({ id: 'c1', date: '2026-07-15', amountCents: -5_000, splitParentId: 'p1', categoryId: 'groceries', needsReview: false, note: 'half-a' });
    const c2 = row({ id: 'c2', date: '2026-07-15', amountCents: -5_000, splitParentId: 'p1', categoryId: 'gas', needsReview: false, note: 'half-b' });
    const sParent = row({ id: 'sp', date: '2026-07-15', amountCents: -10_000, isSplitParent: true });
    const sc1 = row({ id: 'sc1', date: '2026-07-15', amountCents: -5_000, splitParentId: 'sp', categoryId: 'groceries', needsReview: false });
    const sc2 = row({ id: 'sc2', date: '2026-07-15', amountCents: -3_000, splitParentId: 'sp', categoryId: 'gas', needsReview: false });
    const sc3 = row({ id: 'sc3', date: '2026-07-15', amountCents: -2_000, splitParentId: 'sp', categoryId: 'other', needsReview: false });

    const writes = planReaderFieldCarry([parent, c1, c2], [sParent, sc1, sc2, sc3], CUTOVER);

    // Neither 'half-a' nor 'half-b' is assigned to sc1 — neither piece can be told apart, so
    // neither moves. The CONTAINER's own charge-level note ('dinner') is not ambiguous — it is
    // the charge's note, read nowhere once the row is a container — so Finding A routes it onto
    // every piece that has no note of its own (the same gap-fill as NEW-1's inheritance).
    expect(writes).toEqual([
      { targetId: 'sc1', data: { note: 'dinner' } },
      { targetId: 'sc2', data: { note: 'dinner' } },
      { targetId: 'sc3', data: { note: 'dinner' } },
    ]);
  });

  it('a STALE family never fires on a dangling-child survivor — the reader’s own allocation is not pinned (F3)', () => {
    // The critic's P2: the stale-split branch lacked the child guard, so a pred family whose
    // parts no longer summed forced the survivor's own intact allocation into DURABLE review.
    const parent = row({
      id: 'p1', date: '2026-07-15', amountCents: -10_000, isSplitParent: true,
      categoryId: 'dining', needsReview: false, note: 'dinner', hasCorrection: true,
    });
    const c1 = row({ id: 'c1', date: '2026-07-15', amountCents: -6_000, splitParentId: 'p1', categoryId: 'groceries', needsReview: false });
    const c2 = row({ id: 'c2', date: '2026-07-15', amountCents: -3_000, splitParentId: 'p1', categoryId: 'gas', needsReview: false }); // stale: −9,000 ≠ −10,000
    // The survivor is a split piece — its category is the reader's own allocation, intact.
    const succ = row({ id: 's1', date: '2026-07-15', amountCents: -10_000, splitParentId: 'ghost-parent', categoryId: 'groceries', needsReview: false });

    const writes = planReaderFieldCarry([parent, c1, c2], [succ], CUTOVER);

    // Flats travel; the stale family just stops being applied — no forced review, no pin.
    expect(writes).toEqual([
      { targetId: 's1', data: { note: 'dinner' } },
    ]);
  });

  it('a settled PIECE’s filing never becomes a whole-charge verdict on the survivor’s own container (F4)', () => {
    // The critic's P2, the mirror of P1-1: the child guard blocked verdicts onto child TARGETS
    // but not FROM child SOURCES — a settled dangling pred piece matched the survivor's own
    // container and its verdict + Correction moved onto it, feeding the learner evidence that
    // contradicts the reader's own pieces. (A piece onto a PLAIN survivor still carries — that
    // row is that amount's own copy — locked by 'a dangling predecessor child carries as itself'.)
    const pred = row({
      id: 'p1', date: '2026-07-15', amountCents: -4_000, splitParentId: 'ghost-parent',
      categoryId: 'groceries', needsReview: false, note: 'refiled', hasCorrection: true,
    });
    const sParent = row({ id: 'sp', date: '2026-07-15', amountCents: -4_000, isSplitParent: true });
    const sc1 = row({ id: 'sc1', date: '2026-07-15', amountCents: -2_500, splitParentId: 'sp', categoryId: 'dining', needsReview: false });
    const sc2 = row({ id: 'sc2', date: '2026-07-15', amountCents: -1_500, splitParentId: 'sp', categoryId: 'gas', needsReview: false });

    const writes = planReaderFieldCarry([pred], [sParent, sc1, sc2], CUTOVER);

    // No verdict, no correction move, and — since the target is a container no surface reads
    // (Finding A) — the flat note routes onto the container's CHILDREN instead of the
    // container itself, each piece's own value winning.
    expect(writes).toEqual([
      { targetId: 'sc1', data: { note: 'refiled' } },
      { targetId: 'sc2', data: { note: 'refiled' } },
    ]);
  });

  it('a settled PLAIN pred row matched against the survivor’s CONTAINER routes its flats onto the pieces, never the container (A1)', () => {
    // Finding A (critic cycle 4, P1): the survivor's container is a row NO surface reads — the
    // register lists only children, the tax report leaves containers out entirely
    // (TAX_BLOCKED_SPLIT_PARENT), the reimbursement line skips them. A verdict + Correction
    // landing there would feed the learner evidence contradicting the reader's own pieces, and
    // the pred row's LIVE money-bearing flats (this charge is excluded, a claim is awaiting, the
    // tag belongs on the export) would stop applying. Pre-fix discriminator: the planner wrote
    // the whole payload — verdict, correction move, flats — onto the container itself.
    const pred = row({
      id: 'p1', date: '2026-07-15', amountCents: -10_000,
      categoryId: 'groceries', needsReview: false, hasCorrection: true,
      note: 'old note', taxClass: 'BUSINESS', excludeFromTotals: true, reimbursement: 'awaiting',
    });
    const sParent = row({ id: 'sp', date: '2026-07-15', amountCents: -10_000, isSplitParent: true });
    const sc1 = row({ id: 'sc1', date: '2026-07-15', amountCents: -6_000, splitParentId: 'sp', categoryId: 'groceries', needsReview: false });
    const sc2 = row({ id: 'sc2', date: '2026-07-15', amountCents: -4_000, splitParentId: 'sp', categoryId: 'gas', needsReview: false });

    const writes = planReaderFieldCarry([pred], [sParent, sc1, sc2], CUTOVER);

    // No write targets the container; every piece inherits the pred row's four flats, each
    // piece's own value winning (none here). The pieces' categories stay the reader's own
    // allocation — no verdict, no correction move.
    expect(writes).toEqual([
      {
        targetId: 'sc1',
        data: { note: 'old note', taxClass: 'BUSINESS', excludeFromTotals: true, reimbursement: 'awaiting' },
      },
      {
        targetId: 'sc2',
        data: { note: 'old note', taxClass: 'BUSINESS', excludeFromTotals: true, reimbursement: 'awaiting' },
      },
    ]);
  });

  it('a survivor that is itself a dangling child keeps its own split category — flats only, never a verdict', () => {
    const parent = row({
      id: 'p1', date: '2026-07-15', amountCents: -10_000, isSplitParent: true,
      categoryId: 'dining', needsReview: false, note: 'dinner', hasCorrection: true,
    });
    const c1 = row({ id: 'c1', date: '2026-07-15', amountCents: -6_000, splitParentId: 'p1', categoryId: 'groceries', needsReview: false });
    const c2 = row({ id: 'c2', date: '2026-07-15', amountCents: -4_000, splitParentId: 'p1', categoryId: 'gas', needsReview: false });
    // The survivor is a split piece (its parent was dissolved) — its category is the reader's
    // own allocation, so the settled pred verdict must NOT replace it (P1-1's child rule).
    const succ = row({ id: 's1', date: '2026-07-15', amountCents: -10_000, splitParentId: 'ghost-parent', categoryId: 'groceries', needsReview: false });

    const writes = planReaderFieldCarry([parent, c1, c2], [succ], CUTOVER);

    expect(writes).toEqual([
      { targetId: 's1', data: { note: 'dinner' } },
    ]);
  });
});
