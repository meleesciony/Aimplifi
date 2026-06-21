/**
 * Email dispatch behind a graceful, tested fallback — the dormant-by-default
 * pattern (same stance as the LLM in DECISIONS #38 and the cron sync route). With
 * NO `RESEND_API_KEY`, sendEmail is a no-op that reports {sent:false,
 * reason:'no-provider'} WITHOUT making a network call, so the app and every test
 * run with zero credentials. With a key it POSTs to the Resend HTTP API. It NEVER
 * throws — a notification failure must not abort a reminder sweep.
 *
 * Switch it on later by setting RESEND_API_KEY (+ optional REMINDER_FROM_EMAIL).
 */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface SendResult {
  sent: boolean;
  /** Why it wasn't sent (or how it failed); absent on success. */
  reason?: string;
}

/** True when an email provider is configured — used to label dormant cron runs. */
export function emailProviderConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}

export async function sendEmail(msg: EmailMessage): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { sent: false, reason: 'no-provider' };

  const from = process.env.REMINDER_FROM_EMAIL ?? 'Pulse Finance <reminders@pulsefinance.app>';
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ from, to: msg.to, subject: msg.subject, text: msg.text }),
    });
    if (!res.ok) return { sent: false, reason: `provider-${res.status}` };
    return { sent: true };
  } catch (e) {
    return { sent: false, reason: e instanceof Error ? e.message : 'send-failed' };
  }
}
