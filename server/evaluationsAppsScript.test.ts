import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { appsScriptServices, unzipEntries } from './appsScriptServices.ts';
import { type Grid, loadAppsScript, plain } from './fakeSpreadsheet.ts';

const FILES = ['Data.gs', 'Metrics.gs', 'Roster.gs', 'Ledger.gs', 'Import.gs', 'KpiImport.gs', 'Logos.gs', 'Xlsx.gs', 'Evaluations.gs', 'EvalImport.gs'];
const manager = { role: 'manager' };
const admin = { role: 'admin' };

function store(): Record<string, Grid> {
  return {
    CC_People: [
      ['name', 'role', 'SNAP Written'],
      ['Renzo Del Solar', 'associate', 10088],
      ['Prakash Gandhi', 'associate', 39843],
      ['Eric Montes Rodriguez', 'associate', 32294],
      ['Ricky Nassif', 'associate', 17715],
      ['Brenda Sanchez', 'associate', ''],
      ['Caroline Amaro', 'former', ''],
    ],
    CC_Config: [['key', 'value'], ['individual_volume_goal', 65000]],
  };
}

function boot(tabs: Record<string, Grid>, today: string) {
  const services = appsScriptServices();
  const gs = loadAppsScript(FILES, tabs, today, services.services);
  gs.ensureRosterColumns_();
  return { gs, ...services };
}

function at(tabs: Record<string, Grid>, today: string, services: ReturnType<typeof appsScriptServices>) {
  const gs = loadAppsScript(FILES, tabs, today, services.services);
  return gs;
}

const METRIC_KEYS = ['volume', 'average', 'mattress', 'adjBase', 'pillows', 'protector', 'warranty', 'fabric', 'power', 'powerAdj', 'leather', 'wood', 'finance', 'rugs'];

/** Test figures only, written the way a verified report entry would be. */
function record(tabs: Record<string, Grid>, month: string, name: string, values: Record<string, number | null>) {
  if (!tabs.CC_EvalMetrics) tabs.CC_EvalMetrics = [['month', 'name', 'employee_id', 'metric', 'value', 'unit', 'status', 'source', 'note', 'recorded_at', 'recorded_by', 'origin']];
  for (const [metric, value] of Object.entries(values)) {
    const unit = metric === 'volume' || metric === 'average' ? 'dollars' : metric === 'rugs' ? 'count' : 'percent';
    tabs.CC_EvalMetrics.push([month, name, '', metric, value === null ? '' : value, unit, value === null ? 'Not Available' : 'Verified', 'test fixture', value === null ? 'not in source' : '', `2026-11-01T0${METRIC_KEYS.indexOf(metric) % 10}:00:00Z`, 'test', 'fixture']);
  }
}

const fullMonth = (overrides: Record<string, number | null> = {}) => ({
  volume: 70000, average: 2600, mattress: 0.22, adjBase: 0.4, pillows: 0.7, protector: 0.82, warranty: 0.06, fabric: 0.85, power: 0.9, powerAdj: 0.55, leather: 0.81, wood: 0.6, finance: 0.55, rugs: 13, ...overrides,
});

test('a cycle covers the last three completed salesperson months, 1st through last day, never the store period', () => {
  const { gs } = boot(store(), '2026-10-16');
  const october = plain(gs.evalCycleInfo_('2026-10'));
  assert.deepEqual(october.months.map((month: any) => [month.start, month.end]), [['2026-07-01', '2026-07-31'], ['2026-08-01', '2026-08-31'], ['2026-09-01', '2026-09-30']]);
  assert.equal(october.label, 'October 2026');
  const november = plain(gs.evalCycleInfo_('2026-11'));
  assert.deepEqual(november.months.map((month: any) => [month.start, month.end]), [['2026-08-01', '2026-08-31'], ['2026-09-01', '2026-09-30'], ['2026-10-01', '2026-10-31']]);
  assert.deepEqual([november.prepare, november.deliverBy], ['2026-11-03', '2026-11-06']);
  assert.deepEqual(plain(gs.evalCycleInfo_('2027-01')).months.map((month: any) => month.key), ['2026-10', '2026-11', '2026-12']);
});

