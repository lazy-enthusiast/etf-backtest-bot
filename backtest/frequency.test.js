import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateRetirement, buildLifeLedger } from './retirement.js';

function plan(over = {}) {
  return {
    currency: 'HKD',
    currentAge: 40,
    retireAge: 41,
    endAge: 43,
    currentSavings: 100000,
    monthlyContribution: 0,
    annualSpending: 1200,
    otherIncome: 0,
    otherIncomeAge: 65,
    inflationMode: 'fixed',
    inflationRate: 0,
    feeRate: 0,
    withdrawalStrategy: 'fixed_real',
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

test('monthly withdrawal and annual guardrail checks match the previous defaults', () => {
  const plain = simulateRetirement(plan(), returns);
  const explicit = simulateRetirement(plan({ withdrawEvery: 1, guardrailEvery: 12 }), returns);
  assert.deepEqual(explicit.endBalance, plain.endBalance);
  assert.deepEqual(explicit.spendingBrief, plain.spendingBrief);
  assert.deepEqual(
    buildLifeLedger(plan({ withdrawEvery: 1, guardrailEvery: 12 }), returns).rows.map(row => row.withdrawal),
    buildLifeLedger(plan(), returns).rows.map(row => row.withdrawal)
  );
});

test('a longer withdrawal gap pays the same annual amount in fewer months', () => {
  const annual = buildLifeLedger(plan({ withdrawEvery: 12 }), returns);
  const monthly = buildLifeLedger(plan(), returns);
  const sum = rows => rows.reduce((total, row) => total + row.withdrawal, 0);
  const one = start => annual.rows.filter(row => row.start_month === start);
  const path = one(annual.rows[0].start_month);
  assert.equal(sum(path), sum(monthly.rows.filter(row => row.start_month === path[0].start_month)));
  assert.equal(path.find(row => row.k === 13).withdrawal, 0);
  assert.equal(path.find(row => row.k === 12).withdrawal, 1200);
});

test('checking guardrails every month can cut sooner than the yearly default', () => {
  const base = plan({
    currentSavings: 2000,
    annualSpending: 600,
    withdrawalStrategy: 'guardrails'
  });
  const yearly = simulateRetirement(base, returns);
  const monthly = simulateRetirement({ ...base, guardrailEvery: 1 }, returns);
  assert.ok(monthly.spendingBrief.guardrail.largest >= yearly.spendingBrief.guardrail.largest);
  assert.notEqual(monthly.endBalance.p50, yearly.endBalance.p50);
});
