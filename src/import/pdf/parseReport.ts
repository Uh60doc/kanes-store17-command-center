import { identifyEmployee } from '../../config/roster.ts';
import { calendarFor, isProvisional, isSingleDay, parseGeneratedAt, parseReportDay } from '../../domain/calendar.ts';
import { dominantPrecision, moneyFromCell, parseDecimal, toCents, type Money, type ReportedPrecision } from '../../domain/money.ts';
import type { AssociateRow, IssueSeverity, ProjectionLine, ReportIssue, ReportType } from '../types.ts';
import { columnsFromHeader, findHeaderLine, isFooter, lineText, pageBlob, readRow, type Column, type PdfPage } from './layout.ts';

export interface ParsedReport {
  recognized: boolean;
  reportType: ReportType | null;
  sourceTitle: string;
  periodStart: string | null;
  periodEnd: string | null;
  generatedAt: string | null;
  provisional: boolean;
  precision: ReportedPrecision;
  totalSales: Money | null;
  bedSales: Money | null;
  customerCount: number | null;
  printedSalesVsLyPercent: number | null;
  associates: AssociateRow[];
  projections: ProjectionLine[];
  issues: ReportIssue[];
}

const HEADLINE_TYPES = new Set<ReportType>([
  'SNAP Written',
  'SNAP Delivered',
  'NWDSR Written',
  'NWDSR Delivered',
  'BSSA Written',
  'BSSA Delivered',
]);

export function parseReportFromPages(pages: readonly PdfPage[]): ParsedReport {
  const text = pageBlob(pages);
  const reportType = detectReportType(text);
  const sourceTitle = firstTitle(text);
  const period = detectPeriod(text);
  const generatedAt = detectGeneratedAt(text);
  const issues: ReportIssue[] = [];

  if (!reportType) {
    issues.push({ severity: 'block', message: 'The file is not a recognized Store 17 report.' });
  }
  if (!/store(?:\s+group)?\s*(?:code\s*)?:?\s*17\b|for store 17\b|store group code 17\b/i.test(text)) {
    issues.push({ severity: 'block', message: 'Store 17 is not printed on this report.' });
  }
  if (!period) {
    issues.push({ severity: 'block', message: 'The printed from/to dates could not be read.' });
  }
  if (!generatedAt) {
    issues.push({ severity: 'warn', message: 'The printed generation time is missing, so this file will not replace a current total.' });
  }

  const provisional = period ? isProvisional(period.end, generatedAt) : false;
  if (provisional) {
    issues.push({
      severity: 'info',
      message: 'Generated on the period end date, so this snapshot is provisional and is not a completed end-of-day result.',
    });
  }

  const table = reportType === 'SPR Projection' ? emptyTable() : readTable(pages);
  const projections = reportType === 'SPR Projection' ? readProjections(pages) : [];
  const associates = table.associates;
  const totalSales = table.totalSales;
  const bedSales = table.bedSales;

  if (reportType && HEADLINE_TYPES.has(reportType) && !totalSales) {
    issues.push({ severity: 'block', message: 'The printed store total could not be read. Nothing was stored as zero.' });
  }
  if (reportType === 'SPR Projection') {
    issues.push({
      severity: 'info',
      message: 'SPR status codes are stored raw. This is not actual delivered sales and not paid commission.',
    });
  }
  if (totalSales && associates.length > 0) {
    const comparable = associates.filter((row) => row.totalSalesCents !== null);
    if (comparable.length === associates.length) {
      const sum = comparable.reduce((total, row) => total + (row.totalSalesCents ?? 0), 0);
      if (sum !== totalSales.cents) {
        issues.push({
          severity: 'warn',
          message: `Associate rows sum to ${sum} cents and the printed store total is ${totalSales.cents} cents. The printed store total is kept.`,
        });
      }
    }
  }
  if (bedSales && associates.some((row) => row.bedSalesCents !== null)) {
    const sum = associates.reduce((total, row) => total + (row.bedSalesCents ?? 0), 0);
    if (sum !== bedSales.cents) {
      issues.push({
        severity: 'warn',
        message: `Bedding rows sum to ${sum} cents and the printed bedding total is ${bedSales.cents} cents. The printed bedding total is kept.`,
      });
    }
  }

  const money = [totalSales, bedSales, ...associates.flatMap((row) => rowMoney(row))].filter((value): value is Money => value !== null);

  return {
    recognized: reportType !== null && !issues.some((issue) => issue.severity === 'block'),
    reportType,
    sourceTitle,
    periodStart: period?.start ?? null,
    periodEnd: period?.end ?? null,
    generatedAt,
    provisional,
    precision: dominantPrecision(money),
    totalSales,
    bedSales,
    customerCount: table.customerCount,
    printedSalesVsLyPercent: table.printedSalesVsLyPercent,
    associates,
    projections,
    issues,
  };
}

