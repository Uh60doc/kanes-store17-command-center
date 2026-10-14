/** Text rules for Kane's ranking reports after a PDF has been turned into lines. */

export type CloudReportType = 'SNAP Written' | 'NWDSR Written' | 'NWDSR Delivered';

export interface ParsedAssociateLine {
  sourceName: string;
  amount: number;
}

export interface ParsedReportText {
  reportType: CloudReportType;
  start: string;
  end: string;
  singleDay: boolean;
  storeTotal: number;
  associates: ParsedAssociateLine[];
}

const MONTHS: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};

function iso(day: number, month: number, year: number): string | null {
  if (!month || day < 1 || day > 31 || year < 2000) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function moneyToken(token: string): number | null {
  const cleaned = token.replace(/[$,]/g, '').replace(/^\((.*)\)$/, '-$1');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100) / 100;
}

export function detectCloudReportType(text: string): CloudReportType | null {
  if (/SNAP\s*-\s*WRITTEN/i.test(text)) return 'SNAP Written';
  if (/NET WRITTEN STORE SALES/i.test(text)) return 'NWDSR Written';
  if (/DELIVERED STORE SALES/i.test(text)) return 'NWDSR Delivered';
  return null;
}

export function parseReportText(text: string): ParsedReportText | null {
  const reportType = detectCloudReportType(text);
  const period = /FROM\s+(\d{2})-([A-Z]{3})-(\d{4})\s+TO\s+(\d{2})-([A-Z]{3})-(\d{4})/i.exec(text);
  if (!reportType || !period) return null;
  const start = iso(Number(period[1]), MONTHS[period[2].toUpperCase()] ?? 0, Number(period[3]));
  const end = iso(Number(period[4]), MONTHS[period[5].toUpperCase()] ?? 0, Number(period[6]));
  if (!start || !end) return null;

  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  let storeTotal: number | null = null;
  if (reportType === 'SNAP Written') {
    const match = lines
      .map((line) => /17\s*-\s*ORLANDO\s+Totals:\s*(-?\d[\d,]*(?:\.\d+)?)\s+(-?\d[\d,]*(?:\.\d+)?)/i.exec(line))
      .find((item) => item !== null);
    storeTotal = match ? moneyToken(match[2] ?? '') : null;
  } else {
    const match = lines
      .map((line) => /KANE FURNITURE #17\s+Totals:\s*(-?\d[\d,]*(?:\.\d+)?)/i.exec(line))
      .find((item) => item !== null);
    storeTotal = match ? moneyToken(match[1] ?? '') : null;
  }
  if (storeTotal === null) return null;

  const associates: ParsedAssociateLine[] = [];
  if (reportType === 'SNAP Written') {
    for (const line of lines) {
      if (/totals:/i.test(line)) continue;
      const row = /^([A-Z][A-Z' .-]+,\s*[A-Z][A-Z' .-]+?)\s+(-?\d[\d,]*(?:\.\d+)?)\b/i.exec(line);
      if (!row) continue;
      const amount = moneyToken(row[2] ?? '');
      if (amount === null) continue;
      associates.push({ sourceName: (row[1] ?? '').replace(/\s+/g, ' ').trim(), amount });
    }
  }

  return { reportType, start, end, singleDay: start === end, storeTotal, associates };
}
