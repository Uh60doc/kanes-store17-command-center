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
  assert.equal(home.chart.length, expected.length);
  home.chart.forEach((day: { date: string; written: number | null; delivered: number | null; snap: number | null }, index: number) => {
    assert.equal(day.date, expected[index]!.date);
    assert.equal(day.written, expected[index]!.nwdsrWritten);
    assert.equal(day.delivered, expected[index]!.nwdsrDelivered);
    assert.equal(day.snap, expected[index]!.snapWritten);
  });
  assert.ok(home.chart.length > 0);
});
