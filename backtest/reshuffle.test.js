import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampReshuffleBlock,
  drawReshuffleIndices,
  fitReshuffleBlock,
  growthAtMonthIndex,
  normalizePlan,
  simulateRetirement,
  RESHUFFLE_PATHS
} from './retirement.js';
import { HKD_PEG_NOTE } from './engine.js';
import { overviewNotes, reshuffleParts } from '../js/narrate.js';

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
      account: { note: HKD_PEG_NOTE },
      warnings: ['2800.HK：價格指數，不含股息，報酬被低估']
    },
    sim: { history: { method: 'rolling' } },
    plan: { inflationMode: 'cpi', currency: 'HKD' }
  });
  const joined = notes.join('\n');
  assert.match(joined, /7\.8 港元/);
  assert.match(joined, /外國當地的物價/);
  assert.doesNotMatch(joined, /7\.75/);
  assert.match(joined, /美國物價/);
  assert.match(joined, /不含派息/);
  const parts = reshuffleParts({
    suppressed: null,
    blockMonths: 12,
    seed: 1,
    paths: 1000,
    historyMonths: 120,
    blockStarts: 109,
    nonOverlappingBlocks: 10,
    fewBlocks: false,
    solventRate: 0.61,
    label: '重排後達成比例',
    ruinAge: null,
    sustainableSpending: { p10: 100000, p50: 200000 }
  }, { priceIndex: true });
  const text = `${parts.headline}\n${parts.spend}\n${parts.notes}`;
  assert.match(parts.headline, /重排後達成比例為 61%/);
  assert.match(parts.headline, /能讓錢用到計劃結束/);
  assert.match(parts.headline, /不是預測/);
  assert.match(parts.headline, /與概況裡的歷史可花金額不是同一回事/);
  assert.match(parts.headline, /共模擬 1000 次，每段 12 個月；隨機種子 1/);
  assert.match(parts.spend, /這不是概況裡的歷史可花金額/);
  assert.match(parts.spend, /約十次模擬中有一次/);
  assert.match(parts.spend, /中間值/);
  assert.match(parts.notes, /上下動一點/);
  assert.match(parts.notes, /港股會顯得比較保守/);
  assert.doesNotMatch(text, /機率|勝率/);
  assert.doesNotMatch(text, /區塊拔靴/);
  const legacy = reshuffleParts({
    suppressed: null,
    blockMonths: 12,
    seed: 1,
    paths: 1000,
    solventRate: 0.61,
    sustainableSpending: { p10: 1, p50: 2 }
  }, { legacyOn: true });
  assert.match(legacy.notes, /你已開啟「區塊拔靴」，其數字與這裡不能直接比較/);
});

test('block length is capped by history and a short tape is marked as few blocks', () => {
  const wide = fitReshuffleBlock(12, 120);
  assert.equal(wide.block, 12);
  assert.equal(wide.nonOverlapping, 10);
  assert.equal(wide.few, false);
  const tight = fitReshuffleBlock(60, 120);
  assert.equal(tight.block, 60);
  assert.equal(tight.nonOverlapping, 2);
  assert.equal(tight.few, true);
  assert.equal(tight.starts, 61);
  const over = fitReshuffleBlock(40, 30);
  assert.equal(over.block, 30);
  assert.equal(over.capped, true);
});

test('one month index drives both sleeves', () => {
  const glide = {
    equityR: [0.2, -0.4],
    restR: [-0.1, 0.8],
    inflation: [1, 2],
    feeFactor: 1
  };
  const together = growthAtMonthIndex(1, { glideOn: true, glide, equityWeight: 0.25 });
  const mixed = 1 + 0.25 * glide.equityR[1] + 0.75 * glide.restR[0];
  assert.equal(together, (1 + 0.25 * glide.equityR[1] + 0.75 * glide.restR[1]) / glide.inflation[1]);
  assert.notEqual(together, mixed);
});

test('historical successRate is unchanged by reshuffle seed and block length', () => {
  const series = returns(120);
  const base = simulateRetirement(plan({ reshuffleSeed: 1, reshuffleBlock: 12 }), series);
  const otherSeed = simulateRetirement(plan({ reshuffleSeed: 99, reshuffleBlock: 12 }), series);
  const otherBlock = simulateRetirement(plan({ reshuffleSeed: 1, reshuffleBlock: 48 }), series);
  assert.equal(otherSeed.successRate, base.successRate);
  assert.equal(otherBlock.successRate, base.successRate);
  assert.deepEqual(otherSeed.sustainableSpending, base.sustainableSpending);
  assert.deepEqual(otherBlock.sustainableSpending, base.sustainableSpending);
  assert.notEqual(otherSeed.monteCarlo.seed, base.monteCarlo.seed);
  assert.notEqual(otherBlock.monteCarlo.blockMonths, base.monteCarlo.blockMonths);
});
