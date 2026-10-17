import { loadConfig, loadDotEnv } from '../server/config.ts';
import { SHEETS_SCOPE } from '../server/access.ts';
import { accessTokenFor, googleJson } from '../server/google.ts';
import { readStored } from '../server/tokenStore.ts';
import { loadVerifiedSnapshots } from '../server/reports.ts';
import { money, requiredPace, sumColumn, type DailyFact } from '../src/cloud/facts.ts';

const KEEP = new Set(['Sheet1', 'CC_Connection_Test']);
const TABS = ['CC_Config', 'CC_Daily', 'CC_AssociateDays', 'CC_People', 'CC_Metrics', 'CC_Imports', 'CC_Health', 'CC_Exceptions', 'CC_SellingDays', 'CC_Rollup'];

type Cell = string | number;
type Row = Cell[];

function nyToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

function previousDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

function asRows(payload: unknown): Row[] {
  const values = (payload as { values?: unknown[][] }).values ?? [];
  return values.map((row) => row.map((cell) => (typeof cell === 'number' ? cell : cellText(cell))));
}

async function readTab(token: string, spreadsheetId: string, title: string): Promise<Row[]> {
  try {
    const payload = await googleJson({
      accessToken: token,
      url: `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(`${title}!A1:Z500`)}`,
    });
    return asRows(payload);
  } catch {
    return [];
  }
}

async function writeTab(token: string, spreadsheetId: string, title: string, rows: Row[]): Promise<void> {
  if (KEEP.has(title) || !TABS.includes(title)) throw new Error(`Refusing to write ${title}.`);
  await googleJson({
    accessToken: token,
    method: 'POST',
    url: `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(`${title}!A1:Z500`)}:clear`,
    body: {},
  });
  await googleJson({
    accessToken: token,
    method: 'PUT',
    url: `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(`${title}!A1`)}?valueInputOption=RAW`,
    body: { range: `${title}!A1`, majorDimension: 'ROWS', values: rows },
  });
}

function mergeDaily(existing: Row[], seed: DailyFact[]): Row[] {
  const header = ['date', 'snap_written', 'nwdsr_written', 'nwdsr_delivered'];
  const map = new Map<string, DailyFact>();
  for (const row of existing.slice(1)) {
    const date = cellText(row[0]);
    if (!date) continue;
    map.set(date, {
      date,
      snapWritten: row[1] === '' ? null : Number(row[1]),
      nwdsrWritten: row[2] === '' ? null : Number(row[2]),
      nwdsrDelivered: row[3] === '' ? null : Number(row[3]),
    });
  }
  for (const row of seed) {
    const current = map.get(row.date) ?? { date: row.date, snapWritten: null, nwdsrWritten: null, nwdsrDelivered: null };
    if (row.snapWritten !== null) current.snapWritten = row.snapWritten;
    if (row.nwdsrWritten !== null) current.nwdsrWritten = row.nwdsrWritten;
    if (row.nwdsrDelivered !== null) current.nwdsrDelivered = row.nwdsrDelivered;
    map.set(row.date, current);
  }
  const body = [...map.values()]
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((row) => [row.date, row.snapWritten ?? '', row.nwdsrWritten ?? '', row.nwdsrDelivered ?? '']);
  return [header, ...body];
}

