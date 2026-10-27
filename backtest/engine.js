// 純計算模組：不做任何 I/O，Node 與瀏覽器都可直接 import。
// 價格資料格式：{ symbol, series: [['YYYY-MM-DD', adjClose], ...] }（日期遞增）

import { mappingLookupKey, normalizeSymbol } from './symbols.js';

const SEGMENT_WARNINGS = {
  price_index: '價格指數，不含股息，報酬被低估',
  synthetic: '月度合成數據（Shiller 月均價／殖利率推算），波動與回撤被低估'
};

export function symbolToFile(symbol) {
  return symbol.toUpperCase().replace(/\^/g, 'IDX_').replace(/[^A-Z0-9._-]/g, '_') + '.json';
}

export function resolveChain(symbol, mapping) {
  const sym = normalizeSymbol(symbol);
  const mapKey = mappingLookupKey(sym, mapping);
  const entry = mapping?.etfs?.[mapKey];
  return [
    { symbol: sym, type: 'etf' },
    ...(entry?.proxies || []).map(p => ({ symbol: normalizeSymbol(p.symbol), type: p.type, note: p.note }))
  ];
}

export function symbolsNeeded(symbols, mapping) {
  const out = new Set();
  for (const s of symbols) {
    for (const link of resolveChain(s, mapping)) out.add(link.symbol);
  }
  return [...out];
}

// ETF 上市前的期間，依序以替代序列的報酬往前拼接（在拼接點按比例縮放，保留報酬率）。
export function buildSplicedSeries(symbol, mapping, dataBySymbol) {
  const warnings = [];
  const segments = [];
  let combined = null;

  for (const link of resolveChain(symbol, mapping)) {
    const raw = dataBySymbol[link.symbol]?.series;
    if (!raw?.length) {
      warnings.push(`${symbol}：找不到 ${link.symbol} 的資料，已略過`);
      continue;
    }
    const s = raw.filter(([, p]) => Number.isFinite(p) && p > 0);
    if (s.length < 2) continue;

    if (!combined) {
      combined = s.map(([d, p]) => [d, p]);
      segments.push({ symbol: link.symbol, type: link.type, from: s[0][0], to: s.at(-1)[0] });
      continue;
    }

    const spliceDate = combined[0][0];
    const older = s.filter(([d]) => d <= spliceDate);
    if (older.length < 2) continue;

    const anchor = older.at(-1);
    const k = combined[0][1] / anchor[1];
    const prefix = older.slice(0, -1).map(([d, p]) => [d, p * k]);
    combined = prefix.concat(combined);
    segments.unshift({ symbol: link.symbol, type: link.type, from: prefix[0][0], to: spliceDate });
  }

  if (!combined) throw new Error(`${symbol}：沒有任何可用的價格資料`);
  return { symbol: symbol.toUpperCase(), series: combined, segments, warnings };
}

function normalizeHoldings(holdings) {
  const list = Array.isArray(holdings)
    ? holdings.map(h => [h.symbol, h.weight])
    : Object.entries(holdings);
  const cleaned = list.map(([s, w]) => [String(s).toUpperCase(), Number(w)]);
  for (const [s, w] of cleaned) {
    if (!Number.isFinite(w) || w < 0) throw new Error(`${s} 的權重無效：${w}`);
  }
  const total = cleaned.reduce((a, [, w]) => a + w, 0);
  if (total <= 0) throw new Error('權重總和必須大於 0');
  return cleaned.map(([s, w]) => ({ symbol: s, weight: w / total }));
}

function periodKey(date, freq) {
  const y = date.slice(0, 4);
  const m = Number(date.slice(5, 7));
  switch (freq) {
    case 'monthly': return `${y}-${m}`;
    case 'quarterly': return `${y}-Q${Math.ceil(m / 3)}`;
    case 'semiannual': return `${y}-H${m <= 6 ? 1 : 2}`;
    case 'annual': return y;
    default: return null;
  }
}

function yearsBetween(a, b) {
  return (Date.parse(b) - Date.parse(a)) / (365.25 * 86400000);
}

