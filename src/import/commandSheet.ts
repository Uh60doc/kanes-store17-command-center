import { buildStoreDashboard, type Figure, type StoreDashboardModel } from '../dashboard/model.ts';
import { commitSnapshot, currentSnapshots } from './snapshotStore.ts';
import type { ReportSnapshot, ReportType } from './types.ts';

export interface ScorecardView {
  id: string;
  name: string;
  knownAs: string | null;
  note: string;
  written: Figure;
  delivered: Figure;
  bedding: Figure;
  maintenance: Figure;
  rugs: Figure;
  mattress: Figure;
  fabric: Figure;
  leather: Figure;
  power: Figure;
}

export interface ManagementView {
  id: string;
  name: string;
  role: string;
  written: Figure;
  delivered: Figure;
}

export interface OtherActivity {
  name: string;
  written: Figure;
  delivered: Figure;
}

export interface SheetLoad {
  model: StoreDashboardModel;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  provisional: boolean;
  scorecards: ScorecardView[];
  management: ManagementView[];
  otherActivity: OtherActivity[];
}

type LoadFailure = { ok: false; reason: 'missing-header' | 'missing-period' };

type CellValue =
  | { kind: 'number'; value: number; unit: 'number' | 'percent' }
  | { kind: 'missing'; label: 'Not Available' | 'Awaiting Report' };

interface SheetRow {
  metric: string;
  value: CellValue;
  notes: string;
}

type PersonField =
  | 'written'
  | 'delivered'
  | 'bedding'
  | 'maintenance'
  | 'rugs'
  | 'mattress'
  | 'fabric'
  | 'leather'
  | 'power';

const PERSON_FIELDS: readonly PersonField[] = [
  'written',
  'delivered',
  'bedding',
  'maintenance',
  'rugs',
  'mattress',
  'fabric',
  'leather',
  'power',
];

const SALESPEOPLE = [
  {
    id: 'renzo',
    name: 'Renzo Del Solar',
    knownAs: null,
    aliases: ['renzo del solar', 'renzo'],
  },
  {
    id: 'prakash',
    name: 'Prakash Gandhi',
    knownAs: null,
    aliases: ['prakash gandhi', 'prakash'],
  },
  {
    id: 'eric',
    name: 'Eric Montes Rodriguez',
    knownAs: null,
    aliases: ['eric montes rodriguez', 'eric montes', 'eric'],
  },
  {
    id: 'tarik',
    name: 'Tarik Nassif',
    knownAs: 'Ricky',
    aliases: ['tarik nassif', 'tarik', 'ricky'],
  },
  {
    id: 'brenda',
    name: 'Brenda Sanchez',
    knownAs: null,
    aliases: ['brenda sanchez', 'brenda'],
  },
  {
    id: 'caroline',
    name: 'Caroline Amaro',
    knownAs: null,
    aliases: ['caroline amaro', 'caroline'],
  },
] as const;

const MANAGEMENT = [
  { id: 'cordell', name: 'Cordell Primous', role: 'Sales Manager', aliases: ['cordell primous', 'cordell'] },
  { id: 'kelly', name: 'Kelly Meyers', role: 'General Manager', aliases: ['kelly meyers', 'kelly'] },
  { id: 'elizabeth', name: 'Elizabeth Perez', role: 'Operations Manager', aliases: ['elizabeth perez', 'elizabeth'] },
] as const;

const STORE_METRICS = new Set([
  'snap written mtd',
  'snap written',
  'nwdsr delivered mtd',
  'nwdsr delivered',
  'nwdsr written',
  'bedding percent',
  'bedding',
  'snap versus last year',
  'projected month-end written',
  'closing ratio',
  'written goal',
  'written remaining',
  'delivered goal',
  'delivered remaining',
  'corporate stretch written',
  'corporate stretch delivered',
  'store attachment',
]);

const MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

function awaiting(): Figure {
  return { kind: 'missing', label: 'Awaiting Report' };
}

