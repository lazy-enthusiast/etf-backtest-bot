import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePlan, simulateRetirement, parseLumpSums, parseIncomeSegments } from './retirement.js';

function plan(over = {}) {
  return {
    currency: 'HKD',
    currentAge: 60,
    retireAge: 61,
    endAge: 64,
    currentSavings: 20000,
    monthlyContribution: 0,
    annualSpending: 1000,
    otherIncome: 1200,
    otherIncomeAge: 62,
    inflationMode: 'fixed',
    inflationRate: 0,
    feeRate: 0,
    withdrawalStrategy: 'fixed_real',
    ...over
  };
}

function returns() {
  return Array.from({ length: 48 }, (_, i) => ({
    month: `${2000 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`,
    r: 0
  }));
}

test('old other income still matches when the new lists are absent', () => {
  const series = returns();
  const plain = simulateRetirement(plan(), series);
  const empty = simulateRetirement(plan({ lumpSums: [], otherIncomeSegments: [], compareBootstrap: false }), series);
  assert.equal(plain.successRate, empty.successRate);
  assert.deepEqual(plain.sustainableSpending, empty.sustainableSpending);
  assert.equal(plain.endBalance.p50, empty.endBalance.p50);
  assert.equal(plain.bootstrapCompare, undefined);
  assert.deepEqual(parseLumpSums('70:200000, 80:50000'), [
    { age: 70, amount: 200000 },
    { age: 80, amount: 50000 }
  ]);
  assert.equal(parseIncomeSegments('60-65:120000, 65-:80000')[1].toAge, null);
});

test('a lump sum lowers the balance and a segment adds to the old income', () => {
  const series = returns();
  const base = simulateRetirement(plan(), series);
  const withLump = simulateRetirement(plan({ lumpSums: [{ age: 61, amount: 5000 }] }), series);
  assert.ok(withLump.endBalance.p50 < base.endBalance.p50);
  const withSegment = simulateRetirement(plan({
    otherIncomeSegments: [{ fromAge: 62, toAge: 64, amount: 600 }]
  }), series);
  assert.ok(withSegment.endBalance.p50 > base.endBalance.p50);
  assert.equal(normalizePlan({ otherIncome: 1200, otherIncomeAge: 62 }).otherIncome, 1200);
});

test('dual engine keeps the historical success rate and can label a small gap robust', () => {
  const series = returns();
  const plain = simulateRetirement(plan(), series);
  const both = simulateRetirement(plan({ compareBootstrap: true }), series);
  assert.equal(both.successRate, plain.successRate);
  assert.equal(both.bootstrapCompare.historical, plain.successRate);
  assert.equal(both.bootstrapCompare.robust, Math.abs(both.bootstrapCompare.historical - both.bootstrapCompare.bootstrap) <= 0.05);
  assert.equal(both.bootstrapCompare.robust, true);
});
