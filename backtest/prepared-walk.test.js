import test from 'node:test';
import assert from 'node:assert/strict';
import {
  annualTaxDrag,
  buildDividendTax,
  buildPathYears,
  composeDrags,
  prepareRetirement,
  runPrepared,
  simulateRetirement
} from './retirement.js';
import { highlightLines } from '../js/narrate.js';

function plan(over = {}) {
  return {
    currency: 'HKD',
    currentAge: 60,
    retireAge: 60,
    endAge: 63,
    currentSavings: 100000,
    monthlyContribution: 0,
    annualSpending: 4000,
    otherIncome: 0,
    otherIncomeAge: 65,
    inflationMode: 'fixed',
    inflationRate: 0,
    feeRate: 0,
    withdrawalStrategy: 'fixed_real',
    ...over
  };
}

function prices(n = 40) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    const month = `${2010 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
    rows.push([`${month}-28`, 100]);
  }
  return rows;
}

function flatReturns(n = 36) {
  return Array.from({ length: n }, (_, i) => ({
    month: `${2010 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`,
    r: 0
  }));
}

test('a prepared walk matches the plain simulator when every option is off', () => {
  const holdings = { 'VTI.US': 60, 'IEF.US': 40 };
  const prepared = prepareRetirement({
    plan: plan(),
    holdings,
    equityMonthly: prices(),
    assetMonthly: []
  });
  const viaPrepare = runPrepared(prepared);
  const direct = simulateRetirement(prepared.plan, prepared.returns);
  assert.equal(viaPrepare.successRate, direct.successRate);
  assert.deepEqual(viaPrepare.sustainableSpending, direct.sustainableSpending);
  assert.equal(prepared.dividend, null);
  assert.equal(prepared.taxDrag, null);
  assert.equal(prepared.cashSleeve, null);
});

test('plan dividend yields fill only holdings that have no tax of their own', () => {
  const holdings = { 'VTI.US': 50, 'IEF.US': 50 };
  const holdingTax = { 'VTI.US': { taxDomicile: 'IE', dividendYield: 2 } };
  const on = plan({
    dividendTax: true,
    dividendYields: { 'VTI.US': 2, 'IEF.US': 2 },
    dividendTaxRates: { 'VTI.US': 30, 'IEF.US': 30 }
  });
  const both = composeDrags(holdings, holdingTax, on);
  const dividendOnly = buildDividendTax(holdings, on);
  assert.equal(both.taxDrag.fraction, annualTaxDrag(holdings, holdingTax).fraction);
  assert.equal(both.dividend.monthlyRate, dividendOnly.monthlyRate / 2);
  const covered = composeDrags(holdings, {
    'VTI.US': { taxDomicile: 'IE', dividendYield: 2 },
    'IEF.US': { taxDomicile: 'US', dividendYield: 2 }
  }, on);
  assert.equal(covered.dividend, null);
});

test('the opened year table can use the same cash sleeve as the comparison', () => {
  const series = flatReturns();
  const p = plan({ cashBucketYears: 1, annualSpending: 8000, currentSavings: 5000 });
  const sleeve = {
    equityR: Float64Array.from({ length: series.length }, () => -0.2),
    restR: Float64Array.from({ length: series.length }, () => 0),
    inflation: Float64Array.from({ length: series.length }, () => 1),
    feeFactor: 1
  };
  const sim = simulateRetirement(p, series, null, null, null, null, null, sleeve);
  const primary = buildPathYears(p, series, sim.spendingBrief.worstStart);
  const withCash = buildPathYears(p, series, sim.spendingBrief.worstStart, null, null, null, null, { bucket: sleeve });
  assert.notDeepEqual(primary.map(y => y.withdrawal), withCash.map(y => y.withdrawal));
  const said = highlightLines(sim, p, {
    pct: x => String(x),
    money: x => String(Math.round(x))
  });
  assert.match(said.cash, /現金桶/);
});
