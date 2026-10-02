/**
 * Settings Bank connections card. Home and Cards already offer CSV next to
 * Plaid. This card still described Plaid/SimpleFIN only.
 *
 * SimpleFIN is retired as a way to connect (DECISIONS #780), so it is no longer
 * named here; the Accounts page still manages a SimpleFIN connection that exists.
 */
export const SETTINGS_CONNECTIONS_BODY =
  'Connect with Plaid right here; the Accounts page is where existing connections are managed. Paste a CSV on Import if you prefer not to connect. Access tokens are encrypted at rest (AES-256-GCM); only account masks (last 4) are ever stored.';

export const SETTINGS_IMPORT_CSV_LABEL = 'Import a CSV';
