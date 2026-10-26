import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateRetirement, buildLifeLedger } from './retirement.js';

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
    feeRate: 0.2,
    withdrawalStrategy: 'fixed_real',
    guardrailCeiling: 6,
    guardrailFloor: 3,
    guardrailAdjustPct: 10,
    ...over
  };
}

function flatReturns(n, r = 0) {
  return Array.from({ length: n }, (_, i) => ({
    month: `${2000 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`,
    r
  }));
}

function percentile(sorted, q) {
  const idx = (sorted.length - 1) * q / 100;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function csvOf(rows) {
  const keys = ['start_month', 'k', 'return_month', 'circular', 'contribution', 'other_income', 'withdrawal', 'real_return', 'balance_after_flows', 'balance_end', 'depleted'];
  const lines = [keys.join(',')];
  for (const row of rows) lines.push(keys.map(k => row[k]).join(','));
  return lines.join('\n');
}

function sumsFromCsv(text) {
  const [head, ...body] = text.trim().split('\n');
  const cols = head.split(',');
  const w = cols.indexOf('withdrawal');
  const start = cols.indexOf('start_month');
  const by = new Map();
  for (const line of body) {
    const cells = line.split(',');
    by.set(cells[start], (by.get(cells[start]) || 0) + Number(cells[w]));
  }
  return [...by.values()];
}

test('two runs match and ledger columns are only what the loop computes', () => {
  const p = plan();
  const returns = flatReturns(36, 0.001);
  const a = simulateRetirement(p, returns);
  const b = simulateRetirement(p, returns);
  assert.deepEqual(a, b);
  const ledger = buildLifeLedger(p, returns);
  assert.deepEqual(buildLifeLedger(p, returns), ledger);
  const keys = Object.keys(ledger.rows[0]);
  assert.deepEqual(keys, [
    'start_month', 'k', 'return_month', 'circular', 'contribution', 'other_income',
    'withdrawal', 'real_return', 'balance_after_flows', 'balance_end', 'depleted'
  ]);
  assert.equal('tax_paid' in ledger.rows[0], false);
  assert.equal('fx_rate_used' in ledger.rows[0], false);
  assert.equal('equity_weight_actual' in ledger.rows[0], false);
});

test('zero-return path end balance matches the month loop', () => {
  const p = plan({ feeRate: 0 });
  const sim = simulateRetirement(p, flatReturns(36, 0));
  assert.equal(sim.history.starts, 1);
  assert.equal(sim.endBalance.p50, 960);
  assert.equal(sim.balanceAtRetire.p50, 1200);
  assert.equal(sim.successRate, 1);
  assert.equal(sim.spendingBrief.tightest.spending, 120);
  assert.equal(sim.spendingBrief.tightest.age, 41);
  assert.equal(sim.spendingBrief.meanAbsGapRatio, 0);
  assert.equal(sim.spendingBrief.guardrail, null);
});

test('csv withdrawal sums match published percentiles and year-end bands', () => {
  const p = plan({ currentSavings: 5000, annualSpending: 240, endAge: 45, retireAge: 42 });
  const returns = flatReturns(48, 0.002);
  const sim = simulateRetirement(p, returns);
  const ledger = buildLifeLedger(p, returns);
  const sums = sumsFromCsv(csvOf(ledger.rows)).sort((a, b) => a - b);
  const published = sim.cumWithdrawal;
  for (const q of [10, 25, 50, 75, 90]) {
    assert.equal(percentile(sums, q), published[`p${q}`]);
  }
  assert.equal(sums[0], published.min);
  assert.equal(sums[sums.length - 1], published.max);

  const byAge = new Map();
  for (const row of ledger.rows) {
    if ((row.k + 1) % 12 !== 0) continue;
    const age = p.currentAge + (row.k + 1) / 12;
    if (!byAge.has(age)) byAge.set(age, []);
    byAge.get(age).push(row.balance_end);
  }
  for (const band of sim.bands) {
    if (band.age === p.currentAge) continue;
    const values = byAge.get(band.age).slice().sort((a, b) => a - b);
    assert.equal(percentile(values, 50), band.p50);
    assert.equal(values[0], band.min);
    assert.equal(values[values.length - 1], band.max);
  }
});

test('guardrail cuts are summarized from the same loop and default off leaves them empty', () => {
  const returns = flatReturns(36, 0);
  const fixed = simulateRetirement(plan({ annualSpending: 600 }), returns);
  assert.equal(fixed.spendingBrief.guardrail, null);
  const guarded = simulateRetirement(plan({
    annualSpending: 600,
    withdrawalStrategy: 'guardrails'
  }), returns);
  assert.ok(guarded.spendingBrief.guardrail.longest >= 1);
  assert.ok(guarded.spendingBrief.guardrail.largest > 0);
  assert.equal(guarded.successRateFixedReal >= 0, true);
});
