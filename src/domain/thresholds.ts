export type TierColor = 'red' | 'orange' | 'yellow' | 'lime' | 'dark_green';

export interface DeliveredTier {
  color: TierColor;
  ratePercent: number;
  nextTargetCents: number | null;
  label: string;
}

const DELIVERED_TIERS = [
  { minCents: 0, color: 'red', ratePercent: 4, nextTargetCents: 6_000_000, label: 'Under $60,000' },
  { minCents: 6_000_000, color: 'orange', ratePercent: 5, nextTargetCents: 7_500_000, label: '$60,000–$74,999.99' },
  { minCents: 7_500_000, color: 'yellow', ratePercent: 6, nextTargetCents: 9_500_000, label: '$75,000–$94,999.99' },
  { minCents: 9_500_000, color: 'lime', ratePercent: 7, nextTargetCents: 11_500_000, label: '$95,000–$114,999.99' },
  { minCents: 11_500_000, color: 'dark_green', ratePercent: 8, nextTargetCents: null, label: '$115,000 and above' },
] as const;

/** Calendar-month qualifying delivered sales. Boundaries are exact cents. */
export function deliveredTier(cents: number): DeliveredTier {
  let selected: DeliveredTier = DELIVERED_TIERS[0];
  for (const tier of DELIVERED_TIERS) {
    if (cents >= tier.minCents) selected = tier;
  }
  return selected;
}

export interface ProtectionStatus {
  coachingColor: 'red' | 'yellow' | 'green';
  /** Agreement pays 25% only when protection dollars are strictly over $4,500. */
  commissionRate25: boolean;
  coachingGreen: boolean;
}

export function protectionStatus(cents: number): ProtectionStatus {
  if (cents < 300_000) {
    return { coachingColor: 'red', commissionRate25: false, coachingGreen: false };
  }
  if (cents < 450_000) {
    return { coachingColor: 'yellow', commissionRate25: false, coachingGreen: false };
  }
  return {
    coachingColor: 'green',
    commissionRate25: cents > 450_000,
    coachingGreen: true,
  };
}

export function beddingColor(ratio: number | null): 'red' | 'green' | 'neutral' {
  if (ratio === null) return 'neutral';
  return ratio >= 0.2 ? 'green' : 'red';
}

/** Dollars over dollars. Never an average of daily percentage rates. */
export function beddingRatio(bedSalesCents: number | null, totalSalesCents: number | null): number | null {
  if (bedSalesCents === null || totalSalesCents === null || totalSalesCents === 0) return null;
  return bedSalesCents / totalSalesCents;
}
