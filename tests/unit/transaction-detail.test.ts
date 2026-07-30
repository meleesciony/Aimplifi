/**
 * `getTransactionDetail` — the read behind `/transactions/[id]` (TASKS O.13b).
 *
 * Two things a page-level e2e cannot demonstrate, and a hostile critic named
 * both as missing:
 *
 *  1. **Cross-tenant refusal against a REAL other user's row.** The e2e uses a
 *     bogus id and argues that a foreign id is equivalent — which is reasoning,
 *     not a test. Here user B asks for user A's actual transaction id.
 *  2. **The register/detail agreement the docblock promises.** The two reads map
 *     their rows in the same file; this asserts field-by-field that they agree on
 *     the row they both return, so the promise is checked rather than reviewed.
 *
 * Plus the split-container behaviour the detail view is the only surface for.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { auth } from '@/auth';
import { getTransactionDetail, getTransactions } from '@/server/transactions';
import { splitTransaction, undoSplit } from '@/server/triage-actions';
import { prisma } from '@/lib/db';

const OWNER = `td-owner-${Date.now()}-${process.pid}`;
const STRANGER = `td-other-${Date.now()}-${process.pid}`;

async function wipe() {
  for (const u of [OWNER, STRANGER]) {
    await prisma.accountReconciliation.deleteMany({ where: { userId: u } });
    await prisma.correction.deleteMany({ where: { userId: u } });
    await prisma.categoryPrediction.deleteMany({ where: { userId: u } });
    await prisma.transaction.deleteMany({ where: { account: { userId: u } } });
    await prisma.account.deleteMany({ where: { userId: u } });
    await prisma.user.deleteMany({ where: { id: u } });
  }
}

let accountId = '';
let txnId = '';

beforeAll(async () => {
  await wipe();
  for (const u of [OWNER, STRANGER]) {
    await prisma.user.create({ data: { id: u, email: `${u}@test.local` } });
  }
});

afterAll(wipe);

beforeEach(async () => {
  await prisma.accountReconciliation.deleteMany({ where: { userId: OWNER } });
  await prisma.transaction.deleteMany({ where: { account: { userId: OWNER } } });
  await prisma.account.deleteMany({ where: { userId: OWNER } });
  const account = await prisma.account.create({
    data: {
      userId: OWNER,
      name: 'Detail Checking',
      type: 'CHECKING',
      provider: 'manual',
      currentBalanceCents: 250000,
      currency: 'USD',
    },
  });
  accountId = account.id;
  const txn = await prisma.transaction.create({
    data: {
      accountId,
      date: '2026-06-01',
      amountCents: -21240,
      rawDescriptor: 'COSTCO WHSE 1084',
      categoryId: 'household',
      confidenceBps: 9900,
    },
  });
  txnId = txn.id;
  vi.mocked(auth).mockResolvedValue({ user: { id: OWNER } } as never);
});

describe('getTransactionDetail', () => {
  it('refuses one user the transaction of another, by that row’s REAL id', async () => {
    // The precondition matters: if the id did not resolve for its owner, the
    // refusal below would prove nothing.
    expect(await getTransactionDetail(OWNER, txnId)).not.toBeNull();
    expect(await getTransactionDetail(STRANGER, txnId)).toBeNull();
  });

  it('agrees with the register field for field on the same row', async () => {
    const detail = await getTransactionDetail(OWNER, txnId);
    const { rows } = await getTransactions(OWNER);
    const fromRegister = rows.find((r) => r.id === txnId);

    expect(fromRegister).toBeDefined();
    // `merchantCount` is deliberately absent from the detail read (the register
    // derives it from its reconciliation-filtered set); everything else must match.
    const registerRow: Record<string, unknown> = { ...fromRegister! };
    delete registerRow.merchantCount;
    expect({ ...detail!.row }).toEqual(registerRow);
  });

  it('says a manual row was ENTERED, never that it appears on a statement', async () => {
    // The account above is `provider: 'manual'` and the descriptor is text a
    // person typed. Calling that bank-statement text is the false-claim class.
    // (This test previously flipped the ACCOUNT to 'plaid' and asserted 'bank',
    // which locked the very bug cycle 2 found — a hand-typed row on a linked
    // card. The row-level assertion lives in the sibling test below.)
    expect((await getTransactionDetail(OWNER, txnId))!.descriptorOrigin).toBe('entered');
  });

  it('refuses a split on a transfer and on a row too small to halve, in advance', async () => {
    await prisma.transaction.update({ where: { id: txnId }, data: { isTransfer: true } });
    expect((await getTransactionDetail(OWNER, txnId))!.splitBlockedReason).toMatch(/transfer/i);

    await prisma.transaction.update({
      where: { id: txnId },
      data: { isTransfer: false, amountCents: -1 },
    });
    expect((await getTransactionDetail(OWNER, txnId))!.splitBlockedReason).toMatch(/too small/i);
  });

  it('renders a split container with its pieces, and points a piece back at it', async () => {
    const { childIds } = await splitTransaction({
      transactionId: txnId,
      parts: [
        { amountCents: -1240, categoryId: 'household' },
        { amountCents: -20000, categoryId: 'shopping' },
      ],
    });

    const parent = await getTransactionDetail(OWNER, txnId);
    expect(parent!.isSplitParent).toBe(true);
    expect(parent!.parts.map((p) => p.amountCents).sort((a, b) => a - b)).toEqual([-20000, -1240]);
    // Money is conserved by the split, to the cent.
    expect(parent!.parts.reduce((s, p) => s + p.amountCents, 0)).toBe(-21240);

    // The way back. Without this id the container is unreachable: it is hidden
    // from the register AND from the inbox, so its Undo would live at an address
    // nothing links to.
    const child = await getTransactionDetail(OWNER, childIds[0]);
    expect(child!.splitParentId).toBe(txnId);
  });

  it('gives the reader’s own category back when a split is undone', async () => {
    // The regression this locks: the split used to null the parent's category, so
    // undoing a split of an ALREADY-FILED row — the very thing this page made
    // possible — silently discarded the filing and dropped the row into review.
    await splitTransaction({
      transactionId: txnId,
      parts: [
        { amountCents: -1240, categoryId: 'household' },
        { amountCents: -20000, categoryId: 'shopping' },
      ],
    });
    await undoSplit(txnId);

    const restored = await prisma.transaction.findUniqueOrThrow({ where: { id: txnId } });
    expect(restored.categoryId).toBe('household');
    expect(restored.isSplitParent).toBe(false);
    expect(restored.needsReview).toBe(false); // filed, so NOT dumped back into the queue
    expect(await prisma.transaction.count({ where: { splitParentId: txnId } })).toBe(0);
  });

  it('still returns an undone-split row to review when it never had a category', async () => {
    await prisma.transaction.update({
      where: { id: txnId },
      data: { categoryId: null, confidenceBps: null },
    });
    await splitTransaction({
      transactionId: txnId,
      parts: [
        { amountCents: -1240, categoryId: 'household' },
        { amountCents: -20000, categoryId: 'shopping' },
      ],
    });
    await undoSplit(txnId);

    const restored = await prisma.transaction.findUniqueOrThrow({ where: { id: txnId } });
    expect(restored.categoryId).toBeNull();
    expect(restored.needsReview).toBe(true);
  });

  it('never restores a row that is FILED into the pinned-but-filed state', async () => {
    // Every filing path in triage-actions clears `reviewPinned` as it files, so a
    // `needsReview: false` + `reviewPinned: true` row is a state no surface can
    // clear — a P1 in an earlier cycle. Undoing a split of a filed TRANSFER is the
    // one path that could mint one, because the transfer branch pins on restore.
    await prisma.transaction.update({ where: { id: txnId }, data: { isTransfer: true } });
    await splitTransaction({
      transactionId: txnId,
      parts: [
        { amountCents: -1240, categoryId: 'household' },
        { amountCents: -20000, categoryId: 'shopping' },
      ],
    });
    await undoSplit(txnId);

    const restored = await prisma.transaction.findUniqueOrThrow({ where: { id: txnId } });
    expect(restored.categoryId).toBe('household');
    expect(restored.needsReview).toBe(false);
    expect(restored.reviewPinned).toBe(false);
  });

  it('still pins an UNFILED transfer restored to review (the #165 guard holds)', async () => {
    await prisma.transaction.update({
      where: { id: txnId },
      data: { isTransfer: true, categoryId: null, confidenceBps: null },
    });
    await splitTransaction({
      transactionId: txnId,
      parts: [
        { amountCents: -1240, categoryId: 'household' },
        { amountCents: -20000, categoryId: 'shopping' },
      ],
    });
    await undoSplit(txnId);

    const restored = await prisma.transaction.findUniqueOrThrow({ where: { id: txnId } });
    expect(restored.needsReview).toBe(true);
    expect(restored.reviewPinned).toBe(true); // or the queue's transfer guard hides it
  });

  it('withholds a reconciled duplicate exactly as the register does', async () => {
    // The register drops a superseded predecessor's post-cutover rows (the R1
    // ownership rule). A detail page that still rendered one would be a fully
    // editable transaction that every total treats as nonexistent — and it must
    // not go the other way either, 404ing a row the register DOES show.
    const successor = await prisma.account.create({
      data: {
        userId: OWNER,
        name: 'New Checking',
        type: 'CHECKING',
        provider: 'plaid',
        currentBalanceCents: 250000,
        currency: 'USD',
      },
    });
    // An EARLIER row on the predecessor, so its span straddles the cutover. With
    // only the 2026-06-01 row, the cutover would predate the account's first
    // transaction and the engine's degenerate-claim guard would (correctly) make
    // the predecessor keep everything — the fixture would prove nothing.
    const kept = await prisma.transaction.create({
      data: {
        accountId,
        date: '2026-04-01',
        amountCents: -1500,
        rawDescriptor: 'BEFORE CUTOVER',
        categoryId: 'household',
      },
    });
    await prisma.accountReconciliation.create({
      data: {
        userId: OWNER,
        predecessorAccountId: accountId,
        successorAccountId: successor.id,
        cutoverDate: '2026-05-01', // the target row (2026-06-01) is AFTER it
        matchSignal: 'mask',
        confidence: 'high',
      },
    });

    const { rows } = await getTransactions(OWNER);
    expect(rows.some((r) => r.id === txnId)).toBe(false); // the register withholds it
    expect(await getTransactionDetail(OWNER, txnId)).toBeNull(); // …and so does this
    // The pre-cutover row is still the predecessor's, on BOTH surfaces — the
    // boundary is a date rule, not a blanket ban on the account.
    expect(rows.some((r) => r.id === kept.id)).toBe(true);
    expect(await getTransactionDetail(OWNER, kept.id)).not.toBeNull();

    // Undo the link and BOTH must show it again — the boundary, not a one-way filter.
    await prisma.accountReconciliation.updateMany({
      where: { userId: OWNER },
      data: { undoneAt: new Date() },
    });
    const after = await getTransactions(OWNER);
    expect(after.rows.some((r) => r.id === txnId)).toBe(true);
    expect(await getTransactionDetail(OWNER, txnId)).not.toBeNull();
  });

  it('attributes a HAND-TYPED row on a bank-linked account to the reader, not the bank', async () => {
    // The row decides, not the account: manual add and CSV import both accept any
    // account the reader owns, so asking `account.provider` called typed text
    // "bank text" on any Plaid-linked card.
    await prisma.account.update({ where: { id: accountId }, data: { provider: 'plaid' } });
    expect((await getTransactionDetail(OWNER, txnId))!.descriptorOrigin).toBe('entered');

    // A row the feed actually delivered carries its id, and only that is 'bank'.
    await prisma.transaction.update({
      where: { id: txnId },
      data: { providerRef: 'plaid-txn-abc123' },
    });
    expect((await getTransactionDetail(OWNER, txnId))!.descriptorOrigin).toBe('bank');
  });
});
