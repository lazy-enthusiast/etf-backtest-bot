import test from 'node:test';
import assert from 'node:assert/strict';
import { effectiveSampleNote, simulateRetirement } from './retirement.js';

function plan(over = {}) {
  return {
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
    withdrawalStrategy: 'fixed_real',
    ...over
  };
}

function returns(n = 48) {
  return Array.from({ length: n }, (_, i) => ({
    month: `${2000 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`,
    r: 0.002
  }));
}

test('overlapping-sample note uses the run length, not a fixed count', () => {
  const sim = simulateRetirement(plan(), returns(48));
  const note = effectiveSampleNote(sim.history, { successRate: sim.successRate });
  assert.equal(note.includes('549'), false);
  assert.ok(note.startsWith(`${sim.history.starts} 個起始月高度重疊，有效獨立樣本估計約 `));
  assert.ok(note.includes(String(Math.round((sim.history.months / 60) * 10) / 10)));
  assert.equal(sim.successRate, 1);
  assert.ok(note.endsWith('。資訊量有限'));
});

test('a shortfall omits the limited-information note and bootstrap uses the block length', () => {
  const sim = simulateRetirement(plan({ annualSpending: 20000 }), returns(48));
  const note = effectiveSampleNote(sim.history, { successRate: sim.successRate });
  assert.ok(sim.successRate < 1);
  assert.equal(note.includes('資訊量有限'), false);
  const boot = effectiveSampleNote(
    { starts: 36, months: 36 },
    { pathMode: 'bootstrap', bootstrapBlock: 12, successRate: 1 }
  );
  assert.ok(boot.includes('估計約 3'));
  assert.ok(boot.endsWith('。資訊量有限'));
});