function mean(xs) {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function std(xs) {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

function lastPerMonth(curve) {
  const out = [];
  for (const point of curve) {
    if (out.length && out.at(-1)[0].slice(0, 7) === point[0].slice(0, 7)) out[out.length - 1] = point;
    else out.push(point);
  }
  return out;
}

function toReturns(values) {
  const r = [];
  for (let i = 1; i < values.length; i++) r.push(values[i] / values[i - 1] - 1);
  return r;
}

function computeDrawdown(curve) {
  let peak = curve[0];
  let maxDD = 0;
  let worst = { peakDate: curve[0][0], troughDate: curve[0][0], recoveryDate: null };
  for (const point of curve) {
    if (point[1] > peak[1]) peak = point;
    const dd = point[1] / peak[1] - 1;
    if (dd < maxDD) {
      maxDD = dd;
      worst = { peakDate: peak[0], peakValue: peak[1], troughDate: point[0], recoveryDate: null };
    }
  }
  if (maxDD < 0) {
    const after = curve.find(([d, v]) => d > worst.troughDate && v >= worst.peakValue);
    worst.recoveryDate = after ? after[0] : null;
  }
  return { maxDrawdown: maxDD, peakDate: worst.peakDate, troughDate: worst.troughDate, recoveryDate: worst.recoveryDate };
}

// 波動、Sharpe、Sortino 一律用月報酬計算（資料可能混合日線與月度合成序列）；回撤用完整序列
function computeStats(curve, riskFreeRate = 0) {
  const start = curve[0][0];
  const end = curve.at(-1)[0];
  const years = yearsBetween(start, end);
  const rets = toReturns(lastPerMonth(curve).map(p => p[1]));
  const cagr = (curve.at(-1)[1] / curve[0][1]) ** (1 / years) - 1;
  const enough = rets.length >= 3;
  const vol = enough ? std(rets) * Math.sqrt(12) : NaN;
  const annMean = enough ? mean(rets) * 12 : NaN;
  const downside = enough ? Math.sqrt(mean(rets.map(r => Math.min(r, 0) ** 2))) * Math.sqrt(12) : NaN;
  const dd = computeDrawdown(curve);
  return {
    cagr,
    volatility: vol,
    sharpe: vol > 0 ? (annMean - riskFreeRate) / vol : null,
    sortino: downside > 0 ? (annMean - riskFreeRate) / downside : null,
    calmar: dd.maxDrawdown < 0 ? cagr / -dd.maxDrawdown : null,
    ...dd
  };
}

function annualReturns(curve) {
  const byYear = new Map();
  for (const [d, v] of curve) byYear.set(d.slice(0, 4), { date: d, value: v });
  const years = [...byYear.keys()];
  return years.map((y, i) => {
    const prevValue = i === 0 ? curve[0][1] : byYear.get(years[i - 1]).value;
    const partial = (i === 0 && !curve[0][0].startsWith(`${y}-01`)) ||
                    (i === years.length - 1 && !byYear.get(y).date.startsWith(`${y}-12`));
    return { year: Number(y), return: byYear.get(y).value / prevValue - 1, partial };
  });
}

// 日期取所有資產日期的聯集；每個資產取「該日或之前最後一個價格」。
// 這讓日線與月度序列、不同交易所的交易日可以混用，累積報酬不變。
function alignAsOf(spliced, from, to) {
  const dateSet = new Set();
  for (const s of spliced) {
    for (const [d] of s.series) if (d >= from && d <= to) dateSet.add(d);
  }
  const dates = [...dateSet].sort();
  const levels = spliced.map(s => {
    const out = new Array(dates.length);
    let j = 0;
    let last = null;
    for (let i = 0; i < dates.length; i++) {
      while (j < s.series.length && s.series[j][0] <= dates[i]) last = s.series[j++][1];
      out[i] = last;
    }
    return out;
  });
  return { dates, levels };
}

function correlationMatrix(symbols, monthlyReturns) {
  const n = symbols.length;
  const matrix = Array.from({ length: n }, () => Array(n).fill(1));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = monthlyReturns[i];
      const b = monthlyReturns[j];
      const ma = mean(a);
      const mb = mean(b);
      let cov = 0, va = 0, vb = 0;
      for (let k = 0; k < a.length; k++) {
        cov += (a[k] - ma) * (b[k] - mb);
        va += (a[k] - ma) ** 2;
        vb += (b[k] - mb) ** 2;
      }
      matrix[i][j] = matrix[j][i] = cov / Math.sqrt(va * vb);
    }
  }
  return { symbols, matrix };
}

