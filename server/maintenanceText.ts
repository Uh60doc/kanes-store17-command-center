/** Text pulled from the maintenance PDFs. A blank pillow column stays blank. */

export interface MaintenanceLine {
  code: string;
  name: string;
  mattressSales: number | null;
  padSales: number | null;
  padPercent: number | null;
  baseSales: number | null;
  basePercent: number | null;
  woodSales: number | null;
  woodWarranties: number | null;
  woodPercent: number | null;
  rugCount: number | null;
  rugDollars: number | null;
}

export interface MaintenanceReport {
  kind: 'mppa' | 'uvwl' | 'rugs';
  start: string;
  end: string;
  verifiedThrough: string;
  lines: MaintenanceLine[];
}

function numberToken(token: string | undefined): number | null {
  if (!token) return null;
  const cleaned = token.replace(/[$,]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
}

function printedPercent(value: number | null): number | null {
  if (value === null) return null;
  return Math.round(value * 10) / 1000;
}

function period(text: string): { start: string; end: string } | null {
  const match = /FROM\s+(\d{2})-([A-Z]{3})-(\d{4})\s+TO\s+(\d{2})-([A-Z]{3})-(\d{4})/i.exec(text);
  if (!match || !match[1] || !match[2] || !match[3] || !match[4] || !match[5] || !match[6]) return null;
  const months: Record<string, string> = {
    JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
    JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12',
  };
  const month = months[match[2].toUpperCase()];
  const endMonth = months[match[5].toUpperCase()];
  if (!month || !endMonth) return null;
  return {
    start: `${match[3]}-${month}-${match[1]}`,
    end: `${match[6]}-${endMonth}-${match[4]}`,
  };
}

function blankLine(): MaintenanceLine {
  return {
    code: '',
    name: '',
    mattressSales: null,
    padSales: null,
    padPercent: null,
    baseSales: null,
    basePercent: null,
    woodSales: null,
    woodWarranties: null,
    woodPercent: null,
    rugCount: null,
    rugDollars: null,
  };
}

/** MPPA written: mattress sales, pad sales, pad percent, adjustable bases. */
export function parseMppa(text: string, sourcePeriod?: { start: string; end: string }): MaintenanceReport | null {
  const dates = sourcePeriod ?? period(text);
  if (!dates) return null;
  const lines: MaintenanceLine[] = [];
  text.split(/\r?\n/).forEach((raw) => {
    const totals = /17\s*-\s*ORLANDO\s+Totals:\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/i.exec(raw);
    if (totals) {
      const line = blankLine();
      line.name = 'STORE';
      line.mattressSales = numberToken(totals[1]);
      line.padSales = numberToken(totals[2]);
      line.padPercent = printedPercent(numberToken(totals[3]));
      line.baseSales = numberToken(totals[5]);
      line.basePercent = printedPercent(numberToken(totals[6]));
      lines.push(line);
      return;
    }
    const person = /^([A-Z0-9]{4,})\s+([A-Z].+)$/.exec(raw.trim());
    if (!person || !person[1] || !person[2]) return;
    const numbers = person[2].match(/-?\d+\.\d+/g) ?? [];
    if (numbers.length < 6) return;
    const line = blankLine();
    line.code = person[1];
    line.name = person[2].replace(/-?\d+\.\d+/g, ' ').replace(/\s+/g, ' ').trim();
    line.mattressSales = numberToken(numbers[0]);
    line.padSales = numberToken(numbers[1]);
    line.padPercent = printedPercent(numberToken(numbers[2]));
    line.baseSales = numberToken(numbers[4]);
    line.basePercent = printedPercent(numberToken(numbers[5]));
    lines.push(line);
  });
  if (!lines.length) return null;
  return { kind: 'mppa', start: dates.start, end: dates.end, verifiedThrough: dates.end, lines };
}

export function parseUvwl(text: string): MaintenanceReport | null {
  const dates = period(text);
  if (!dates) return null;
  const lines: MaintenanceLine[] = [];
  text.split(/\r?\n/).forEach((raw) => {
    const totals = /17\s*-\s*ORLANDO\s+Totals:\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/i.exec(raw);
    if (totals) {
      const line = blankLine();
      line.name = 'STORE';
      line.woodSales = numberToken(totals[1]);
      line.woodWarranties = numberToken(totals[2]);
      line.woodPercent = printedPercent(numberToken(totals[3]));
      lines.push(line);
      return;
    }
    const person = /^([A-Z0-9]{4,})\s+([A-Z].+)$/.exec(raw.trim());
    if (!person || !person[1] || !person[2]) return;
    const numbers = person[2].match(/-?\d+\.\d+/g) ?? [];
    if (numbers.length < 3) return;
    const line = blankLine();
    line.code = person[1];
    line.name = person[2].replace(/-?\d+\.\d+/g, ' ').replace(/\s+/g, ' ').trim();
    line.woodSales = numberToken(numbers[0]);
    line.woodWarranties = numberToken(numbers[1]);
    line.woodPercent = printedPercent(numberToken(numbers[2]));
    lines.push(line);
  });
  if (!lines.length) return null;
  return { kind: 'uvwl', start: dates.start, end: dates.end, verifiedThrough: dates.end, lines };
}

export function parseRugs(text: string): MaintenanceReport | null {
  const dates = period(text.replace('thru', 'TO').replace(/(\d{2}-[A-Z]{3}-\d{4})\s+thru\s+/i, 'FROM $1 TO '));
  const loose = /(\d{2})-([A-Z]{3})-(\d{4})\s+thru\s+(\d{2})-([A-Z]{3})-(\d{4})/i.exec(text);
  const months: Record<string, string> = { OCT: '10', NOV: '11', SEP: '09' };
  let start = dates?.start ?? '';
  let end = dates?.end ?? '';
  if (loose && loose[1] && loose[2] && loose[3] && loose[4] && loose[5] && loose[6] && months[loose[2].toUpperCase()] && months[loose[5].toUpperCase()]) {
    start = `${loose[3]}-${months[loose[2].toUpperCase()]}-${loose[1]}`;
    end = `${loose[6]}-${months[loose[5].toUpperCase()]}-${loose[4]}`;
  }
  if (!start || !end) return null;
  const lines: MaintenanceLine[] = [];
  text.split(/\r?\n/).forEach((raw) => {
    const totals = /Totals:\s+(-?\d+)\s+(-?[\d,]+)/i.exec(raw);
    if (totals) {
      const line = blankLine();
      line.name = 'STORE';
      line.rugCount = numberToken(totals[1]);
      line.rugDollars = numberToken(totals[2]);
      lines.push(line);
      return;
    }
    const person = /^([A-Z][A-Z ]+?)\s{2,}(-?\d+)\s+(-?[\d,]+)\s*$/.exec(raw.trim());
    if (!person || !person[1]) return;
    const line = blankLine();
    line.name = person[1].replace(/\s+/g, ' ').trim();
    line.rugCount = numberToken(person[2]);
    line.rugDollars = numberToken(person[3]);
    lines.push(line);
  });
  if (!lines.length) return null;
  return { kind: 'rugs', start, end, verifiedThrough: end, lines };
}