test('before the 3rd the next cycle is a preview: Sales Team only, new-hire template, nothing invented', () => {
  const { gs } = boot(store(), '2026-10-16');
  const view = plain(gs.evals_({ session: manager }));
  assert.equal(view.cycle, '2026-11');
  assert.equal(view.canPrepare, false);
  assert.equal(view.prepared, false);
  assert.deepEqual(view.evaluations.map((e: any) => e.name), ['Renzo Del Solar', 'Prakash Gandhi', 'Eric Montes Rodriguez', 'Ricky Nassif', 'Brenda Sanchez'], 'Caroline never started and is not evaluated');
  const brenda = view.evaluations.find((e: any) => e.name === 'Brenda Sanchez');
  assert.equal(brenda.template, 'newHire');
  assert.equal(brenda.metrics.find((m: any) => m.key === 'fabric').goal, 0.8);
  assert.equal(brenda.metrics.find((m: any) => m.key === 'average').goal, 2100);
  assert.deepEqual(brenda.metrics[0].values.map((v: any) => v.status), ['Not Employed', 'Not Employed', 'Pending Verification']);
  const ricky = view.evaluations.find((e: any) => e.name === 'Ricky Nassif');
  assert.equal(ricky.template, 'standard');
  for (const key of ['fabric', 'leather', 'power', 'protector']) assert.equal(ricky.metrics.find((m: any) => m.key === key).goal, 0.8, key);
  assert.equal(ricky.verification, 'Pending Verification');
  assert.ok(ricky.metrics.every((m: any) => m.values.every((v: any) => v.value === null)), 'no figure without a verified source');
  assert.match(ricky.metrics[0].values[2].note, /not complete/);
  assert.match(ricky.comments, /Pending Verification: no verified figures/);
  assert.deepEqual(ricky.focus.map((f: any) => f.metric), ['', '']);
  assert.throws(() => gs.prepareEvals_({ session: manager, cycle: '2026-11' }), /prepared on 2026-11-03/);
});

test('drafts are prepared on the 3rd, labeled Pending Verification when reports are missing, and never replaced', () => {
  const tabs = store();
  const { gs: first, ...services } = boot(tabs, '2026-11-02');
  assert.equal(first.prepareDueEvaluations_('2026-11-02'), 0);
  const gs = at(tabs, '2026-11-03', services);
  assert.equal(gs.prepareDueEvaluations_('2026-11-03'), 5);
  assert.equal(gs.prepareDueEvaluations_('2026-11-03'), 0, 'a second run adds nothing');
  const rows = tabs.CC_Evaluations!;
  assert.equal(rows.length, 6);
  const header = rows[0] as string[];
  assert.ok(rows.slice(1).every((row) => row[header.indexOf('status')] === 'Draft'));
  assert.match(String(rows[1]![header.indexOf('note')]), /Pending Verification when prepared: August 2026, September 2026, October 2026/);
  const view = plain(gs.evals_({ session: manager }));
  assert.equal(view.cycle, '2026-11');
  assert.ok(view.evaluations.every((e: any) => e.status === 'Draft' && e.verification === 'Pending Verification'));
  assert.equal(at(tabs, '2026-11-08', services).prepareDueEvaluations_('2026-11-08'), 0, 'outside the delivery window nothing is prepared automatically');
});

test('a manager prepares drafts only after confirming, with a warning once the delivery window has passed', () => {
  const tabs = store();
  const { gs } = boot(tabs, '2026-10-16');
  const preview = plain(gs.prepareEvals_({ session: manager, cycle: '2026-10' }));
  assert.equal(preview.confirmed, false);
  assert.match(preview.summary, /^Prepare 4 October 2026 drafts \(Renzo Del Solar, Prakash Gandhi, Eric Montes Rodriguez, Ricky Nassif\) covering July 2026 through September 2026\./);
  assert.match(preview.summary, /delivery window for this month ended on 2026-10-06.*upload that workbook instead/);
  assert.ok(!('CC_Evaluations' in tabs), 'nothing is written before confirmation');
  const done = plain(gs.prepareEvals_({ session: manager, cycle: '2026-10', confirm: true }));
  assert.equal(done.saved, '4 drafts prepared.');
  assert.equal(tabs.CC_Evaluations!.length, 5);
});

