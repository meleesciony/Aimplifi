// @vitest-environment jsdom
/**
 * DECISIONS #792 (#789 critic cycle 3, P3-3) — the Remove target button on /budgets: a
 * deadline usually means the write committed and only the confirmation was lost, so the
 * page reloads and shows the truth; a real refusal says so and changes nothing. Its
 * accessible name carries its visible words (WCAG 2.5.3).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const clearBudget = vi.fn();
vi.mock('@/server/budget-actions', () => ({ clearBudget: (id: string) => clearBudget(id) }));

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RemoveUntrackedTargetButton } from '@/components/finance/remove-untracked-target-button';
import { ActionDeadline } from '@/components/triage/action-deadline';

const reload = vi.fn();
Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, reload } });

afterEach(() => {
  cleanup();
  clearBudget.mockReset();
  reload.mockReset();
});

async function press() {
  render(<RemoveUntrackedTargetButton categoryId="investment" name="Investment & Savings" />);
  await act(async () => {
    fireEvent.click(screen.getByTestId('budget-untracked-remove-investment'));
  });
}

describe('Remove target', () => {
  it('names itself with its visible words', () => {
    render(<RemoveUntrackedTargetButton categoryId="investment" name="Investment & Savings" />);
    const button = screen.getByRole('button');
    expect(button.textContent).toBe('Remove target');
    expect(button.getAttribute('aria-label')).toContain('Remove target');
  });

  it('removed: the page reloads', async () => {
    clearBudget.mockResolvedValue(undefined);
    await press();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a lost confirmation (deadline): the page reloads to show what happened, with no "couldn’t" claim', async () => {
    clearBudget.mockRejectedValue(new ActionDeadline());
    await press();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a refusal: no reload, and the reader is told it did not happen', async () => {
    clearBudget.mockRejectedValue(new Error('refused'));
    await press();
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('Couldn’t remove the target. Try again.');
    expect((screen.getByTestId('budget-untracked-remove-investment') as HTMLButtonElement).disabled).toBe(false);
  });
});
