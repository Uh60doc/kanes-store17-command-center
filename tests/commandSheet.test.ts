import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { deliveredTier } from '../src/dashboard/thermometer.ts';
import { formatFigure } from '../src/dashboard/model.ts';
import { loadCommandSheet } from '../src/import/commandSheet.ts';
import { currentSnapshots, resetSnapshots } from '../src/import/snapshotStore.ts';

const OCTOBER = `Store 17 Command Center,"October 2–11, 2026",Provisional
Metric,Value,Notes
SNAP Written MTD,85532,"Printed October 11, 2026 at 3:10 PM"
NWDSR Delivered MTD,78727,"Printed October 11, 2026 at 3:11 PM"
NWDSR Written,93740,"Official written figure, printed 3:10 PM"
Bedding percent,0.216,"Written bedding report, 21.6%"
SNAP versus last year,Not Available,No 2025 day-by-day SNAP baseline
Projected month-end written,Not Available,No store operating-day calendar
Closing ratio,Not Available,PERQ is missing
Written goal,400000,Management goal
Written remaining,314468,"Toward $400,000"
Delivered goal,320000,Management goal
Delivered remaining,241273,"Toward $320,000"
Corporate stretch written,652274,Separate from management goals
Corporate stretch delivered,564373,Separate from management goals
Renzo written,-1339,Store period October 2–11
Renzo delivered,27360,Store period October 2–11
Prakash written,39842,Store period October 2–11
Prakash delivered,10228,Store period October 2–11
Tarik written,14009,Store period October 2–11
Tarik delivered,30234,Store period October 2–11
Eric written,31794,Store period October 2–11
Eric delivered,6043,Store period October 2–11
`;

function load(csv: string, importedAt = '2026-10-13T12:00:00.000Z') {
  const result = loadCommandSheet(csv, importedAt);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('expected a sheet');
  return result.view;
}

