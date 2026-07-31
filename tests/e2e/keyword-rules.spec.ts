/**
 * The rule builder, driven end to end (TASKS O.13a).
 *
 * Owner, with a screenshot of three deposits: *"Build the categorizer so I can group
 * all 'Cardone' into income. I've clicked many of these already and categorized. The
 * system clearly isn't smart enough to identify trends."*
 *
 * This spec reproduces exactly that shape — two deposits whose descriptors share ONE
 * word and nothing else, each carrying the `~ Tran:` id his bank appends — and drives
 * a real signed-up account through typing the keyword, seeing the count, and filing
 * both. It exists because the unit and integration locks cannot see the page: they
 * proved the engine and the server, while what he reported was that no surface let
 * him say it (docs/lessons/fencing-a-write-path-breaks-the-tests-that-drove-it.md —
 * the register/inbox specs run on the demo user, and this feature is fenced off it,
 * so it needs its own throwaway account).
 */
import { expect, test, type Page } from './helpers/test';

/** Two Cardone deposits: one shared word, different funds, different ids. */
const DEPOSITS = [
  { descriptor: 'Cardone Eq Fund Cef Xv Ppd Tran 9912', amount: '375.00' },
  { descriptor: 'Cardone Equity F Cef Ix Ppd Tran 4471', amount: '412.50' },
];
/** A row that must NOT be swept in: an inflow, same account, unrelated payee. */
const OTHER = { descriptor: 'Lakeshore Learning Mater', amount: '18.65' };