test('coaching text uses verified figures, the two largest gaps, tenure, and stays editable until approval', () => {
  const tabs = store();
  record(tabs, '2026-08', 'Ricky Nassif', fullMonth({ fabric: 0.6, finance: 0.3 }));
  record(tabs, '2026-09', 'Ricky Nassif', fullMonth({ fabric: 0.55, finance: 0.35 }));
  record(tabs, '2026-10', 'Ricky Nassif', fullMonth({ fabric: 0.524, finance: 0.31, volume: 52000 }));
  const { gs } = boot(tabs, '2026-11-03');
  gs.prepareDueEvaluations_('2026-11-03');
  const ricky = plain(gs.evals_({ session: manager })).evaluations.find((e: any) => e.name === 'Ricky Nassif');
  assert.equal(ricky.verification, 'Verified');
  assert.deepEqual(ricky.focus.map((f: any) => f.metric), ['Finance % of Total Sales', 'Fabric Protection Attachment % (FABW)']);
  assert.equal(ricky.focus[1].prior, '52.4%');
  assert.equal(ricky.focus[1].goal, '80.0%');
  assert.match(ricky.focus[1].plan, /October result: 52\.4%, 27\.6 points under the 80\.0% goal\. Three-month trend: August 60\.0%, September 55\.0%, October 52\.4%\./);
  assert.match(ricky.recognition, /Met the goal every verified month in: Average Sale/);
  assert.match(ricky.comments, /met 11 of 14 goals with verified figures in October 2026/);
  const fabric = ricky.metrics.find((m: any) => m.key === 'fabric');
  assert.deepEqual(fabric.values.map((v: any) => v.met), [false, false, false]);
  assert.equal(fabric.metText, '0 of 3');
  assert.equal(ricky.metrics[0].goal, 65000);

  const brenda = plain(gs.evals_({ session: manager })).evaluations.find((e: any) => e.name === 'Brenda Sanchez');
  assert.match(brenda.comments, /joined Store 17 on 2026-10-12, so October 2026 covers 20 of its 31 days/);

  const edited = plain(gs.saveEvaluation_({ session: manager, cycle: '2026-11', name: 'Ricky Nassif', fields: { focus1_plan: 'Manager wording.', volume_goal: '70,000', manager_name: 'Kelly Meyers' } }));
  const after = edited.evaluations.find((e: any) => e.name === 'Ricky Nassif');
  assert.equal(after.focus[0].plan, 'Manager wording.');
  assert.equal(after.volumeGoal, 70000);
  assert.equal(after.managerName, 'Kelly Meyers');
  assert.throws(() => gs.saveEvaluation_({ session: manager, cycle: '2026-11', name: 'Ricky Nassif', fields: { volume_goal: 'lots' } }), /volume goal in dollars/);
});

