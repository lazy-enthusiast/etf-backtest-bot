import * as engine from '../backtest/engine.js';
import * as retirement from '../backtest/retirement.js';
import { toDisplaySymbol, normalizeSymbol } from '../backtest/symbols.js';
import { WORKER_URL } from './config.js';
import { getAuth, showAuthDialog } from './auth.js';
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

/** datalist 建議清單：顯示用 TICKER.EX；mapping 裸美股補 .US。任意 Yahoo 代號仍可手動輸入。 */
export function backtestableSymbols(meta) {
  const etfKeys = Object.keys(meta.mapping.etfs).map(s => s.toUpperCase());
  const proxies = new Set(
    Object.values(meta.mapping.etfs).flatMap(e => e.proxies.map(p => p.symbol.toUpperCase()))
  );
  const list = new Set();
  for (const s of etfKeys) {
    // 裸別名且已有非 .US 後綴鍵（如 IGLN + IGLN.L）→ 略過裸鍵，避免變成錯誤的 IGLN.US
    if (!s.includes('.') && !s.includes('=')) {
      const hasNonUsSuffix = etfKeys.some(k => k.startsWith(`${s}.`) && k !== `${s}.US`);
      if (hasNonUsSuffix) continue;
    }
    list.add(toDisplaySymbol(s));
  }
  for (const [s, info] of Object.entries(meta.manifest.symbols)) {
    if (proxies.has(s)) continue;
    if (info.instrumentType === 'CPI' || info.instrumentType === 'SYNTHETIC') continue;
    list.add(toDisplaySymbol(s));
  }
  return [...list].sort();
}

function loadLocalSeries(meta, symbol) {
  return fetch('data/' + meta.engine.symbolToFile(symbol)).then(r => {
    if (!r.ok) throw new Error(`無法載入本地 ${symbol}（HTTP ${r.status}）`);
    return r.json();
  });
}

async function loadRemoteSeries(symbol) {
  const auth = getAuth();
  if (!auth) {
    showAuthDialog();
    throw new Error(`載入 ${symbol} 需要先登入（經 Worker 向 Yahoo 抓價）`);
  }
  const res = await fetch(`${WORKER_URL}api/series?symbol=${encodeURIComponent(symbol)}`, {
    headers: { 'X-App-Auth': auth }
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) {
    showAuthDialog();
    throw new Error('驗證失敗，請重新輸入存取密碼');
  }
  if (!res.ok) {
    throw new Error(body.error || `無法從 Yahoo 載入 ${symbol}（HTTP ${res.status}）`);
  }
  return body;
}

/** 合成／CPI（manifest 有列）走本地 data/；其餘含 VTI.US／VWRD.L／GC=F 走 Worker Yahoo。 */
export function loadSeries(meta, symbol) {
  const sym = normalizeSymbol(symbol);
  if (!state.series.has(sym)) {
    const local = meta.manifest.symbols[sym];
    const p = (local ? loadLocalSeries(meta, sym) : loadRemoteSeries(sym))
      .catch(err => {
        state.series.delete(sym);
        throw err;
      });
    state.series.set(sym, p);
  }
  return state.series.get(sym);
}

export async function runBacktestCached(pf) {
  const key = JSON.stringify([pf.holdings, pf.rebalance, pf.start, pf.end]);
  if (state.backtestCache.has(key)) return state.backtestCache.get(key);
  const meta = await loadMeta();
  const symbols = Object.keys(pf.holdings).map(s => s.toUpperCase());
  const needed = meta.engine.symbolsNeeded(symbols, meta.mapping);
  let loaded;
  try {
    loaded = await Promise.all(needed.map(s => loadSeries(meta, s)));
  } catch (err) {
    throw new Error(err.message || String(err));
  }
  const dataBySymbol = Object.fromEntries(needed.map((s, i) => [s, loaded[i]]));
  // 把遠端抓到的 firstDate 寫進記憶體 manifest，方便 datalist／AI 標註年份
  for (const [s, data] of Object.entries(dataBySymbol)) {
    if (!meta.manifest.symbols[s] && data?.firstDate) {
      meta.manifest.symbols[s] = {
        name: data.name,
        currency: data.currency,
        instrumentType: data.instrumentType,
        frequency: data.frequency || 'daily',
        firstDate: data.firstDate,
        lastDate: data.lastDate,
        source: data.source || 'yahoo'
      };
    }
  }
  const result = meta.engine.runBacktest({
    holdings: pf.holdings, rebalance: pf.rebalance, start: pf.start || undefined, end: pf.end || undefined
  }, meta.mapping, dataBySymbol);
  state.backtestCache.set(key, result);
  return result;
}

export async function loadCpi(meta) {
  if (!meta.manifest.symbols.CPI_US) return null;
  return (await loadSeries(meta, 'CPI_US')).series;
}