async function signUpThrowaway(page: Page) {
  const email = `e2e-kw-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill('e2e-password-123');
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20000 });
}

/**
 * A fresh signup owns no accounts, so the manual-transaction form's Account select
 * is EMPTY and the row can never be submitted — which is what the first run of this
 * spec discovered (the page snapshot in the failure trace showed the empty
 * combobox). Create one checking account first, the `transactions.spec` idiom.
 */
async function addManualAccount(page: Page, name: string) {
  await page.goto('/accounts');
  // The first click after a load can land pre-hydration and drop silently — the
  // click-and-verify retry is the hydration barrier (#167 idiom).
  await expect(async () => {
    await page.getByTestId('add-asset-btn').click({ timeout: 2000 });
    await expect(page.getByTestId('manual-name')).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20000 });
  await page.getByTestId('manual-name').fill(name);
  await page.getByTestId('manual-type').selectOption('CHECKING');
  await page.getByTestId('manual-value').fill('2500');
  await page.getByTestId('manual-submit').click();
  await expect(page.getByTestId('manual-account-row').filter({ hasText: name })).toBeVisible({
    timeout: 20000,
  });
}

async function addDeposit(page: Page, descriptor: string, amount: string) {
  await page.goto('/transactions/new');
  // Money-in is React state: a pre-hydration click drops silently and the row would
  // file as money OUT, which would change what the sign warning says (#167 idiom).
  await expect(async () => {
    await page.getByTestId('dir-in').click({ timeout: 2000 });
    await expect(page.getByTestId('dir-in')).toHaveAttribute('aria-pressed', 'true', { timeout: 2000 });
  }).toPass({ timeout: 20000 });
  await page.getByTestId('txn-descriptor').fill(descriptor);
  await page.getByTestId('txn-amount').fill(amount);
  await page.getByTestId('txn-submit').click();
  await page.waitForURL('**/transactions', { timeout: 20000 });
}

test('one typed keyword groups deposits no derived key could ever join', async ({ page }) => {
  await signUpThrowaway(page);
  await addManualAccount(page, 'KW Checking');
  for (const d of DEPOSITS) await addDeposit(page, d.descriptor, d.amount);
  await addDeposit(page, OTHER.descriptor, OTHER.amount);

  // The register is where he notices the problem, so that is where the door is.
  await page.goto('/transactions');
  await expect(page.getByTestId('rules-link')).toBeVisible({ timeout: 20000 });
  await page.getByTestId('rules-link').click();
  await page.waitForURL('**/rules', { timeout: 20000 });

  // No rules yet — the honest empty state, not a fabricated list.
  await expect(page.getByTestId('kw-empty')).toBeVisible();

  await page.getByTestId('kw-input').fill('cardone');
  await page.getByTestId('kw-category').selectOption('investment-income');
  await page.getByTestId('kw-preview').click();

  // THE CLAIM THE READER ACTS ON: the count, before the rule exists.
  const result = page.getByTestId('kw-preview-result');
  await expect(result).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('kw-preview-count')).toContainText('2');
  // Both Cardone rows are named; the unrelated inflow is not.
  await expect(result).toContainText('Cardone Eq Fund Cef Xv Ppd');
  await expect(result).toContainText('Cardone Equity F Cef Ix Ppd');
  await expect(result).not.toContainText('Lakeshore');
  // Both matched rows are inflows filed as income, so no sign warning is due.
  await expect(page.getByTestId('kw-sign-warning')).toHaveCount(0);

  // The history rewrite is opt-IN now: creating a rule is a statement about the
  // future, and the earlier build defaulted this ON while its own docblock said the
  // reader must choose it (critic P1).
  await expect(page.getByTestId('kw-apply-existing')).not.toBeChecked();
  await page.getByTestId('kw-apply-existing').check();
  await page.getByTestId('kw-create').click();
  await expect(page.getByTestId('kw-done')).toContainText('2', { timeout: 20000 });

  // And the rewrite is reversible from the page that performed it — `undoCorrections`
  // existed for months with the triage card as its only caller (critic P1).
  await expect(page.getByTestId('kw-undo')).toBeVisible({ timeout: 20000 });

  // It appears WITHOUT a reload: "Rule saved" printed beside "you have no rules yet"
  // is two contradictory statements, and `router.refresh()` alone did not reliably
  // repaint the list (measured — the row was in the database while the page still
  // showed the empty state 20s later).
  await expect(page.getByTestId('kw-rule-row')).toHaveCount(1, { timeout: 20000 });
  // …and it is still there on a fresh request, which is what proves it was stored
  // rather than only drawn (the `addManualAsset` reload-confirmed idiom).
  await page.reload();

  // The rule is visible and removable — an invisible rule that files money is worse
  // than no rule. The wait budget is explicit because this assertion follows a
  // `router.refresh()`, i.e. a server round-trip: under full-suite contention the
  // default 5s expired while the list was still in flight (this spec failed 3 of 4
  // full runs and passed every time it ran alone — the documented load-flake
  // signature, in my own assertion rather than in the app).
  await expect(page.getByTestId('kw-rule-row')).toHaveCount(1, { timeout: 20000 });
  await expect(page.getByTestId('kw-rule-row')).toContainText('cardone', { timeout: 20000 });

  // And the register now shows the category on BOTH rows, while the unrelated
  // inflow is untouched.
  await page.goto('/transactions');
  const rows = page.getByTestId('txn-row');
  await expect(rows.filter({ hasText: 'Cardone Eq Fund' })).toContainText(/investment income/i, {
    timeout: 20000,
  });
  await expect(rows.filter({ hasText: 'Cardone Equity F' })).toContainText(/investment income/i, {
    timeout: 20000,
  });
  await expect(rows.filter({ hasText: 'Lakeshore' })).toContainText(/uncategorized/i, {
    timeout: 20000,
  });
});

/**
 * O.13c — the three Simplifi-parity additions, on the same two deposits: an "or"
 * line, a payee RENAME, and editing the stored rule in place.
 *
 * The OR assertion is built so neither line could pass alone: `cardone xv` reaches
 * only the Xv fund and `cardone ix` only the Ix fund, so a count of 2 is proof the
 * groups were unioned rather than one group being silently widened. The RENAME
 * assertion reads the REGISTER, because that is where a rename either is or isn't
 * real — `merchantName` there is the row's stored merchant canonical
 * (server/transactions.ts), so two descriptors collapsing to one payee is the
 * identity-level grouping the feature promises, not a label drawn on the rules page.
 */
test('an "or" line unions two keys, a rename groups them, and the rule edits in place', async ({
  page,
}) => {
  await signUpThrowaway(page);
  await addManualAccount(page, 'KW Checking');
  for (const d of DEPOSITS) await addDeposit(page, d.descriptor, d.amount);
  await addDeposit(page, OTHER.descriptor, OTHER.amount);

  await page.goto('/rules');

  // ONE line first, so the union is measured against a known baseline: `cardone xv`
  // reaches the Xv fund and nothing else.
  await page.getByTestId('kw-input').fill('cardone xv');
  await page.getByTestId('kw-category').selectOption('investment-income');
  await page.getByTestId('kw-preview').click();
  await expect(page.getByTestId('kw-preview-count')).toContainText(/Matches\s+1\s+transaction\b/, {
    timeout: 20000,
  });

  // Now the "or" line. Adding it is pure React state, so a pre-hydration click
  // drops silently and the fill below would land on a field that never appeared
  // (#167 idiom).
  await expect(async () => {
    await page.getByTestId('kw-add-or').click({ timeout: 2000 });
    await expect(page.getByTestId('kw-input-or-1')).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20000 });
  await page.getByTestId('kw-input-or-1').fill('cardone ix');
  await page.getByTestId('kw-rename').fill('Cardone Capital');
  await page.getByTestId('kw-preview').click();
  // TWO — and neither line alone reached both, which is the whole claim of an OR group.
  await expect(page.getByTestId('kw-preview-count')).toContainText(/Matches\s+2\s+transactions\b/, {
    timeout: 20000,
  });

  await page.getByTestId('kw-apply-existing').check();
  await page.getByTestId('kw-create').click();
  await expect(page.getByTestId('kw-done')).toContainText('renamed', { timeout: 20000 });

  // The stored rule renders both groups and the payee name it will show.
  await expect(page.getByTestId('kw-rule-row')).toHaveCount(1, { timeout: 20000 });
  await expect(page.getByTestId('kw-rule-row')).toContainText('Cardone Capital', { timeout: 20000 });

  // THE POINT: the register now groups two unrelated descriptors under one payee…
  await page.goto('/transactions');
  const rows = page.getByTestId('txn-row');
  await expect(rows.filter({ hasText: 'Cardone Capital' })).toHaveCount(2, { timeout: 20000 });
  // …both filed as income, and the unrelated inflow is untouched by either line.
  await expect(rows.filter({ hasText: 'Cardone Capital' }).first()).toContainText(
    /investment income/i,
    { timeout: 20000 },
  );
  await expect(rows.filter({ hasText: 'Lakeshore' })).toContainText(/uncategorized/i, {
    timeout: 20000,
  });

  // EDIT IN PLACE. O.13a offered only delete-and-retype, which dropped the rule's
  // undo lineage; the edit must reopen what was STORED (both or-lines, the name).
  await page.goto('/rules');
  await expect(async () => {
    await page.getByTestId('kw-edit').click({ timeout: 2000 });
    await expect(page.getByTestId('kw-editing-banner')).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20000 });
  // The stored key reopens as deletable CHIPS, one per keyword, in both or-lines
  // (owner, with Simplifi's Create Rule on screen: the keywords belong on screen as
  // chips he can delete). The typing box is empty because nothing is half-typed.
  await expect(page.getByTestId('kw-chip')).toHaveCount(4, { timeout: 20000 });
  await expect(page.getByTestId('kw-chip').nth(0)).toContainText('cardone');
  await expect(page.getByTestId('kw-chip').nth(1)).toContainText('xv');
  await expect(page.getByTestId('kw-chip').nth(2)).toContainText('cardone');
  await expect(page.getByTestId('kw-chip').nth(3)).toContainText('ix');
  await expect(page.getByTestId('kw-input')).toHaveValue('');
  await expect(page.getByTestId('kw-rename')).toHaveValue('Cardone Capital');

  await page.getByTestId('kw-rename').fill('Cardone Holdings');
  await page.getByTestId('kw-preview').click();
  await expect(page.getByTestId('kw-preview-count')).toContainText(/Matches\s+2\s+transactions\b/, {
    timeout: 20000,
  });
  await page.getByTestId('kw-apply-existing').check();
  await page.getByTestId('kw-create').click();
  await expect(page.getByTestId('kw-done')).toContainText('updated', { timeout: 20000 });

  // ONE rule still — an edit, not a second rule racing the first.
  await expect(page.getByTestId('kw-rule-row')).toHaveCount(1, { timeout: 20000 });
  await page.reload();
  await expect(page.getByTestId('kw-rule-row')).toHaveCount(1, { timeout: 20000 });
  await expect(page.getByTestId('kw-rule-row')).toContainText('Cardone Holdings', { timeout: 20000 });

  // And the new name reached the register, so the edit re-applied rather than only saving.
  await page.goto('/transactions');
  await expect(page.getByTestId('txn-row').filter({ hasText: 'Cardone Holdings' })).toHaveCount(2, {
    timeout: 20000,
  });
});

test('the builder refuses a key with nothing to match on', async ({ page }) => {
  await signUpThrowaway(page);
  await page.goto('/rules');
  // A blank key cannot even be submitted (the field is required), so the refusal a
  // reader can actually reach is a key of pure separators.
  await page.getByTestId('kw-input').fill(' , , ');
  await page.getByTestId('kw-category').selectOption('investment-income');
  await page.getByTestId('kw-preview').click();
  await expect(page.getByTestId('kw-preview-result')).toContainText('at least one word', {
    timeout: 20000,
  });
  // It must NOT tell the reader an empty rule matches everything — the engine makes
  // it match nothing, and the old sentence shipped the rationale as fact (critic P1).
  await expect(page.getByTestId('kw-preview-result')).not.toContainText('match everything');
  // No create button is offered for an empty key.
  await expect(page.getByTestId('kw-create')).toHaveCount(0);
});

/**
 * THE OWNER'S NAMED ASK, as a lock (2026-07-29, with Simplifi's Create Rule on
 * screen showing `costco` `whse` `1084` as deletable chips):
 *
 *   *"You have the ability to change things like 'contains tjmax'. Because the card
 *    number and other numbers always change. This aids in future pain."*
 *
 * The keywords shipped as text in a box, so nothing on screen could be DELETED —
 * which is the whole gesture. This drives it: type the bank's full text, see one
 * chip per word, delete the volatile store number, and watch the match count widen
 * from the single row that carries that number to BOTH spellings of the same store.
 * A count that did not move would mean the deletion changed nothing.
 */
test('deleting a volatile keyword chip widens the key to every spelling of the store', async ({
  page,
}) => {
  await signUpThrowaway(page);
  await addManualAccount(page, 'Chip Checking');
  // Two real Costco spellings: the store number differs, so no single literal key
  // containing it can ever span both.
  for (const d of ['costco whse 1084', 'COSTCO WHSE #0981']) {
    await page.goto('/transactions/new');
    await expect(async () => {
      await page.getByTestId('dir-out').click({ timeout: 2000 });
      await expect(page.getByTestId('dir-out')).toHaveAttribute('aria-pressed', 'true', {
        timeout: 2000,
      });
    }).toPass({ timeout: 20000 });
    await page.getByTestId('txn-descriptor').fill(d);
    await page.getByTestId('txn-amount').fill('142.60');
    await page.getByTestId('txn-submit').click();
    await page.waitForURL('**/transactions', { timeout: 20000 });
  }

  await page.goto('/rules');
  // A trailing space commits the last word, exactly as Simplifi describes it.
  await page.getByTestId('kw-input').fill('costco whse 1084 ');
  await expect(page.getByTestId('kw-chip')).toHaveCount(3, { timeout: 20000 });
  await page.getByTestId('kw-category').selectOption('groceries');
  await page.getByTestId('kw-preview').click();
  // With the store number in the key, only the row carrying it can match.
  await expect(page.getByTestId('kw-preview-count')).toContainText(/Matches\s+1\s+transaction\b/, {
    timeout: 20000,
  });

  // Delete the chip that changes every visit — the gesture the owner asked for.
  await page.getByTestId('kw-chip-remove-1084').click();
  await expect(page.getByTestId('kw-chip')).toHaveCount(2);
  await page.getByTestId('kw-preview').click();
  await expect(page.getByTestId('kw-preview-count')).toContainText(/Matches\s+2\s+transactions\b/, {
    timeout: 20000,
  });
});

/**
 * O.15 slice 6 — the tag-for-taxes THEN action, end to end.
 *
 * Owner (Wave O.11): *"Can we add reimbursable and exclude from budgets and all
 * other mint and simplifi fields? That way I don't have expenses that are work
 * related. Similar to business related items as well"* — and DECISIONS #345(c),
 * which routed Simplifi's per-CATEGORY "Tax Related" toggle onto the rule machinery
 * because there is no single category-write choke point to stamp at.
 *
 * The flow drives the two halves the owner asked for by name — *"This should work
 * for prior and forward transactions"* — and the third that no unit test can see:
 * a transaction he tagged HIMSELF is not re-tagged by a rule that disagrees.
 *
 * The assertion surface is `/transactions/[id]`, because the tax select there is
 * both where the tag becomes visible and where he can undo it by hand — which is
 * what makes the absence of a per-row undo on the rule apply a stated limitation
 * rather than a dead end.
 */
const SPENDS = [
  { descriptor: 'ADOBE *XXX-XXX-6687', amount: '59.99' },
  { descriptor: 'ADOBE  ACROPRO SUBS 8774', amount: '19.99' },
];

async function addSpend(page: Page, descriptor: string, amount: string) {
  await page.goto('/transactions/new');
  await expect(async () => {
    await page.getByTestId('dir-out').click({ timeout: 2000 });
    await expect(page.getByTestId('dir-out')).toHaveAttribute('aria-pressed', 'true', { timeout: 2000 });
  }).toPass({ timeout: 20000 });
  await page.getByTestId('txn-descriptor').fill(descriptor);
  await page.getByTestId('txn-amount').fill(amount);
  await page.getByTestId('txn-submit').click();
  await page.waitForURL('**/transactions', { timeout: 20000 });
}

/**
 * Open a register row's detail page BY AMOUNT, not by the bank's text: the register
 * deliberately renders the normalizer's cleaned-up payee ("Adobe Xxx-xxx"), which is
 * the very gap the provenance line on the detail page exists to close (O.13b). The
 * first run of this spec filtered on the raw descriptor and found nothing — the
 * page snapshot in the failure trace is what said so.
 */
async function openDetail(page: Page, text: string) {
  await page.goto('/transactions');
  const row = page.getByTestId('txn-row').filter({ hasText: text }).first();
  await expect(row).toBeVisible({ timeout: 20000 });
  await row.getByTestId('txn-detail-link').click();
  await page.waitForURL('**/transactions/**', { timeout: 20000 });
}

test('a rule tags prior and future transactions for taxes, and never re-tags one you tagged yourself', async ({
  page,
}) => {
  await signUpThrowaway(page);
  await addManualAccount(page, 'Tax Checking');
  for (const s of SPENDS) await addSpend(page, s.descriptor, s.amount);

  // The reader's OWN answer on the first row, made BEFORE the rule exists. This is
  // the row the whole abstention rests on.
  await openDetail(page, '$59.99');
  await page.getByTestId('detail-tax').selectOption('medical');
  // The note+tax form saves together (one submit, `detail-note-save`).
  await page.getByTestId('detail-note-save').click();
  await expect(page.getByTestId('detail-tax')).toHaveValue('medical', { timeout: 20000 });

  // Saving the tag kicks a client-side refresh, and a `goto` racing it is aborted
  // by the browser (net::ERR_ABORTED — seen on the first run of this spec, in the
  // navigation rather than in the app). Retry until the builder is actually on
  // screen; the retry IS the wait.
  await expect(async () => {
    await page.goto('/rules');
    await expect(page.getByTestId('kw-input')).toBeVisible({ timeout: 5000 });
  }).toPass({ timeout: 30000 });
  await page.getByTestId('kw-input').fill('adobe');
  await page.getByTestId('kw-category').selectOption('software');
  await page.getByTestId('kw-tax').selectOption('business');
  await page.getByTestId('kw-preview').click();

  // THE COUNTS, before the rule exists: two rows match, one takes the tag, one
  // keeps the answer the reader already gave. A single summed number here would
  // leave him unable to tell which of his rows the export now counts.
  await expect(page.getByTestId('kw-preview-result')).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('kw-preview-count')).toContainText('2');
  await expect(page.getByTestId('kw-tag-note')).toContainText('1 transaction would be tagged');
  await expect(page.getByTestId('kw-tag-note')).toContainText('1 already carries a tag');

  await page.getByTestId('kw-apply-existing').check();
  await page.getByTestId('kw-create').click();
  await expect(page.getByTestId('kw-done')).toContainText('tagged Business expense for taxes', {
    timeout: 20000,
  });
  // Both clauses, separately: "1 tagged" and "1 already carried a tag" describe
  // DIFFERENT rows, and a reader handed a single summed number could not tell which
  // of his transactions the export now counts.
  await expect(page.getByTestId('kw-done')).toContainText('already carried a tax tag');
  // …and the receipt says the tags are not covered by the Undo beside it.
  await expect(page.getByTestId('kw-done')).toContainText('tax tags stay put');
  // The action is on the rule the reader can see, edit and delete — not hidden.
  await expect(page.getByTestId('kw-rule-tax')).toContainText('Business expense', { timeout: 20000 });

  // PRIOR: the untagged row now carries the rule's tag…
  await openDetail(page, '$19.99');
  await expect(page.getByTestId('detail-tax')).toHaveValue('business', { timeout: 20000 });

  // …and the row he answered himself still says what he said.
  await openDetail(page, '$59.99');
  await expect(page.getByTestId('detail-tax')).toHaveValue('medical', { timeout: 20000 });

  // FORWARD: a transaction that arrives AFTER the rule is tagged as it is filed,
  // with no second gesture — the half a history backfill cannot prove.
  await addSpend(page, 'ADOBE  CREATIVE CLOUD 5521', '82.49');
  await openDetail(page, '$82.49');
  await expect(page.getByTestId('detail-tax')).toHaveValue('business', { timeout: 20000 });
});
