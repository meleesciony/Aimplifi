/**
 * Reports named calendar years (DECISIONS #567). Trailing 6/12/24 stays the
 * default. A named year is Jan–Dec of that civil year, clamped to today.
 */
import { describe, expect, it } from 'vitest';
import { DEMO_USER_ID } from '@/lib/demo-user';
import { parseReportYear, reportCalendarYears } from '@/lib/engine/reports/chart-range';
import { getReports } from '@/server/reports';

const TODAY = '2026-06-10';

describe('reportCalendarYears / parseReportYear', () => {
  it('test_regression__reports_range_names_calendar_years_2024_2025_2026', () => {
    expect(reportCalendarYears(TODAY)).toEqual([2024, 2025, 2026]);
    expect(reportCalendarYears('2026-09-01')).toEqual([2024, 2025, 2026]);
    expect(parseReportYear('2024', TODAY)).toBe(2024);
    expect(parseReportYear('2025', TODAY)).toBe(2025);
    expect(parseReportYear('2026', TODAY)).toBe(2026);
    expect(parseReportYear('2023', TODAY)).toBeNull();
    expect(parseReportYear('26', TODAY)).toBeNull();
    expect(parseReportYear('not-a-year', TODAY)).toBeNull();
  });
});

describe('getReports — named calendar year', () => {
  it('default payload still answers this month and lists 2024–2026', async () => {
    const data = await getReports(DEMO_USER_ID);
    expect(data.year).toBeNull();
    expect(data.window).toEqual({ fromYm: '2026-06', toYm: '2026-06', asOf: TODAY });
    expect(data.calendarYears).toEqual([2024, 2025, 2026]);
  });

  it('year 2025 is Jan–Dec 2025, and every chart bar is in 2025', async () => {
    const data = await getReports(DEMO_USER_ID, 6, { year: 2025 });
    expect(data.year).toBe(2025);
    expect(data.window).toEqual({ fromYm: '2025-01', toYm: '2025-12', asOf: TODAY });
    expect(data.months.every((m) => m.month.startsWith('2025-'))).toBe(true);
    const href = Object.values(data.categoryHrefs).find((h) => h != null);
    if (href) {
      expect(href).toContain('from=2025-01-01');
      expect(href).toContain('to=2025-12-31');
    }
  });

  it('year 2026 is Jan–Dec 2026 stopping at today', async () => {
    const data = await getReports(DEMO_USER_ID, 6, { year: 2026 });
    expect(data.year).toBe(2026);
    expect(data.window).toEqual({ fromYm: '2026-01', toYm: '2026-12', asOf: TODAY });
    expect(data.months.every((m) => m.month.startsWith('2026-'))).toBe(true);
    const href = Object.values(data.categoryHrefs).find((h) => h != null);
    if (href) {
      expect(href).toContain('from=2026-01-01');
      expect(href).toContain('to=2026-06-10');
    }
  });

  it('an out-of-range year is ignored — this month, trailing chart', async () => {
    const data = await getReports(DEMO_USER_ID, 6, { year: 1999 });
    expect(data.year).toBeNull();
    expect(data.window.fromYm).toBe('2026-06');
  });
});
