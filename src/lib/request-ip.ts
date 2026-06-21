/**
 * Best-effort client IP for rate-limit keys. Vercel sets `x-forwarded-for`
 * (client first); we take the first hop. Never throws — falls back to 'unknown'
 * if no header is present or it's called outside a request scope. Used only to
 * scope a per-device throttle, so an 'unknown' bucket is an acceptable degrade.
 *
 * `next/headers` is imported dynamically so merely importing this module doesn't
 * pull a server-only dependency (keeps callers' unit tests light).
 */
export async function clientIp(): Promise<string> {
  try {
    const { headers } = await import('next/headers');
    const h = await headers();
    const fwd = h.get('x-forwarded-for');
    if (fwd) return fwd.split(',')[0].trim() || 'unknown';
    return h.get('x-real-ip')?.trim() || 'unknown';
  } catch {
    return 'unknown';
  }
}