test('approval needs verified months, freezes the evaluation, archives it, and given is only recorded by a manager', () => {
  const tabs = store();
  for (const month of ['2026-08', '2026-09', '2026-10']) record(tabs, month, 'Ricky Nassif', fullMonth());
  const { gs, files } = boot(tabs, '2026-11-03');
  gs.prepareDueEvaluations_('2026-11-03');
  assert.throws(() => gs.setEvalStatus_({ session: manager, cycle: '2026-11', name: 'Eric Montes Rodriguez', status: 'Approved', confirm: true }), /cannot move to Approved/);
  gs.setEvalStatus_({ session: manager, cycle: '2026-11', name: 'Eric Montes Rodriguez', status: 'Ready for Review', confirm: true });
  assert.throws(() => gs.setEvalStatus_({ session: manager, cycle: '2026-11', name: 'Eric Montes Rodriguez', status: 'Approved', confirm: true }), /Pending Verification: August 2026, September 2026, October 2026/);

  const preview = plain(gs.setEvalStatus_({ session: manager, cycle: '2026-11', name: 'Ricky Nassif', status: 'Ready for Review' }));
  assert.equal(preview.confirmed, false, 'a status change needs confirmation');
  gs.setEvalStatus_({ session: manager, cycle: '2026-11', name: 'Ricky Nassif', status: 'Ready for Review', confirm: true });
  const approved = plain(gs.setEvalStatus_({ session: manager, cycle: '2026-11', name: 'Ricky Nassif', status: 'Approved', confirm: true }));
  const ricky = approved.evaluations.find((e: any) => e.name === 'Ricky Nassif');
  assert.equal(ricky.status, 'Approved');
  assert.equal(ricky.frozen, true);
  assert.equal(ricky.givenOn, '', 'approval never marks the evaluation given');
  assert.equal(Object.keys(files).length, 1, 'the approved workbook is saved to Drive');
  const archived = approved.archive.find((entry: any) => entry.kind === 'approved evaluation');
  assert.match(archived.fileName, /Store17_Evaluation_2026-11_Ricky_Nassif_r1\.xlsx/);

  record(tabs, '2026-10', 'Ricky Nassif', { volume: 1 });
  const later = plain(gs.evals_({ session: manager })).evaluations.find((e: any) => e.name === 'Ricky Nassif');
  assert.equal(later.metrics[0].values[2].value, 70000, 'a later figure does not change the approved evaluation');
  assert.throws(() => gs.saveEvaluation_({ session: manager, cycle: '2026-11', name: 'Ricky Nassif', fields: { comments: 'x' } }), /locked/);

  const download = plain(gs.evalWorkbook_({ session: manager, archiveId: archived.id }));
  assert.equal(download.archived, true);
  assert.equal(Buffer.from(download.base64, 'base64').equals(Buffer.from(files[archived.id]!.bytes)), true, 'the archived file comes back byte for byte');

  assert.throws(() => gs.setEvalStatus_({ session: manager, cycle: '2026-11', name: 'Ricky Nassif', status: 'Reopen', confirm: true }), /Only an admin can reopen/);
  assert.throws(() => gs.setEvalStatus_({ session: manager, cycle: '2026-11', name: 'Ricky Nassif', status: 'Given to Associate', givenOn: '2026-11-30', confirm: true }), /future/);
  const given = plain(gs.setEvalStatus_({ session: manager, cycle: '2026-11', name: 'Ricky Nassif', status: 'Given to Associate', givenOn: '2026-11-03', confirm: true }));
  const done = given.evaluations.find((e: any) => e.name === 'Ricky Nassif');
  assert.deepEqual([done.status, done.givenOn, done.givenBy], ['Given to Associate', '2026-11-03', 'manager']);
});

test('an admin reopen starts a new revision and leaves the approved one in the archive', () => {
  const tabs = store();
  for (const month of ['2026-08', '2026-09', '2026-10']) record(tabs, month, 'Ricky Nassif', fullMonth());
  const { gs, files } = boot(tabs, '2026-11-03');
  gs.prepareDueEvaluations_('2026-11-03');
  gs.setEvalStatus_({ session: manager, cycle: '2026-11', name: 'Ricky Nassif', status: 'Ready for Review', confirm: true });
  gs.setEvalStatus_({ session: manager, cycle: '2026-11', name: 'Ricky Nassif', status: 'Approved', confirm: true });
  const fileBytes = Buffer.from(Object.values(files)[0]!.bytes);
  const reopened = plain(gs.setEvalStatus_({ session: admin, cycle: '2026-11', name: 'Ricky Nassif', status: 'Reopen', confirm: true }));
  const ricky = reopened.evaluations.find((e: any) => e.name === 'Ricky Nassif');
  assert.deepEqual([ricky.status, ricky.revision, ricky.frozen], ['Draft', 2, false]);
  assert.equal(reopened.archive.filter((entry: any) => entry.kind === 'approved evaluation').length, 1);
  assert.ok(Buffer.from(Object.values(files)[0]!.bytes).equals(fileBytes), 'the revision 1 file is unchanged');
});

