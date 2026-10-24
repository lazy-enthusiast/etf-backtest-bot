// 從公開免費來源抓歷史價格，快取到 data/*.json。
// 用法：
//   node backtest/data-fetcher.js SPY TLT GLD   # 抓指定 ETF 及其替代序列
//   node backtest/data-fetcher.js --all         # 抓 index-mapping.json 內全部代號 + CPI_US
//   合成月度：US_STOCK_TR / US_10Y_TR / US_BILL_TR / GOLD_SPOT / CPI_US（Shiller、FRED、datasets）
//   其餘走 Yahoo Finance adj close
//   加 --refresh 強制重抓；加 --no-proxies 只抓 ETF 本身

import { pathToFileURL } from 'node:url';
import { symbolsNeeded } from './engine.js';
import { fetchFromYahoo } from './fetch/yahoo.js';
import { SYNTHETIC_BUILDERS } from './fetch/synthetic.js';
import { DATA_DIR, loadMapping, readCached, writeCache, writeManifest } from './fetch/cache.js';

export { DATA_DIR, loadMapping, fetchFromYahoo, readCached, writeManifest };

const sleep = ms => new Promise(r => setTimeout(r, ms));

// 回傳 { [symbol]: data }；本地已有快取就直接讀，否則抓 Yahoo／合成並寫入 data/
export async function ensureData(symbols, { refresh = false, log = console.log } = {}) {
  const out = {};
  let fetched = 0;
  for (const symbol of symbols) {
    const cached = refresh ? null : await readCached(symbol);
    if (cached) {
      out[symbol] = cached;
      log(`· ${symbol.padEnd(9)} cache ${cached.firstDate} ~ ${cached.lastDate}`);
      continue;
    }
    try {
      log(`… ${symbol.padEnd(9)} fetching`);
      const data = SYNTHETIC_BUILDERS[symbol] ? await SYNTHETIC_BUILDERS[symbol](log) : await fetchFromYahoo(symbol);
      await writeCache(data);
      out[symbol] = data;
      fetched++;
      log(`✓ ${symbol.padEnd(9)} ${data.firstDate} ~ ${data.lastDate}  ${String(data.series.length).padStart(6)} 筆  ${data.adjusted ? '' : '(未調整)'}`);
    } catch (err) {
      log(`✗ ${symbol.padEnd(9)} ${err.message}`);
    }
    await sleep(400);
  }
  if (fetched) await writeManifest();
  return out;
}

async function main(argv) {
  const flags = new Set(argv.filter(a => a.startsWith('--')));
  const args = argv.filter(a => !a.startsWith('--')).map(a => a.toUpperCase());
  const mapping = await loadMapping();

  let symbols;
  if (flags.has('--all')) {
    symbols = [...symbolsNeeded(Object.keys(mapping.etfs), mapping), 'CPI_US'];
  } else if (args.length) {
    symbols = flags.has('--no-proxies') ? args : symbolsNeeded(args, mapping);
  } else {
    console.log('用法：node backtest/data-fetcher.js <ETF...> | --all  [--refresh] [--no-proxies]');
    return;
  }
  await ensureData(symbols, { refresh: flags.has('--refresh') });
  await writeManifest();
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
  main(process.argv.slice(2)).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
