// 從 Yahoo Finance 抓日線調整收盤價（含股息/分割調整），快取到 data/*.json。
// 用法：
//   node backtest/data-fetcher.js SPY TLT GLD   # 抓指定 ETF 及其替代序列
//   node backtest/data-fetcher.js --all         # 抓 index-mapping.json 內全部代號 + CPI_US
//   US_STOCK_TR / US_10Y_TR / CPI_US 為合成月度序列（Shiller 資料集、FRED），其餘走 Yahoo
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

// ===== 合成長期序列（月度）：Shiller 資料集 + FRED CPI =====
// Shiller 的 S&P 價格是月均價，回撤與波動會被平滑；只作為 ETF／共同基金上市前的延伸。
const SHILLER_CSV = 'https://raw.githubusercontent.com/datasets/s-and-p-500/main/data/data.csv';
const FRED_CPI_CSV = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=CPIAUCNS';

async function fetchWithRetry(url, attempts = 3) {
  for (let i = 1; ; i++) {
    try {
      return await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(60000) });
    } catch (err) {
      if (i >= attempts) throw new Error(`${new URL(url).host}：${err.cause?.code || err.message}`);
      await new Promise(r => setTimeout(r, 2000 * i));
    }
  }
}

let shillerRows = null;
async function loadShillerRows() {
  if (!shillerRows) {
    shillerRows = (async () => {
      const res = await fetchWithRetry(SHILLER_CSV);
      if (!res.ok) throw new Error(`Shiller CSV：HTTP ${res.status}`);
      return (await res.text()).trim().split('\n').slice(1).map(line => {
        const [date, price, dividend, , cpi, rate] = line.split(',');
        return { date, price: Number(price), dividend: Number(dividend), cpi: Number(cpi), rate: Number(rate) };
      });
    })();
  }
  return shillerRows;
}

function syntheticRecord(symbol, name, source, series) {
  return {
    symbol, name, currency: 'USD', instrumentType: 'SYNTHETIC', frequency: 'monthly', adjusted: true,
    source, fetchedAt: new Date().toISOString(),
    firstDate: series[0][0], lastDate: series.at(-1)[0], series
  };
}

async function buildUsStockTR() {
  const rows = (await loadShillerRows()).filter(r => r.price > 0 && r.dividend > 0);
  let level = 100;
  const series = [[rows[0].date, level]];
  for (let i = 1; i < rows.length; i++) {
    level *= (rows[i].price + rows[i].dividend / 12) / rows[i - 1].price;
    series.push([rows[i].date, Number(level.toPrecision(10))]);
  }
  return syntheticRecord('US_STOCK_TR', 'US stocks total return (Shiller S&P Composite, dividends reinvested)', 'shiller', series);
}

// 每月買入平價 10 年期國債（票息 = 上月殖利率），一個月後以新殖利率、剩餘 119 個月重新定價
async function buildUs10yTR() {
  const rows = (await loadShillerRows()).filter(r => r.rate > 0);
  let level = 100;
  const series = [[rows[0].date, level]];
  for (let i = 1; i < rows.length; i++) {
    const coupon = rows[i - 1].rate / 100 / 12;
    const y = rows[i].rate / 100 / 12;
    const discount = (1 + y) ** -119;
    const price = coupon * (1 - discount) / y + discount;
    level *= price + coupon;
    series.push([rows[i].date, Number(level.toPrecision(10))]);
  }
  return syntheticRecord('US_10Y_TR', 'US 10-year Treasury total return (synthetic from Shiller long rate)', 'shiller', series);
}

// FRED CPIAUCNS（1913 起）為主，1913 年前以 Shiller CPI 按比例銜接；FRED 連不上時只用 Shiller（至 2023 年）
async function buildCpiUs(log = console.log) {
  const shiller = (await loadShillerRows()).filter(r => r.cpi > 0).map(r => [r.date, r.cpi]);
  let fred = null;
  try {
    const res = await fetchWithRetry(FRED_CPI_CSV, 2);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    fred = (await res.text()).trim().split('\n').slice(1)
      .map(line => line.split(','))
      .filter(([, v]) => Number(v) > 0)
      .map(([d, v]) => [d, Number(v)]);
  } catch (err) {
    log(`! CPI_US    FRED 無法連線（${err.message}），只用 Shiller CPI`);
  }

  let series = shiller;
  let name = 'US CPI (Shiller dataset)';
  if (fred?.length) {
    const anchor = shiller.find(([d]) => d === fred[0][0]);
    const k = anchor ? fred[0][1] / anchor[1] : 1;
    series = shiller.filter(([d]) => d < fred[0][0]).map(([d, v]) => [d, Number((v * k).toPrecision(8))]).concat(fred);
    name = 'US CPI-U, not seasonally adjusted (FRED CPIAUCNS; Shiller before 1913)';
  }
  const record = syntheticRecord('CPI_US', name, fred ? 'fred+shiller' : 'shiller', series);
  record.instrumentType = 'CPI';
  return record;
}

const SYNTHETIC_BUILDERS = { US_STOCK_TR: buildUsStockTR, US_10Y_TR: buildUs10yTR, CPI_US: buildCpiUs };

// data/manifest.json：前端用來列出可回測代號，不必逐一下載價格檔
export async function writeManifest() {
  const symbols = {};
  for (const file of (await readdir(DATA_DIR)).sort()) {
    if (!file.endsWith('.json') || file === 'manifest.json') continue;
    const d = JSON.parse(await readFile(path.join(DATA_DIR, file), 'utf8'));
    symbols[d.symbol] = {
      name: d.name, currency: d.currency, instrumentType: d.instrumentType,
      frequency: d.frequency || 'daily', firstDate: d.firstDate, lastDate: d.lastDate
    };
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

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
