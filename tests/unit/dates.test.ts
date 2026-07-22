import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonthsClamped,
  addMonthsToMonthKey,
  compareDates,
  dayOfWeek,
  daysBetween,
  daysInMonth,
  formatISODate,
  fromEpochDays,
  holidayTable,
  isBusinessDay,
  monthKey,
  isLeapYear,
  isWeekend,
  isoDate,
  nextDayOfMonth,
  previousBusinessDay,
  priorBusinessDayIfNonBusiness,
  toEpochDays,
  usFederalHolidaysObserved,
} from '@/lib/dates';

const d = isoDate;

describe('isoDate validation', () => {
  it('accepts valid dates and rejects invalid ones', () => {
    expect(d('2026-06-10')).toBe('2026-06-10');
    expect(() => d('2026-02-30')).toThrow();
    expect(() => d('2026-13-01')).toThrow();
    expect(() => d('06/10/2026')).toThrow();
  });
  it('accepts Feb 29 only in leap years', () => {
    expect(d('2024-02-29')).toBe('2024-02-29');
    expect(() => d('2026-02-29')).toThrow();
  });
});

describe('leap years and month lengths', () => {
  it('handles the 4/100/400 rules', () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2026)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
    expect(isLeapYear(1900)).toBe(false);
  });
  it('month lengths', () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 6)).toBe(30);
    expect(daysInMonth(2026, 7)).toBe(31);
  });
});

describe('epoch-day round trip', () => {
  it('1970-01-01 is day 0', () => {
    expect(toEpochDays(d('1970-01-01'))).toBe(0);
    expect(fromEpochDays(0)).toBe('1970-01-01');
  });
  it('round-trips across leap boundaries', () => {
    for (const s of ['2024-02-29', '2026-06-10', '1999-12-31', '2100-03-01']) {
      expect(fromEpochDays(toEpochDays(d(s)))).toBe(s);
    }
  });
});

describe('day-of-week (anchored to known calendar facts from docs/EDGE_CASES.md)', () => {
  it('2026-06-13 is a Saturday and 2026-06-15 is a Monday', () => {
    expect(dayOfWeek(d('2026-06-13'))).toBe(6);
    expect(dayOfWeek(d('2026-06-15'))).toBe(1);
  });
  it('2026-07-04 is a Saturday; 2026-06-28 is a Sunday; 2026-06-24 is a Wednesday', () => {
    expect(dayOfWeek(d('2026-07-04'))).toBe(6);
    expect(dayOfWeek(d('2026-06-28'))).toBe(0);
    expect(dayOfWeek(d('2026-06-24'))).toBe(3);
  });
  it('isWeekend', () => {
    expect(isWeekend(d('2026-06-13'))).toBe(true);
    expect(isWeekend(d('2026-06-14'))).toBe(true);
    expect(isWeekend(d('2026-06-15'))).toBe(false);
  });
});

describe('addDays / daysBetween / compare', () => {
  it('adds across month and year boundaries', () => {
    expect(addDays(d('2026-06-30'), 1)).toBe('2026-07-01');
    expect(addDays(d('2026-01-01'), -1)).toBe('2025-12-31');
    expect(addDays(d('2024-02-28'), 1)).toBe('2024-02-29');
  });
  it('daysBetween is signed', () => {
    expect(daysBetween(d('2026-06-10'), d('2026-06-15'))).toBe(5);
    expect(daysBetween(d('2026-06-15'), d('2026-06-10'))).toBe(-5);
  });
  it('compareDates', () => {
    expect(compareDates(d('2026-06-10'), d('2026-06-15'))).toBe(-1);
    expect(compareDates(d('2026-06-15'), d('2026-06-15'))).toBe(0);
  });
});

describe('addMonthsClamped (docs/EDGE_CASES.md §Money & dates)', () => {
  it("clamps Jan 31 + 1 month to Feb 28 in a non-leap year", () => {
    expect(addMonthsClamped(d('2026-01-31'), 1)).toBe('2026-02-28');
  });
  it('clamps to Feb 29 in a leap year', () => {
    expect(addMonthsClamped(d('2024-01-31'), 1)).toBe('2024-02-29');
  });
  it('a cycle anchored on the 31st produces correct month-ends across a year', () => {
    const anchor = d('2026-01-31');
    const expected = [
      '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30',
      '2026-07-31', '2026-08-31', '2026-09-30', '2026-10-31', '2026-11-30',
      '2026-12-31', '2027-01-31',
    ];
    expected.forEach((exp, i) => {
      expect(addMonthsClamped(anchor, i + 1)).toBe(exp);
    });
  });
  it('handles negative months and year wrap', () => {
    expect(addMonthsClamped(d('2026-01-15'), -2)).toBe('2025-11-15');
    expect(addMonthsClamped(d('2026-03-31'), -1)).toBe('2026-02-28');
  });
});

describe('US federal holidays (observed)', () => {
  it('2026: Independence Day (Sat 07-04) is observed Friday 07-03', () => {
    const h = usFederalHolidaysObserved(2026);
    expect(h).toContain('2026-07-03');
    expect(h).not.toContain('2026-07-04');
  });
  it('2026: Juneteenth falls on Friday 06-19 (no shift)', () => {
    expect(usFederalHolidaysObserved(2026)).toContain('2026-06-19');
  });
  it('2026: floating holidays — MLK Jan 19, Memorial May 25, Labor Sep 7, Thanksgiving Nov 26', () => {
    const h = usFederalHolidaysObserved(2026);
    for (const x of ['2026-01-19', '2026-05-25', '2026-09-07', '2026-11-26']) {
      expect(h).toContain(x);
    }
  });
  it('2027: Juneteenth (Sat) observed 06-18; Independence Day (Sun) observed 07-05; Christmas (Sat) observed 12-24', () => {
    const h = usFederalHolidaysObserved(2027);
    expect(h).toContain('2027-06-18');
    expect(h).toContain('2027-07-05');
    expect(h).toContain('2027-12-24');
  });
  it('holidayTable spans multiple years', () => {
    const t = holidayTable(2025, 2027);
    expect(t).toContain('2025-12-25');
    expect(t).toContain('2026-07-03');
    expect(t).toContain('2027-07-05');
    expect(t.length).toBe(33);
  });
});

