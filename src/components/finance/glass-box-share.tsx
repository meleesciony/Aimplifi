/**
 * Client-only Glass-Box share (TASKS 1.6 / DECISIONS #202).
 *
 * Copies a REDACTED snapshot to the clipboard (text + best-effort PNG drawn
 * from the same redacted data via Canvas 2D — no third-party screenshot lib,
 * no network). Share is offered only when the trace reconciles; a mismatched
 * trace must not become a marketing asset.
 */
'use client';

import { useState } from 'react';
import { buttonVariants } from '@/components/ui/button';
import type { NumberTrace } from '@/lib/engine/glass-box/trace';
import { formatShareText, redactTraceForShare } from '@/lib/engine/glass-box/redact';
import { cn } from '@/lib/utils';

type ShareStatus = 'idle' | 'copied' | 'saved' | 'error';

export function GlassBoxShare({
  trace,
  /** Defaults to the ids this component has always emitted; panels that share
   *  a page pass their own (O.18b critic P2-4 — strict-mode collision trap). */
  testIdPrefix = 'glass-box',
}: {
  trace: NumberTrace;
  testIdPrefix?: string;
}) {
  const [status, setStatus] = useState<ShareStatus>('idle');

  if (!trace.reconciles) return null;

  async function share() {
    setStatus('idle');
    const text = formatShareText(trace);
    try {
      const png = await renderSharePng(trace);
      if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined' && png) {
        const item: Record<string, Blob> = {
          'text/plain': new Blob([text], { type: 'text/plain' }),
          'image/png': png,
        };
        await navigator.clipboard.write([new ClipboardItem(item)]);
        setStatus('copied');
        return;
      }
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        setStatus('copied');
        return;
      }
      throw new Error('clipboard-unavailable');
    } catch {
      try {
        downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), 'aimplifi-glass-box.txt');
        setStatus('saved');
      } catch {
        setStatus('error');
      }
    }
  }

  return (
    <div className="mt-3 border-t pt-3">
      <button
        type="button"
        data-testid={`${testIdPrefix}-share`}
        onClick={() => void share()}
        className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
      >
        Copy redacted snapshot
      </button>
      <p className="mt-1.5 text-xs text-muted-foreground" data-testid={`${testIdPrefix}-share-hint`}>
        Copies amounts with card names removed. Stays on this device — nothing is uploaded.
      </p>
      {/* Hidden redacted preview for e2e — not shown visually. */}
      <div className="sr-only" data-testid={`${testIdPrefix}-share-target`} aria-hidden="true">
        {formatShareText(trace)}
      </div>
      <p
        className="mt-1.5 text-xs text-muted-foreground"
        data-testid={`${testIdPrefix}-share-status`}
        aria-live="polite"
      >
        {status === 'copied' && 'Copied — names redacted, amounts intact.'}
        {status === 'saved' && 'Saved a redacted text file — names removed.'}
        {status === 'error' && 'Could not copy. Try again, or take a manual screenshot of this panel.'}
      </p>
    </div>
  );
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Canvas 2D PNG from redacted rows — no DOM screenshot, no third-party lib. */
async function renderSharePng(trace: NumberTrace): Promise<Blob | null> {
  const redacted = redactTraceForShare(trace);
  const lines = formatShareText(redacted).split('\n');
  const canvas = document.createElement('canvas');
  const pad = 24;
  const lineH = 22;
  const width = 640;
  const height = pad * 2 + lines.length * lineH;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#fafaf9';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#1c1917';
  ctx.font = '14px ui-sans-serif, system-ui, sans-serif';
  lines.forEach((line, i) => {
    ctx.fillText(line, pad, pad + (i + 1) * lineH - 6);
  });
  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), 'image/png');
  });
}