function emptyScorecard(
  person: (typeof SALESPEOPLE)[number],
  note: string,
): ScorecardView {
  return {
    id: person.id,
    name: person.name,
    knownAs: person.knownAs,
    note,
    written: awaiting(),
    delivered: awaiting(),
    bedding: awaiting(),
    maintenance: awaiting(),
    rugs: awaiting(),
    mattress: awaiting(),
    fabric: awaiting(),
    leather: awaiting(),
    power: awaiting(),
  };
}

export function standingScorecards(): ScorecardView[] {
  return SALESPEOPLE.map((person) =>
    emptyScorecard(
      person,
      person.id === 'brenda' || person.id === 'caroline'
        ? 'New hire. No figures until a report names them.'
        : 'Store-period figures from the current snapshot. Not the payroll month.',
    ),
  );
}

export function standingManagement(): ManagementView[] {
  return MANAGEMENT.map((person) => ({
    id: person.id,
    name: person.name,
    role: person.role,
    written: awaiting(),
    delivered: awaiting(),
  }));
}

/**
 * Read one sheet export. A later row for the same metric replaces the earlier
 * row in this file. Nothing is added together, and a blank or "Not Available"
 * cell is never stored as zero.
 */
export function loadCommandSheet(csv: string, importedAt: string): { ok: true; view: SheetLoad } | LoadFailure {
  const parsed = parseSheet(csv);
  if (!parsed.ok) return parsed;

  const scorecards = standingScorecards();
  const management = standingManagement();
  const other = new Map<string, OtherActivity>();
  const cardById = new Map(scorecards.map((card) => [card.id, card]));
  const managerById = new Map(management.map((person) => [person.id, person]));

  let snapWritten: SheetRow | undefined;
  let nwdsrWritten: SheetRow | undefined;
  let nwdsrDelivered: SheetRow | undefined;
  let bedding: SheetRow | undefined;
  let yearOverYear: SheetRow | undefined;
  let projected: SheetRow | undefined;
  let closing: SheetRow | undefined;
  let writtenGoal: number | undefined;
  let deliveredGoal: number | undefined;
  let stretchWritten: number | undefined;
  let stretchDelivered: number | undefined;

  for (const row of parsed.rows) {
    const key = normalize(row.metric);
    if (key === 'snap written mtd' || key === 'snap written') snapWritten = row;
    else if (key === 'nwdsr written') nwdsrWritten = row;
    else if (key === 'nwdsr delivered mtd' || key === 'nwdsr delivered') nwdsrDelivered = row;
    else if (key === 'bedding percent' || key === 'bedding') bedding = row;
    else if (key === 'snap versus last year') yearOverYear = row;
    else if (key === 'projected month-end written') projected = row;
    else if (key === 'closing ratio') closing = row;
    else if (key === 'written goal') writtenGoal = numeric(row);
    else if (key === 'delivered goal') deliveredGoal = numeric(row);
    else if (key === 'corporate stretch written') stretchWritten = numeric(row);
    else if (key === 'corporate stretch delivered') stretchDelivered = numeric(row);
    else if (key === 'written remaining' || key === 'delivered remaining' || key === 'store attachment') {
      continue;
    } else {
      const match = matchPerson(key);
      if (!match) continue;
      const figure = figureFor(row, match.field);
      if (match.group === 'sales') {
        const card = cardById.get(match.id);
        if (card) card[match.field] = figure;
      } else if (match.group === 'management') {
        const person = managerById.get(match.id);
        if (person && (match.field === 'written' || match.field === 'delivered')) {
          person[match.field] = figure;
        }
      } else if (match.field === 'written' || match.field === 'delivered') {
        const current = other.get(match.id) ?? { name: match.name, written: awaiting(), delivered: awaiting() };
        current[match.field] = figure;
        other.set(match.id, current);
      }
    }
  }

  for (const card of scorecards) {
    const hasFigure = [card.written, card.delivered, card.bedding, card.maintenance, card.rugs].some(
      (figure) => figure.kind === 'value',
    );
    if (hasFigure) {
      card.note = `Store period ${parsed.periodLabel}. Not the payroll month.`;
    }
  }

  const snapshots = [
    snapshot('SNAP Written', parsed, importedAt, snapWritten, 'writtenSales'),
    snapshot('NWDSR Written', parsed, importedAt, nwdsrWritten, 'writtenSales'),
    snapshot('NWDSR Delivered', parsed, importedAt, nwdsrDelivered, 'deliveredSales'),
    snapshot('BSSA', parsed, importedAt, bedding, 'beddingPercentage'),
  ].filter((item): item is ReportSnapshot => item !== null);

  for (const item of snapshots) commitSnapshot(item);

  const model = buildStoreDashboard(currentSnapshots(), {
    period: { start: parsed.periodStart, end: parsed.periodEnd },
    goals: {
      writtenSales: writtenGoal,
      deliveredSales: deliveredGoal,
    },
    stretch: {
      writtenSales: stretchWritten,
      deliveredSales: stretchDelivered,
    },
    snapYearOverYear: explicitFigure(yearOverYear, 'percent'),
    closingRatio: explicitFigure(closing, 'percent'),
    projectedWritten: explicitFigure(projected, 'dollars'),
  });

  return {
    ok: true,
    view: {
      model,
      periodLabel: parsed.periodLabel,
      periodStart: parsed.periodStart,
      periodEnd: parsed.periodEnd,
      provisional: parsed.provisional,
      scorecards,
      management,
      otherActivity: [...other.values()],
    },
  };
}

