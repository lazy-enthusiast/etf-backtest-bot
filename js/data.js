import * as engine from '../backtest/engine.js';
import * as retirement from '../backtest/retirement.js';
import { state } from './state.js';

export function loadMeta() {
  if (!state.meta) {
    state.meta = Promise.all([
      fetch('backtest/index-mapping.json').then(r => r.json()),
      fetch('data/manifest.json').then(r => r.json())
    ]).then(([mapping, manifest]) => ({ engine, retirement, mapping, manifest }));
    state.meta.catch(() => { state.meta = null; });
  }
  return state.meta;
}

export function earliestDate(meta, symbol) {
  const dates = meta.engine.resolveChain(symbol, meta.mapping)
    .map(link => meta.manifest.symbols[link.symbol]?.firstDate)
    .filter(Boolean)
    .sort();
  return dates[0] || null;
}

export function backtestableSymbols(meta) {
  const proxies = new Set(Object.values(meta.mapping.etfs).flatMap(e => e.proxies.map(p => p.symbol.toUpperCase())));
  const list = new Set(Object.keys(meta.mapping.etfs));
  for (const [s, info] of Object.entries(meta.manifest.symbols)) {
    if (!proxies.has(s) && info.instrumentType !== 'CPI') list.add(s);
  }
  return [...list].filter(s => earliestDate(meta, s)).sort();
}

export function loadSeries(meta, symbol) {
  if (!state.series.has(symbol)) {
    const p = fetch('data/' + meta.engine.symbolToFile(symbol)).then(r => {
      if (!r.ok) throw new Error(`無法載入 ${symbol}（HTTP ${r.status}）`);
      return r.json();
    });
    p.catch(() => state.series.delete(symbol));
    state.series.set(symbol, p);
  }
  return state.series.get(symbol);
}

export async function runBacktestCached(pf) {
  const key = JSON.stringify([pf.holdings, pf.rebalance, pf.start, pf.end]);
  if (state.backtestCache.has(key)) return state.backtestCache.get(key);
  const meta = await loadMeta();
  const symbols = Object.keys(pf.holdings);
  const missing = symbols.filter(s => !earliestDate(meta, s));
  if (missing.length) {
    throw new Error(`沒有 ${missing.join('、')} 的價格資料。請在本機執行 npm run fetch -- ${missing.join(' ')} 後重新整理。`);
  }
  const needed = meta.engine.symbolsNeeded(symbols, meta.mapping).filter(s => meta.manifest.symbols[s]);
  const loaded = await Promise.all(needed.map(s => loadSeries(meta, s)));
  const result = meta.engine.runBacktest({
    holdings: pf.holdings, rebalance: pf.rebalance, start: pf.start || undefined, end: pf.end || undefined
  }, meta.mapping, Object.fromEntries(needed.map((s, i) => [s, loaded[i]])));
  state.backtestCache.set(key, result);
  return result;
}

export async function loadCpi(meta) {
  if (!meta.manifest.symbols.CPI_US) return null;
  return (await loadSeries(meta, 'CPI_US')).series;
}
