import test from 'node:test';
import assert from 'node:assert/strict';
import { runBacktest } from './engine.js';
import { realMonthlyReturns, simulateRetirement, buildGlide, buildLifeLedger, normalizePlan } from './retirement.js';

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
    equityTickers: ['AAA.US'],
    ...over
  };
}

const data = {
  'AAA.US': { series: points(Array.from({ length: 40 }, () => 0.01)) },
  'BBB.US': { series: points(Array.from({ length: 40 }, () => 0)) }
};
const holdings = { 'AAA.US': 60, 'BBB.US': 40 };

test('a glide object that is off matches today, and the legacy boolean still loads', () => {
  const off = normalizePlan({ glidePath: { enabled: false, stockEnd: 20, bondFloor: 30 } });
  assert.equal(off.glidePath, false);
  assert.equal(off.glideEquityEnd, 20);
  assert.equal(off.glideBondFloor, 30);
  assert.equal(normalizePlan({}).glidePath, false);
  assert.equal(normalizePlan({}).glideStockStart, null);
  const result = runBacktest({ holdings, rebalance: 'monthly' }, {}, data);
  const base = plan();
  const { returns } = realMonthlyReturns(result.equityMonthly, base);
  const plain = simulateRetirement(base, returns);
  assert.equal(plain.glideCompare, undefined);
  const legacy = plan({ glidePath: true, glideEquityEnd: 20 });
  const asObject = plan({ glidePath: { enabled: true, stockEnd: 20 } });
  const sleevesA = buildGlide(result.assetMonthly, holdings, legacy);
  const sleevesB = buildGlide(result.assetMonthly, holdings, asObject);
  const a = simulateRetirement(legacy, returns, sleevesA);
  const b = simulateRetirement(asObject, returns, sleevesB);
  assert.equal(a.endBalance.p50, b.endBalance.p50);
  assert.equal(a.successRate, b.successRate);
  assert.equal(b.glideCompare.label, '概念建議，非歷史實證');
  assert.ok(b.glideCompare.flat);
  assert.ok(b.glideCompare.glide);
  assert.notEqual(b.glideCompare.flat.endBalanceP50, b.glideCompare.glide.endBalanceP50);
  assert.equal(b.glideCompare.glide.successRate, b.successRate);
  assert.equal(b.glideCompare.flat.successRate, plain.successRate);
});

test('stock start and bond floor change the equity weight without dropping the flat path', () => {
  const result = runBacktest({ holdings, rebalance: 'monthly' }, {}, data);
  const shaped = plan({
    glidePath: { enabled: true, stockStart: 80, stockEnd: 20, bondFloor: 50 }
  });
  const { returns } = realMonthlyReturns(result.equityMonthly, plan());
  const sleeves = buildGlide(result.assetMonthly, holdings, shaped);
  assert.ok(sleeves.startEquity <= 0.5);
  assert.ok(sleeves.endEquity <= 0.5);
  const sim = simulateRetirement(shaped, returns, sleeves);
  const ledger = buildLifeLedger(shaped, returns, null, sleeves);
  const weights = ledger.rows.filter(row => row.start_month === ledger.rows[0].start_month).map(row => row.equity_weight_actual);
  assert.ok(Math.max(...weights) <= 0.5 + 1e-12);
  assert.ok(sim.glideCompare.flat.worstMinSpend != null);
  assert.ok(sim.glideCompare.glide.worstMinSpend != null);
});
