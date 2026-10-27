import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateRetirement, buildLifeLedger, buildDividendTax, normalizePlan } from './retirement.js';

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
    feeRate: 0,
    withdrawalStrategy: 'fixed_real',
    dividendTax: false,
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
const holdings = { 'VTI.US': 60, '2800.HK': 40 };

test('dividend tax off leaves balances and ledger columns unchanged', () => {
  const off = simulateRetirement(plan(), returns);
  const spec = { monthlyRate: 0.02 };
  const stillOff = simulateRetirement(plan(), returns, null, spec);
  assert.deepEqual(stillOff, off);
  assert.equal(off.dividendSpend, null);
  assert.equal(buildDividendTax(holdings, plan()), null);
  const ledger = buildLifeLedger(plan(), returns, null, null, spec);
  assert.equal('tax_paid' in ledger.rows[0], false);
  assert.equal(normalizePlan({ dividendYields: 'vti:2' }).dividendYields.VTI, 2);
});

test('dividend tax uses an explicit yield and domicile rate, then records tax_paid', () => {
  const onPlan = plan({
    dividendTax: true,
    dividendYields: { US: 60, HK: 0 },
    dividendTaxRates: { US: 100, HK: 0 }
  });
  const spec = buildDividendTax(holdings, onPlan);
  assert.ok(spec.monthlyRate > 0);
  const on = simulateRetirement(onPlan, returns, null, spec);
  const again = simulateRetirement(onPlan, returns, null, spec);
  assert.deepEqual(on.dividendSpend, again.dividendSpend);
  assert.ok(on.dividendSpend.withTax < on.dividendSpend.withoutTax);
  assert.ok(on.endBalance.p50 <= simulateRetirement(plan(), returns).endBalance.p50);
  const ledger = buildLifeLedger(onPlan, returns, null, null, spec);
  assert.ok(ledger.rows.some(row => row.tax_paid > 0));
  assert.equal(buildDividendTax({ VTI: 100 }, plan({
    dividendTax: true,
    dividendYields: { US: 2 },
    dividendTaxRates: { US: 30 }
  })), null);
});