test('the Excel workbook has one worksheet per associate, both logos, print areas and page breaks', () => {
  const tabs = store();
  record(tabs, '2026-08', 'Ricky Nassif', fullMonth({ fabric: 0.6 }));
  const { gs } = boot(tabs, '2026-11-03');
  gs.prepareDueEvaluations_('2026-11-03');
  const all = plain(gs.evalWorkbook_({ session: manager, cycle: '2026-11' }));
  assert.equal(all.fileName, 'Store17_Sales_Evaluations_November_2026.xlsx');
  const parts = unzipEntries(Buffer.from(all.base64, 'base64'));
  const workbook = new TextDecoder().decode(parts['xl/workbook.xml']);
  const names = [...workbook.matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(names, ['Renzo Del Solar', 'Prakash Gandhi', 'Eric Montes Rodriguez', 'Ricky Nassif', 'Brenda Sanchez']);
  assert.equal([...workbook.matchAll(/_xlnm\.Print_Area/g)].length, 5);
  assert.match(workbook, /<definedName name="_xlnm.Print_Area" localSheetId="3">'Ricky Nassif'!\$A\$1:\$G\$\d+<\/definedName>/);
  assert.deepEqual(Buffer.from(parts['xl/media/kanes.jpeg']!), readFileSync(new URL('../public/kanes-furniture-logo.jpg', import.meta.url)), 'the real Kane\'s logo, unchanged');
  assert.deepEqual(Buffer.from(parts['xl/media/store17.png']!), readFileSync(new URL('../public/store17-logo.png', import.meta.url)), 'the real Store 17 emblem, unchanged');
  for (let n = 1; n <= 5; n += 1) {
    const sheet = new TextDecoder().decode(parts[`xl/worksheets/sheet${n}.xml`]);
    assert.match(sheet, /<rowBreaks count="1" manualBreakCount="1"><brk id="\d+"/);
    assert.match(sheet, /<pageSetup paperSize="1" orientation="portrait" fitToWidth="1" fitToHeight="0"\/>/);
    assert.match(sheet, /<drawing r:id="rId1"\/>/);
    const drawing = new TextDecoder().decode(parts[`xl/drawings/drawing${n}.xml`]);
    assert.equal([...drawing.matchAll(/<xdr:pic>/g)].length, 4, 'both logos on page 1 and page 2');
    for (const text of ['August 2026', 'September 2026', 'October 2026', 'Aug 1–31, 2026', 'Sep 1–30, 2026', 'Oct 1–31, 2026', 'Focus metric #1 action plan', 'Focus metric #2 action plan', 'Salesperson signature', 'Manager signature', 'OVERALL PERFORMANCE COMMENTS', 'RECOGNITION']) assert.ok(sheet.includes(text), `${n}: ${text}`);
  }
  const one = plain(gs.evalWorkbook_({ session: manager, cycle: '2026-11', names: ['Ricky Nassif'] }));
  assert.equal(one.fileName, 'Store17_Sales_Evaluations_November_2026_Ricky_Nassif.xlsx');
  const single = new TextDecoder().decode(unzipEntries(Buffer.from(one.base64, 'base64'))['xl/workbook.xml']);
  assert.deepEqual([...single.matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1]), ['Ricky Nassif']);
});

