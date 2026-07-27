/**
 * Tax-relevant classes a reader may tag a transaction with (owner request
 * 2026-07-27: *"for fields that may have tax implications (medical expenses,
 * child care, etc…) so easy to export that data during tax time"*; class set
 * chosen by the owner the same day — the common US itemized set).
 *
 * A CLOSED SET, not free text, and that is the whole point of the request. The
 * deliverable is an export that GROUPS BY this field and totals each group, and
 * you cannot group by prose. A note ("mum's prescription") is for the reader to
 * remember what something was; this is for a report to add it up.
 *
 * WHAT THIS MODULE IS NOT. It is not tax advice and it encodes no tax rule: no
 * deduction thresholds (the medical AGI floor), no eligibility test, no limits,
 * no filing status. It is a filing cabinet — the reader decides what belongs in
 * each drawer, and the export reports what they put there and nothing more. Every
 * total this feeds must say so in the same breath; a figure the reader might hand
 * to a preparer or copy onto a return may never look like a computed entitlement.
 *
 * Pure: no I/O, no Date, no money arithmetic beyond integer cents.
 */

/**
 * The stored value. Kept as a string union rather than a Prisma enum so a class
 * can be added without a migration on a column readers have already tagged, and
 * so an unknown value read back from the database degrades to "untagged" instead
 * of throwing (`isTaxClass` below is the gate).
 */
export type TaxClass =
  | 'medical'
  | 'dependent-care'
  | 'charitable'
  | 'mortgage-interest'
  | 'state-local-tax'
  | 'education'
  | 'business';

/**
 * Display order, fixed and shared by every surface. Ordered as a US itemized
 * return tends to read rather than alphabetically, so a reader comparing the
 * export against their own paperwork scans down it once.
 */
export const TAX_CLASSES: readonly TaxClass[] = [
  'medical',
  'dependent-care',
  'charitable',
  'mortgage-interest',
  'state-local-tax',
  'education',
  // Added on the owner's follow-up the same day ("Also make a business related
  // box"). LAST on purpose: the six above are personal itemized drawers, and a
  // business expense is a different kind of claim entirely — it belongs to a
  // business's own return, not to an itemized personal deduction. Keeping it at
  // the end of one list is the honest compromise between the reader's one tagging
  // gesture and two genuinely different destinations; the export therefore totals
  // it as its own group and never folds it into the itemized subtotal.
  'business',
];

/**
 * The label printed wherever a class appears — one author, so a picker, a row and
 * an export heading cannot drift into three names for one drawer (the L.29
 * lesson, which cost a live drift between two surfaces printing the same label).
 *
 * Deliberately descriptive rather than statutory: "Medical & dental" not
 * "Schedule A line 1". Naming a line of a form would be a claim about where the
 * figure belongs, which is exactly the claim this module refuses to make.
 */
export const TAX_CLASS_LABELS: Record<TaxClass, string> = {
  medical: 'Medical & dental',
  'dependent-care': 'Child & dependent care',
  charitable: 'Charitable donations',
  'mortgage-interest': 'Mortgage interest',
  'state-local-tax': 'State & local taxes',
  education: 'Education',
  business: 'Business expense',
};

/** Narrowing gate for a value read back from storage. A column is a free String
 *  (see the type note above), so an unrecognized value — a class removed in a
 *  later version, a hand-edited row — must read as untagged rather than crash a
 *  report or, worse, land in the wrong drawer's total. */
export function isTaxClass(value: string | null | undefined): value is TaxClass {
  return value != null && (TAX_CLASSES as readonly string[]).includes(value);
}

export function taxClassLabel(value: string | null | undefined): string | null {
  return isTaxClass(value) ? TAX_CLASS_LABELS[value] : null;
}
