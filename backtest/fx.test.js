import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateRetirement, buildLifeLedger, buildFx, HKD_USD_PEG } from './retirement.js';

function plan(over = {}) {
  return {
    currency: 'HKD',
    currentAge: 40,
    retireAge: 41,
    endAge: 43,
    currentSavings: 10000,
    monthlyContribution: 0,
    annualSpending: 120,
    otherIncome: 0,
    otherIncomeAge: 65,
    inflationMode: 'fixed',
    inflationRate: 0,
    feeRate: 0,
    withdrawalStrategy: 'fixed_real',
    fxMode: false,
    ...over
  };
}

function flatReturns(n) {
  return Array.from({ length: n }, (_, i) => ({
    month: `${2000 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`,
    r: 0
  }));
}

const returns = flatReturns(36);

test('fx off does not convert and does not emit fx_rate_used', () => {
  const off = simulateRetirement(plan(), returns);
  const spec = buildFx(plan({ fxMode: true, spendingBasket: 'HKD:100' }));
  const still = simulateRetirement(plan(), returns, null, null, null, spec);
  assert.deepEqual(still, off);
  assert.equal(off.fxSpend, null);
  assert.equal(off.fxStatus, null);
  assert.equal('fx_rate_used' in buildLifeLedger(plan(), returns, null, null, null, spec).rows[0], false);
  assert.equal(buildFx(plan()), null);
});

test('HKD uses the peg label and leaves spending unchanged', () => {
  const onPlan = plan({ fxMode: true, spendingBasket: 'HKD:100' });
  const fx = buildFx(onPlan);
  assert.equal(fx.peg, HKD_USD_PEG);
  assert.equal(fx.twd, null);
  const on = simulateRetirement(onPlan, returns, null, null, null, fx);
  const off = simulateRetirement(plan(), returns);
  assert.equal(on.fxSpend.withFx, on.fxSpend.withoutFx);
  assert.equal(on.endBalance.p50, off.endBalance.p50);
  const ledger = buildLifeLedger(onPlan, returns, null, null, null, fx);
  assert.equal(ledger.rows.find(row => row.k >= 12).fx_rate_used, HKD_USD_PEG);
  assert.deepEqual(on.fxSpend, simulateRetirement(onPlan, returns, null, null, null, fx).fxSpend);
});

test('TWD needs its own series and does not reuse the HKD peg', () => {
  const bare = plan({ fxMode: true, currency: 'TWD', spendingBasket: 'TWD:100' });
  assert.equal(buildFx(bare).skipped, 'twd');
  const skipped = simulateRetirement(bare, returns, null, null, null, buildFx(bare));
  assert.equal(skipped.fxSpend, null);
  assert.equal(skipped.endBalance.p50, simulateRetirement(plan({ currency: 'TWD' }), returns).endBalance.p50);
  assert.equal('fx_rate_used' in buildLifeLedger(bare, returns).rows[0], false);

  const lines = returns.map((row, i) => `${row.month},${30 + i}`).join('\n');
  const onPlan = plan({ fxMode: true, currency: 'TWD', spendingBasket: 'TWD:100', fxSeries: lines });
  const fx = buildFx(onPlan);
  const on = simulateRetirement(onPlan, returns, null, null, null, fx);
  assert.ok(on.fxSpend.withFx > on.fxSpend.withoutFx);
  const used = buildLifeLedger(onPlan, returns, null, null, null, fx).rows.find(row => row.k >= 12).fx_rate_used;
  assert.notEqual(used, HKD_USD_PEG);
  assert.ok(used >= 30);
});
