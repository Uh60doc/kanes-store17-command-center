/**
 * The desktop navigation is one row of the nine groups, and Home's chart
 * repeats the store calendar instead of a second calculation.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { plain } from './fakeSpreadsheet.ts';
import { harness, session } from './octoberVerified.ts';

const html = fs.readFileSync(new URL('../apps-script/Index.html', import.meta.url), 'utf8');
const script = html.split('<script>')[1]?.split('</script>')[0] || '';

function client() {
  const element = () => ({
    classList: { add() {}, remove() {}, toggle() { return false; } },
    addEventListener() {},
    setAttribute() {},
    textContent: '',
    innerHTML: '',
  });
  const context: Record<string, unknown> = {
    document: {
      getElementById: () => element(),
      addEventListener() {},
      querySelector() { return null; },
      querySelectorAll: () => [],
      body: { classList: { add() {}, remove() {} } },
    },
    sessionStorage: { getItem: () => '', setItem() {}, removeItem() {} },
    setInterval: () => 0,
    clearInterval() {},
    window: { scrollTo() {}, addEventListener() {} },
  };
  vm.createContext(context);
  vm.runInContext(script, context, { filename: 'Index.html' });
  return context as {
    role: string;
    ownReport: boolean;
    screen: string;
    reportQuery: { kind: string };
    navModel: () => { label: string; screen?: string; items?: [string, string][] }[];
    routeAllowed: (name: string) => boolean;
  };
}

const managerOrder = ['Home', 'Sales Team', 'Morning Meeting', 'Upload Reports', 'Sales & KPIs', 'Reports', 'Operations', 'Resources', 'Admin'];

test('manager navigation is the nine groups in order and keeps every manager page', () => {
  const page = client();
  page.role = 'manager';
  page.ownReport = false;
  page.screen = 'home';
  const groups = page.navModel();
  assert.equal(groups.map((group) => group.label).join('|'), managerOrder.join('|'));
  assert.equal(groups.length, 9);
  const targets = groups.flatMap((group) => group.items ? group.items.map((item) => item[0]) : [group.screen]);
  ['written', 'delivered', 'closing', 'bedding', 'accel', 'variance', 'recovery', 'leakage', 'daily',
    'reports:daily', 'reports:weekly', 'reports:monthly', 'brief', 'reports:trend', 'email', 'reports:meeting', 'reports:individual',
    'readiness', 'delivery', 'orderQuality', 'closeout', 'actions',
    'documents', 'training', 'coaching', 'evalPrep',
    'health', 'consistency', 'email'].forEach((target) => assert.ok(targets.includes(target), target));
  assert.equal(targets.includes('admin'), false);
  assert.equal(targets.includes('coverage'), false);
  assert.equal(html.includes('Google Setup'), false);
  assert.equal(html.includes('Remaining written budget divided by days left.'), false);
  assert.equal(html.includes('This week written'), true);
  assert.equal(html.includes('Close %'), true);
  assert.equal(html.includes('Last year is the prior year, not last month.'), false);
  assert.equal(html.includes('Supplemental. Not the store written total.'), false);
  assert.equal(html.includes('repeat(6, minmax(0, 1fr))'), true);
});

test('admin adds administration and coverage, and sales cannot open manager pages', () => {
  const admin = client();
  admin.role = 'admin';
  const adminTargets = admin.navModel().flatMap((group) => group.items ? group.items.map((item) => item[0]) : []);
  assert.ok(adminTargets.includes('admin'));
  assert.ok(adminTargets.includes('coverage'));

  const sales = client();
  sales.role = 'sales';
  sales.ownReport = false;
  const labels = sales.navModel().map((group) => group.label).join('|');
  assert.equal(labels, ['Home', 'Sales Team', 'Morning Meeting', 'Sales & KPIs', 'Resources'].join('|'));
  assert.equal(sales.routeAllowed('upload'), false);
  assert.equal(sales.routeAllowed('bedding'), false);
  assert.equal(sales.routeAllowed('reports'), false);
  assert.equal(sales.routeAllowed('coach'), true);
  sales.ownReport = true;
  assert.equal(sales.routeAllowed('reports'), true);
  assert.ok(sales.navModel().some((group) => group.label === 'Reports'));
});

test('home chart repeats the store calendar through yesterday', () => {
  const { gs } = harness();
  const home = plain(gs.home_({ session }));
  const daily = plain(gs.daily_({ session }));
  const expected = (daily.days as { date: string; nwdsrWritten: number | null; nwdsrDelivered: number | null; snapWritten: number | null }[])
    .filter((day) => day.date < home.today);
  const past = home.chart.filter((day: { date: string }) => day.date < home.today);
  assert.equal(past.length, expected.length);
  let running = 0;
  past.forEach((day: { date: string; written: number | null; dailyWritten: number | null }, index: number) => {
    assert.equal(day.date, expected[index]!.date);
    assert.equal(day.dailyWritten, expected[index]!.nwdsrWritten);
    if (day.dailyWritten !== null && day.dailyWritten !== undefined) running += day.dailyWritten;
    const cumulative = day.dailyWritten === null || day.dailyWritten === undefined ? null : Math.round(running * 100) / 100;
    assert.equal(day.written, cumulative);
  });
  assert.ok(home.chart.some((day: { date: string; written: number | null }) => day.date >= home.today && day.written === null));
  assert.ok(home.chart.length > past.length);
  assert.equal(home.month.writtenGoal, 400000);
  assert.equal(home.month.deliveredGoal, 320000);
  assert.equal(home.stretch.written, 652274);
  assert.equal(home.stretch.delivered, 564373);
  assert.equal(home.goals.attachment, 0.9);
  assert.equal(home.week.start <= '2026-10-17' && home.week.end >= '2026-10-17', true);
  assert.ok(home.week.written > 0);
  assert.ok(home.week.delivered > 0);
});

test('home trend draws a smooth area and leaves last year off until those days exist', () => {
  const page = client() as {
    homeTrend: (chart: unknown, today: string) => string;
    homeTrendHasLy: (chart: unknown) => boolean;
    softenTrend: (group: { index: number; value: number }[]) => { index: number; value: number }[];
  };
  const chart = [];
  for (let day = 2; day <= 31; day += 1) {
    const date = `2026-10-${String(day).padStart(2, '0')}`;
    chart.push({ date, written: day < 16 ? day * 8000 : null, snapLy: day < 10 ? day * 5000 : null });
  }
  chart.push({ date: '2026-11-01', written: null, snapLy: null });
  const svg = page.homeTrend(chart, '2026-10-19');
  assert.match(svg, /linearGradient/);
  assert.match(svg, / C/);
  assert.match(svg, /stroke="#f3d48a" stroke-width="1.8" stroke-dasharray="4 4"/);
  assert.match(svg, /#7eecf6/);
  assert.match(svg, /Through Oct 15/);
  assert.equal(svg.includes('not drawn as a guess'), false);
  assert.equal(page.homeTrendHasLy(chart.map((day) => ({ ...day, snapLy: null }))), false);
  const pending = page.homeTrend(chart.map((day) => ({ ...day, snapLy: null })), '2026-10-15');
  assert.equal(pending.includes('stroke-dasharray="4 4"'), false);
  assert.equal(pending.includes('#f3d48a'), false);
  assert.match(pending, /Today Oct 15/);
  const jagged = [0, 40, 41, 90, 92, 93, 140].map((value, index) => ({ index, value }));
  const soft = page.softenTrend(jagged);
  assert.equal(soft[0].value, 0);
  assert.equal(soft[soft.length - 1].value, 140);
  assert.ok(soft[1].value < 40);
  soft.forEach((point, index) => {
    if (index) assert.ok(point.value >= soft[index - 1].value - 0.001);
  });
});