function rowMoney(row: AssociateRow): Money[] {
  const values: Money[] = [];
  if (row.totalSalesCents !== null) values.push({ cents: row.totalSalesCents, precision: row.precision });
  if (row.bedSalesCents !== null) values.push({ cents: row.bedSalesCents, precision: row.precision });
  return values;
}

function emptyTable(): TableRead {
  return { associates: [], totalSales: null, bedSales: null, customerCount: null, printedSalesVsLyPercent: null };
}

interface TableRead {
  associates: AssociateRow[];
  totalSales: Money | null;
  bedSales: Money | null;
  customerCount: number | null;
  printedSalesVsLyPercent: number | null;
}

function readTable(pages: readonly PdfPage[]): TableRead {
  const associates: AssociateRow[] = [];
  let totalSales: Money | null = null;
  let bedSales: Money | null = null;
  let customerCount: number | null = null;
  let printedSalesVsLyPercent: number | null = null;
  let carriedColumns: Column[] | null = null;
  let section: number | null = null;

  for (const page of pages) {
    const header = findHeaderLine(page.lines);
    const columns: Column[] | null = header ? columnsFromHeader(page.lines, header) : carriedColumns;
    if (header && columns) carriedColumns = columns;
    if (!columns || columns.length === 0) continue;
    for (const line of page.lines) {
      if (isFooter(line)) continue;
      const text = lineText(line);
      const sectionLine = /^(\d+)\s*-\s*ORLANDO$/i.exec(text);
      if (sectionLine) {
        section = Number(sectionLine[1]);
        continue;
      }
      if (header && line.y >= header.y - 1) continue;
      if (section !== null && section !== 17) continue;
      if (!/\d/.test(text)) continue;
      const row = readRow(line, columns);
      if (/totals/i.test(text)) {
        totalSales = moneyOf(row, 'totalSales') ?? totalSales;
        bedSales = moneyOf(row, 'bedSales') ?? bedSales;
        customerCount = numberOf(row, 'customers') ?? customerCount;
        printedSalesVsLyPercent = numberOf(row, 'salesVsLy') ?? printedSalesVsLyPercent;
        continue;
      }
      const sourceName = row.name ?? '';
      if (!sourceName || /orlando/i.test(sourceName)) continue;
      const identity = identifyEmployee(row.employeeCode ?? null, sourceName);
      const sales = moneyOf(row, 'totalSales');
      const bedding = moneyOf(row, 'bedSales');
      if (!sales && !bedding && !row.employeeCode) continue;
      associates.push({
        employeeCode: identity.employeeCode,
        sourceName,
        displayName: identity.displayName,
        role: identity.role,
        onCard: identity.onCard,
        note: identity.note,
        totalSalesCents: sales?.cents ?? null,
        bedSalesCents: bedding?.cents ?? null,
        precision: dominantPrecision([sales, bedding].filter((value): value is Money => value !== null)),
      });
    }
  }
  return { associates, totalSales, bedSales, customerCount, printedSalesVsLyPercent };
}

function moneyOf(row: Record<string, string>, field: string): Money | null {
  const raw = row[field];
  if (!raw) return null;
  return moneyFromCell(raw);
}

function numberOf(row: Record<string, string>, field: string): number | null {
  const raw = row[field];
  if (!raw) return null;
  return parseDecimal(raw)?.value ?? null;
}

function readProjections(pages: readonly PdfPage[]): ProjectionLine[] {
  const lines: ProjectionLine[] = [];
  let person = '';
  for (const page of pages) {
    for (const line of page.lines) {
      const text = lineText(line);
      const who = /ORLANDO\s+-\s+(.+)$/i.exec(text);
      if (who) {
        person = who[1].trim();
        continue;
      }
      const detail = /^([A-Z])\s+([A-Z]+)\s+(.+?)\s+(\$?-?[\d,]+\.\d{2})\s+(\$?-?[\d,]+\.\d{2})\s+(\$?-?[\d,]+\.\d{2})$/.exec(text);
      if (!detail || !person) continue;
      const sales = toCents(detail[4]);
      const spiff = toCents(detail[5]);
      const comm = toCents(detail[6]);
      if (!sales || !spiff || !comm) continue;
      lines.push({
        person,
        statusCode: detail[1],
        commissionCode: detail[2],
        description: detail[3],
        totalSalesCents: sales.cents,
        totalSpiffCents: spiff.cents,
        totalCommCents: comm.cents,
      });
    }
  }
  return lines;
}

