import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePlan, simulateRetirement, spendingFactor, spendingCurveNote } from './retirement.js';

function plan(over = {}) {
  return {
    currency: 'HKD',
    currentAge: 74,
    retireAge: 74,
    endAge: 78,
    currentSavings: 100000,
    monthlyContribution: 0,
    annualSpending: 1000,
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
  return Array.from({ length: 60 }, (_, i) => ({
    month: `${2000 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`,
    r: 0.001
  }));
}

test('flat spending is the default and keeps the published success rate', () => {
  assert.equal(normalizePlan({}).spendingCurve, 'flat');
  assert.equal(spendingFactor('flat', 80), 1);
  assert.equal(spendingFactor('declining', 75), 1);
  assert.ok(spendingFactor('declining', 76) < 1);
  const series = returns();
  const base = simulateRetirement(plan(), series);
  const named = simulateRetirement(plan({ spendingCurve: 'flat' }), series);
  assert.equal(base.curveCompare, undefined);
  assert.equal(named.successRate, base.successRate);
  assert.deepEqual(named.sustainableSpending, base.sustainableSpending);
});

test('declining and u-shape sit beside flat instead of replacing it', () => {
  const series = returns();
  const base = simulateRetirement(plan(), series);
  const down = simulateRetirement(plan({ spendingCurve: 'declining' }), series);
  assert.equal(down.successRate, base.successRate);
  assert.equal(down.curveCompare.label, '概念建議');
  assert.equal(down.curveCompare.note, spendingCurveNote('declining'));
  assert.equal(down.curveCompare.flat.successRate, base.successRate);
  assert.ok(down.curveCompare.shaped.worstMinSpend < down.curveCompare.flat.worstMinSpend);
  const u = simulateRetirement(plan({ spendingCurve: 'u_shape' }), series);
  assert.equal(u.curveCompare.note, '65–75 歲每年 −1%，其後每年 +1%（醫療）');
  assert.equal(u.successRate, base.successRate);
  assert.ok(u.curveCompare.shaped.worstMinSpend < u.curveCompare.flat.worstMinSpend);
});
