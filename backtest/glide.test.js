import test from 'node:test';
import assert from 'node:assert/strict';
import { runBacktest } from './engine.js';
import { realMonthlyReturns, simulateRetirement, buildLifeLedger, buildGlide, normalizePlan } from './retirement.js';

function points(rets) {
  let v = 100;
  const out = [];
  for (let i = 0; i <= rets.length; i++) {
    const y = 2000 + Math.floor(i / 12);
    const m = (i % 12) + 1;
    out.push([`${y}-${String(m).padStart(2, '0')}-28`, v]);
    if (i < rets.length) v *= 1 + rets[i];
  }
  return out;
}

function plan(over = {}) {
  return {
    currency: 'HKD',
    currentAge: 40,
    retireAge: 41,
    endAge: 43,
    currentSavings: 1200,
    monthlyContribution: 0,
    annualSpending: 120,
    otherIncome: 0,
    otherIncomeAge: 65,
    inflationMode: 'fixed',
    inflationRate: 0,
    feeRate: 0,
    withdrawalStrategy: 'fixed_real',
    glidePath: false,
    equityTickers: [],
    glideEquityEnd: null,
    ...over
  };
}

const eqR = Array.from({ length: 40 }, () => 0.01);
const restR = Array.from({ length: 40 }, () => 0);
const data = {
  'AAA.US': { series: points(eqR) },
  'BBB.US': { series: points(restR) }
};

test('glide off matches the single blended series, including when sleeves are passed', () => {
  const result = runBacktest({ holdings: { 'AAA.US': 60, 'BBB.US': 40 }, rebalance: 'monthly' }, {}, data);
  const p = plan();
  const { returns } = realMonthlyReturns(result.equityMonthly, p);
  assert.equal(returns.length, 40);
  for (const row of returns) assert.ok(Math.abs(row.r - 0.006) < 1e-12);
  const sleeves = buildGlide(result.assetMonthly, { 'AAA.US': 60, 'BBB.US': 40 }, { ...p, glidePath: true, equityTickers: ['AAA.US'], glideEquityEnd: 60 });
  const off = simulateRetirement(p, returns);
  const offWithSleeves = simulateRetirement(p, returns, sleeves);
  assert.equal(off.glide, null);
  assert.deepEqual(offWithSleeves, off);
  assert.equal(buildGlide(result.assetMonthly, { 'AAA.US': 60, 'BBB.US': 40 }, p), null);
  const ledger = buildLifeLedger(p, returns);
  assert.equal('equity_weight_actual' in ledger.rows[0], false);
});

test('constant glide weight uses the same month index and matches monthly rebalance', () => {
  const result = runBacktest({ holdings: { 'AAA.US': 60, 'BBB.US': 40 }, rebalance: 'monthly' }, {}, data);
  const p = plan({ glidePath: true, equityTickers: ['AAA.US'], glideEquityEnd: 60 });
  const { returns } = realMonthlyReturns(result.equityMonthly, p);
  const sleeves = buildGlide(result.assetMonthly, { 'AAA.US': 60, 'BBB.US': 40 }, p);
  for (let i = 0; i < returns.length; i++) {
    const blended = (1 + 0.6 * sleeves.equityR[i] + 0.4 * sleeves.restR[i]) * sleeves.feeFactor / sleeves.inflation[i] - 1;
    assert.ok(Math.abs(blended - returns[i].r) < 1e-12);
  }
  const a = simulateRetirement(p, returns, sleeves);
  const b = simulateRetirement(p, returns, sleeves);
  assert.deepEqual(a.glide, b.glide);
  assert.ok(Math.abs(a.glide.min - 0.6) < 1e-12);
  assert.ok(Math.abs(a.glide.max - 0.6) < 1e-12);
  assert.ok(Math.abs(a.endBalance.p50 - simulateRetirement(plan(), returns).endBalance.p50) < 1e-6);
});

test('a changing glide keeps the historical index and records equity_weight_actual', () => {
  const result = runBacktest({ holdings: { 'AAA.US': 60, 'BBB.US': 40 }, rebalance: 'monthly' }, {}, data);
  const p = plan({ glidePath: true, equityTickers: ['AAA.US'], glideEquityEnd: 20 });
  const { returns } = realMonthlyReturns(result.equityMonthly, plan());
  const sleeves = buildGlide(result.assetMonthly, { 'AAA.US': 60, 'BBB.US': 40 }, p);
  const sim = simulateRetirement(p, returns, sleeves);
  const ledger = buildLifeLedger(p, returns, null, sleeves);
  const first = ledger.rows.find(row => row.k === 0);
  const last = ledger.rows.filter(row => row.start_month === first.start_month).at(-1);
  assert.ok(Math.abs(first.equity_weight_actual - 0.6) < 1e-12);
  assert.ok(Math.abs(last.equity_weight_actual - 0.2) < 1e-12);
  assert.equal(first.return_month, returns[0].month);
  assert.equal(last.return_month, returns[last.k].month);
  assert.ok(sim.glide.min < sim.glide.max);
  assert.notEqual(sim.endBalance.p50, simulateRetirement(plan(), returns).endBalance.p50);
  assert.equal(normalizePlan({ equityTickers: 'vti' }).equityTickers[0], 'VTI');
});
