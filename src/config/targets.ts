/** Dollar targets opened from the sealed October payload. This file holds no amounts. */

export interface OfficeSession {
  name: string;
  targets: OfficeTargets;
}

export interface OfficeTargets {
  managementGoals: {
    writtenSales: number;
    deliveredSales: number;
    beddingMinimum: number;
    closingRatioTarget: number;
  };
  corporateStretch: {
    writtenSales: number;
    deliveredSales: number;
  };
}
