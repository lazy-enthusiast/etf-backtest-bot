import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateRetirement, buildPathYears, buildLifeLedger, formatPathCsv } from './retirement.js';

function plan(over = {}) {
  return {
    currency: 'HKD',
    currentAge: 60,
    retireAge: 62,
    endAge: 66,
    currentSavings: 8000,
    monthlyContribution: 0,
    annualSpending: 400,
    otherIncome: 0,
    otherIncomeAge: 65,
    inflationMode: 'fixed',
    inflationRate: 0,
    feeRate: 0,
    withdrawalStrategy: 'fixed_real',
    ...over
  };
}

function series() {
  return Array.from({ length: 80 }, (_, i) => ({
    month: `${1998 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`,
    r: i % 9 === 0 ? -0.08 : 0.01
  }));
}

test('worst start opens a year table and csv lists every path', () => {
  const p = plan();
  const returns = series();
  const sim = simulateRetirement(p, returns);
  const worst = sim.spendingBrief.worstStart;
  assert.ok(worst);
  assert.notEqual(worst, '2000-03');
  const row = sim.pathSummaries.find(item => item.start === worst);
  assert.equal(row.lowestWithdrawal, sim.spendingBrief.tightest.spending);
  assert.equal(sim.pathSummaries.length, sim.history.starts);
  const years = buildPathYears(p, returns, worst);
  const i = years.findIndex(y => y.age === sim.spendingBrief.tightest.age);
  assert.ok(i >= 0);
  assert.equal(years[i].guardrail, false);
  assert.ok(Number.isFinite(years[i].yearReturn));
  assert.ok(Number.isFinite(years[i].startBalance));
  assert.ok(Number.isFinite(years[i].endBalance));
  const around = [years[i - 1], years[i], years[i + 1]].filter(Boolean);
  assert.ok(around.length >= 2);
  for (const y of around) assert.ok(Number.isFinite(y.yearReturn));
  const csv = formatPathCsv(sim.pathSummaries);
  assert.equal(csv.split('\n')[0], '起始年月,結束年齡,成功,耗盡年齡,期末資產,最低年提領');
  assert.equal(csv.split('\n').length, sim.pathSummaries.length + 1);
  assert.ok(csv.includes(worst));
  const ledger = buildLifeLedger(p, returns);
  assert.equal('guardrail_hit' in ledger.rows[0], false);
});

test('guardrail hits show on the year that cut spending', () => {
  const returns = series();
  const p = plan({ annualSpending: 3000, withdrawalStrategy: 'guardrails' });
  const sim = simulateRetirement(p, returns);
  const years = buildPathYears(p, returns, sim.spendingBrief.worstStart);
  assert.ok(years.some(y => y.guardrail));
  assert.ok(sim.spendingBrief.guardrail.longest >= 1);
});
