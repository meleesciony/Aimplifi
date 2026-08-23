// @vitest-environment jsdom
/**
 * P1.3 "Your Rich Life" echo on /coach — render decision locked.
 *
 * The line is the reader's OWN words inside a registered sentence, rendered
 * only when the reader wrote one: no stored vision → no line, so a page for
 * someone who never answered the question makes no claim their life is any
 * particular thing. The sentence itself is the plan's P1.3 template verbatim.
 *
 * Deliberately not a snapshot — a snapshot would go green on any change that
 * updates it (the C.26 rule).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { RichLifeEcho } from '@/components/coach/rich-life-echo';
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';

afterEach(cleanup);

describe('P1.3 Rich Life echo', () => {
  it('renders the reader vision verbatim inside the registered sentence', () => {
    const vision = 'Three months of travel every year with the family';
    render(<RichLifeEcho vision={vision} />);
    const line = screen.getByTestId('rich-life-vision');
    expect(line.textContent).toBe(COACH_COPY.richLifeHeader(vision));
    expect(line.textContent).toContain(vision);
  });

  it('stays utterly silent when no vision was written', () => {
    render(<RichLifeEcho vision={null} />);
    expect(screen.queryByTestId('rich-life-vision')).toBeNull();
  });

  it('the header sentence is the P1.3 template SCOPED to the reader money (critic F2)', () => {
    // The bare plan template ("Every number below") was falsified by the
    // value-receipts tally (a count of the app's own flags), so the shipped
    // sentence claims only the numbers about the reader's money.
    expect(COACH_COPY.richLifeHeader('a calm, funded year')).toBe(
      'Your Rich Life: "a calm, funded year". Every number about your money below is in service of that — not the other way around.',
    );
  });

  it('wraps a one-token vision instead of overflowing the mobile width (critic F4)', () => {
    render(<RichLifeEcho vision={'x'.repeat(120)} />);
    const line = screen.getByTestId('rich-life-vision');
    expect(line.className).toContain('break-words');
  });
});
