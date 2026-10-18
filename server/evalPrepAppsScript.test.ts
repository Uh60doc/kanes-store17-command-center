import assert from 'node:assert/strict';
import test from 'node:test';
import { appsScriptServices } from './appsScriptServices.ts';
import { loadAppsScript, plain } from './fakeSpreadsheet.ts';
import { ALL_FILES, cells, harness, session, verifiedOctober } from './octoberVerified.ts';

const admin = session;

test('evaluation prep uses the tenure schedule and does not write sales or evaluation rows', () => {
  const { gs, tabs } = harness();
  gs.ensureRosterColumns_();
  const before = plain(gs.home_({ session: admin }));
  const evalRows = cells(tabs.CC_Evaluations || [['cycle']]).length;
  const prep = plain(gs.evalPrep_({ session: admin, cycle: '2026-11' }));
  const after = plain(gs.home_({ session: admin }));
  assert.equal(after.month.written, before.month.written);
  assert.equal(after.month.delivered, before.month.delivered);
  assert.equal(cells(tabs.CC_Evaluations || [['cycle']]).length, evalRows);
  assert.deepEqual(plain(gs.ROUTES_).evalPrep, ['manager', 'admin']);
  assert.match(prep.form, /corporate PDF/);
  assert.match(prep.calendar, /1st through the last calendar day/);
  const names = prep.cards.map((card: { name: string }) => card.name);
  assert.ok(names.includes('Ricky Nassif'));
  assert.ok(names.includes('Brenda Sanchez'));
  assert.ok(!names.some((name: string) => /Mukhtar|Filepe|Valentina|Caroline|Kelly|Elizabeth|Cordell|James/.test(name)));
  const ricky = prep.cards.find((card: { name: string }) => card.name === 'Ricky Nassif');
  assert.equal(ricky.newHire, false);
  assert.equal(ricky.hireDate, '');
  assert.equal(ricky.metrics[0].values[2].goal, null);
  assert.notEqual(ricky.metrics[0].values[2].met, false);
  const brenda = prep.cards.find((card: { name: string }) => card.name === 'Brenda Sanchez');
  assert.equal(brenda.newHire, true);
  assert.equal(brenda.hireDate, '2026-10-12');
  assert.equal(brenda.metrics[0].values[0].status, 'Not employed');
  assert.equal(brenda.metrics[0].values[1].status, 'Not employed');
  assert.equal(brenda.metrics[0].values[2].goal, 0);
  assert.notEqual(brenda.metrics[0].values[2].met, false);
  assert.ok(brenda.metrics.every((metric: { key: string; values: { met: boolean | null }[] }) => metric.key === 'rugs' || metric.values.every((cell) => cell.met !== false)));
  assert.match(brenda.comments, /Draft for the manager/);
  assert.equal(brenda.metrics.find((metric: { key: string }) => metric.key === 'rugs').values[2].value, null);
});

test('the draft workbook uses the existing evaluation form and writes nothing', () => {
  const tabs = verifiedOctober();
  const services = appsScriptServices();
  const gs = loadAppsScript(ALL_FILES.concat(['Logos.gs', 'Xlsx.gs']), tabs, '2026-10-17', services.services);
  gs.ensureRosterColumns_();
  const before = cells(tabs.CC_Daily).length;
  const file = plain(gs.evalPrepWorkbook_({ session: admin, cycle: '2026-11', names: ['Brenda Sanchez'] }));
  assert.match(file.fileName, /Eval_Draft/);
  assert.equal(file.draft, true);
  assert.ok(String(file.base64).length > 100);
  assert.equal(cells(tabs.CC_Daily).length, before);
});
