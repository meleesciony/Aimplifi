'use client';

/**
 * Web-Push opt-in (Gap 2 §2). Rendered ONLY when the deployment has VAPID keys
 * (the parent passes a non-null publicKey), so it never appears in the dormant demo.
 * Requests notification permission, subscribes the browser's push manager with the
 * VAPID key, and registers the subscription server-side. Turning it off unsubscribes
 * both places. All state is local + feature-detected; no money data flows through here.
 */
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

function urlBase64ToUint8Array(base64String: string): BufferSource {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const buffer = new ArrayBuffer(raw.length);
  const output = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

type Status = 'loading' | 'unsupported' | 'blocked' | 'off' | 'on' | 'busy';

export function PushOptIn({ publicKey }: { publicKey: string }) {
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Detection runs inside an async task (not the effect body) so it never triggers
    // a synchronous cascading setState; the cancel guard avoids a post-unmount update.
    void (async () => {
      if (
        typeof window === 'undefined' ||
        !('serviceWorker' in navigator) ||
        !('PushManager' in window) ||
        !('Notification' in window)
      ) {
        if (!cancelled) setStatus('unsupported');
        return;
      }
      if (Notification.permission === 'denied') {
        if (!cancelled) setStatus('blocked');
        return;
      }
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (!cancelled) setStatus(sub ? 'on' : 'off');
      } catch {
        if (!cancelled) setStatus('off');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function enable() {
    setError(null);
    setStatus('busy');
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setStatus(permission === 'denied' ? 'blocked' : 'off');
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      const json = sub.toJSON();
      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
      });
      if (!res.ok) throw new Error('Could not save your subscription. Please try again.');
      setStatus('on');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not turn on notifications.');
      setStatus('off');
    }
  }

  async function disable() {
    setError(null);
    setStatus('busy');
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch('/api/push/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setStatus('off');
    } catch {
      setError('Could not turn off notifications.');
      setStatus('on');
    }
  }

  if (status === 'loading') return <p className="text-sm text-muted-foreground">Checking…</p>;
  if (status === 'unsupported')
    return <p className="text-sm text-muted-foreground">Your browser doesn’t support push notifications.</p>;
  if (status === 'blocked')
    return (
      <p className="text-sm text-muted-foreground">
        Notifications are blocked in your browser settings. Re-enable them for this site to turn them on.
      </p>
    );

  return (
    <div className="space-y-2">
      {status === 'on' ? (
        <Button variant="outline" size="sm" onClick={disable} data-testid="push-disable">
          Turn off notifications
        </Button>
      ) : (
        <Button
          size="sm"
          onClick={enable}
          disabled={status === 'busy'}
          data-testid="push-enable"
        >
          {status === 'busy' ? 'Working…' : 'Enable notifications'}
        </Button>
      )}
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
