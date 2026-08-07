/**
 * The name of the collapsed section on /accounts that holds the duplicate/combine machinery
 * (O.19).
 *
 * It lives in `src/lib/engine/account/` rather than beside the component because the sentences
 * that send a reader to that control are spread across BOTH halves of the tree: the page's own
 * flashes in `src/components/finance/`, and the duplicate disclosures in
 * `src/lib/engine/account/card-duplicate-view.ts`, which /cards, /calendar, the dashboard, the
 * digest email and the reminder emails all render. `src/lib` may not import from
 * `src/components` (the dependency runs one way), so a constant defined there could not reach
 * the copy that needs it most — including copy an EMAIL reader sees, who cannot be sent looking
 * around a page for a control that is behind a tap.
 *
 * One definition, so renaming the section can never leave a stale instruction behind.
 */
export const ACCOUNT_CLEANUP_HEADING = 'Account cleanup';
