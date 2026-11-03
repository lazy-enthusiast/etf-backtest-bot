import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampReshuffleBlock,
  drawReshuffleIndices,
  normalizePlan,
  simulateRetirement,
  RESHUFFLE_PATHS
} from './retirement.js';
import { overviewNotes, reshuffleSummary } from '../js/narrate.js';

function plan(over = {}) {
  return {
    currency: 'HKD',
    currentAge: 40,
    retireAge: 41,
    endAge: 43,
    currentSavings: 1000,
    monthlyContribution: 0,
    annualSpending: 100,
    otherIncome: 0,
    otherIncomeAge: 65,
    inflationMode: 'fixed',
    inflationRate: 0,
    feeRate: 0,
    withdrawalStrategy: 'fixed_real',
    pathMode: 'historical',
    ...over
  };
}

function returns(n, crashAt = 12) {
  return Array.from({ length: n }, (_, i) => ({
    month: `${2000 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`,
    r: i >= crashAt && i < crashAt + 6 ? -0.08 : 0.01
  }));
}

test('reshuffle block length is 6–60 and does not share the legacy bootstrap knob', () => {
  assert.equal(clampReshuffleBlock(undefined), 12);
  assert.equal(clampReshuffleBlock(4), 6);
  assert.equal(clampReshuffleBlock(6), 6);
  assert.equal(clampReshuffleBlock(60), 60);
  assert.equal(clampReshuffleBlock(80), 60);
  const p = normalizePlan({ reshuffleBlock: 4, bootstrapBlock: 6 });
  assert.equal(p.reshuffleBlock, 6);
  assert.equal(p.bootstrapBlock, 6);
  assert.equal(normalizePlan({}).reshuffleBlock, 12);
  assert.equal(normalizePlan({}).reshuffleSeed, 1);
});

test('a block is a real stretch of months and does not wrap inside the block', () => {
  const idx = drawReshuffleIndices(120, 12, 1, 36);
  for (let b = 0; b < idx.length; b += 12) {
    const slice = idx.slice(b, b + 12);
    for (let i = 1; i < slice.length; i++) assert.equal(slice[i], slice[0] + i);
    assert.ok(slice[0] >= 0);
    assert.ok(slice.at(-1) < 120);
  }
  assert.notDeepEqual(drawReshuffleIndices(120, 12, 1, 24), drawReshuffleIndices(120, 12, 2, 24));
  assert.notDeepEqual(drawReshuffleIndices(120, 12, 1, 24), drawReshuffleIndices(120, 24, 1, 24));
});

test('history under 10 years does not report a reshuffle percentage', () => {
  const sim = simulateRetirement(plan(), returns(119));
  assert.equal(sim.monteCarlo.suppressed, '歷史短於 10 年，不報重排比例');
  assert.equal(sim.monteCarlo.solventRate, null);
  assert.equal(sim.monteCarlo.sustainableSpending, null);
  assert.equal(typeof sim.successRate, 'number');
});

test('reshuffle sits beside the historical success rate and does not overwrite spend fields', () => {
  const series = returns(120);
  const a = simulateRetirement(plan({ reshuffleSeed: 1, reshuffleBlock: 12 }), series);
  const b = simulateRetirement(plan({ reshuffleSeed: 1, reshuffleBlock: 12 }), series);
  const otherBlock = simulateRetirement(plan({ reshuffleSeed: 1, reshuffleBlock: 24 }), series);
  const legacy = simulateRetirement(plan({ pathMode: 'bootstrap', bootstrapBlock: 6, bootstrapSeed: 3 }), series);
  assert.equal(a.monteCarlo.paths, RESHUFFLE_PATHS);
  assert.equal(a.monteCarlo.blockMonths, 12);
  assert.equal(a.monteCarlo.seed, 1);
  assert.equal(a.monteCarlo.intraBlockWrap, false);
  assert.equal(a.monteCarlo.jointMonth, true);
  assert.equal(a.monteCarlo.solventRate, b.monteCarlo.solventRate);
  assert.deepEqual(a.monteCarlo.sustainableSpending, b.monteCarlo.sustainableSpending);
  assert.equal(typeof a.monteCarlo.sustainableSpending.p10, 'number');
  assert.equal(typeof a.monteCarlo.sustainableSpending.p50, 'number');
  assert.equal(a.successRate, otherBlock.successRate);
  assert.deepEqual(a.sustainableSpending, otherBlock.sustainableSpending);
  assert.notEqual(a.monteCarlo.blockMonths, otherBlock.monteCarlo.blockMonths);
  assert.equal(legacy.history.method, 'bootstrap');
  assert.equal(legacy.plan.bootstrapBlock, 6);
  assert.equal(legacy.plan.reshuffleBlock, 12);
  assert.equal(typeof legacy.successRate, 'number');
  assert.notEqual(legacy.monteCarlo.blockMonths, legacy.plan.bootstrapBlock);
});

test('overview copy states the peg and US CPI, and reshuffle copy stays out of the success rate', () => {
  const notes = overviewNotes({
    result: {
      account: { note: '計劃以港元計價。美元價格已按 1 美元 = 7.8 港元換算。' },
      warnings: ['2800.HK：價格指數，不含股息，報酬被低估']
    },
    sim: { history: { method: 'rolling' } },
    plan: { inflationMode: 'cpi', currency: 'HKD' }
  });
  const joined = notes.join('\n');
  assert.match(joined, /7\.8/);
  assert.match(joined, /美國 CPI/);
  assert.match(joined, /價格指數/);
  const text = reshuffleSummary({
    suppressed: null,
    blockMonths: 12,
    seed: 1,
    paths: 1000,
    solventRate: 0.61,
    label: '同一段歷史的區塊重排，不是未來機率',
    ruinAge: null,
    sustainableSpending: { p10: 100000, p50: 200000 }
  });
  assert.match(text, /6–60/);
  assert.match(text, /不是未來機率/);
  assert.match(text, /不取代歷史可花金額/);
  assert.doesNotMatch(text, /歷史成功率/);
});
