import type { CalendarKind } from '../import/types.ts';
import { periodFor } from './reportingCalendar.ts';

const octoberStore = periodFor('store', 2026, 10);
const octoberIndividual = periodFor('individual', 2026, 10);

export const STORE_PERIOD_START = octoberStore.start;
export const STORE_PERIOD_END = octoberStore.end;
export const PAYROLL_PERIOD_START = octoberIndividual.start;
export const PAYROLL_PERIOD_END = octoberIndividual.end;
export const PRIOR_YEAR_START = '2025-10-02';
export const OPERATING_DAY_COUNT = 31;

export function parseIsoDate(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(Date.UTC(year, (month ?? 1) - 1, day ?? 1));
}

export function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addUtcDays(iso: string, days: number): string {
  const date = parseIsoDate(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return formatIsoDate(date);
}

export function inclusiveDayCount(start: string, end: string): number {
  const ms = parseIsoDate(end).getTime() - parseIsoDate(start).getTime();
  return Math.round(ms / 86_400_000) + 1;
}

export function inRange(iso: string, start: string, end: string): boolean {
  return iso >= start && iso <= end;
}

/** October 2, 2026 is operating day 1 and matches October 2, 2025. */
export function sequentialLastYearDate(storeDate: string): string | null {
  if (!inRange(storeDate, STORE_PERIOD_START, STORE_PERIOD_END)) return null;
  const index = inclusiveDayCount(STORE_PERIOD_START, storeDate) - 1;
  return addUtcDays(PRIOR_YEAR_START, index);
}

export function calendarFor(start: string, end: string): CalendarKind {
  const store = start >= STORE_PERIOD_START && end <= STORE_PERIOD_END;
  const payroll = start >= PAYROLL_PERIOD_START && end <= PAYROLL_PERIOD_END;
  if (store && payroll) return 'both';
  if (store) return 'store-operating';
  if (payroll) return 'payroll';
  return 'other';
}

export function isSingleDay(start: string, end: string): boolean {
  return start === end;
}

/**
 * A snapshot printed on the period end date can still be an open business day.
 * Reports printed after the end date are the completed range.
 */
export function isProvisional(periodEnd: string, generatedAt: string | null): boolean {
  if (!generatedAt) return false;
  return generatedAt.slice(0, 10) <= periodEnd;
}

export function daysAfter(iso: string, through: string): number {
  if (iso >= through) return 0;
  return inclusiveDayCount(addUtcDays(iso, 1), through);
}

const MONTHS: Record<string, string> = {
  JAN: '01',
  FEB: '02',
  MAR: '03',
  APR: '04',
  MAY: '05',
  JUN: '06',
  JUL: '07',
  AUG: '08',
  SEP: '09',
  OCT: '10',
  NOV: '11',
  DEC: '12',
};

export function parseReportDay(token: string): string | null {
  const match = /^(\d{2})-([A-Z]{3})-(\d{4})$/i.exec(token.trim());
  if (!match) return null;
  const month = MONTHS[match[2].toUpperCase()];
  if (!month) return null;
  return `${match[3]}-${month}-${match[1]}`;
}

export function parseGeneratedAt(date: string, time: string): string | null {
  const dateMatch = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(date.trim());
  const timeMatch = /^(\d{1,2}):(\d{2})\s*([AP]M)$/i.exec(time.trim());
  if (!dateMatch || !timeMatch) return null;
  let hour = Number(timeMatch[1]);
  const minute = timeMatch[2];
  const meridiem = timeMatch[3].toUpperCase();
  if (meridiem === 'PM' && hour !== 12) hour += 12;
  if (meridiem === 'AM' && hour === 12) hour = 0;
  return `${dateMatch[3]}-${dateMatch[1]}-${dateMatch[2]}T${String(hour).padStart(2, '0')}:${minute}`;
}

export function eachDate(start: string, end: string): string[] {
  const dates: string[] = [];
  let cursor = start;
  while (cursor <= end) {
    dates.push(cursor);
    cursor = addUtcDays(cursor, 1);
  }
  return dates;
}