describe('command center sheet', () => {
  beforeEach(() => resetSnapshots());

  it('maps the October headlines and leaves missing cells blank', () => {
    const view = load(OCTOBER);
    assert.equal(view.periodStart, '2026-10-02');
    assert.equal(view.periodEnd, '2026-10-11');
    assert.equal(view.provisional, true);
    assert.equal(formatFigure(view.model.snapWritten), '$85,532');
    assert.equal(view.model.snapWritten.kind === 'value' && view.model.snapWritten.value, 85532);
    assert.equal(formatFigure(view.model.nwdsrDelivered), '$78,727');
    assert.equal(view.model.nwdsrDelivered.kind === 'value' && view.model.nwdsrDelivered.value, 78727);
    assert.equal(formatFigure(view.model.nwdsrWritten), '$93,740');
    assert.equal(view.model.nwdsrWritten.kind === 'value' && view.model.nwdsrWritten.value, 93740);
    assert.equal(view.model.beddingPercentage.kind === 'value' && view.model.beddingPercentage.value, 0.216);
    assert.equal(formatFigure(view.model.beddingPercentage), '21.6%');
    assert.equal(formatFigure(view.model.snapYearOverYear), 'Not Available');
    assert.equal(formatFigure(view.model.projectedWritten), 'Not Available');
    assert.equal(formatFigure(view.model.closingRatio), 'Not Available');
    assert.equal(formatFigure(view.model.storeAttachment), 'Awaiting Report');
    assert.equal(formatFigure(view.model.writtenRemaining), '$314,468');
    assert.equal(formatFigure(view.model.deliveredRemaining), '$241,273');
    assert.equal(formatFigure(view.model.writtenProgress), '21.4%');
    assert.equal(formatFigure(view.model.deliveredProgress), '24.6%');
    assert.equal(formatFigure(view.model.writtenRequiredDailyAverage), 'Not Available');
    assert.deepEqual(view.model.dailySales, []);
  });

  it('keeps the six cards and does not invent history for Brenda or Caroline', () => {
    const view = load(OCTOBER);
    assert.deepEqual(
      view.scorecards.map((card) => card.name),
      [
        'Renzo Del Solar',
        'Prakash Gandhi',
        'Eric Montes Rodriguez',
        'Tarik Nassif',
        'Brenda Sanchez',
        'Caroline Amaro',
      ],
    );
    const renzo = view.scorecards[0];
    assert.equal(formatFigure(renzo.written), '-$1,339');
    assert.equal(formatFigure(renzo.delivered), '$27,360');
    assert.equal(formatFigure(renzo.bedding), 'Awaiting Report');
    assert.equal(formatFigure(renzo.rugs), 'Awaiting Report');
    const tarik = view.scorecards.find((card) => card.id === 'tarik');
    assert.equal(tarik?.knownAs, 'Ricky');
    assert.equal(formatFigure(tarik?.written ?? { kind: 'missing', label: 'Awaiting Report' }), '$14,009');
    for (const id of ['brenda', 'caroline']) {
      const card = view.scorecards.find((item) => item.id === id);
      assert.equal(card?.written.kind, 'missing');
      assert.equal(card?.delivered.kind, 'missing');
      assert.equal(formatFigure(card?.written ?? { kind: 'value', value: 0, unit: 'dollars' }), 'Awaiting Report');
    }
    assert.equal(
      view.scorecards.some((card) => card.name.includes('Cordell') || card.name.includes('Kelly') || card.name.includes('Elizabeth')),
      false,
    );
    assert.equal(formatFigure(view.management.find((person) => person.id === 'cordell')?.written ?? { kind: 'value', value: 1, unit: 'dollars' }), 'Awaiting Report');
  });

  it('replaces the same date range and does not add a second period on top', () => {
    load(OCTOBER, '2026-10-13T12:00:00.000Z');
    const replaced = OCTOBER.replace('SNAP Written MTD,85532', 'SNAP Written MTD,90000');
    const view = load(replaced, '2026-10-13T13:00:00.000Z');
    assert.equal(view.model.snapWritten.kind === 'value' && view.model.snapWritten.value, 90000);
    const currentWritten = currentSnapshots().filter((item) => item.reportType === 'SNAP Written');
    assert.equal(currentWritten.length, 1);
    assert.equal(currentWritten[0]?.metrics.writtenSales, 90000);
    assert.notEqual(currentWritten[0]?.metrics.writtenSales, 85532 + 90000);

    const nextPeriod = `Store 17 Command Center,"November 2–8, 2026",Provisional
Metric,Value,Notes
SNAP Written MTD,1000,Next period
`;
    const november = load(nextPeriod, '2026-11-08T12:00:00.000Z');
    assert.equal(november.model.snapWritten.kind === 'value' && november.model.snapWritten.value, 1000);
    assert.equal(november.model.nwdsrDelivered.kind, 'missing');
    const stillCurrent = currentSnapshots().filter((item) => item.reportType === 'SNAP Written');
    assert.equal(stillCurrent.length, 2);
    const summed = stillCurrent.reduce((total, item) => total + (item.metrics.writtenSales ?? 0), 0);
    assert.equal(summed, 91000);
    assert.notEqual(november.model.snapWritten.kind === 'value' && november.model.snapWritten.value, summed);
  });

  it('keeps a reported zero and refuses a missing cell', () => {
    const csv = `Store 17 Command Center,"October 2–11, 2026",Provisional
Metric,Value,Notes
SNAP Written MTD,85532,first
SNAP Written MTD,Not Available,later row replaces and is not zero
Brenda written,0,Reported zero
Cordell written,500,Management
Valentina written,10,Inactive
`;
    const view = load(csv);
    assert.equal(formatFigure(view.model.snapWritten), 'Awaiting Report');
    assert.equal(view.model.snapWritten.kind === 'value' && view.model.snapWritten.value, false);
    const brenda = view.scorecards.find((card) => card.id === 'brenda');
    assert.equal(brenda?.written.kind === 'value' && brenda.written.value, 0);
    assert.equal(view.scorecards.some((card) => card.id === 'cordell' || card.name === 'Valentina'), false);
    const cordell = view.management.find((person) => person.id === 'cordell');
    assert.ok(cordell);
    assert.equal(cordell.written.kind === 'value' ? cordell.written.value : null, 500);
    assert.equal(view.otherActivity[0]?.name, 'Valentina');
    assert.equal(view.otherActivity[0]?.written.kind === 'value' && view.otherActivity[0].written.value, 10);
    assert.equal(currentSnapshots().some((item) => item.reportType === 'SNAP Written'), false);
  });

  it('does not store a sheet that has no period', () => {
    const result = loadCommandSheet('Metric,Value,Notes\nSNAP Written MTD,1,x\n', '2026-10-13T12:00:00.000Z');
    assert.deepEqual(result, { ok: false, reason: 'missing-period' });
    assert.equal(currentSnapshots().length, 0);
  });
});

describe('delivered thermometer', () => {
  it('uses the approved tiers', () => {
    assert.equal(deliveredTier(59_999).tone, 'red');
    assert.equal(deliveredTier(59_999).nextGoal, 60_000);
    assert.equal(deliveredTier(60_000).tone, 'orange');
    assert.equal(deliveredTier(74_999).tone, 'orange');
    assert.equal(deliveredTier(75_000).tone, 'yellow');
    assert.equal(deliveredTier(94_999).tone, 'yellow');
    assert.equal(deliveredTier(95_000).tone, 'lime');
    assert.equal(deliveredTier(114_999).tone, 'lime');
    assert.equal(deliveredTier(115_000).tone, 'dark-green');
    assert.equal(deliveredTier(115_000).nextGoal, null);
  });
});
