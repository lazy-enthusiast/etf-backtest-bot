import test from 'node:test';
import assert from 'node:assert/strict';
import { fxStressAmounts, simulateRetirement } from './retirement.js';

test('FX stress lines scale spendable amount and do not change the simulation', () => {
  const stress = fxStressAmounts(1000);
  assert.equal(stress.down10, 900);
  assert.equal(stress.down20, 800);
  assert.equal(fxStressAmounts(null), null);
  const plan = {
    currency: 'HKD',
    currentAge: 60,
    retireAge: 61,
    endAge: 63,
    currentSavings: 5000,
    monthlyContribution: 0,
    annualSpending: 600,
    otherIncome: 0,
    otherIncomeAge: 65,
    inflationMode: 'fixed',
    inflationRate: 0,
    feeRate: 0,
    withdrawalStrategy: 'fixed_real'
  };
  const returns = Array.from({ length: 36 }, (_, i) => ({
    month: `${2000 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`,
    r: 0
  }));
  const a = simulateRetirement(plan, returns);
  const b = simulateRetirement(plan, returns);
  assert.equal(a.successRate, b.successRate);
  assert.equal(fxStressAmounts(a.sustainableSpending.p95).down10, a.sustainableSpending.p95 * 0.9);
});
