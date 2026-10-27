import test from 'node:test';
import assert from 'node:assert/strict';
import {
  annualTaxDrag,
  compareHoldingTaxSpend,
  domicileTaxRate,
  parseHoldingWeight,
  simulateRetirement
} from './retirement.js';

function plan() {
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
    withdrawalStrategy: 'fixed_real'
  };
}

function returns() {
  return Array.from({ length: 48 }, (_, i) => ({
    month: `${2000 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`,
    r: i % 5 === 0 ? -0.02 : 0.006
  }));
}

function version(symbol, domicile, otherTaxRate) {
  const meta = { taxDomicile: domicile, dividendYield: 2 };
  if (otherTaxRate != null) meta.otherTaxRate = otherTaxRate;
  return {
    name: symbol,
    holdings: { [symbol]: 70, 'AGG.US': 10, 'IGLN.L': 5, 'BIL.US': 15 },
    holdingTax: { [symbol]: meta }
  };
}

test('missing tax fields leave success rate and sustainable spending unchanged', () => {
  const p = plan();
  const series = returns();
  const plain = simulateRetirement(p, series);
  const explicit = simulateRetirement(p, series, null, null, null, null, null);
  assert.equal(plain.successRate, 1);
  assert.equal(plain.sustainableSpending.p50, 2543.5061198594394);
  assert.equal(plain.sustainableSpending.p95, 2518.642127734485);
  assert.equal(plain.sustainableSpending.p100, 2518.642127734485);
  assert.deepEqual(explicit.sustainableSpending, plain.sustainableSpending);
  assert.equal(explicit.successRate, plain.successRate);
  assert.equal(explicit.endBalance.p50, plain.endBalance.p50);
  assert.equal(plain.taxDrag, undefined);
  assert.equal(annualTaxDrag(version('VWRA.L', 'IE').holdings, null), null);
  assert.equal(annualTaxDrag(version('VWRA.L', 'IE').holdings, {}), null);
});

test('IE 15% and US 30% on a 70/10/5/15 mix produce a computed spending gap', () => {
  assert.equal(domicileTaxRate('IE'), 15);
  assert.equal(domicileTaxRate('US'), 30);
  assert.equal(domicileTaxRate('other'), 30);
  assert.equal(domicileTaxRate('OTHER', 10), 10);
  const ie = version('VWRA.L', 'IE');
  const us = version('VT.US', 'US');
  assert.equal(annualTaxDrag(ie.holdings, ie.holdingTax).fraction, 0.7 * 0.02 * 0.15);
  assert.equal(annualTaxDrag(us.holdings, us.holdingTax).fraction, 0.7 * 0.02 * 0.30);
  const other = annualTaxDrag(
    { 'X.HK': 100 },
    { 'X.HK': { taxDomicile: 'other', dividendYield: 2 } }
  );
  assert.equal(other.fraction, 0.02 * 0.30);
  const cmp = compareHoldingTaxSpend(plan(), returns(), [ie, us]);
  assert.equal(cmp.gap, cmp.versions[0].spend - cmp.versions[1].spend);
  assert.ok(cmp.gap > 0);
  assert.ok(cmp.versions[1].spend < cmp.versions[0].spend);
  const taxed = simulateRetirement(plan(), returns(), null, null, null, null, annualTaxDrag(ie.holdings, ie.holdingTax));
  assert.equal(taxed.taxDrag.annual, 0.7 * 0.02 * 0.15);
  assert.equal(taxed.dividendSpend, null);
  assert.ok(taxed.sustainableSpending.p50 < simulateRetirement(plan(), returns()).sustainableSpending.p50);
});

test('holding objects carry optional tax without changing a plain weight', () => {
  assert.deepEqual(parseHoldingWeight(70), { weight: 70, tax: null });
  const parsed = parseHoldingWeight({ weight: 70, taxDomicile: 'ie', dividendYield: '2' });
  assert.equal(parsed.weight, 70);
  assert.equal(parsed.tax.taxDomicile, 'IE');
  assert.equal(parsed.tax.dividendYield, 2);
  const drag = annualTaxDrag({
    'VWRA.L': { weight: 70, taxDomicile: 'IE', dividendYield: 2 },
    'AGG.US': 10,
    'IGLN.L': 5,
    'BIL.US': 15
  });
  assert.equal(drag.fraction, 0.7 * 0.02 * 0.15);
});