/** A workbook in the established evaluation layout, built for the test: four associates, a template and a hidden list. */
function octoberWorkbook(gs: Record<string, (...args: any[]) => any>, blankVolumeGoalFor = '') {
  const styles = new (gs.XlsxStyles_ as any)();
  const labels = ['Sales Volume ', 'Average Sale', 'Mattress % of Total Sales', 'Adustable Base Attachment (MPPA)', 'Pillows (MPPA)', 'Mattress Protector Attachment (MPPA)', 'Overall Warranty % of Total Sales', 'Fabric Protection Attachment % (FABW)', 'Power Upholstery Attachment % (PWAR)', 'Power Adj Base Attachment % (PWAR)', 'Leather Protection Attachment % (LTHW)', 'Wood Kits (UVWL)', 'Finance % of Total Sales', 'Rugs (RUGSD)'];
  const goals: (number | string)[] = [80000, 2500, 0.2, 0.35, 0.65, 0.8, 0.055, 0.85, 0.85, 0.5, 0.8, 0.5, 0.5, '12 per Month'];
  const people = [['Renzo', 'Renzo Del Solar', 41000], ['Prakash', 'Prakash Gandhi', 61000], ['Eric', 'Eric Montes Rodriguez', 52000], ['Ricky', 'Ricky Nassif', 38000]] as const;
  const sheets = people.map(([sheetName, full, base], p) => {
    const sheet = new (gs.XlsxSheet_ as any)(sheetName, styles);
    sheet.set(1, 3, '3 Month Performance and Coaching Evaluation');
    sheet.set(5, 1, 'Salesperson:'); sheet.set(5, 2, full); sheet.set(5, 3, 'Date:'); sheet.set(5, 5, 'Store #'); sheet.set(5, 6, '17 - OBT');
    sheet.set(6, 1, 'Use WDSRR Based on Delivered (unless specified)');
    sheet.set(7, 1, 'Sales Metrics'); sheet.set(7, 3, 'GOALS'); sheet.set(7, 4, 'July'); sheet.set(7, 5, 'August'); sheet.set(7, 6, 'September');
    labels.forEach((label, i) => {
      sheet.set(8 + i, 1, label);
      sheet.set(8 + i, 3, i === 0 && sheetName === blankVolumeGoalFor ? '$' : goals[i]);
      [0, 1, 2].forEach((m) => {
        if (i === 6 && m === 0) { sheet.set(8 + i, 4 + m, '%'); return; }
        const value = i === 0 ? base + m * 1000 + p : i === 1 ? 2000 + m * 100 : i === 13 ? 3 + m : Math.round((0.4 + 0.1 * m + 0.01 * i) * 1000) / 1000;
        sheet.set(8 + i, 4 + m, value);
      });
    });
    sheet.set(22, 1, 'Focus Metric #1 '); sheet.set(22, 2, 'Fabric Protection'); sheet.set(22, 4, 'Focus Metric #2 '); sheet.set(22, 5, 'Avg Ticket');
    sheet.set(23, 1, 'Prior Month '); sheet.set(23, 2, 0.6); sheet.set(23, 4, 'Prior Month'); sheet.set(23, 5, 2200);
    sheet.set(24, 1, 'Goal End of Month'); sheet.set(24, 2, 0.85); sheet.set(24, 4, 'Goal End of Month'); sheet.set(24, 5, 2500);
    sheet.set(25, 1, 'Focus Metric #1 Action Plan'); sheet.set(25, 4, 'Focus Metric #2 Action Plan');
    sheet.set(26, 1, `${sheetName}: offer fabric protection on every upholstered piece.`); sheet.set(26, 4, `${sheetName}: present the whole room.`);
    sheet.set(35, 1, 'Sales Consultant Spotlight:\nPerformance Highlights, Anniversaries, Rankings, Improvement Shout Out');
    sheet.set(36, 1, `${sheetName} led the store in leather protection.`);
    sheet.set(42, 1, 'Associate Signature:'); sheet.set(44, 1, 'Managers’ Signature:'); sheet.set(46, 1, 'Manager’s Name (Print):'); sheet.set(46, 3, 'Kelly Meyers');
    return sheet;
  });
  const template = new (gs.XlsxSheet_ as any)('Template Under 90', styles);
  template.set(1, 3, 'New Hire Coaching Evaluation\n3 Month Performance'); template.set(7, 1, 'Sales Metrics'); template.set(7, 3, 'GOALS'); template.set(7, 4, 'April');
  template.set(8, 1, 'Sales Volume '); template.set(8, 3, '$'); template.set(8, 4, '$');
  return Buffer.from(gs.xlsxWorkbook_([...sheets, template], [], 'October evaluations') as Uint8Array);
}

