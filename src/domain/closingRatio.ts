/** Official closing ratio: Net Written purchasing customers ÷ PERQ Ups + Be Backs. */

export interface ClosingResult {
  customers: number | null;
  opportunities: number | null;
  ratio: number | null;
  needsReconciliation: boolean;
}

/** Divide the two counts. Missing data and a zero denominator stay uncalculated. */
export function closingRatio(customers: number | null, opportunities: number | null): Pick<ClosingResult, 'ratio' | 'needsReconciliation'> {
  if (customers === null || opportunities === null || opportunities === 0) {
    return { ratio: null, needsReconciliation: false };
  }
  const ratio = Math.round((customers / opportunities) * 1000) / 1000;
  return { ratio, needsReconciliation: ratio > 1 };
}

/**
 * Sum a series only when every date from the start through the latest present
 * date has a count. A gap stays null so a missing day is not treated as zero.
 */
export function coveredTotal(dates: readonly string[], values: ReadonlyMap<string, number>): number | null {
  const end = coverageEnd(dates, values);
  if (end === null) return null;
  return dates.filter((date) => date <= end).reduce((total, date) => total + (values.get(date) ?? 0), 0);
}

export function coverageEnd(dates: readonly string[], values: ReadonlyMap<string, number>): string | null {
  const present = dates.filter((date) => values.has(date));
  const latest = present[present.length - 1];
  if (latest === undefined) return null;
  const required = dates.filter((date) => date <= latest);
  if (required.some((date) => !values.has(date))) return null;
  return latest;
}

/**
 * Month-to-date adds customers and opportunities separately, then divides.
 * It does not average daily percentages.
 * A full-period total is used only with the other total for that same period.
 * Daily totals are divided only when both sides end on the same date.
 */
export function officialClosing(input: {
  periodCustomers: number | null;
  periodOpportunities: number | null;
  dates: readonly string[];
  customers: ReadonlyMap<string, number>;
  opportunities: ReadonlyMap<string, number>;
}): ClosingResult {
  if (input.periodCustomers !== null && input.periodOpportunities !== null) {
    const computed = closingRatio(input.periodCustomers, input.periodOpportunities);
    return {
      customers: input.periodCustomers,
      opportunities: input.periodOpportunities,
      ratio: computed.ratio,
      needsReconciliation: computed.needsReconciliation,
    };
  }

  const customerEnd = input.periodCustomers === null ? coverageEnd(input.dates, input.customers) : null;
  const opportunityEnd = input.periodOpportunities === null ? coverageEnd(input.dates, input.opportunities) : null;
  const customers = input.periodCustomers !== null ? input.periodCustomers : coveredTotal(input.dates, input.customers);
  const opportunities = input.periodOpportunities !== null ? input.periodOpportunities : coveredTotal(input.dates, input.opportunities);
  const sameDailyRange =
    input.periodCustomers === null &&
    input.periodOpportunities === null &&
    customerEnd !== null &&
    customerEnd === opportunityEnd;
  const computed = sameDailyRange ? closingRatio(customers, opportunities) : { ratio: null, needsReconciliation: false };
  return {
    customers,
    opportunities,
    ratio: computed.ratio,
    needsReconciliation: computed.needsReconciliation,
  };
}
