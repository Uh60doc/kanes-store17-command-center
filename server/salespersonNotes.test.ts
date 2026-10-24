/**
 * Salesperson cards tell the floor when the number was last updated.
 * File lists and source explanations stay off the card.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../apps-script/Index.html', import.meta.url), 'utf8');
const script = html.split('<script>')[1]?.split('</script>')[0] || '';

function client() {
  const screen = {
    innerHTML: '',
    classList: { add() {}, remove() {} },
    addEventListener() {},
  };
  const element = () => ({
    classList: { add() {}, remove() {}, toggle() { return false; } },
    addEventListener() {},
    setAttribute() {},
    textContent: '',
    innerHTML: '',
  });
  const context: Record<string, unknown> = {
    document: {
      getElementById: (id: string) => (id === 'screen' ? screen : element()),
      addEventListener() {},
      querySelector() { return null; },
      querySelectorAll: () => [],
      body: { classList: { add() {}, remove() {} } },
    },
    sessionStorage: { getItem: () => '', setItem() {}, removeItem() {} },
    setInterval: () => 0,
    clearInterval() {},
    window: { scrollTo() {}, addEventListener() {}, print() {} },
  };
  vm.createContext(context);
  vm.runInContext(script, context, { filename: 'Index.html' });
  return { context, screen };
}

test('every salesperson card says last updated and drops the file notes', () => {
  const { context, screen } = client();
  const page = context as {
    peopleCache: unknown[];
    peopleSnapThrough: string;
    peopleSnapPending: string[];
    peopleAnalysisThrough: { written: string; delivered: string };
    renderPerson: (name: string) => void;
  };
  page.peopleSnapThrough = '2026-10-23';
  page.peopleSnapPending = ['2026-10-01'];
  page.peopleAnalysisThrough = { written: '2026-10-23', delivered: '2026-10-23' };
  page.peopleCache = [{
    name: 'Prakash Gandhi',
    snapWritten: 53738,
    monthlyGoal: 65000,
    deliveredSales: 29394,
    deliveredThrough: '2026-10-23',
    deliveredBasis: 'Group 17 salesperson report 2026-10-01 through 2026-10-15 plus the day files 2026-10-16',
    closingThrough: '2026-10-14',
    closingOrders: 11,
    opportunities: 31,
    analysisWrittenThrough: '2026-10-23',
    writtenOrders: 14,
    analysisWritten: 51000,
    analysisWrittenBasis: 'Group 17 salesperson report',
    closingRatio: 0.355,
    closingPoints: -14.5,
    closingVersus: 'Below Goal',
    closingReconcile: false,
    closingNote: 'Through 2026-10-14: Group 17 Written orders. Store delivered was $0.',
    closing: { goal: 0.5, ordersSource: '11 for 2026-10-01 through 2026-10-13 plus day files', opportunitiesSource: '31 for 2026-10-01 through 2026-10-13 plus daily', ratioStatus: '' },
    kpis: [],
    days: [],
  }, {
    name: 'Ricky Nassif',
    snapWritten: 1000,
    monthlyGoal: 65000,
    deliveredSales: 0,
    deliveredThrough: '2026-10-23',
    closingThrough: '2026-10-23',
    closingOrders: 4,
    opportunities: 10,
    analysisWrittenThrough: '2026-10-23',
    analysisWritten: 1000,
    closingRatio: 0.4,
    closingPoints: -10,
    closingVersus: 'Below Goal',
    closingReconcile: false,
    closing: { goal: 0.5 },
    kpis: [],
    days: [],
  }];

  page.renderPerson('Prakash Gandhi');
  const prakash = screen.innerHTML;
  assert.match(prakash, /SNAP written[\s\S]*Last updated October 23, 2026\. October 1, 2026 is still waiting on SNAP\./);
  assert.match(prakash, /Monthly goal[\s\S]*Last updated October 23, 2026\. 82\.7% to goal\./);
  assert.match(prakash, /Delivered[\s\S]*Last updated October 23, 2026\./);
  assert.match(prakash, /Written orders[\s\S]*Last updated October 14, 2026\. Written orders after October 14, 2026 wait on PERQ\./);
  assert.match(prakash, /Opportunities[\s\S]*Last updated October 14, 2026\./);
  assert.match(prakash, /Closing ratio[\s\S]*Last updated October 14, 2026\./);
  assert.match(prakash, /Data Analysis written[\s\S]*Last updated October 23, 2026\./);
  assert.equal(prakash.includes('salesperson report'), false);
  assert.equal(prakash.includes('day files'), false);
  assert.equal(prakash.includes('was $0'), false);
  assert.equal(prakash.includes('only source'), false);
  assert.equal(prakash.includes('Store budgets'), false);
  assert.equal(prakash.includes('PERQ opportunities'), false);

  page.renderPerson('Ricky Nassif');
  const ricky = screen.innerHTML;
  assert.match(ricky, /Delivered[\s\S]*Last updated October 23, 2026\./);
  assert.match(ricky, /Written orders[\s\S]*Last updated October 23, 2026\./);
  assert.equal(ricky.includes('wait on PERQ'), false);
  assert.equal(ricky.includes('day files'), false);
});
