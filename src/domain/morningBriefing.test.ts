import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { activeFinancing, activeSale, anniversarySale, chooseVerifiedFigure, claimsZeroInterest, dailyWinners, managementName, personalShare, type StaffLine } from './morningBriefing.ts';

const example: StaffLine[] = [
  { name: 'A', role: 'associate', worked: true, onLeave: false, nwdsrWritten: 4000 },
  { name: 'B', role: 'associate', worked: true, onLeave: false, nwdsrWritten: 2000 },
  { name: 'C', role: 'associate', worked: true, onLeave: false, nwdsrWritten: 3000 },
  { name: 'Kelly', role: 'management', worked: true, onLeave: false, nwdsrWritten: 9000 },
  { name: 'Out', role: 'associate', worked: false, onLeave: false, nwdsrWritten: 8000 },
];

test('the example lists only the associate who beat a $3,000 share', () => {
  const result = dailyWinners(example, 9000);
  assert.equal(result.status, 'ready');
  if (result.status !== 'ready') return;
  assert.equal(result.share, 3000);
  assert.deepEqual(result.winners.map((winner) => winner.name), ['A']);
  assert.equal(result.winners[0]?.above, 1000);
});

test('a sale without a working roster is not turned into a winner', () => {
  const result = dailyWinners(
    [{ name: 'Renzo Del Solar', role: 'associate', worked: null, onLeave: false, nwdsrWritten: 7106 }],
    15470.3,
  );
  assert.equal(result.status, 'pending');
});

test('a manager kept on the associate roster is still left off the winner list', () => {
  const result = dailyWinners(
    [
      { name: 'James Meyers', role: 'associate', worked: true, onLeave: false, nwdsrWritten: 9000 },
      { name: 'A', role: 'associate', worked: true, onLeave: false, nwdsrWritten: 4000 },
    ],
    3000,
  );
  assert.equal(result.status, 'ready');
  if (result.status !== 'ready') return;
  assert.equal(result.share, 3000);
  assert.deepEqual(result.winners.map((winner) => winner.name), ['A']);
  assert.equal(managementName('PEREZ, ELIZABETH'), true);
  assert.equal(claimsZeroInterest('20% down, plus tax and delivery'), false);
  assert.equal(claimsZeroInterest('SPECIAL 0% FINANCING'), true);
});

test('a missing NWDSR line is not treated as zero', () => {
  const result = dailyWinners(
    [
      { name: 'A', role: 'associate', worked: true, onLeave: false, nwdsrWritten: 4000 },
      { name: 'B', role: 'associate', worked: true, onLeave: false, nwdsrWritten: null },
    ],
    6000,
  );
  assert.equal(result.status, 'pending');
  assert.equal(personalShare(null, 3), null);
});

test('the anniversary sale expires on October 19 and 78-month financing lasts through October 26', () => {
  const sale = anniversarySale();
  assert.equal(activeSale(sale, '2026-10-13')?.name, '78th Anniversary Sale');
  assert.equal(activeSale(sale, '2026-10-20'), null);
  assert.equal(activeSale({ ...sale, approved: false }, '2026-10-14'), null);
  const during = activeFinancing(sale.financing, '2026-10-14').map((term) => term.months);
  assert.deepEqual(during, [6, 12, 18, 24, 48, 60, 78]);
  const after = activeFinancing(sale.financing, '2026-10-20');
  assert.deepEqual(after.map((term) => term.months), [78]);
  assert.equal(after[0]?.zeroInterest, true);
  assert.equal(sale.financing.some((term) => term.months === 72 || term.months === 36 || term.months === 50), false);
  assert.equal(sale.financing.filter((term) => term.zeroInterest).length, 1);
});

test('a month-to-date figure is not labeled as yesterday', () => {
  const yesterday = chooseVerifiedFigure({
    yesterday: '2026-10-13',
    dailyValue: 0.5,
    latestDailyValue: 0.206,
    latestDailyDate: '2026-10-11',
    mtdValue: 0.206,
    mtdThrough: '2026-10-13',
    mtdPeriod: '2026-10-02 through 2026-11-01',
  });
  assert.equal(yesterday.scope, 'yesterday');
  assert.equal(yesterday.value, 0.5);
  const latestDay = chooseVerifiedFigure({
    yesterday: '2026-10-13',
    dailyValue: null,
    latestDailyValue: 0.5,
    latestDailyDate: '2026-10-14',
    mtdValue: 0.206,
    mtdThrough: '2026-10-13',
    mtdPeriod: '2026-10-02 through 2026-11-01',
  });
  assert.equal(latestDay.scope, 'latest-daily');
  assert.equal(latestDay.date, '2026-10-14');
  assert.notEqual(latestDay.scope, 'yesterday');
  const mtd = chooseVerifiedFigure({
    yesterday: '2026-10-13',
    dailyValue: null,
    latestDailyValue: null,
    latestDailyDate: '',
    mtdValue: 0.206,
    mtdThrough: '2026-10-13',
    mtdPeriod: '2026-10-02 through 2026-11-01',
  });
  assert.equal(mtd.scope, 'mtd');
  assert.equal(mtd.value, 0.206);
  assert.equal(mtd.date, '2026-10-13');
  const missing = chooseVerifiedFigure({
    yesterday: '2026-10-11',
    dailyValue: null,
    latestDailyValue: null,
    latestDailyDate: '',
    mtdValue: null,
    mtdThrough: '',
    mtdPeriod: '',
  });
  assert.equal(missing.scope, 'none');
  assert.equal(missing.value, null);
});

test('morning meeting reuses the Home bedding figure and keeps month-to-date off yesterday', () => {
  const data = readFileSync(new URL('../../apps-script/Data.gs', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../../apps-script/Index.html', import.meta.url), 'utf8');
  assert.equal(data.includes("if (row.name === 'Bedding') homeBedding = row;"), true);
  assert.equal(data.includes("scope: 'mtd'"), true);
  assert.equal(data.includes('On vacation October 1 through October 12, 2026. Back October 13.'), true);
  assert.equal(html.includes('Latest verified MTD'), true);
  assert.equal(html.includes('Awaiting first report'), true);
  assert.equal(html.includes('class="morning-five"'), true);
  assert.equal(html.includes('The daily bedding report is not in.'), false);
  assert.equal(html.includes('section-title">Results</h2>'), true);
});

test('the Apps Script briefing contains the approved prices and no extra finance term', () => {
  const source = readFileSync(new URL('../../apps-script/Data.gs', import.meta.url), 'utf8');
  for (const text of ['78th Anniversary Sale', '3999.99', '1999.99', '599.50', '899.50', '5,999.99', 'Beautyrest Black', 'Tempur-Pedic']) {
    assert.equal(source.includes(text), true, text);
  }
  assert.equal(source.includes('72 months'), false);
  assert.equal(source.includes('36 months'), false);
  assert.equal(source.includes('(^|[^0-9.])0\\s*%'), true);
  assert.equal(source.includes('20% down'), true);
});
