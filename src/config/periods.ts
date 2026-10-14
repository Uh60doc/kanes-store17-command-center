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
    /** Store month and every salesperson month. Green at 50% or higher. */
    closingRatioTarget: 0.5,
    /** Overall attachment. Green at 90% or higher. Missing reports stay Not Available. */
    storeAttachmentTarget: 0.9,
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
 * Official budgets for the configured store month only.
 * Another month does not inherit these dollars. Daily pace never writes them back.
 */
export function goalsForStorePeriod(period: { start: string; end: string }): {
  written: number | null;
  delivered: number | null;
  stretchWritten: number | null;
  stretchDelivered: number | null;
} {
  if (period.start === storeOperatingPeriod.start && period.end === storeOperatingPeriod.end) {
    return {
      written: storeOperatingPeriod.managementGoals.writtenSales,
      delivered: storeOperatingPeriod.managementGoals.deliveredSales,
      stretchWritten: storeOperatingPeriod.corporateStretch.writtenSales,
      stretchDelivered: storeOperatingPeriod.corporateStretch.deliveredSales,
    };
  }
  return { written: null, delivered: null, stretchWritten: null, stretchDelivered: null };
}
