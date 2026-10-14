/** October 2026 periods and the goals Kelly configured. Not sales actuals. */

import { periodFor } from '../domain/reportingCalendar.ts';

const octoberStore = periodFor('store', 2026, 10);
const octoberIndividual = periodFor('individual', 2026, 10);

export const reportingMonth = { year: 2026, month: 10 } as const;

export const storeOperatingPeriod = {
  id: 'store-operating-2026-10',
  label: 'Store operating month',
  start: octoberStore.start,
  end: octoberStore.end,
  rangeDisplay: 'October 2–November 1, 2026',
  purpose: 'Store reports use the 2nd through the 1st of the next month.',
  managementGoals: {
    writtenSales: 400_000,
    deliveredSales: 320_000,
    beddingMinimum: 0.2,
    closingRatioTarget: 0.4,
  },
  corporateStretch: {
    writtenSales: 652_274,
    deliveredSales: 564_373,
  },
  priorYearSnap: {
    rangeDisplay: 'October 1–31, 2025',
    map: 'operating-day number',
  },
} as const;

export const payrollPeriod = {
  id: 'payroll-2026-10',
  label: 'Salesperson / payroll month',
  start: octoberIndividual.start,
  end: octoberIndividual.end,
  rangeDisplay: 'October 1–October 31, 2026',
  purpose: 'Individual reports use the 1st through the last calendar day of the month.',
} as const;

/**
 * Remaining store operating days are not defined until an operating calendar
 * is supplied. Pace stays unavailable. Do not substitute calendar dates.
 */
export const remainingOperatingDays: number | null = null;
