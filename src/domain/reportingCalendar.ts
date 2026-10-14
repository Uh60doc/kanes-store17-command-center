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

function addDays(isoDate: string, days: number): string {
  const { year, month, day } = parts(isoDate);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Every calendar date from the period start through the period end, inclusive. */
export function datesInPeriod(period: Pick<ReportingPeriod, 'start' | 'end'>): string[] {
  const dates: string[] = [];
  let cursor = period.start;
  while (cursor <= period.end) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return dates;
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** Readable range. Same-month periods stay in one month name. Cross-year periods keep both years. */
export function rangeLabel(period: Pick<ReportingPeriod, 'start' | 'end'>): string {
  const start = parts(period.start);
  const end = parts(period.end);
  const startMonth = MONTH_NAMES[(start.month || 1) - 1] ?? '';
  const endMonth = MONTH_NAMES[(end.month || 1) - 1] ?? '';
  if (start.year === end.year && start.month === end.month) {
    return `${startMonth} ${start.day}–${end.day}, ${start.year}`;
  }
  if (start.year === end.year) return `${startMonth} ${start.day}–${endMonth} ${end.day}, ${start.year}`;
  return `${startMonth} ${start.day}, ${start.year}–${endMonth} ${end.day}, ${end.year}`;
}

/**
 * Selling days still left in a store period.
 * Every date counts, including today when today falls in the period,
 * unless that date was explicitly marked closed.
 * An empty closure list means the whole span is open. It does not mean zero days.
 */
export function operatingDaysRemaining(
  period: Pick<ReportingPeriod, 'start' | 'end'>,
  today: string,
  closedDates: readonly string[] = [],
): number {
  const closed = new Set(closedDates);
  return datesInPeriod(period).filter((date) => date >= today && date <= period.end && !closed.has(date)).length;
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
