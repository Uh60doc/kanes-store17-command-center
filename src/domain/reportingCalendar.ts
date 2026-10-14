/** Store and individual calendars. The measured subject picks the calendar. */

export type ReportingCategory = 'store' | 'individual';

export interface ReportingPeriod {
  category: ReportingCategory;
  year: number;
  month: number;
  start: string;
  end: string;
}

function iso(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parts(isoDate: string): { year: number; month: number; day: number } {
  const [year, month, day] = isoDate.split('-').map(Number);
  return { year: year ?? 0, month: month ?? 0, day: day ?? 0 };
}

/** Last calendar day of a month. February follows the Gregorian leap-year rule. */
export function lastCalendarDay(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Named month for a category.
 * Store: the 2nd of that month through the 1st of the next month.
 * Individual: the 1st through the last calendar day of that month.
 */
export function periodFor(category: ReportingCategory, year: number, month: number): ReportingPeriod {
  if (month < 1 || month > 12 || !Number.isInteger(year) || !Number.isInteger(month)) {
    throw new Error('A reporting month is a year and a month from 1 to 12.');
  }
  if (category === 'individual') {
    return {
      category,
      year,
      month,
      start: iso(year, month, 1),
      end: iso(year, month, lastCalendarDay(year, month)),
    };
  }
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  return {
    category: 'store',
    year,
    month,
    start: iso(year, month, 2),
    end: iso(nextYear, nextMonth, 1),
  };
}

/** The store month that contains a date. The 1st closes the previous store month. */
export function storePeriodContaining(isoDate: string): ReportingPeriod {
  const { year, month, day } = parts(isoDate);
  if (day === 1) {
    const previousMonth = month === 1 ? 12 : month - 1;
    const previousYear = month === 1 ? year - 1 : year;
    return periodFor('store', previousYear, previousMonth);
  }
  return periodFor('store', year, month);
}

/** The individual month that contains a date. The 1st opens that calendar month. */
export function individualPeriodContaining(isoDate: string): ReportingPeriod {
  const { year, month } = parts(isoDate);
  return periodFor('individual', year, month);
}

export function periodContaining(category: ReportingCategory, isoDate: string): ReportingPeriod {
  return category === 'store' ? storePeriodContaining(isoDate) : individualPeriodContaining(isoDate);
}

export function inPeriod(isoDate: string, period: Pick<ReportingPeriod, 'start' | 'end'>): boolean {
  return isoDate >= period.start && isoDate <= period.end;
}

/** Copies the rows whose own dates fall in the category period. The input list is left unchanged. */
export function filterByCategory<T>(
  rows: readonly T[],
  category: ReportingCategory,
  year: number,
  month: number,
  dateOf: (row: T) => string,
): T[] {
  const period = periodFor(category, year, month);
  return rows.filter((row) => inPeriod(dateOf(row), period));
}
