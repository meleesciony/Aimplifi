/**
 * Deep link to the Fixed vs guilt-free panel on Spending (/budgets).
 * Hash is required: a bare `/budgets` href from the conscious Fixed expander
 * (already on that page) is a no-op and looks like a broken button.
 */
export const SPEND_CLASS_PANEL_ID = 'spend-class';
export const REVIEW_FIXED_HREF = `/budgets#${SPEND_CLASS_PANEL_ID}` as const;
