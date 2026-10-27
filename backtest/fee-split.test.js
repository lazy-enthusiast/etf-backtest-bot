import test from 'node:test';
import assert from 'node:assert/strict';
import { realMonthlyReturns, simulateRetirement, buildLifeLedger } from './retirement.js';

function curve(n) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const y = 2000 + Math.floor(i / 12);
    const m = (i % 12) + 1;
    out.push([`${y}-${String(m).padStart(2, '0')}-28`, 100]);
  }
  return out;
}

function plan(over = {}) {
  return {
    currency: 'HKD',
    currentAge: 40,
    retireAge: 41,
    endAge: 43,
    currentSavings: 200,
    monthlyContribution: 0,
    annualSpending: 1200,
    otherIncome: 0,
    otherIncomeAge: 65,
    inflationMode: 'fixed',
    inflationRate: 0,
    feeRate: 0.2,
    withdrawalStrategy: 'fixed_real',
    feeSplit: false,
    ter: 0,
    turnover: 0,
    turnoverCost: 0,
    fxSpread: 0,
    ...over
  };
}

test('fee split off keeps the single feeRate factor and hides cost columns', () => {
  const equity = curve(36);
  const off = realMonthlyReturns(equity, plan());
  const untouched = realMonthlyReturns(equity, plan({ ter: 5, turnover: 100, turnoverCost: 1, fxSpread: 1 }));
  assert.deepEqual(untouched.returns, off.returns);
  const sim = simulateRetirement(plan(), off.returns);
  assert.equal(sim.feeSpend, null);
  assert.equal('ter_cost' in buildLifeLedger(plan(), off.returns).rows[0], false);
  assert.equal('fx_spread' in buildLifeLedger(plan(), off.returns).rows[0], false);
});

test('an equivalent TER replaces feeRate, and a higher split changes funded spending', () => {
  const equity = curve(36);
  const off = realMonthlyReturns(equity, plan());
  const same = realMonthlyReturns(equity, plan({ feeSplit: true, ter: 0.2 }));
  assert.deepEqual(same.returns.map(row => row.r), off.returns.map(row => row.r));
  const matched = simulateRetirement(plan({ feeSplit: true, ter: 0.2 }), same.returns, null, null, off.returns);
  assert.ok(Math.abs(matched.feeSpend.withSplit - matched.feeSpend.withoutSplit) < 1e-6);
  const ledger = buildLifeLedger(plan({ feeSplit: true, ter: 0.2, turnover: 50, turnoverCost: 1, fxSpread: 0.1 }), same.returns);
  assert.ok(ledger.rows[0].ter_cost > 0);
  assert.ok(ledger.rows[0].turnover_cost > 0);
  assert.ok(ledger.rows[0].fx_spread > 0);
  const heavyReturns = realMonthlyReturns(equity, plan({ feeSplit: true, ter: 20 }));
  const heavy = simulateRetirement(plan({ feeSplit: true, ter: 20 }), heavyReturns.returns, null, null, off.returns);
  assert.ok(heavy.feeSpend.withSplit < heavy.feeSpend.withoutSplit);
  assert.deepEqual(heavy.feeSpend, simulateRetirement(plan({ feeSplit: true, ter: 20 }), heavyReturns.returns, null, null, off.returns).feeSpend);
});
