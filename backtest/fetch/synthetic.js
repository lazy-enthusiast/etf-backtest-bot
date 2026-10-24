// 合成長期序列（月度）：Shiller + FRED + datasets
// Shiller 的 S&P 價格是月均價，回撤與波動會被平滑；只作為 ETF／共同基金上市前的延伸。
import { fetchFromYahoo, YAHOO_UA } from './yahoo.js';

const SHILLER_CSV = 'https://raw.githubusercontent.com/datasets/s-and-p-500/main/data/data.csv';
const GOLD_MONTHLY_CSV = 'https://raw.githubusercontent.com/datasets/gold-prices/main/data/monthly.csv';
const FRED_CPI_CSV = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=CPIAUCNS';
const FRED_DGS10_CSV = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10';
const FRED_TB3MS_CSV = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=TB3MS';
// FRED 對長 Chrome UA 會掛住不回應，改用簡短字串
const FRED_UA = 'etf-backtest-bot/0.1 (+https://github.com/neuy/etf-backtest-bot)';

// 一次抓完 header+body；避免「header 已回、body 卡住」時 AbortSignal 不再生效
async function fetchText(url, { timeoutMs = 45000, ua = YAHOO_UA } = {}) {
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
  const res = await fetchWithRetry(url, 3, { ua: FRED_UA, timeoutMs: 30000 });
  if (!res.ok) throw new Error(`FRED：HTTP ${res.status}`);
  return res.text.trim().split('\n').slice(1)
    .map(line => line.split(','))
    .filter(([, v]) => v && v !== '.' && Number(v) > 0)
    .map(([d, v]) => [d, Number(v)]);
}

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
  let anchorIdx = monthly.findIndex(([d]) => monthKey(d) === lastKey);
  if (anchorIdx < 0) {
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

export const SYNTHETIC_BUILDERS = {
  US_STOCK_TR: buildUsStockTR,
  US_10Y_TR: buildUs10yTR,
  US_BILL_TR: buildUsBillTR,
  GOLD_SPOT: buildGoldSpot,
  CPI_US: buildCpiUs
};