loadDotEnv('/workspace');
const config = loadConfig('/workspace');
const stored = readStored(config.tokenPath);
if (!stored.spreadsheetId) throw new Error('The command center spreadsheet is not saved.');
const token = await accessTokenFor({
  clientId: config.clientId,
  clientSecret: config.clientSecret,
  tokenPath: config.tokenPath,
  requiredScope: SHEETS_SCOPE,
});
const spreadsheetId = stored.spreadsheetId;
const before = await googleJson({
  accessToken: token,
  url: `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties.title`,
}) as { sheets: { properties: { title: string } }[] };
const titles = new Set(before.sheets.map((sheet) => sheet.properties.title));
const missing = TABS.filter((title) => !titles.has(title));
if (missing.length > 0) {
  await googleJson({
    accessToken: token,
    method: 'POST',
    url: `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
    body: { requests: missing.map((title) => ({ addSheet: { properties: { title } } })) },
  });
}

const { model, snapshots } = await loadVerifiedSnapshots();
const seedDays: DailyFact[] = model.storeDays
  .filter((day) => day.snapWritten !== null || day.nwdsrWritten !== null || day.nwdsrDelivered !== null)
  .map((day) => ({
    date: day.date,
    snapWritten: day.snapWritten,
    nwdsrWritten: day.nwdsrWritten,
    nwdsrDelivered: day.nwdsrDelivered,
  }));
const dailyRows = mergeDaily(await readTab(token, spreadsheetId, 'CC_Daily'), seedDays);
const facts: DailyFact[] = dailyRows.slice(1).map((row) => ({
  date: cellText(row[0]),
  snapWritten: row[1] === '' ? null : Number(row[1]),
  nwdsrWritten: row[2] === '' ? null : Number(row[2]),
  nwdsrDelivered: row[3] === '' ? null : Number(row[3]),
}));
const snap = sumColumn(facts, 'snapWritten', '2026-10-02', '2026-11-01');
const nwdsrWritten = sumColumn(facts, 'nwdsrWritten', '2026-10-02', '2026-11-01');
const delivered = sumColumn(facts, 'nwdsrDelivered', '2026-10-02', '2026-11-01');
const writtenPace = requiredPace(400_000, nwdsrWritten, null);
const deliveredPace = requiredPace(320_000, delivered, null);
const verifiedThrough = facts.reduce((latest, row) => (row.nwdsrWritten !== null && row.date >= '2026-10-02' && row.date <= '2026-11-01' && row.date > latest ? row.date : latest), '');
const now = new Date().toISOString();
const yesterday = previousDate(nyToday());
const yesterdayRow = facts.find((row) => row.date === yesterday);
const status = !yesterdayRow || yesterdayRow.snapWritten === null || yesterdayRow.nwdsrDelivered === null ? 'Report Missing' : 'Current';

const associateHeader = ['date', 'source_name', 'display_name', 'role', 'amount', 'sha256'];
const existingAssociates = await readTab(token, spreadsheetId, 'CC_AssociateDays');
const associateMap = new Map<string, Row>();
for (const row of existingAssociates.slice(1)) {
  associateMap.set(`${cellText(row[0])}|${cellText(row[1])}|${cellText(row[5])}`, row);
}
for (const snapshot of snapshots) {
  if (snapshot.status !== 'current' || snapshot.reportType !== 'SNAP Written' || snapshot.periodStart !== snapshot.periodEnd) continue;
  for (const associate of snapshot.associates) {
    if (associate.totalSalesCents === null) continue;
    const row: Row = [
      snapshot.periodStart,
      associate.sourceName,
      associate.displayName,
      associate.role,
      money(associate.totalSalesCents / 100),
      snapshot.sha256,
    ];
    associateMap.set(`${snapshot.periodStart}|${associate.sourceName}|${snapshot.sha256}`, row);
  }
}

const importHeader = ['sha256', 'file_name', 'report_type', 'status', 'imported_at', 'note'];
const existingImports = await readTab(token, spreadsheetId, 'CC_Imports');
const importMap = new Map<string, Row>();
for (const row of existingImports.slice(1)) importMap.set(cellText(row[0]), row);
for (const snapshot of snapshots) {
  if (!snapshot.sha256 || importMap.has(snapshot.sha256)) continue;
  importMap.set(snapshot.sha256, [
    snapshot.sha256,
    snapshot.fileName,
    snapshot.reportType,
    'imported',
    snapshot.importedAt,
    `${snapshot.periodStart} through ${snapshot.periodEnd}. Seeded from the verified archive and will not be added again.`,
  ]);
}

const people = [['name', 'role', 'written'], ...model.salesTeam.map((person) => [person.displayName, 'associate', person.writtenSales ?? ''])];
const configRows: Row[] = [
  ['key', 'value'],
  ['store_period_start', '2026-10-02'],
  ['store_period_end', '2026-11-01'],
  ['individual_period_start', '2026-10-01'],
  ['individual_period_end', '2026-10-31'],
  ['prior_year_start', '2025-10-01'],
  ['prior_year_end', '2025-10-31'],
  ['written_goal', 400000],
  ['delivered_goal', 320000],
  ['bedding_minimum', 0.2],
  ['closing_goal', 0.5],
  ['attachment_goal', 0.9],
  ['stretch_written', 652274],
  ['stretch_delivered', 564373],
  ['timezone', 'America/New_York'],
  ['admin_email', 'store17commandcenter@gmail.com'],
  ['version', '1.0.0'],
  ['preserved_tabs', 'Sheet1 and CC_Connection_Test are historical and are not rewritten'],
];
const metrics: Row[] = [
  ['key', 'value', 'note'],
  ['bedding_percent', model.beddingPercentage.kind === 'value' ? model.beddingPercentage.value : '', model.beddingPeriod ?? 'Not on file'],
  ['closing_ratio', '', 'Not Available until Net Written purchasing customers and PERQ opportunities share the same dates'],
  ['store_attachment', '', 'Not Available'],
  ['prior_year_written', '', 'Not Available'],
];
const exceptions: Row[] = [['at', 'severity', 'message']];
for (const day of model.negativeWrittenDays) {
  exceptions.push([now, 'Review', `${day.date} SNAP Written is ${day.storeTotal} and is flagged for review.`]);
}

await writeTab(token, spreadsheetId, 'CC_Config', configRows);
await writeTab(token, spreadsheetId, 'CC_Daily', dailyRows);
await writeTab(token, spreadsheetId, 'CC_AssociateDays', [associateHeader, ...associateMap.values()]);
await writeTab(token, spreadsheetId, 'CC_People', people);
await writeTab(token, spreadsheetId, 'CC_Metrics', metrics);
await writeTab(token, spreadsheetId, 'CC_Imports', [importHeader, ...importMap.values()]);
await writeTab(token, spreadsheetId, 'CC_SellingDays', [['date', 'selling'], ['', 'Every store day is open unless this tab marks the date NO or closed. Do not list the open days. This tab does not store the monthly budget.']]);
await writeTab(token, spreadsheetId, 'CC_Health', [
  ['key', 'value'],
  ['status', status],
  ['last_import', now],
  ['last_calculation', now],
  ['latest_report_day', model.importedThrough ?? ''],
  ['version', '1.0.0'],
  ['next_check', 'Every 30 minutes after the Apps Script trigger is installed'],
]);
await writeTab(token, spreadsheetId, 'CC_Exceptions', exceptions);
await writeTab(token, spreadsheetId, 'CC_Rollup', [
  ['metric', 'value', 'method'],
  ['nwdsr_written', nwdsrWritten ?? '', 'Primary written total. Sum of CC_Daily nwdsr_written for the store period. Blank cells are skipped.'],
  ['snap_written', snap ?? '', 'SNAP Written reconciliation only. Not used for written remaining.'],
  ['nwdsr_delivered', delivered ?? '', 'Sum of CC_Daily nwdsr_delivered for the store period. Blank cells are skipped.'],
  ['written_remaining', writtenPace.remaining ?? '', 'Written goal minus NWDSR written. The goal itself is not changed.'],
  ['delivered_remaining', deliveredPace.remaining ?? '', 'Delivered goal minus NWDSR delivered. The goal itself is not changed.'],
  ['verified_through', verifiedThrough, 'Latest store-period date with NWDSR written on CC_Daily.'],
  ['written_pace', '', 'Calculated at read time from verified written sales and the generated store calendar. The written goal is not changed.'],
  ['delivered_pace', '', 'Calculated at read time from verified delivered sales and the generated store calendar. The delivered goal is not changed.'],
]);

const sheet1 = await readTab(token, spreadsheetId, 'Sheet1');
const connection = await readTab(token, spreadsheetId, 'CC_Connection_Test');
console.log(JSON.stringify({
  snap,
  delivered,
  writtenRemaining: writtenPace.remaining,
  deliveredRemaining: deliveredPace.remaining,
  status,
  yesterday,
  imports: importMap.size,
  associates: associateMap.size,
  sheet1Preserved: cellText(sheet1[2]?.[1] ?? ''),
  connectionPreserved: cellText(connection[1]?.[1] ?? ''),
}, null, 2));
