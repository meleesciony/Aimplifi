/**
 * The triage pending-stall lock (probed 2026-07-05): Next.js can sever a server
 * action's response stream under rapid sequential dispatch (net::ERR_ABORTED on
 * the action POST); when the value chunk is lost the awaited promise never
 * settles, and an un-bounded await inside startTransition leaves `pending` true
 * forever — every triage button disabled until a full reload (the phase2-triage
 * "button stuck disabled" flake, STATUS 2026-07-04/05). withDeadline is the
 * bound that turns that hang into a typed, recoverable rejection.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ACTION_DEADLINE_MS,
  ActionDeadline,
  withDeadline,
} from '@/components/triage/action-deadline';

describe('withDeadline — the triage pending-stall bound', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('test_regression__triage_pending_stall_bounded: a promise that NEVER settles rejects with ActionDeadline at the deadline', async () => {
    vi.useFakeTimers();
    const hung = new Promise<never>(() => {
      /* a severed response stream: no resolve, no reject, ever */
    });
    const bounded = withDeadline(hung);
    // Attach the rejection expectation BEFORE advancing so the rejection is handled.
    const assertion = expect(bounded).rejects.toBeInstanceOf(ActionDeadline);
    await vi.advanceTimersByTimeAsync(ACTION_DEADLINE_MS);
    await assertion;
  });

  it('does not reject early: one tick before the deadline the promise is still pending', async () => {
    vi.useFakeTimers();
    let settled = false;
    const bounded = withDeadline(new Promise<never>(() => {})).catch(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(ACTION_DEADLINE_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await bounded;
    expect(settled).toBe(true);
  });

  it('passes a resolution through untouched and clears the timer (no leak)', async () => {
    vi.useFakeTimers();
    await expect(withDeadline(Promise.resolve('ok'))).resolves.toBe('ok');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('passes a real rejection through as-is — a genuine action failure is NOT re-labeled a deadline', async () => {
    vi.useFakeTimers();
    const boom = new Error('ownership check failed');
    await expect(withDeadline(Promise.reject(boom))).rejects.toBe(boom);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('honors a custom deadline', async () => {
    vi.useFakeTimers();
    const bounded = withDeadline(new Promise<never>(() => {}), 500);
    const assertion = expect(bounded).rejects.toBeInstanceOf(ActionDeadline);
    await vi.advanceTimersByTimeAsync(500);
    await assertion;
  });
});
