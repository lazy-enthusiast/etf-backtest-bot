import { toYahooQuery, normalizeSymbol, parseHoldingSymbol, SYMBOL_HINT } from '../symbols.js';

const YAHOO_CHART = 'https://query2.finance.yahoo.com/v8/finance/chart/';
// Yahoo 日線約限 100 年／次；用 99 年留餘裕（勿再用 1900-01-01）
const YAHOO_DAILY_MAX_YEARS = 99;
export const YAHOO_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

function yahooPeriod1() {
  return Math.floor(Date.now() / 1000) - Math.floor(YAHOO_DAILY_MAX_YEARS * 365.25 * 24 * 3600);
}

async function fetchYahooOnce(yahooSymbol) {
  const params = new URLSearchParams({
    period1: String(yahooPeriod1()),
    period2: String(Math.floor(Date.now() / 1000)),
    interval: '1d',
    events: 'div,split',
    includeAdjustedClose: 'true'
  });
  const res = await fetch(`${YAHOO_CHART}${encodeURIComponent(yahooSymbol)}?${params}`, {
    headers: { 'User-Agent': YAHOO_UA }
  });
  const json = await res.json().catch(() => null);
  const result = json?.chart?.result?.[0];
  if (!res.ok || !result) {
    throw new Error(`Yahoo ${yahooSymbol}：${json?.chart?.error?.description || `HTTP ${res.status}`}`);
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
  if (!series.length) throw new Error(`Yahoo ${yahooSymbol}：回傳空序列`);

  return {
    symbol: yahooSymbol.toUpperCase(),
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

export async function fetchFromYahoo(symbol) {
  const requested = normalizeSymbol(symbol);
  const yahoo = toYahooQuery(requested);
  try {
    const data = await fetchYahooOnce(yahoo);
    if (yahoo !== requested) {
      data.requestedSymbol = requested;
      data.resolvedFrom = yahoo;
    }
    if (parseHoldingSymbol(requested).ok) data.symbol = requested;
    return data;
  } catch (err) {
    const holding = parseHoldingSymbol(requested);
    let hint = '';
    if (!holding.ok && !requested.includes('=')) {
      hint = ` ${SYMBOL_HINT}`;
    } else if (holding.ok && holding.exchange === 'US') {
      hint = `（Yahoo 查詢「${yahoo}」）。若為倫敦／港股 ETF，請改用 ${holding.base}.L／${holding.base}.HK，勿用 ${holding.base}.US`;
    } else if (!requested.includes('.') && !requested.includes('=')) {
      hint = ` ${SYMBOL_HINT}`;
    }
    throw new Error((err.message || `Yahoo ${requested}：找不到資料`) + hint);
  }
}
