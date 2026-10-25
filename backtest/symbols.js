// 投資標的代號規則（Node／瀏覽器／Worker 共用，無 I/O）
// 持倉必須帶交易所後綴：VTI.US、IGLN.L、2800.HK、0050.TW；期貨維持 GC=F。

export const EXCHANGE_SUFFIXES = [
  'US', 'L', 'HK', 'TW', 'T', 'AX', 'TO', 'PA', 'DE', 'MI', 'SW', 'SS', 'SZ', 'KS', 'KQ', 'SI', 'NS'
];

export const SYMBOL_HINT = '格式：代號.交易所（美股 VTI.US、倫敦 IGLN.L、港股 2800.HK、台股 0050.TW；期貨 GC=F）';

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
    return {
      ok: false,
      error: `「${s}」缺少交易所後綴。${SYMBOL_HINT}`
    };
  }
  const [, base, exchange] = m;
  // Yahoo：美股用不加後綴的裸代號；其餘保留 TICKER.EX
  const yahoo = exchange === 'US' ? base : `${base}.${exchange}`;
  return { ok: true, display: s, base, exchange, yahoo };
}

/** 舊資料遷移：無後綴的當美股補 .US；已有後綴／期貨／合成不變 */
export function migrateHoldingSymbol(raw) {
  const s = normalizeSymbol(raw);
  if (!s) return s;
  if (s.includes('=') || s.includes('.')) return s;
  if (isFuturesOrSpecial(s)) return s;
  return `${s}.US`;
}

export function migrateHoldings(holdings) {
  const out = {};
  for (const [sym, w] of Object.entries(holdings || {})) {
    const next = migrateHoldingSymbol(sym);
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

/** datalist 顯示用：mapping 裸美股代號補 .US */
export function toDisplaySymbol(raw) {
  const s = normalizeSymbol(raw);
  if (!s || s.includes('=') || s.includes('.') || isFuturesOrSpecial(s)) return s;
  return `${s}.US`;
}
