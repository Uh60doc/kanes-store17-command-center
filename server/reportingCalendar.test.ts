/**
 * Permanent reporting calendars. Expected dates are written out beside the calculated ones.
 * A later edit that moves November 1 into the November store month fails here.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { plain } from './fakeSpreadsheet.ts';
import { harness, session } from './octoberVerified.ts';
import { table } from './snapshotGrid.ts';

type Period = { start: string; end: string; year: number; month: number };

const CASES: { date: string; store: [string, string]; person: [string, string] }[] = [
  { date: '2026-10-31', store: ['2026-10-02', '2026-11-01'], person: ['2026-10-01', '2026-10-31'] },
  { date: '2026-11-01', store: ['2026-10-02', '2026-11-01'], person: ['2026-11-01', '2026-11-30'] },
  { date: '2026-11-02', store: ['2026-11-02', '2026-12-01'], person: ['2026-11-01', '2026-11-30'] },
  { date: '2026-11-30', store: ['2026-11-02', '2026-12-01'], person: ['2026-11-01', '2026-11-30'] },
  { date: '2026-12-01', store: ['2026-11-02', '2026-12-01'], person: ['2026-12-01', '2026-12-31'] },
  { date: '2026-12-02', store: ['2026-12-02', '2027-01-01'], person: ['2026-12-01', '2026-12-31'] },
  { date: '2026-12-31', store: ['2026-12-02', '2027-01-01'], person: ['2026-12-01', '2026-12-31'] },
  { date: '2027-01-01', store: ['2026-12-02', '2027-01-01'], person: ['2027-01-01', '2027-01-31'] },
  { date: '2027-01-02', store: ['2027-01-02', '2027-02-01'], person: ['2027-01-01', '2027-01-31'] },
  { date: '2024-02-28', store: ['2024-02-02', '2024-03-01'], person: ['2024-02-01', '2024-02-29'] },
  { date: '2024-02-29', store: ['2024-02-02', '2024-03-01'], person: ['2024-02-01', '2024-02-29'] },
  { date: '2024-03-01', store: ['2024-02-02', '2024-03-01'], person: ['2024-03-01', '2024-03-31'] },
  { date: '2024-03-02', store: ['2024-03-02', '2024-04-01'], person: ['2024-03-01', '2024-03-31'] },
  { date: '2025-02-28', store: ['2025-02-02', '2025-03-01'], person: ['2025-02-01', '2025-02-28'] },
  { date: '2025-03-01', store: ['2025-02-02', '2025-03-01'], person: ['2025-03-01', '2025-03-31'] },
  { date: '2025-03-02', store: ['2025-03-02', '2025-04-01'], person: ['2025-03-01', '2025-03-31'] },
  { date: '2028-02-29', store: ['2028-02-02', '2028-03-01'], person: ['2028-02-01', '2028-02-29'] },
  { date: '2100-02-28', store: ['2100-02-02', '2100-03-01'], person: ['2100-02-01', '2100-02-28'] },
];

test('store and salesperson calendars stay on the date rules through year-end and leap years', () => {
  const { gs } = harness();
  const failures: string[] = [];
  const check = (label: string, expected: string, actual: string) => {
    const line = `${label}: expected ${expected} | calculated ${actual}`;
    console.log(expected === actual ? `OK  ${line}` : `FAIL ${line}`);
    if (expected !== actual) failures.push(line);
  };
  assert.match(String(gs.isoDate_), /America\/New_York/);
  for (const item of CASES) {
    const store = plain(gs.storePeriodContaining_(item.date)) as Period;
    const person = plain(gs.individualPeriodContaining_(item.date)) as Period;
    check(`${item.date} store`, item.store.join(' through '), `${store.start} through ${store.end}`);
    check(`${item.date} salesperson`, item.person.join(' through '), `${person.start} through ${person.end}`);
  }
  const october = plain(gs.periodFor_('store', 2026, 10)) as Period;
  const november = plain(gs.periodFor_('store', 2026, 11)) as Period;
  const octoberLy = plain(gs.storeLastYear_({ prior_year_start: '2025-10-01', prior_year_end: '2025-10-31', store_period_start: '2026-10-02' }, october));
  const novemberLy = plain(gs.storeLastYear_({}, november));
  const personLy = plain(gs.periodFor_('individual', 2025, 11)) as Period;
  check('October 2026 store last year', '2025-10-02 through 2025-11-01', `${octoberLy.start} through ${octoberLy.end}`);
  check('November 2026 store last year', '2025-11-02 through 2025-12-01', `${novemberLy.start} through ${novemberLy.end}`);
  check('November salesperson last year', '2025-11-01 through 2025-11-30', `${personLy.start} through ${personLy.end}`);
  assert.equal(octoberLy.confirmed, true);
  assert.equal(novemberLy.confirmed, true);
  const leap = plain(gs.periodFor_('store', 2024, 2)) as Period;
  const common = plain(gs.periodFor_('store', 2025, 2)) as Period;
  check('2024 February store length', '29', String((gs.eachDate_(leap.start, leap.end) as string[]).length));
  check('2025 February store length', '28', String((gs.eachDate_(common.start, common.end) as string[]).length));
  const unpaired = gs.lastYearDate_({ track: 'Store', period: leap, ly: plain(gs.storeLastYear_({}, leap)) }, '2024-03-01');
  check('2024-03-01 store last-year partner', 'No matching last-year day', String(unpaired));
  check('2024-02-29 salesperson last-year partner', 'No matching last-year day', String(gs.lastYearDate_({ track: 'Person' }, '2024-02-29')));
  assert.equal(failures.length, 0, failures.join('\n'));
});

test('a late upload for a closed store month stays on its business date', () => {
  const { gs, tabs, setToday } = harness();
  const before = tabs.CC_Daily!.length;
  const octoberWritten = Number(plain(gs.home_({ session })).month.written);
  setToday('2026-11-05');
  const filed = gs.writeDailyAmount_({ reportType: 'NWDSR Written', start: '2026-10-30', storeTotal: 4321 });
  const row = table(tabs, 'CC_Daily').find((line) => line.date === '2026-10-30');
  const store = plain(gs.storePeriodContaining_('2026-10-30')) as Period;
  const november = plain(gs.storePeriodContaining_('2026-11-05')) as Period;
  console.log(`late upload status: expected imported | calculated ${filed}`);
  console.log(`late upload business date: expected 2026-10-30 | calculated ${row?.date}`);
  console.log(`late upload store month: expected 2026-10-02 through 2026-11-01 | calculated ${store.start} through ${store.end}`);
  console.log(`upload day store month: expected 2026-11-02 through 2026-12-01 | calculated ${november.start} through ${november.end}`);
  assert.equal(filed, 'imported');
  assert.equal(row?.date, '2026-10-30');
  assert.equal(Number(row?.nwdsr_written), 4321);
  assert.equal(store.start, '2026-10-02');
  assert.equal(store.end, '2026-11-01');
  assert.equal(november.start, '2026-11-02');
  const novemberDollars = table(tabs, 'CC_Daily')
    .filter((line) => line.date >= '2026-11-02' && line.date <= '2026-12-01')
    .reduce((sum, line) => sum + Number(line.nwdsr_written || 0), 0);
  assert.equal(novemberDollars, 0, 'October 30 does not become November store sales');
  setToday('2026-11-01');
  assert.equal(Number(plain(gs.home_({ session })).month.written), octoberWritten + 4321);
  assert.equal(tabs.CC_Daily!.length, before + 1, 'one business date was added and no earlier day was removed');
});

test('a confirmed closure is one date, and a duplicate historical amount is flagged without being zeroed', () => {
  const { gs, tabs } = harness();
  const written = Number(plain(gs.home_({ session })).month.written);
  const confirmed = plain(gs.confirmStoreClosure_('2026-11-26', 'GM', 'Thanksgiving observed this year only'));
  assert.equal(confirmed.status, 'confirmed');
  assert.equal(plain(gs.closedDates_())['2026-11-26'], true);
  assert.equal(plain(gs.closedDates_())['2025-11-27'], undefined);
  assert.equal(plain(gs.closedDates_())['2027-11-26'], undefined);
  const audit = table(tabs, 'CC_History').filter((row) => row.record_key === '2026-11-26');
  assert.equal(audit.length, 1);
  const kept = plain(gs.recordHistoricalDay_({
    metric: 'NWDSR Written', date: '2026-10-30', dollars: 4321, source: 'first.pdf', verification: 'Verified', note: '',
  }));
  const conflict = plain(gs.recordHistoricalDay_({
    metric: 'NWDSR Written', date: '2026-10-30', dollars: 9999, source: 'late-conflict.pdf', verification: 'Verified', note: 'disagree',
  }));
  assert.equal(kept.status, 'added');
  assert.equal(conflict.status, 'kept');
  assert.equal(plain(gs.historicalAmount_('NWDSR Written', '2026-10-30')).dollars, 4321);
  tabs.NWDSR_WRITTEN_LY!.push(['2026-10-30', 17, 1, '2026-10-02 through 2026-11-01', 29, 'second.pdf', 'Verified', '2026-11-05', 'Canonical', '']);
  gs.runQualityChecks_('calendar proof');
  const checks = table(tabs, 'CC_QualityChecks').filter((row) => row.check_id === 'reporting-calendar' && row.status === 'FLAG');
  assert.ok(checks.some((row) => /2026-10-30/.test(row.explanation) && /conflict/i.test(row.explanation)));
  assert.equal(plain(gs.historicalAmount_('NWDSR Written', '2026-10-30')).dollars, 4321);
  assert.equal(Number(plain(gs.home_({ session })).month.written), written);
});
