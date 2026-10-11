export const REPORT_TYPES = [
  'SNAP Written',
  'SNAP Delivered',
  'NWDSR Written',
  'NWDSR Delivered',
  'PERQ',
  'BSSA',
  'MPPA',
  'FABW',
  'LTHW',
  'PWAR',
  'Rug Sales Written',
  'UVWL',
] as const;

export type ReportType = (typeof REPORT_TYPES)[number];

export const IMPORT_SOURCE_IDS = ['manual-upload', 'company-mailbox'] as const;

export type ImportSourceId = (typeof IMPORT_SOURCE_IDS)[number];

export type CalendarKind = 'store-operating' | 'payroll';

export type SnapshotStatus = 'current' | 'superseded' | 'flagged';

/** Keys a parser actually read. Absent keys are unknown and are never stored as zero. */
export type SnapshotMetrics = Readonly<Record<string, number>>;

export interface DatedAmount {
  date: string;
  amount: number;
}

export interface ReportSnapshot {
  id: string;
  reportType: ReportType;
  storeNumber: 17;
  periodStart: string;
  periodEnd: string;
  calendar: CalendarKind;
  generatedAt: string | null;
  importedAt: string;
  status: SnapshotStatus;
  supersedes: string | null;
  source: ImportSourceId;
  fileName: string;
  metrics: SnapshotMetrics;
  /** Per-day amounts only when the file actually contained them. */
  daily: readonly DatedAmount[];
  issues: readonly string[];
}

export interface IncomingReportFile {
  source: ImportSourceId;
  fileName: string;
  mediaType: string;
  bytes: Uint8Array;
  receivedAt: string;
}

export interface ImportSourceDescriptor {
  id: ImportSourceId;
  label: string;
  connected: false;
  handsOffTo: 'acceptIncomingReport';
}
