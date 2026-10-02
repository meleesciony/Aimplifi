/**
 * The Settings page's own table of contents.
 *
 * /settings is the longest page in the app after the register — fourteen cards,
 * about thirteen phone screens — and it had no way to reach the twelfth card
 * except to scroll past the first eleven. This is the list the "On this page"
 * index renders, grouped by what the reader came to do — which is NOT the page's
 * render order (the operator's Activation checklist renders mid-page and is
 * listed last here, where a reader who is not the operator can skip it).
 *
 * Pure data, so the two halves cannot drift apart silently: the index is built
 * from this list, and a unit test asserts every id below is an anchor the page
 * source actually carries (an index link with no target is a dead end the reader
 * only discovers by tapping it).
 */
export type SettingsSection = { id: string; label: string };
export type SettingsSectionGroup = { label: string; sections: readonly SettingsSection[] };

export const SETTINGS_NOTIFICATIONS_ID = 'notifications';

export const SETTINGS_SECTION_GROUPS: readonly SettingsSectionGroup[] = [
  {
    label: 'Your plan',
    sections: [
      { id: 'money-dials', label: 'Money dials' },
      { id: 'rich-life', label: 'My Rich Life' },
      { id: 'employer-match', label: 'Employer match' },
      { id: 'contribution-room', label: 'Contribution room' },
      { id: 'fixed-costs', label: 'Fixed costs' },
    ],
  },
  {
    label: 'Your data',
    sections: [
      { id: 'export', label: 'Export' },
      { id: 'connections', label: 'Bank connections' },
      { id: SETTINGS_NOTIFICATIONS_ID, label: 'Notifications' },
      { id: 'categories', label: 'Categories' },
    ],
  },
  {
    label: 'Trust & privacy',
    sections: [
      { id: 'ai-trust', label: 'AI trust' },
      { id: 'transfer-repair', label: 'Transfer mark repair' },
      { id: 'household', label: 'Household' },
      { id: 'sessions', label: 'Sessions' },
      { id: 'delete-data', label: 'Delete my data' },
    ],
  },
  {
    label: 'Operator',
    sections: [{ id: 'activation', label: 'Activation checklist' }],
  },
];

/**
 * The groups to render for THIS reader. The Notifications card exists only when
 * the deployment has a push key, so its index entry is dropped with it — an entry
 * pointing at a card that did not render is the dead end this list exists to
 * prevent. No other section is conditional.
 */
export function settingsIndexGroups(opts: { notifications: boolean }): SettingsSectionGroup[] {
  return SETTINGS_SECTION_GROUPS.map((g) => ({
    label: g.label,
    sections: g.sections.filter((s) => opts.notifications || s.id !== SETTINGS_NOTIFICATIONS_ID),
  })).filter((g) => g.sections.length > 0);
}
