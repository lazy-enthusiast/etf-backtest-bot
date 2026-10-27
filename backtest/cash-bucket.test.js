import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePlan, simulateRetirement } from './retirement.js';

function plan(over = {}) {
  return {
    currency: 'HKD',
    currentAge: 60,
    retireAge: 60,
    endAge: 63,
    currentSavings: 5000,
    monthlyContribution: 0,
    annualSpending: 8000,
    otherIncome: 0,
    otherIncomeAge: 65,
    inflationMode: 'fixed',
    inflationRate: 0,
    feeRate: 0,
    withdrawalStrategy: 'fixed_real',
    ...over
  };
}

function returns() {
  return Array.from({ length: 36 }, (_, i) => ({
    month: `${2010 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`,
    r: -0.03
  }));
}

function sleeve(n) {
  return {
    equityR: Float64Array.from({ length: n }, () => -0.03),
    restR: Float64Array.from({ length: n }, () => 0),
    inflation: Float64Array.from({ length: n }, () => 1),
    feeFactor: 1
  };
}

test('an unset cash bucket leaves success and spending unchanged', () => {
  assert.equal(normalizePlan({}).cashBucketYears, null);
  assert.equal(normalizePlan({ cashBucketYears: true }).cashBucketYears, 3);
  const series = returns();
  const plain = simulateRetirement(plan(), series);
  const passed = simulateRetirement(plan(), series, null, null, null, null, null, sleeve(series.length));
  assert.equal(plain.cashCompare, undefined);
  assert.equal(passed.cashCompare, undefined);
  assert.equal(passed.successRate, plain.successRate);
  assert.deepEqual(passed.sustainableSpending, plain.sustainableSpending);
});

test('a crash year pays spending from the bucket and reports both minimums', () => {
  const series = returns();
  const on = simulateRetirement(plan({ cashBucketYears: 1 }), series, null, null, null, null, null, sleeve(series.length));
  assert.equal(on.cashCompare.label, '概念建議');
  assert.ok(on.cashCompare.after < on.cashCompare.before);
  assert.equal(on.successRate, simulateRetirement(plan(), series).successRate);
  assert.deepEqual(on.sustainableSpending, simulateRetirement(plan(), series).sustainableSpending);
});
