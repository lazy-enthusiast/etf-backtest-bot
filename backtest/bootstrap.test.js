import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateRetirement, buildLifeLedger } from './retirement.js';

function plan(over = {}) {
  return {
    currency: 'HKD',
    currentAge: 40,
    retireAge: 41,
    endAge: 43,
    currentSavings: 1200,
    monthlyContribution: 0,
    annualSpending: 120,
    otherIncome: 0,
    otherIncomeAge: 65,
    inflationMode: 'fixed',
    inflationRate: 0,
    feeRate: 0,
    withdrawalStrategy: 'fixed_real',
    pathMode: 'historical',
    ...over
  };
}

function returns() {
  return Array.from({ length: 36 }, (_, i) => ({
    month: `${2000 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`,
    r: ((i % 5) - 2) / 100
  }));
}

test('historical mode ignores bootstrap settings and keeps the same paths', () => {
  const series = returns();
  const base = simulateRetirement(plan(), series);
  const withSeed = simulateRetirement(plan({ bootstrapSeed: 99, bootstrapBlock: 6 }), series);
  assert.deepEqual(withSeed.endBalance, base.endBalance);
  assert.deepEqual(withSeed.history, base.history);
  assert.deepEqual(withSeed.spendingBrief, base.spendingBrief);
  assert.deepEqual(buildLifeLedger(plan({ bootstrapSeed: 99, bootstrapBlock: 6 }), series).rows, buildLifeLedger(plan(), series).rows);
  assert.equal(base.history.method === 'bootstrap', false);
});

test('bootstrap is seeded, repeatable, and uses contiguous blocks', () => {
  const series = returns();
  const on = plan({ pathMode: 'bootstrap', bootstrapSeed: 7, bootstrapBlock: 6 });
  const a = simulateRetirement(on, series);
  const b = simulateRetirement(on, series);
  assert.deepEqual(a.endBalance, b.endBalance);
  assert.deepEqual(a.spendingBrief, b.spendingBrief);
  assert.equal(a.history.method, 'bootstrap');
  const other = simulateRetirement(plan({ pathMode: 'bootstrap', bootstrapSeed: 8, bootstrapBlock: 6 }), series);
  assert.notEqual(other.endBalance.p50, a.endBalance.p50);
  const ledger = buildLifeLedger(on, series);
  const path = ledger.rows.filter(row => row.start_month === ledger.rows[0].start_month);
  const firstBlock = path.slice(0, 6).map(row => row.return_month);
  const start = series.findIndex(row => row.month === firstBlock[0]);
  for (let i = 0; i < 6; i++) assert.equal(firstBlock[i], series[(start + i) % series.length].month);
});
