import assert from 'node:assert/strict';
import test from 'node:test';
import { HISTORY_HEADERS, historyRow } from './history.ts';
import { SCOPE_VIEWS, auditFormula, scopeOf, viewFormula } from './scopeViews.ts';

function balanced(formula: string): boolean {
  let depth = 0;
  for (const character of formula.replace(/"(?:[^"]|"")*"/g, '')) {
    if (character === '(') depth += 1;
    if (character === ')') depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

test('every STORE and PERSON tab formula filters CC_Ledger by its own view and scope', () => {
  assert.equal(SCOPE_VIEWS.length, 30);
  for (const view of SCOPE_VIEWS) {
    const formula = viewFormula(view);
    assert.ok(balanced(formula), `${view} parentheses`);
    assert.ok(formula.includes(`CC_Ledger!$A$2:$A="${view}"`), `${view} filters its own rows`);
    assert.ok(formula.includes(`LAMBDA(x,"${scopeOf(view)}")`), `${view} labels its scope`);
    assert.doesNotMatch(formula, /QUERY\(/);
  }
  assert.match(viewFormula('NWDSR_WRITTEN_PERSON'), /No salesperson report on file for NWDSR_WRITTEN_PERSON\. Pending\. Store figures are not copied here\./);
  assert.throws(() => viewFormula('CC_Kpi'), /no STORE or PERSON scope/);
});

test('the audit formula reads CC_Ledger, CC_Closing and CC_Kpi and never writes to them', () => {
  const formula = auditFormula();
  assert.ok(balanced(formula));
  for (const tab of ['CC_Ledger!$A$2:$R', 'CC_Closing!$A$2:$M', 'CC_Kpi!$A$2:$G']) assert.ok(formula.includes(tab), tab);
  assert.ok(formula.length < 50_000, 'within the Sheets formula length limit');
});

test('a CC_History row keeps the whole replaced row', () => {
  const row = historyRow({ at: '2026-10-16T12:00:00.000Z', tab: 'CC_Ledger', key: 'k', replacedBy: 'new.xlsx', previous: ['BEDDING_STORE', 'daily', 100] });
  assert.equal(row.length, HISTORY_HEADERS.length);
  assert.deepEqual(row.slice(0, 5), ['2026-10-16T12:00:00.000Z', 'CC_Ledger', 'k', 'Corrected report replaced this row.', 'new.xlsx']);
  assert.deepEqual(JSON.parse(String(row[5])), ['BEDDING_STORE', 'daily', 100]);
});
