// 從 Yahoo Finance 抓日線調整收盤價（含股息/分割調整），快取到 data/*.json。
// 用法：
//   node backtest/data-fetcher.js SPY TLT GLD   # 抓指定 ETF 及其替代序列
//   node backtest/data-fetcher.js --all         # 抓 index-mapping.json 內全部代號
//   加 --refresh 強制重抓；加 --no-proxies 只抓 ETF 本身

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { symbolToFile, symbolsNeeded } from './engine.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.join(ROOT, 'data');
const MAPPING_PATH = path.join(ROOT, 'backtest', 'index-mapping.json');

const YAHOO_CHART = 'https://query2.finance.yahoo.com/v8/finance/chart/';
const EARLIEST = -2208988800; // 1900-01-01
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

export async function loadMapping() {
  return JSON.parse(await readFile(MAPPING_PATH, 'utf8'));
}

export async function fetchFromYahoo(symbol) {
  const params = new URLSearchParams({
    period1: String(EARLIEST),
    period2: String(Math.floor(Date.now() / 1000)),
    interval: '1d',
    events: 'div,split',
    includeAdjustedClose: 'true'
  });
  const res = await fetch(`${YAHOO_CHART}${encodeURIComponent(symbol)}?${params}`, {
    headers: { 'User-Agent': USER_AGENT }
  });
  const json = await res.json().catch(() => null);
  const result = json?.chart?.result?.[0];
  if (!res.ok || !result) {
    throw new Error(`Yahoo ${symbol}：${json?.chart?.error?.description || `HTTP ${res.status}`}`);
  }

  const timestamps = result.timestamp || [];
  const adj = result.indicators?.adjclose?.[0]?.adjclose;
  const prices = adj || result.indicators?.quote?.[0]?.close || [];
  const offset = result.meta?.gmtoffset || 0;

  const series = [];
  for (let i = 0; i < timestamps.length; i++) {
    const p = prices[i];
    if (p == null || !(p > 0)) continue;
    const date = new Date((timestamps[i] + offset) * 1000).toISOString().slice(0, 10);
    const point = [date, Number(p.toPrecision(8))];
    if (series.length && series.at(-1)[0] === date) series[series.length - 1] = point;
    else series.push(point);
  }
  if (!series.length) throw new Error(`Yahoo ${symbol}：回傳空序列`);

  return {
    symbol: symbol.toUpperCase(),
    name: result.meta?.longName || result.meta?.shortName || null,
    currency: result.meta?.currency || null,
    instrumentType: result.meta?.instrumentType || null,
    adjusted: Boolean(adj),
    source: 'yahoo',
    fetchedAt: new Date().toISOString(),
    firstDate: series[0][0],
    lastDate: series.at(-1)[0],
    series
  };
}

export async function readCached(symbol) {
  const file = path.join(DATA_DIR, symbolToFile(symbol));
  if (!existsSync(file)) return null;
  return JSON.parse(await readFile(file, 'utf8'));
}

async function writeCache(data) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(path.join(DATA_DIR, symbolToFile(data.symbol)), JSON.stringify(data));
}

// data/manifest.json：前端用來列出可回測代號，不必逐一下載價格檔
export async function writeManifest() {
  const symbols = {};
  for (const file of (await readdir(DATA_DIR)).sort()) {
    if (!file.endsWith('.json') || file === 'manifest.json') continue;
    const d = JSON.parse(await readFile(path.join(DATA_DIR, file), 'utf8'));
    symbols[d.symbol] = { name: d.name, currency: d.currency, firstDate: d.firstDate, lastDate: d.lastDate };
  }
  await writeFile(path.join(DATA_DIR, 'manifest.json'), JSON.stringify({ updatedAt: new Date().toISOString(), symbols }, null, 1));
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// 回傳 { [symbol]: data }；本地已有快取就直接讀，否則抓 Yahoo 並寫入 data/
export async function ensureData(symbols, { refresh = false, log = console.log } = {}) {
  const out = {};
  let fetched = 0;
  for (const symbol of symbols) {
    const cached = refresh ? null : await readCached(symbol);
    if (cached) {
      out[symbol] = cached;
      continue;
    }
    try {
      const data = await fetchFromYahoo(symbol);
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
    symbols = symbolsNeeded(Object.keys(mapping.etfs), mapping);
  } else if (args.length) {
    symbols = flags.has('--no-proxies') ? args : symbolsNeeded(args, mapping);
  } else {
    console.log('用法：node backtest/data-fetcher.js <ETF...> | --all  [--refresh] [--no-proxies]');
    return;
  }
  await ensureData(symbols, { refresh: flags.has('--refresh') });
  await writeManifest();
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
