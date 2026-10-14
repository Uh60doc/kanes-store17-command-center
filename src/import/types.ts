import type { EmployeeRole } from '../config/roster.ts';
import type { ReportedPrecision } from '../domain/money.ts';

export const REPORT_TYPES = [
  'SNAP Written',
  'SNAP Delivered',
  'NWDSR Written',
  'NWDSR Delivered',
  'PERQ',
  'BSSA Written',
  'BSSA Delivered',
  'MPPA Written',
  'FABW Written',
  'FABW Delivered',
  'LTHW Written',
  'PWAR Written',
  'Rug Sales Written',
  'UVWL Written',
  'AVSA Written',
  'FISPP Written',
  'SPR Projection',
  'Written Sales Ranking',
  'Store KPI',
  'Classification Analysis',
  'Pet Protection',
  'Bedroom Mattress Dining Exceptions',
] as const;

export type ReportType = (typeof REPORT_TYPES)[number];

export const IMPORT_SOURCE_IDS = ['manual-upload', 'company-mailbox'] as const;

export type ImportSourceId = (typeof IMPORT_SOURCE_IDS)[number];

export type CalendarKind = 'store-operating' | 'payroll' | 'both' | 'other';

export type SnapshotStatus = 'current' | 'superseded' | 'flagged';

export type IssueSeverity = 'block' | 'warn' | 'info';

export interface ReportIssue {
  severity: IssueSeverity;
  message: string;
}

/** Keys a parser actually read. Absent keys are unknown and are never stored as zero. */
export type SnapshotMetrics = Readonly<Record<string, number>>;

export interface DatedAmount {
  date: string;
  amount: number;
}

export interface AssociateRow {
  employeeCode: string | null;
  sourceName: string;
  displayName: string;
  role: EmployeeRole;
  onCard: boolean;
  note: string;
  totalSalesCents: number | null;
  bedSalesCents: number | null;
  precision: ReportedPrecision;
}

export interface ProjectionLine {
  person: string;
  statusCode: string;
  commissionCode: string;
  description: string;
  totalSalesCents: number;
  totalSpiffCents: number;
  totalCommCents: number;
}

export interface ReportSnapshot {
  id: string;
  reportType: ReportType;
  sourceTitle: string;
  storeNumber: 17;
  periodStart: string;
  periodEnd: string;
  calendar: CalendarKind;
  generatedAt: string | null;
  importedAt: string;
  provisional: boolean;
  status: SnapshotStatus;
  supersedes: string | null;
  source: ImportSourceId;
  fileName: string;
  sha256: string;
  messageId: string | null;
  precision: ReportedPrecision;
  metrics: SnapshotMetrics;
  associates: readonly AssociateRow[];
  projections: readonly ProjectionLine[];
  /** Per-day amounts only when the file was a single completed day. */
  daily: readonly DatedAmount[];
  issues: readonly ReportIssue[];
}

export interface IncomingReportFile {
  source: ImportSourceId;
  fileName: string;
  mediaType: string;
  bytes: Uint8Array;
  receivedAt: string;
  messageId?: string | null;
  from?: string | null;
  subject?: string | null;
}

export interface ImportSourceDescriptor {
  id: ImportSourceId;
  label: string;
  connected: boolean;
  handsOffTo: 'acceptIncomingReport';
}