function snapshot(
  reportType: ReportType,
  parsed: { periodStart: string; periodEnd: string },
  importedAt: string,
  row: SheetRow | undefined,
  metricKey: string,
): ReportSnapshot | null {
  const value = row ? numeric(row) : undefined;
  if (value === undefined) return null;
  return {
    id: `sheet:${reportType}:${parsed.periodStart}:${parsed.periodEnd}:${importedAt}`,
    reportType,
    storeNumber: 17,
    periodStart: parsed.periodStart,
    periodEnd: parsed.periodEnd,
    calendar: 'store-operating',
    generatedAt: null,
    importedAt,
    status: 'current',
    supersedes: null,
    source: 'sheet',
    fileName: 'command-center-sheet.csv',
    metrics: { [metricKey]: value },
    daily: [],
    issues: [],
  };
}

function explicitFigure(row: SheetRow | undefined, unit: 'dollars' | 'percent'): Figure {
  if (!row || row.value.kind === 'missing') return { kind: 'missing', label: 'Not Available' };
  return { kind: 'value', value: row.value.value, unit };
}

function figureFor(row: SheetRow, field: PersonField): Figure {
  if (row.value.kind === 'missing') return { kind: 'missing', label: row.value.label };
  return { kind: 'value', value: row.value.value, unit: unitFor(field) };
}

function unitFor(field: PersonField): 'dollars' | 'percent' | 'count' {
  if (field === 'bedding' || field === 'mattress' || field === 'fabric' || field === 'leather' || field === 'power') {
    return 'percent';
  }
  if (field === 'rugs') return 'count';
  return 'dollars';
}

function numeric(row: SheetRow): number | undefined {
  if (row.value.kind !== 'number' || !Number.isFinite(row.value.value)) return undefined;
  return row.value.value;
}

function matchPerson(
  metric: string,
): { group: 'sales' | 'management' | 'other'; id: string; name: string; field: PersonField } | null {
  if (STORE_METRICS.has(metric)) return null;
  for (const field of PERSON_FIELDS) {
    const suffix = ` ${field}`;
    if (!metric.endsWith(suffix)) continue;
    const name = metric.slice(0, -suffix.length).trim();
    if (name === '') return null;
    for (const person of SALESPEOPLE) {
      if ((person.aliases as readonly string[]).includes(name)) {
        return { group: 'sales', id: person.id, name: person.name, field };
      }
    }
    for (const person of MANAGEMENT) {
      if ((person.aliases as readonly string[]).includes(name)) {
        return { group: 'management', id: person.id, name: person.name, field };
      }
    }
    return { group: 'other', id: name, name: titleCase(name), field };
  }
  return null;
}

