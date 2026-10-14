import assert from 'node:assert/strict';
import test from 'node:test';
import { payrollPeriod, storeOperatingPeriod } from '../config/periods.ts';
import { buildPerqPanel, validateReference, type VerifiedPerqReference } from './perqReference.ts';

const reference: VerifiedPerqReference = {
  snapshots: [
    {
      id: 'window',
      periodStart: '2026-10-02',
      periodEnd: '2026-10-31',
      opportunities: 10,
      lines: [
        { sourceName: 'Eric Montes', opportunities: 6 },
        { sourceName: 'Ricky Nassif', opportunities: 4 },
      ],
      additions: [],
    },
    {
      id: 'month',
      periodStart: '2026-10-01',
      periodEnd: '2026-10-31',
      opportunities: 12,
      lines: [],
      additions: [{ sourceName: 'Ricky Nassif', date: '2026-10-01', opportunities: 2 }],
    },
  ],
};

test('a cumulative PERQ window reconciles with the wider calendar month', () => {
  assert.deepEqual(validateReference(reference), []);
  const panel = buildPerqPanel(
    reference,
    [],
    { start: storeOperatingPeriod.start, end: storeOperatingPeriod.end },
    { start: payrollPeriod.start, end: payrollPeriod.end },
    { periodStart: '2026-10-02', periodEnd: '2026-10-11' },
  );
  assert.equal(panel.loaded, true);
  assert.equal(panel.windows[0]?.opportunities, 10);
  assert.equal(panel.windows[1]?.opportunities, 12);
  assert.equal(panel.windows[0]?.opportunities !== panel.windows[1]?.opportunities, true);
  const ricky = panel.windows[1]?.lines.find((line) => line.displayName === 'Ricky Nassif');
  assert.equal(ricky?.opportunities, 6);
  assert.match(panel.flags.join(' '), /November 1, 2026/);
  assert.match(panel.flags.join(' '), /October 11, 2026/);
});

test('an addition inside the narrower snapshot is rejected', () => {
  const overlap: VerifiedPerqReference = {
    snapshots: [
      {
        id: 'window',
        periodStart: '2026-10-02',
        periodEnd: '2026-10-31',
        opportunities: 10,
        lines: [{ sourceName: 'Eric Montes', opportunities: 10 }],
        additions: [],
      },
      {
        id: 'month',
        periodStart: '2026-10-01',
        periodEnd: '2026-10-31',
        opportunities: 12,
        lines: [],
        additions: [{ sourceName: 'Eric Montes', date: '2026-10-02', opportunities: 2 }],
      },
    ],
  };
  assert.equal(validateReference(overlap).length > 0, true);
});

test('lines that do not add up to the snapshot total are rejected', () => {
  const broken: VerifiedPerqReference = {
    snapshots: [
      {
        id: 'window',
        periodStart: '2026-10-02',
        periodEnd: '2026-10-31',
        opportunities: 10,
        lines: [{ sourceName: 'Eric Montes', opportunities: 9 }],
        additions: [],
      },
    ],
  };
  assert.match(validateReference(broken).join(' '), /sum to 9/);
});
