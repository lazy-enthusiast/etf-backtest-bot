// Yahoo Finance chart → 與 data/*.json 相同 shape（Worker 用，無 Node I/O）

const YAHOO_CHART = 'https://query2.finance.yahoo.com/v8/finance/chart/';
const EARLIEST = -2208988800; // 1900-01-01
const YAHOO_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

// 美股 ETF／共同基金、以及 0050.TW、2800.HK、GC=F 等常見 Yahoo 代號
export const SYMBOL_RE = /^[A-Z0-9][A-Z0-9.^=-]{0,14}$/;

export function normalizeSymbol(raw) {
  return String(raw || '').trim().toUpperCase();
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
    headers: { 'User-Agent': YAHOO_UA }
  });
  const json = await res.json().catch(() => null);
  const result = json?.chart?.result?.[0];
  if (!res.ok || !result) {
    const desc = json?.chart?.error?.description || `HTTP ${res.status}`;
    const err = new Error(`Yahoo ${symbol}：${desc}`);
    err.status = res.status === 404 ? 404 : 502;
    throw err;
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
  if (!series.length) {
    const err = new Error(`Yahoo ${symbol}：回傳空序列`);
    err.status = 404;
    throw err;
  }

  return {
    symbol: symbol.toUpperCase(),
    name: result.meta?.longName || result.meta?.shortName || null,
    currency: result.meta?.currency || null,
    instrumentType: result.meta?.instrumentType || null,
    frequency: 'daily',
    adjusted: Boolean(adj),
    source: 'yahoo',
    fetchedAt: new Date().toISOString(),
    firstDate: series[0][0],
    lastDate: series.at(-1)[0],
    series
  };
}
