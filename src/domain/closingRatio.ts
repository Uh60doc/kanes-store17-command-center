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

export interface MatchedClosing extends ClosingResult {
  matchedDates: string[];
}

/** Dates that have both a customer count and an opportunity count, in order. */
export function matchedDates(
  dates: readonly string[],
  customers: ReadonlyMap<string, number>,
  opportunities: ReadonlyMap<string, number>,
): string[] {
  return dates.filter((date) => customers.has(date) && opportunities.has(date));
}

/**
 * Month-to-date adds the matched daily counts, then divides once.
 * A day with only one of the two reports is left out. It is not counted as zero.
 */
export function matchedClosing(
  dates: readonly string[],
  customers: ReadonlyMap<string, number>,
  opportunities: ReadonlyMap<string, number>,
): MatchedClosing {
  const included = matchedDates(dates, customers, opportunities);
  if (!included.length) {
    return { customers: null, opportunities: null, ratio: null, needsReconciliation: false, matchedDates: [] };
  }
  const customerTotal = included.reduce((total, date) => total + (customers.get(date) ?? 0), 0);
  const opportunityTotal = included.reduce((total, date) => total + (opportunities.get(date) ?? 0), 0);
  const computed = closingRatio(customerTotal, opportunityTotal);
  return {
    customers: customerTotal,
    opportunities: opportunityTotal,
    ratio: computed.ratio,
    needsReconciliation: computed.needsReconciliation,
    matchedDates: included,
  };
}

/**
 * One cumulative count is usable only when every snapshot for that exact period agrees.
 * Snapshots with different start or end dates are left out. They are not added together.
 */
export function periodSnapshot(
  snapshots: readonly { start: string; end: string; opportunities: number }[],
  periodStart: string,
  periodEnd: string,
): number | null {
  const matches = snapshots.filter((row) => row.start === periodStart && row.end === periodEnd);
  const first = matches[0];
  if (!first) return null;
  if (matches.some((row) => row.opportunities !== first.opportunities)) return null;
  return first.opportunities;
}

/**
 * Month-to-date adds customers and opportunities separately, then divides.
 * It does not average daily percentages.
 * A full-period total is used only with the other total for that same period.
 * A daily month is used only when every date in the window has both counts.
 * One complete day does not stand in for the rest of the month.
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
  if (input.periodCustomers !== null || input.periodOpportunities !== null) {
    return {
      customers: input.periodCustomers !== null ? input.periodCustomers : coveredTotal(input.dates, input.customers),
      opportunities: input.periodOpportunities !== null ? input.periodOpportunities : coveredTotal(input.dates, input.opportunities),
      ratio: null,
      needsReconciliation: false,
    };
  }
  const incomplete = input.dates.some((date) => !input.customers.has(date) || !input.opportunities.has(date));
  if (incomplete || input.dates.length === 0) {
    return { customers: null, opportunities: null, ratio: null, needsReconciliation: false };
  }
  const matched = matchedClosing(input.dates, input.customers, input.opportunities);
  return {
    customers: matched.customers,
    opportunities: matched.opportunities,
    ratio: matched.ratio,
    needsReconciliation: matched.needsReconciliation,
  };
}