function detectReportType(text: string): ReportType | null {
  const rules: [RegExp, ReportType][] = [
    [/SNAP\s*-\s*WRITTEN SALES RANKING/i, 'SNAP Written'],
    [/SNAP\s*-\s*DELIVERED SALES RANKING/i, 'SNAP Delivered'],
    [/NET WRITTEN STORE SALES RANKING/i, 'NWDSR Written'],
    [/DELIVERED STORE SALES RANKING/i, 'NWDSR Delivered'],
    [/BSSA\s*-\s*WRITTEN BEDDING/i, 'BSSA Written'],
    [/BSSA\s*-\s*DELIVERED BEDDING/i, 'BSSA Delivered'],
    [/SALESPERSON (?:SUMMARY )?PROJECTION/i, 'SPR Projection'],
    [/MPPA\s*-\s*WRITTEN/i, 'MPPA Written'],
    [/FABW\s*-\s*WRITTEN/i, 'FABW Written'],
    [/FABW\s*-\s*DELIVERED/i, 'FABW Delivered'],
    [/LTHW\s*-\s*WRITTEN/i, 'LTHW Written'],
    [/PWAR\s*-\s*WRITTEN/i, 'PWAR Written'],
    [/UVWL\s*-\s*WRITTEN/i, 'UVWL Written'],
    [/WRITTEN RUG SALES/i, 'Rug Sales Written'],
    [/AVSA\s*-\s*WRITTEN/i, 'AVSA Written'],
    [/FISPP\s*-\s*WRITTEN/i, 'FISPP Written'],
    [/WRITTEN SALES RANKING REPORT/i, 'Written Sales Ranking'],
    [/CLASSIFICATION SALES ANALYSIS/i, 'Classification Analysis'],
    [/PET PROTECTION SALES/i, 'Pet Protection'],
    [/BEDROOM, MATTRESSES AND DINING/i, 'Bedroom Mattress Dining Exceptions'],
  ];
  for (const [pattern, reportType] of rules) {
    if (pattern.test(text)) return reportType;
  }
  return null;
}

function firstTitle(text: string): string {
  const line = text
    .split('\n')
    .map((entry) => entry.trim())
    .find((entry) => /REPORT|BEDDING|FABRIC|LEATHER|RUG|WARRANTY|WOOD|PROJECTION|PET PROTECTION/i.test(entry));
  return line ?? 'Unrecognized file';
}

function detectPeriod(text: string): { start: string; end: string } | null {
  const match = /FROM\s+(\d{2}-[A-Z]{3}-\d{4})\s+TO\s+(\d{2}-[A-Z]{3}-\d{4})/i.exec(text);
  if (!match) return null;
  const start = parseReportDay(match[1]);
  const end = parseReportDay(match[2]);
  if (!start || !end) return null;
  return { start, end };
}

function detectGeneratedAt(text: string): string | null {
  const date = /DATE:\s*(\d{2}\/\d{2}\/\d{4})/i.exec(text);
  const time = /TIME:\s*(\d{1,2}:\d{2}\s*[AP]M)/i.exec(text);
  if (!date || !time) return null;
  return parseGeneratedAt(date[1], time[1]);
}

export function periodIsSingleDay(report: ParsedReport): boolean {
  return report.periodStart !== null && report.periodEnd !== null && isSingleDay(report.periodStart, report.periodEnd);
}

export function calendarOf(report: ParsedReport) {
  if (!report.periodStart || !report.periodEnd) return 'other' as const;
  return calendarFor(report.periodStart, report.periodEnd);
}

export function blockingIssues(issues: readonly ReportIssue[]): ReportIssue[] {
  return issues.filter((issue) => issue.severity === 'block');
}

export function issueSeverityRank(severity: IssueSeverity): number {
  if (severity === 'block') return 0;
  if (severity === 'warn') return 1;
  return 2;
}
