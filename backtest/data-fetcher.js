// 從公開免費來源抓歷史價格，快取到 data/*.json。
// 用法：
//   node backtest/data-fetcher.js SPY TLT GLD   # 抓指定 ETF 及其替代序列
//   node backtest/data-fetcher.js --all         # 抓 index-mapping.json 內全部代號 + CPI_US
//   合成月度：US_STOCK_TR / US_10Y_TR / US_BILL_TR / GOLD_SPOT / CPI_US（Shiller、FRED、datasets）
//   其餘走 Yahoo Finance adj close
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
// Yahoo 要較完整 UA；FRED 對長 Chrome UA 會掛住不回應，改用簡短字串
const YAHOO_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const FRED_UA = 'etf-backtest-bot/0.1 (+https://github.com/neuy/etf-backtest-bot)';
const USER_AGENT = YAHOO_UA;

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

// ===== 合成長期序列（月度）：Shiller + FRED + datasets =====
// Shiller 的 S&P 價格是月均價，回撤與波動會被平滑；只作為 ETF／共同基金上市前的延伸。
const SHILLER_CSV = 'https://raw.githubusercontent.com/datasets/s-and-p-500/main/data/data.csv';
const GOLD_MONTHLY_CSV = 'https://raw.githubusercontent.com/datasets/gold-prices/main/data/monthly.csv';
const FRED_CPI_CSV = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=CPIAUCNS';
const FRED_DGS10_CSV = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10';
const FRED_TB3MS_CSV = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=TB3MS';

// 一次抓完 header+body；避免「header 已回、body 卡住」時 AbortSignal 不再生效
async function fetchText(url, { timeoutMs = 45000, ua = USER_AGENT } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': ua }, signal: ac.signal });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithRetry(url, attempts = 3, opts = {}) {
  for (let i = 1; ; i++) {
    try {
      return await fetchText(url, opts);
    } catch (err) {
      if (i >= attempts) throw new Error(`${new URL(url).host}：${err.cause?.code || err.message}`);
      await new Promise(r => setTimeout(r, 1500 * i));
    }
  }
}

async function fetchFredCsv(url) {
  // FRED 對長 Chrome UA 會掛住不回 body
  const res = await fetchWithRetry(url, 3, { ua: FRED_UA, timeoutMs: 30000 });
  if (!res.ok) throw new Error(`FRED：HTTP ${res.status}`);
  return res.text.trim().split('\n').slice(1)
    .map(line => line.split(','))
    .filter(([, v]) => v && v !== '.' && Number(v) > 0)
    .map(([d, v]) => [d, Number(v)]);
}

// 日線 → 每月最後一筆，日期正規成 YYYY-MM-01
function toMonthEnd(series) {
  const byMonth = new Map();
  for (const [d, p] of series) {
    if (!(p > 0)) continue;
    const key = d.slice(0, 7);
    byMonth.set(key, [key + '-01', p]);
  }
  return [...byMonth.values()].sort((a, b) => a[0].localeCompare(b[0]));
}

function monthKey(date) {
  return date.slice(0, 7);
}

function appendByReturns(base, extender) {
  if (!extender?.length || !base?.length) return { series: base, extended: false };
  const lastKey = monthKey(base.at(-1)[0]);
  const monthly = toMonthEnd(extender);
  const after = monthly.filter(([d]) => monthKey(d) > lastKey);
  if (after.length < 2) return { series: base, extended: false };

  let level = base.at(-1)[1];
  const out = base.slice();
  // 找到 extender 上「對齊 base 最後一個月」的錨點，再往後滾報酬
  let anchorIdx = monthly.findIndex(([d]) => monthKey(d) === lastKey);
  if (anchorIdx < 0) {
    // 無同月錨點：用第一個晚於 lastKey 的點當起點，先對齊 level 再跳過該點
    anchorIdx = monthly.findIndex(([d]) => monthKey(d) > lastKey);
    if (anchorIdx < 0) return { series: base, extended: false };
  }
  for (let i = anchorIdx + 1; i < monthly.length; i++) {
    const prev = monthly[i - 1][1];
    const cur = monthly[i][1];
    if (!(prev > 0) || !(cur > 0)) continue;
    level *= cur / prev;
    out.push([monthly[i][0], Number(level.toPrecision(10))]);
  }
  return { series: out, extended: out.length > base.length };
}