test('the historical October workbook is archived unchanged, read by label, and its evaluations stay available', () => {
  const tabs = store();
  const { gs, files } = boot(tabs, '2026-10-16');
  const bytes = octoberWorkbook(gs);
  const base64 = bytes.toString('base64');
  const preview = plain(gs.importEvalWorkbook_({ session: admin, cycle: '2026-10', fileName: 'Store17_Sales_Evaluations_October(1).xlsx', base64 }));
  assert.equal(preview.confirmed, false);
  assert.deepEqual(preview.preview.sheets.map((s: any) => [s.sheet, s.name, s.onRoster, s.metrics, s.values, s.missing]), [
    ['Renzo', 'Renzo Del Solar', true, 14, 41, 1], ['Prakash', 'Prakash Gandhi', true, 14, 41, 1], ['Eric', 'Eric Montes Rodriguez', true, 14, 41, 1], ['Ricky', 'Ricky Nassif', true, 14, 41, 1],
  ]);
  assert.deepEqual(preview.preview.covers, ['July 2026 (2026-07-01 to 2026-07-31)', 'August 2026 (2026-08-01 to 2026-08-31)', 'September 2026 (2026-09-01 to 2026-09-30)']);
  assert.ok(preview.preview.warnings.some((w: string) => /Template Under 90" is a blank template/.test(w)));
  assert.equal(Object.keys(files).length, 0, 'nothing is archived before confirmation');

  const done = plain(gs.importEvalWorkbook_({ session: admin, cycle: '2026-10', fileName: 'Store17_Sales_Evaluations_October(1).xlsx', base64, confirm: true }));
  assert.equal(done.confirmed, true);
  const original = Object.values(files)[0]!;
  assert.equal(original.name, 'Store17_Sales_Evaluations_October(1).xlsx');
  assert.ok(Buffer.from(original.bytes).equals(bytes), 'the original workbook is stored byte for byte');
  assert.equal(done.evaluations.length, 4, 'all four associate worksheets are kept');
  const ricky = done.evaluations.find((e: any) => e.name === 'Ricky Nassif');
  assert.deepEqual([ricky.status, ricky.frozen, ricky.givenOn], ['Approved', true, ''], 'historical evaluations are not marked given');
  assert.deepEqual(ricky.months.map((m: any) => m.label), ['July 2026', 'August 2026', 'September 2026']);
  assert.deepEqual(ricky.metrics[0].values.map((v: any) => v.value), [38003, 39003, 40003]);
  assert.equal(ricky.metrics.find((m: any) => m.key === 'fabric').goal, 0.85, 'the goals printed in the historical workbook are kept');
  assert.equal(ricky.metrics.find((m: any) => m.key === 'warranty').values[0].status, 'Not Available', 'a placeholder is a missing period, not a number');
  assert.equal(ricky.focus[0].plan, 'Ricky: offer fabric protection on every upholstered piece.');
  assert.equal(ricky.recognition, 'Ricky led the store in leather protection.');
  assert.equal(ricky.managerName, 'Kelly Meyers');
  const sourceRow = tabs.CC_EvalMetrics!.find((row) => row[1] === 'Ricky Nassif' && row[3] === 'volume' && row[0] === '2026-07')!;
  assert.match(String(sourceRow[11]), /Ricky!D8$/, 'each value keeps its sheet and cell');
  assert.throws(() => gs.importEvalWorkbook_({ session: admin, cycle: '2026-10', fileName: 'again.xlsx', base64, confirm: true }), /already archived/);

  const roster = plain(gs.evals_({ session: manager, cycle: '2026-10' }));
  assert.ok(roster.archive.some((entry: any) => entry.kind === 'historical original'));
  const historyBefore = JSON.stringify(tabs.CC_EvalMetrics) + JSON.stringify(tabs.CC_Evaluations);
  gs.saveAssociate_({ session: admin, action: 'status', name: 'Eric Montes Rodriguez', confirm: true, record: { status: 'Terminated', effectiveDate: '2026-10-16' } });
  gs.saveAssociate_({ session: admin, action: 'hire', confirm: true, record: { fullName: 'Maria Lopez', hireDate: '2026-10-16' } });
  assert.equal(JSON.stringify(tabs.CC_EvalMetrics) + JSON.stringify(tabs.CC_Evaluations), historyBefore, 'roster changes leave evaluation history untouched');
  const afterRoster = plain(gs.evals_({ session: manager, cycle: '2026-10' }));
  assert.deepEqual(afterRoster.evaluations.map((e: any) => e.name), ['Renzo Del Solar', 'Prakash Gandhi', 'Eric Montes Rodriguez', 'Ricky Nassif'], 'a terminated associate keeps the historical evaluation');
  assert.equal(afterRoster.evaluations.find((e: any) => e.name === 'Eric Montes Rodriguez').metrics[0].values[0].value, 52002);

  const november = plain(gs.evals_({ session: manager, cycle: '2026-11' }));
  assert.ok(!november.evaluations.some((e: any) => e.name === 'Eric Montes Rodriguez'), 'the terminated associate is not in the next cycle');
  assert.ok(november.evaluations.some((e: any) => e.name === 'Maria Lopez'), 'the new hire is');
  const next = november.evaluations.find((e: any) => e.name === 'Ricky Nassif');
  assert.deepEqual(next.metrics[0].values.map((v: any) => v.status), ['Verified', 'Verified', 'Pending Verification'], 'August and September carry over from the workbook');
  assert.equal(next.volumeGoal, 80000, 'the volume goal ladder carries forward from the approved October evaluation');
});

test('a volume goal left blank in the historical workbook stays blank, not the configured goal', () => {
  const tabs = store();
  const { gs } = boot(tabs, '2026-10-16');
  const base64 = octoberWorkbook(gs, 'Renzo').toString('base64');
  const done = plain(gs.importEvalWorkbook_({ session: admin, cycle: '2026-10', fileName: 'October.xlsx', base64, confirm: true }));
  const renzo = done.evaluations.find((e: any) => e.name === 'Renzo Del Solar');
  assert.equal(renzo.volumeGoal, null);
  assert.equal(renzo.metrics[0].goalText, 'Manager sets');
  assert.equal(done.evaluations.find((e: any) => e.name === 'Ricky Nassif').volumeGoal, 80000);
});

test('only managers and admins see evaluations; only an admin uploads a historical workbook', () => {
  const code = readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');
  for (const role of ['sales', 'manager', 'admin']) {
    const { gs } = boot(store(), '2026-10-16');
    vm.runInContext(code, gs as vm.Context);
    vm.runInContext(`requireSession_ = function () { return { role: '${role}' }; };`, gs as vm.Context);
    if (role === 'sales') assert.throws(() => gs.dispatch('evals', { token: 't' }), /not available for this login/);
    else assert.equal(plain(gs.dispatch('evals', { token: 't' })).cycle, '2026-11');
    if (role !== 'admin') assert.throws(() => gs.dispatch('importEvalWorkbook', { token: 't', cycle: '2026-10', fileName: 'x.xlsx', base64: '' }), /not available for this login/);
  }
});

const REFERENCE = '/tmp/handoff/REFERENCE_ONLY_NOT_FOR_GIT/Sales_Evaluation_Reference.xlsx';
test('the label reader reads the company evaluation workbook the format came from', { skip: !existsSync(REFERENCE) && 'reference workbook not on this machine' }, () => {
  const { gs } = boot(store(), '2026-10-16');
  const files: Record<string, string> = {};
  for (const [name, bytes] of Object.entries(unzipEntries(readFileSync(REFERENCE)))) if (/\.xml$|\.rels$/.test(name)) files[name] = new TextDecoder().decode(bytes);
  const sheets = plain(gs.xlsxCells_(files));
  assert.deepEqual(sheets.filter((s: any) => !s.hidden).map((s: any) => s.name), ['Mitch', 'Dennis', 'Brad', 'HEXAN', 'Windy', 'Bernard', 'Nzingha', 'Template Under 90']);
  const mitch = plain(gs.parseEvalSheet_(sheets[0]));
  assert.equal(mitch.name, 'Mitch');
  assert.deepEqual(mitch.months.map((m: any) => m.text), ['February', 'March', 'April']);
  assert.equal(mitch.metrics.length, 14);
  assert.deepEqual(mitch.metrics[0].values.map((v: any) => v.value), [52846, 30389, 24513]);
  assert.equal(mitch.metrics[0].goal, 95000);
  assert.deepEqual(mitch.metrics.map((m: any) => m.key), METRIC_KEYS);
  assert.deepEqual(mitch.focus.map((f: any) => [f.metric, f.prior, f.goal]), [['Avg Ticket', 1226, 2500], ['Rugs', 4, 12]]);
});
