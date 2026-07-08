/**
 * Web-Push dispatch behind the SAME dormant-by-default contract as email.ts
 * (DECISIONS #47). With NO `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT`,
 * sendPush is a no-op that reports {sent:false, reason:'no-provider'} WITHOUT any
 * network call or crypto — so the app, the seeded demo, and every test run with zero
 * credentials and store nothing. Set the three VAPID vars to switch it on.
 *
 * It NEVER throws: a delivery failure must not abort a notification sweep. A 404/410
 * from the push service means the browser subscription is gone; that returns
 * {sent:false, gone:true} so the caller can prune the dead row.
 *
 * VAPID keys are generated once by the operator (`npx web-push generate-vapid-keys`)
 * and set as env; the PUBLIC key is also handed to the browser to subscribe.
 */
import webpush from 'web-push';

export interface PushEndpoint {
  endpoint: string;
  /** RFC-8291 client keys (base64url). */
  p256dh: string;
  auth: string;
}

export interface PushPayload {
  title: string;
  body: string;
  /** Deep link opened on notificationclick. */
  url: string;
  /** Collapses same-subject re-alerts in the OS tray. */
  tag?: string;
}

export interface PushResult {
  sent: boolean;
  /** Why it wasn't sent (or how it failed); absent on success. */
  reason?: string;
  /** True when the subscription is expired/unsubscribed (404/410) — prune it. */
  gone?: boolean;
}

/**
 * Guard against turning the notify cron into an SSRF POST engine (DECISIONS #56
 * stance, applied to an attacker-controllable subscription endpoint). A real browser
 * Web-Push endpoint is ALWAYS an https URL on a public push-service DNS host
 * (fcm.googleapis.com, web.push.apple.com, *.notify.windows.com,
 * *.push.services.mozilla.com …) — never a raw IP or localhost. So we accept only
 * https + a non-literal, non-loopback hostname and reject everything else. This blocks
 * pointing the server at an internal address without a brittle host allowlist; the
 * DNS-rebinding residual is the same documented class as SimpleFIN's.
 */
export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false; // any IPv4 literal
  if (host.includes(':') || host.startsWith('[')) return false; // any IPv6 literal
  return true;
}

/** True when a VAPID keypair + subject are configured. */
export function pushProviderConfigured(): boolean {
  return !!(
    process.env.VAPID_PUBLIC_KEY &&
    process.env.VAPID_PRIVATE_KEY &&
    process.env.VAPID_SUBJECT
  );
}

/** The VAPID public key for the browser to subscribe with, or null when dormant. */
export function getVapidPublicKey(): string | null {
  return pushProviderConfigured() ? (process.env.VAPID_PUBLIC_KEY as string) : null;
}

export async function sendPush(sub: PushEndpoint, payload: PushPayload): Promise<PushResult> {
  if (!pushProviderConfigured()) return { sent: false, reason: 'no-provider' };

  try {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT as string,
      process.env.VAPID_PUBLIC_KEY as string,
      process.env.VAPID_PRIVATE_KEY as string,
    );
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
    );
    return { sent: true };
  } catch (e) {
    const status = (e as { statusCode?: number })?.statusCode;
    if (status === 404 || status === 410) return { sent: false, reason: `gone-${status}`, gone: true };
    return { sent: false, reason: e instanceof Error ? e.message : 'send-failed' };
  }
}