let shillerRows = null;
async function loadShillerRows() {
  if (!shillerRows) {
    shillerRows = (async () => {
      const res = await fetchWithRetry(SHILLER_CSV);
      if (!res.ok) throw new Error(`Shiller CSV：HTTP ${res.status}`);
      return res.text.trim().split('\n').slice(1).map(line => {
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

async function buildUsStockTR(log = console.log) {
  const rows = (await loadShillerRows()).filter(r => r.price > 0 && r.dividend > 0);
  let level = 100;
  let series = [[rows[0].date, level]];
  for (let i = 1; i < rows.length; i++) {
    level *= (rows[i].price + rows[i].dividend / 12) / rows[i - 1].price;
    series.push([rows[i].date, Number(level.toPrecision(10))]);
  }
  let source = 'shiller';
  try {
    const vfinx = await fetchFromYahoo('VFINX');
    const { series: ext, extended } = appendByReturns(series, vfinx.series);
    if (extended) {
      series = ext;
      source = 'shiller+vfinx';
      log(`  US_STOCK_TR 以 VFINX 月報酬延伸至 ${series.at(-1)[0]}`);
    }
  } catch (err) {
    log(`! US_STOCK_TR 無法以 VFINX 延伸（${err.message}），只用 Shiller 至 ${series.at(-1)[0]}`);
  }
  return syntheticRecord('US_STOCK_TR', 'US stocks total return (Shiller S&P Composite TR; VFINX after Shiller cutoff)', source, series);
}

// 每月買入平價 10 年期國債（票息 = 上月殖利率），一個月後以新殖利率、剩餘 119 個月重新定價
function rollBondTr(rates) {
  let level = 100;
  const series = [[rates[0][0], level]];
  for (let i = 1; i < rates.length; i++) {
    const coupon = rates[i - 1][1] / 100 / 12;
    const y = rates[i][1] / 100 / 12;
    if (!(y > 0)) continue;
    const discount = (1 + y) ** -119;
    const price = coupon * (1 - discount) / y + discount;
    level *= price + coupon;
    series.push([rates[i][0], Number(level.toPrecision(10))]);
  }
  return series;
}

async function buildUs10yTR(log = console.log) {
  log('  US_10Y_TR 載入 Shiller…');
  const shillerRates = (await loadShillerRows())
    .filter(r => r.rate > 0)
    .map(r => [r.date, r.rate]);
  let rates = shillerRates;
  let source = 'shiller';
  try {
    log('  US_10Y_TR 載入 FRED DGS10…');
    const fredDaily = await fetchFredCsv(FRED_DGS10_CSV);
    const fredMonthly = toMonthEnd(fredDaily);
    const lastKey = monthKey(shillerRates.at(-1)[0]);
    const extra = fredMonthly.filter(([d]) => monthKey(d) > lastKey);
    if (extra.length) {
      rates = shillerRates.concat(extra);
      source = 'shiller+fred_dgs10';
      log(`  US_10Y_TR 以 FRED DGS10 延伸至 ${rates.at(-1)[0]}`);
    }
  } catch (err) {
    log(`! US_10Y_TR 無法以 FRED DGS10 延伸（${err.message}）`);
  }
  return syntheticRecord('US_10Y_TR', 'US 10-year Treasury total return (synthetic from Shiller/FRED long rate)', source, rollBondTr(rates));
}

// 3 個月國庫券近似月報酬（FRED TB3MS，1934 起）
async function buildUsBillTR() {
  const rows = await fetchFredCsv(FRED_TB3MS_CSV);
  let level = 100;
  const series = [[rows[0][0], level]];
  for (let i = 1; i < rows.length; i++) {
    level *= 1 + rows[i - 1][1] / 100 / 12;
    series.push([rows[i][0], Number(level.toPrecision(10))]);
  }
  return syntheticRecord('US_BILL_TR', 'US 3-month T-bill total return (synthetic from FRED TB3MS)', 'fred_tb3ms', series);
}

// LBMA／歷史金價月度（datasets/gold-prices，1833 起）；近端以 GC=F 日線月報酬銜接
async function buildGoldSpot(log = console.log) {
  const res = await fetchWithRetry(GOLD_MONTHLY_CSV);
  if (!res.ok) throw new Error(`Gold CSV：HTTP ${res.status}`);
  let series = res.text.trim().split('\n').slice(1)
    .map(line => {
      const [ym, price] = line.split(',');
      const p = Number(price);
      if (!ym || !(p > 0)) return null;
      const date = ym.length === 7 ? `${ym}-01` : ym;
      return [date, p];
    })
    .filter(Boolean);
  let source = 'datasets/gold-prices';
  try {
    const fut = await fetchFromYahoo('GC=F');
    const { series: ext, extended } = appendByReturns(series, fut.series);
    if (extended) {
      series = ext;
      source = 'datasets/gold-prices+gc=f';
      log(`  GOLD_SPOT 以 GC=F 月報酬延伸至 ${series.at(-1)[0]}`);
    }
  } catch (err) {
    log(`! GOLD_SPOT 無法以 GC=F 延伸（${err.message}）`);
  }
  return syntheticRecord('GOLD_SPOT', 'LBMA / historical gold spot USD/oz (monthly)', source, series);
}

// FRED CPIAUCNS（1913 起）為主，1913 年前以 Shiller CPI 按比例銜接；FRED 連不上時只用 Shiller
async function buildCpiUs(log = console.log) {
  const shiller = (await loadShillerRows()).filter(r => r.cpi > 0).map(r => [r.date, r.cpi]);
  let fred = null;
  try {
    fred = await fetchFredCsv(FRED_CPI_CSV);
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

const SYNTHETIC_BUILDERS = {
  US_STOCK_TR: buildUsStockTR,
  US_10Y_TR: buildUs10yTR,
  US_BILL_TR: buildUsBillTR,
  GOLD_SPOT: buildGoldSpot,
  CPI_US: buildCpiUs
};

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
