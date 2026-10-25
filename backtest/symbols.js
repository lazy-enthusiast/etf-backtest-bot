// 投資標的代號規則（Node／瀏覽器／Worker 共用，無 I/O）
// 持倉必須帶交易所後綴：VTI.US、IGLN.L、2800.HK、0050.TW；期貨維持 GC=F。

export const EXCHANGE_SUFFIXES = [
  'US', 'L', 'HK', 'TW', 'T', 'AX', 'TO', 'PA', 'DE', 'MI', 'SW', 'SS', 'SZ', 'KS', 'KQ', 'SI', 'NS'
];

export const SYMBOL_HINT = '格式：代號.交易所（美股 VTI.US、倫敦 IGLN.L／VWRD.L、港股 2800.HK、台股 0050.TW；期貨 GC=F）。不可省略交易所。';

/**
 * 裸代號別名：對應非美股上市（勿自動補 .US）。
 * 與 index-mapping 中「裸鍵 + 非 .US 後綴鍵」成對者保持同步（目前 IGLN／VWRD）。
 */
export const NON_US_BARE_ALIASES = Object.freeze({
  VWRD: 'L',
  IGLN: 'L'
});

const EX_RE = new RegExp(
  `^([A-Z0-9][A-Z0-9^\\-]{0,11})\\.(${EXCHANGE_SUFFIXES.join('|')})$`
);
const FUT_RE = /^[A-Z0-9][A-Z0-9^=\\-]{0,14}$/;

export function normalizeSymbol(raw) {
  return String(raw || '').trim().toUpperCase();
}

/** 期貨或已含 ./= 的內部序列（合成代號等） */
export function isFuturesOrSpecial(sym) {
  const s = normalizeSymbol(sym);
  return s.includes('=') || /^[A-Z][A-Z0-9_]*_(TR|SPOT|US)$/.test(s) || s === 'CPI_US' || s.startsWith('US_') || s === 'GOLD_SPOT';
}

/**
 * 從 index-mapping 推導「可安全裸→.US」的美股鍵：
 * 裸鍵存在、且沒有同名非 .US 後綴鍵（如 VWRD.L）時才算美股。
 */
export function usBareKeysFromMapping(mapping) {
  const etfKeys = Object.keys(mapping?.etfs || {}).map(k => k.toUpperCase());
  const set = new Set();
  for (const s of etfKeys) {
    if (s.includes('.') || s.includes('=')) continue;
    if (NON_US_BARE_ALIASES[s]) continue;
    const hasNonUsSuffix = etfKeys.some(k => k.startsWith(`${s}.`) && k !== `${s}.US`);
    if (!hasNonUsSuffix) set.add(s);
  }
  return set;
}

/**
 * 解析持倉代號。必須有交易所後綴（或期貨）。
 * @returns {{ ok: true, display, base, exchange, yahoo } | { ok: false, error }}
 */
export function parseHoldingSymbol(raw) {
  const s = normalizeSymbol(raw);
  if (!s) return { ok: false, error: '代號空白' };
  if (s.includes('=')) {
    if (!FUT_RE.test(s)) return { ok: false, error: `期貨代號無效：${s}` };
    return { ok: true, display: s, base: s, exchange: 'FUT', yahoo: s };
  }
  const m = s.match(EX_RE);
  if (!m) {
    const prefer = NON_US_BARE_ALIASES[s];
    const extra = prefer
      ? ` 若為倫敦上市請用 ${s}.${prefer}，不要寫 ${s} 或 ${s}.US。`
      : '';
    return {
      ok: false,
      error: `「${s}」缺少交易所後綴。${SYMBOL_HINT}${extra}`
    };
  }
  const [, base, exchange] = m;
  // Yahoo：美股用不加後綴的裸代號；其餘保留 TICKER.EX
  const yahoo = exchange === 'US' ? base : `${base}.${exchange}`;
  return { ok: true, display: s, base, exchange, yahoo };
}

/** 持倉驗證錯誤（含誤標 .US 的非美股別名） */
export function holdingSymbolError(raw) {
  const s = normalizeSymbol(raw);
  if (!s) return '代號空白';
  if (s.includes('=')) {
    if (!FUT_RE.test(s)) return `期貨代號無效：${s}`;
    return null;
  }
  const prefer = NON_US_BARE_ALIASES[s.split('.')[0]];
  const parsed = parseHoldingSymbol(s);
  if (parsed.ok && parsed.exchange === 'US' && prefer) {
    return `「${s}」不是美股上市；請改用 ${parsed.base}.${prefer}（勿寫 ${parsed.base} 或 ${parsed.base}.US）`;
  }
  if (!parsed.ok) return parsed.error;
  return null;
}

/**
 * 舊資料遷移：僅對「已知美股裸代號」補 .US。
 * 未知裸代號與非美股別名（VWRD、IGLN）保持原樣，交給 validate 攔截。
 * @param {string} raw
 * @param {Set<string>|null|undefined} usBareKeys 美股裸鍵集合；省略／null 時不自動補 .US
 */
export function migrateHoldingSymbol(raw, usBareKeys = null) {
  const s = normalizeSymbol(raw);
  if (!s) return s;
  if (s.includes('=') || s.includes('.')) return s;
  if (isFuturesOrSpecial(s)) return s;
  if (NON_US_BARE_ALIASES[s]) return s;
  if (usBareKeys instanceof Set && usBareKeys.has(s)) return `${s}.US`;
  return s;
}

export function migrateHoldings(holdings, usBareKeys = null) {
  const out = {};
  for (const [sym, w] of Object.entries(holdings || {})) {
    const next = migrateHoldingSymbol(sym, usBareKeys);
    out[next] = (out[next] || 0) + Number(w);
  }
  return out;
}

/** 給 Yahoo／Worker 的查詢字串；內部 proxy 可無後綴 */
export function toYahooQuery(raw) {
  const s = normalizeSymbol(raw);
  if (!s) return s;
  if (isFuturesOrSpecial(s) && !s.includes('.')) return s;
  const parsed = parseHoldingSymbol(s);
  if (parsed.ok) return parsed.yahoo;
  // 對照表 proxy（VFINX、GC=F）等：直接用
  return s;
}

/** index-mapping 查找鍵：完整代號 → base → 原字串 */
export function mappingLookupKey(symbol, mapping) {
  const s = normalizeSymbol(symbol);
  if (mapping?.etfs?.[s]) return s;
  const parsed = parseHoldingSymbol(s);
  if (parsed.ok) {
    if (mapping?.etfs?.[parsed.display]) return parsed.display;
    if (mapping?.etfs?.[parsed.base]) return parsed.base;
    const withEx = `${parsed.base}.${parsed.exchange}`;
    if (mapping?.etfs?.[withEx]) return withEx;
  }
  // 裸 proxy
  if (s.includes('.')) {
    const base = s.split('.')[0];
    if (mapping?.etfs?.[base]) return base;
  }
  return s;
}

/** datalist 顯示用：mapping 裸美股代號補 .US（略過非美股別名） */
export function toDisplaySymbol(raw) {
  const s = normalizeSymbol(raw);
  if (!s || s.includes('=') || s.includes('.') || isFuturesOrSpecial(s)) return s;
  if (NON_US_BARE_ALIASES[s]) return s;
  return `${s}.US`;
}