describe('business-day adjustment (conservative walk-back, EDGE_CASES §E)', () => {
  const holidays = holidayTable(2025, 2027);

  it('E: Saturday 2026-06-13 adjusts to Friday 2026-06-12', () => {
    expect(priorBusinessDayIfNonBusiness(d('2026-06-13'), holidays)).toBe('2026-06-12');
  });
  it('E2: Saturday 2026-07-04 walks back over the observed holiday (Fri 07-03) to Thursday 2026-07-02', () => {
    expect(priorBusinessDayIfNonBusiness(d('2026-07-04'), holidays)).toBe('2026-07-02');
  });
  it('Sunday 2026-06-28 adjusts to Friday 2026-06-26', () => {
    expect(priorBusinessDayIfNonBusiness(d('2026-06-28'), holidays)).toBe('2026-06-26');
  });
  it('a business day passes through unchanged', () => {
    expect(priorBusinessDayIfNonBusiness(d('2026-06-15'), holidays)).toBe('2026-06-15');
  });
  it('previousBusinessDay: Monday 2026-06-15 → Friday 2026-06-12', () => {
    expect(previousBusinessDay(d('2026-06-15'), holidays)).toBe('2026-06-12');
  });
  it('previousBusinessDay: Wednesday 2026-06-24 → Tuesday 2026-06-23', () => {
    expect(previousBusinessDay(d('2026-06-24'), holidays)).toBe('2026-06-23');
  });
  it('isBusinessDay treats holidays as non-business', () => {
    expect(isBusinessDay(d('2026-07-03'), holidays)).toBe(false);
    expect(isBusinessDay(d('2026-06-19'), holidays)).toBe(false); // Juneteenth 2026
    expect(isBusinessDay(d('2026-06-22'), holidays)).toBe(true);
  });
});

describe('formatISODate (UI boundary)', () => {
  it('formats short and long', () => {
    expect(formatISODate(d('2026-06-15'))).toBe('Mon, Jun 15');
    expect(formatISODate(d('2026-06-15'), 'long')).toBe('Mon, Jun 15, 2026');
  });
});

describe('nextDayOfMonth (shared by the cash-needed assembler + loan-obligation engine)', () => {
  it('returns the same-month occurrence when the day is on/after `from`', () => {
    expect(nextDayOfMonth(15, d('2026-06-10'))).toBe('2026-06-15');
    expect(nextDayOfMonth(10, d('2026-06-10'))).toBe('2026-06-10'); // boundary: today counts
  });
  it('rolls to next month when the day has already passed this month', () => {
    expect(nextDayOfMonth(5, d('2026-06-10'))).toBe('2026-07-05');
  });
  it('clamps the day to the month length (no overflow into the next month)', () => {
    expect(nextDayOfMonth(31, d('2026-02-10'))).toBe('2026-02-28'); // Feb 2026 has 28 days
    expect(nextDayOfMonth(31, d('2026-04-10'))).toBe('2026-04-30'); // April has 30
    // already past the clamped day this month → next month, re-clamped
    expect(nextDayOfMonth(31, d('2026-02-28'))).toBe('2026-02-28');
  });
});

describe('monthKey / addMonthsToMonthKey (the one month-key home — 2026-07-21 review B4)', () => {
  it('monthKey takes the calendar month of a date, timezone-free', () => {
    expect(monthKey('2026-06-15')).toBe('2026-06');
    // Boundary days: a month key must never shift by a timezone hour.
    expect(monthKey('2026-01-01')).toBe('2026-01');
    expect(monthKey('2026-12-31')).toBe('2026-12');
  });

  it('addMonthsToMonthKey steps forward and back across year boundaries', () => {
    expect(addMonthsToMonthKey('2026-06', 1)).toBe('2026-07');
    expect(addMonthsToMonthKey('2026-06', -1)).toBe('2026-05');
    expect(addMonthsToMonthKey('2026-12', 1)).toBe('2027-01');
    expect(addMonthsToMonthKey('2026-01', -1)).toBe('2025-12');
    expect(addMonthsToMonthKey('2026-06', 0)).toBe('2026-06');
  });

  it('handles multi-year steps and agrees with addMonthsClamped', () => {
    expect(addMonthsToMonthKey('2026-06', 18)).toBe('2027-12');
    expect(addMonthsToMonthKey('2026-06', -18)).toBe('2024-12');
    expect(addMonthsToMonthKey('2026-03', -14)).toBe(
      monthKey(addMonthsClamped(isoDate('2026-03-01'), -14)),
    );
  });

  it('the 31st never leaks into the key (arithmetic runs on the 1st)', () => {
    // A naive `new Date('2026-01-31') + 1 month` lands in March; the key must not.
    expect(addMonthsToMonthKey(monthKey('2026-01-31'), 1)).toBe('2026-02');
  });

  it('rejects a malformed month key rather than inventing one', () => {
    expect(() => addMonthsToMonthKey('2026-13', 1)).toThrow();
    expect(() => addMonthsToMonthKey('not-a-month', 1)).toThrow();
  });
});
