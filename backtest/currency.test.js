import test from 'node:test';
import assert from 'node:assert/strict';
import { runBacktest } from './engine.js';

function prices(currency, scale = 1) {
  const series = [];
  let price = 100 * scale;
  for (let i = 0; i < 8; i++) {
    series.push([`2020-${String(i + 1).padStart(2, '0')}-01`, price]);
    price *= 1.02 + (i % 2) * 0.01;
  }
  return { currency, series };
}

test('a constant 7.8 peg leaves USD returns equal to the same path already in HKD', () => {
  const usd = runBacktest({ holdings: { 'VTI.US': 100 } }, { etfs: {} }, { 'VTI.US': prices('USD') });
  const hkd = runBacktest({ holdings: { 'VTI.US': 100 } }, { etfs: {} }, { 'VTI.US': prices('HKD', 7.8) });
  assert.ok(Math.abs(usd.stats.cagr - hkd.stats.cagr) < 1e-12);
  assert.ok(Math.abs(usd.finalValue - hkd.finalValue) < 1e-6);
  assert.deepEqual(usd.account.usdConverted, ['VTI.US']);
  assert.deepEqual(hkd.account.usdConverted, []);
  assert.equal(usd.account.unit, 'HKD');
  assert.equal(usd.account.peg, 7.8);
  assert.equal(usd.account.note, '');
  assert.ok(!usd.warnings.some(w => /7\.8 港元|換匯費用|外國當地/.test(w)));
});

test('HKD and USD can sit in one portfolio only after the peg conversion', () => {
  const mixed = runBacktest({
    holdings: { 'VTI.US': 60, '2800.HK': 40 }
  }, { etfs: {} }, {
    'VTI.US': prices('USD'),
    '2800.HK': prices('HKD')
  });
  assert.deepEqual(mixed.account.usdConverted, ['VTI.US']);
  assert.deepEqual(mixed.account.hkdNative, ['2800.HK']);
});

test('other currencies and missing labels are refused', () => {
  assert.throws(
    () => runBacktest({ holdings: { 'CSPX.L': 100 } }, { etfs: {} }, { 'CSPX.L': prices('GBp') }),
    /未支援/
  );
  assert.throws(
    () => runBacktest({ holdings: { 'X.US': 100 } }, { etfs: {} }, { 'X.US': prices('') }),
    /未標幣別/
  );
});