function titleCase(value: string): string {
  return value.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function parseSheet(csv: string): { ok: true; periodLabel: string; periodStart: string; periodEnd: string; provisional: boolean; rows: SheetRow[] } | LoadFailure {
  const table = parseCsv(csv);
  const headerIndex = table.findIndex(
    (row) => normalize(row[0] ?? '') === 'metric' && normalize(row[1] ?? '') === 'value',
  );
  if (headerIndex === -1) return { ok: false, reason: 'missing-header' };

  const title = table.slice(0, headerIndex);
  let periodLabel = '';
  let period: { start: string; end: string } | null = null;
  let provisional = false;
  for (const row of title) {
    for (const cell of row) {
      if (/provisional/i.test(cell)) provisional = true;
      const parsed = parsePeriodLabel(cell);
      if (parsed && !period) {
        period = parsed;
        periodLabel = cell.trim();
      }
    }
  }
  if (!period) return { ok: false, reason: 'missing-period' };

  const rows: SheetRow[] = [];
  for (const row of table.slice(headerIndex + 1)) {
    const metric = (row[0] ?? '').trim();
    if (metric === '' || normalize(metric) === 'metric') continue;
    const value = parseCell(row[1] ?? '');
    if (!value) continue;
    rows.push({ metric, value, notes: (row[2] ?? '').trim() });
  }

  return {
    ok: true,
    periodLabel,
    periodStart: period.start,
    periodEnd: period.end,
    provisional,
    rows,
  };
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const source = text.replace(/^\uFEFF/, '');

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (inQuotes) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ''));
}

export function parsePeriodLabel(label: string): { start: string; end: string } | null {
  const text = label.replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
  let match = text.match(/^([A-Za-z]+)\s+(\d{1,2})\s*-\s*(\d{1,2}),\s*(\d{4})$/);
  if (match) {
    const month = MONTHS[match[1].toLowerCase()];
    const year = Number(match[4]);
    const startDay = Number(match[2]);
    const endDay = Number(match[3]);
    if (!month || !validDay(year, month, startDay) || !validDay(year, month, endDay) || endDay < startDay) return null;
    return { start: iso(year, month, startDay), end: iso(year, month, endDay) };
  }

  match = text.match(/^([A-Za-z]+)\s+(\d{1,2})\s*-\s*([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/);
  if (match) {
    const startMonth = MONTHS[match[1].toLowerCase()];
    const endMonth = MONTHS[match[3].toLowerCase()];
    const year = Number(match[5]);
    const startDay = Number(match[2]);
    const endDay = Number(match[4]);
    if (!startMonth || !endMonth) return null;
    const startYear = endMonth < startMonth ? year - 1 : year;
    if (!validDay(startYear, startMonth, startDay) || !validDay(year, endMonth, endDay)) return null;
    return { start: iso(startYear, startMonth, startDay), end: iso(year, endMonth, endDay) };
  }

  match = text.match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\s*-\s*([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/);
  if (match) {
    const startMonth = MONTHS[match[1].toLowerCase()];
    const endMonth = MONTHS[match[4].toLowerCase()];
    const startYear = Number(match[3]);
    const endYear = Number(match[6]);
    const startDay = Number(match[2]);
    const endDay = Number(match[5]);
    if (!startMonth || !endMonth) return null;
    if (!validDay(startYear, startMonth, startDay) || !validDay(endYear, endMonth, endDay)) return null;
    return { start: iso(startYear, startMonth, startDay), end: iso(endYear, endMonth, endDay) };
  }

  return null;
}

function parseCell(raw: string): CellValue | null {
  const text = raw.trim();
  if (text === '') return null;
  const lower = text.toLowerCase();
  if (lower === 'not available' || lower === 'n/a') return { kind: 'missing', label: 'Not Available' };
  if (lower === 'awaiting report') return { kind: 'missing', label: 'Awaiting Report' };
  const percent = text.endsWith('%');
  const numericText = text.replace(/[$,]/g, '').replace(/%$/, '').trim();
  if (!/^-?\d+(\.\d+)?$/.test(numericText)) return null;
  const value = Number(numericText);
  if (!Number.isFinite(value)) return null;
  if (percent) return { kind: 'number', value: value / 100, unit: 'percent' };
  return { kind: 'number', value, unit: 'number' };
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function validDay(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
