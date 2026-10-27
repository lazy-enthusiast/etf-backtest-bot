import test from 'node:test';
import assert from 'node:assert/strict';
import { inflationLabel, realMonthlyReturns } from './retirement.js';

test('inflation label names CPI or the fixed rate and only the fallback count', () => {
  assert.equal(inflationLabel({ inflationMode: 'fixed', inflationRate: 2.5 }, 4), '通膨：固定 2.5%');
  assert.equal(inflationLabel({ inflationMode: 'cpi', inflationRate: 2.5 }, 0), '通膨：CPI');
  assert.equal(inflationLabel({ inflationMode: 'cpi', inflationRate: 2.5 }, 3), '通膨：CPI，缺 3 個月');
  assert.equal(inflationLabel({ inflationMode: 'cpi' }, 3).includes('2000'), false);
});

test('missing CPI months still fall back without a per-month flag', () => {
  const equity = [['2000-01-31', 100], ['2000-02-28', 101], ['2000-03-31', 102]];
  const { returns, cpiFallbackMonths } = realMonthlyReturns(equity, { inflationMode: 'cpi', inflationRate: 2.5, feeRate: 0 }, [['2000-01-31', 100]]);
  assert.equal(cpiFallbackMonths, 2);
  assert.equal(returns.length, 2);
  assert.equal('cpiFallback' in returns[0], false);
});