/**
 * @param {object} portfolio
 *   holdings: { SPY: 60, TLT: 40 } 或 [{ symbol, weight }]（自動正規化）
 *   rebalance: 'none' | 'monthly' | 'quarterly' | 'semiannual' | 'annual'（預設 annual）
 *   start / end: 'YYYY-MM-DD'（可省略，預設取所有資產共同可用的最長區間）
 *   initial: 初始金額（預設 10000）
 *   riskFreeRate: 年化無風險利率，用於 Sharpe / Sortino（預設 0）
 * @param {object} mapping       index-mapping.json 內容
 * @param {object} dataBySymbol  { [symbol]: { series } }，需包含 symbolsNeeded() 列出的所有代號
 */
export function runBacktest(portfolio, mapping, dataBySymbol) {
  const holdings = normalizeHoldings(portfolio.holdings);
  const rebalance = portfolio.rebalance || 'annual';
  const initial = portfolio.initial ?? 10000;

  const spliced = holdings.map(h => buildSplicedSeries(h.symbol, mapping, dataBySymbol));

  const firstDates = spliced.map(s => s.series[0][0]);
  const commonStart = firstDates.reduce((a, b) => (a > b ? a : b));
  const from = portfolio.start && portfolio.start > commonStart ? portfolio.start : commonStart;
  const lastDates = spliced.map(s => s.series.at(-1)[0]);
  const commonEnd = lastDates.reduce((a, b) => (a < b ? a : b));
  const to = portfolio.end && portfolio.end < commonEnd ? portfolio.end : commonEnd;

  const { dates, levels } = alignAsOf(spliced, from, to);
  if (dates.length < 2) throw new Error(`共同可用區間不足（${from} ~ ${to}）`);
  const weights = holdings.map(h => h.weight);
  let values = weights.map(w => w * initial);
  const curve = [[dates[0], initial]];

  for (let i = 1; i < dates.length; i++) {
    values = values.map((v, j) => v * (levels[j][i] / levels[j][i - 1]));
    const total = values.reduce((a, b) => a + b, 0);
    const prevKey = periodKey(dates[i - 1], rebalance);
    if (prevKey !== null && prevKey !== periodKey(dates[i], rebalance)) {
      values = weights.map(w => w * total);
    }
    curve.push([dates[i], total]);
  }

  const riskFreeRate = portfolio.riskFreeRate ?? 0;
  const monthly = lastPerMonth(curve);

  const assets = holdings.map((h, j) => {
    const assetCurve = dates.map((d, i) => [d, levels[j][i]]);
    const s = computeStats(assetCurve, riskFreeRate);
    return {
      symbol: h.symbol,
      weight: h.weight,
      historyStart: firstDates[j],
      cagr: s.cagr,
      volatility: s.volatility,
      maxDrawdown: s.maxDrawdown,
      dataSources: spliced[j].segments
    };
  });

  const monthlyAssetReturns = levels.map(lv =>
    toReturns(lastPerMonth(dates.map((d, i) => [d, lv[i]])).map(p => p[1]))
  );

  const limiting = assets.find(a => a.historyStart === commonStart);

  const warnings = spliced.flatMap(s => s.warnings);
  for (const s of spliced) {
    for (const seg of s.segments) {
      if (SEGMENT_WARNINGS[seg.type] && seg.from < dates.at(-1) && seg.to > dates[0]) {
        const segFrom = seg.from > dates[0] ? seg.from : dates[0];
        warnings.push(`${s.symbol}：${segFrom} ~ ${seg.to} 使用 ${seg.symbol}（${SEGMENT_WARNINGS[seg.type]}）`);
      }
    }
  }

  return {
    portfolio: { holdings, rebalance, initial, riskFreeRate },
    period: {
      start: dates[0],
      end: dates.at(-1),
      years: yearsBetween(dates[0], dates.at(-1)),
      limitingAsset: limiting ? limiting.symbol : null
    },
    finalValue: curve.at(-1)[1],
    stats: computeStats(curve, riskFreeRate),
    annualReturns: annualReturns(curve),
    assets,
    correlation: correlationMatrix(holdings.map(h => h.symbol), monthlyAssetReturns),
    equityMonthly: monthly,
    assetMonthly: holdings.map((h, j) => ({
      symbol: h.symbol,
      series: lastPerMonth(dates.map((d, i) => [d, levels[j][i]]))
    })),
    warnings
  };
}
