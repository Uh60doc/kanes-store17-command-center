/** October 2026 periods and the goals Kelly configured. Not sales actuals. */

export const storeOperatingPeriod = {
  id: 'store-operating-2026-10',
  label: 'Store operating month',
  start: '2026-10-02',
  end: '2026-11-01',
  rangeDisplay: 'October 2–November 1, 2026',
  purpose: 'Store budget, written sales, delivered revenue, and company reporting.',
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
  start: '2026-10-01',
  end: '2026-10-31',
  rangeDisplay: 'October 1–October 31, 2026',
  purpose: 'Individual delivered sales and payroll-period reporting.',
} as const;

/**
 * Remaining store operating days are not defined until an operating calendar
 * is supplied. Pace stays unavailable. Do not substitute calendar dates.
 */
export const remainingOperatingDays: number | null = null;
