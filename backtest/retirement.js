// 退休規劃模擬：純計算、無 I/O，Node 與瀏覽器共用。
// 全部以「今日幣值」（實質金額）計算：名目月報酬先扣費用、再以通膨折算成實質報酬。
// 投入與支出在每月月初發生，之後套用當月報酬。

export const WITHDRAWAL_STRATEGIES = {
  fixed_real: '固定實質提領',
  guardrails: '護欄法（Guyton-Klinger）',
  vpw: '變動百分比（VPW）'
};

export const DEFAULT_PLAN = {
  currency: 'HKD',
  currentAge: 40,
  retireAge: 60,
  endAge: 95,
  currentSavings: 1000000,
  monthlyContribution: 10000,
  annualSpending: 300000,
  otherIncome: 0,
  otherIncomeAge: 65,
  inflationMode: 'cpi',   // 'cpi' = 美國歷史 CPI；'fixed' = 固定通膨假設
  inflationRate: 2.5,     // %／年；fixed 模式使用，cpi 模式在 CPI 缺月時作後備
  feeRate: 0.2,           // %／年，基金費用與交易成本
  withdrawalStrategy: 'fixed_real',
  // 護欄法：提領率高於上限砍支出、低於下限加支出（每年檢視一次）
  guardrailCeiling: 6,    // % of portfolio
  guardrailFloor: 3,
  guardrailAdjustPct: 10,
  glidePath: false,
  equityTickers: [],
  glideEquityEnd: null,
  dividendTax: false,
  dividendYields: {},
  dividendTaxRates: {},
  feeSplit: false,
  ter: 0,
  turnover: 0,
  turnoverCost: 0,
  fxSpread: 0
};

const PERCENTILES = [10, 25, 50, 75, 90];

export function normalizePlan(plan) {
  const p = { ...DEFAULT_PLAN, ...plan };
  const int = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(v) || 0)));
  const money = v => Math.max(0, Number(v) || 0);
  p.currentAge = int(p.currentAge, 0, 100);
  p.retireAge = int(p.retireAge, p.currentAge, 110);
  p.endAge = int(p.endAge, p.retireAge + 1, 120);
  p.otherIncomeAge = int(p.otherIncomeAge, 0, 120);
  p.currentSavings = money(p.currentSavings);
  p.monthlyContribution = money(p.monthlyContribution);
  p.annualSpending = money(p.annualSpending);
  p.otherIncome = money(p.otherIncome);
  p.inflationRate = Number(p.inflationRate) || 0;
  p.feeRate = Math.max(0, Number(p.feeRate) || 0);
  p.inflationMode = p.inflationMode === 'fixed' ? 'fixed' : 'cpi';
  p.withdrawalStrategy = WITHDRAWAL_STRATEGIES[p.withdrawalStrategy] ? p.withdrawalStrategy : 'fixed_real';
  p.guardrailCeiling = Math.min(20, Math.max(1, Number(p.guardrailCeiling) || DEFAULT_PLAN.guardrailCeiling));
  p.guardrailFloor = Math.min(p.guardrailCeiling - 0.1, Math.max(0.5, Number(p.guardrailFloor) || DEFAULT_PLAN.guardrailFloor));
  p.guardrailAdjustPct = Math.min(50, Math.max(1, Number(p.guardrailAdjustPct) || DEFAULT_PLAN.guardrailAdjustPct));
  p.glidePath = p.glidePath === true || p.glidePath === 'true';
  p.equityTickers = normalizeEquityTickers(p.equityTickers);
  const end = Number(p.glideEquityEnd);
  p.glideEquityEnd = p.glideEquityEnd == null || p.glideEquityEnd === '' || !Number.isFinite(end)
    ? null
    : Math.min(100, Math.max(0, end));
  p.dividendTax = p.dividendTax === true || p.dividendTax === 'true';
  p.dividendYields = parseRateMap(p.dividendYields);
  p.dividendTaxRates = parseRateMap(p.dividendTaxRates);
  p.feeSplit = p.feeSplit === true || p.feeSplit === 'true';
  p.ter = Math.max(0, Number(p.ter) || 0);
  p.turnover = Math.max(0, Number(p.turnover) || 0);
  p.turnoverCost = Math.max(0, Number(p.turnoverCost) || 0);
  p.fxSpread = Math.max(0, Number(p.fxSpread) || 0);
  return p;
}

function annualFeeDrag(p) {
  if (!p.feeSplit) return p.feeRate;
  const turnoverDrag = (p.turnover / 100) * p.turnoverCost;
  return Math.min(99, p.ter + turnoverDrag + p.fxSpread);
}

function feeSplitParts(p) {
  if (!p.feeSplit) return null;
  return {
    ter: p.ter,
    turnover: (p.turnover / 100) * p.turnoverCost,
    fxSpread: p.fxSpread
  };
}

function parseRateMap(value) {
  const out = {};
  const entries = value && typeof value === 'object' && !Array.isArray(value)
    ? Object.entries(value)
    : String(value || '').split(/[,;\n]+/).map(part => {
      const cut = part.indexOf(':');
      return cut < 0 ? null : [part.slice(0, cut), part.slice(cut + 1)];
    }).filter(Boolean);
  for (const [key, raw] of entries) {
    const n = Number(raw);
    const name = String(key || '').trim().toUpperCase();
    if (name && Number.isFinite(n) && n >= 0) out[name] = n;
  }
  return out;
}

function normalizeEquityTickers(value) {
  const raw = Array.isArray(value) ? value : String(value || '').split(/[\s,]+/);
  const out = [];
  for (const item of raw) {
    const sym = String(item || '').trim().toUpperCase();
    if (sym && !out.includes(sym)) out.push(sym);
  }
  return out;
}

function percentile(sorted, q) {
  if (!sorted.length) return NaN;
  const idx = (sorted.length - 1) * q / 100;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function summarize(values, qs = PERCENTILES) {
  const sorted = Float64Array.from(values).sort();
  const out = { min: sorted[0], max: sorted[sorted.length - 1] };
  for (const q of qs) out[`p${q}`] = percentile(sorted, q);
  return out;
}

/**
 * 由回測淨值（每月最後一個交易日）計算實質月報酬。
 * @param equityMonthly  runBacktest().equityMonthly
 * @param cpiSeries      [['YYYY-MM-DD', 指數], ...]（月度），inflationMode = 'fixed' 時可省略
 */
export function realMonthlyReturns(equityMonthly, plan, cpiSeries) {
  const p = normalizePlan(plan);
  const cpi = new Map((cpiSeries || []).map(([d, v]) => [d.slice(0, 7), v]));
  const feeFactor = (1 - annualFeeDrag(p) / 100) ** (1 / 12);
  const fixedInflation = (1 + p.inflationRate / 100) ** (1 / 12);
  const returns = [];
  let cpiFallbackMonths = 0;

  for (let i = 1; i < equityMonthly.length; i++) {
    const [prevDate, prevValue] = equityMonthly[i - 1];
    const [date, value] = equityMonthly[i];
    let inflation = fixedInflation;
    if (p.inflationMode === 'cpi') {
      const a = cpi.get(prevDate.slice(0, 7));
      const b = cpi.get(date.slice(0, 7));
      if (a && b) inflation = b / a;
      else cpiFallbackMonths++;
    }
    returns.push({ month: date.slice(0, 7), r: (value / prevValue) * feeFactor / inflation - 1 });
  }
  return { returns, cpiFallbackMonths };
}

/**
 * 股／其他兩袖的月價格報酬，對齊 equityMonthly 的同一個月序。
 * 下滑關閉、或無法分成兩袖時回傳 null，呼叫端繼續用既有的單一實質報酬。
 */
export function buildGlide(assetMonthly, holdings, plan, cpiSeries) {
  const p = normalizePlan(plan);
  if (!p.glidePath || !assetMonthly?.length || !p.equityTickers.length) return null;
  const list = Array.isArray(holdings)
    ? holdings.map(h => [h.symbol, h.weight])
    : Object.entries(holdings);
  const cleaned = list.map(([symbol, weight]) => [String(symbol).toUpperCase(), Number(weight)]);
  const total = cleaned.reduce((sum, [, weight]) => sum + (Number.isFinite(weight) ? weight : 0), 0);
  if (!(total > 0)) return null;
  const equitySet = new Set(p.equityTickers);
  const bySym = new Map();
  let eqW = 0;
  for (const [symbol, weight] of cleaned) {
    if (!Number.isFinite(weight) || weight < 0) continue;
    const w = weight / total;
    bySym.set(symbol, (bySym.get(symbol) || 0) + w);
    if (equitySet.has(symbol)) eqW += w;
  }
  const restW = 1 - eqW;
  if (eqW <= 1e-12 || restW <= 1e-12) return null;
  const base = assetMonthly[0].series;
  if (!base || base.length < 2) return null;
  const seriesBy = new Map(assetMonthly.map(a => [String(a.symbol).toUpperCase(), a.series]));
  for (const symbol of bySym.keys()) {
    const series = seriesBy.get(symbol);
    if (!series || series.length !== base.length) return null;
  }
  const n = base.length - 1;
  const equityR = new Float64Array(n);
  const restR = new Float64Array(n);
  for (let i = 1; i < base.length; i++) {
    let eq = 0;
    let rest = 0;
    for (const [symbol, weight] of bySym) {
      const series = seriesBy.get(symbol);
      const ret = series[i][1] / series[i - 1][1] - 1;
      if (equitySet.has(symbol)) eq += (weight / eqW) * ret;
      else rest += (weight / restW) * ret;
    }
    equityR[i - 1] = eq;
    restR[i - 1] = rest;
  }
  const feeFactor = (1 - annualFeeDrag(p) / 100) ** (1 / 12);
  const fixedInflation = (1 + p.inflationRate / 100) ** (1 / 12);
  const cpi = new Map((cpiSeries || []).map(([d, v]) => [String(d).slice(0, 7), v]));
  const inflation = new Float64Array(n);
  for (let i = 1; i < base.length; i++) {
    let factor = fixedInflation;
    if (p.inflationMode === 'cpi') {
      const a = cpi.get(String(base[i - 1][0]).slice(0, 7));
      const b = cpi.get(String(base[i][0]).slice(0, 7));
      if (a && b) factor = b / a;
    }
    inflation[i - 1] = factor;
  }
  return {
    equityR,
    restR,
    inflation,
    feeFactor,
    startEquity: eqW,
    endEquity: p.glideEquityEnd == null ? eqW : p.glideEquityEnd / 100
  };
}

/**
 * 價格序列沒有分開的股息。稅額＝資產 × 假設年殖利率／12 × 註冊地稅率。
 * 模組關閉、或沒有對得上的殖利率與稅率時回傳 null。
 */
export function buildDividendTax(holdings, plan) {
  const p = normalizePlan(plan);
  if (!p.dividendTax) return null;
  const list = Array.isArray(holdings)
    ? holdings.map(h => [h.symbol, h.weight])
    : Object.entries(holdings || {});
  const cleaned = list.map(([symbol, weight]) => [String(symbol).toUpperCase(), Number(weight)]);
  const total = cleaned.reduce((sum, [, weight]) => sum + (Number.isFinite(weight) && weight > 0 ? weight : 0), 0);
  if (!(total > 0)) return null;
  let annual = 0;
  for (const [symbol, weight] of cleaned) {
    if (!Number.isFinite(weight) || weight <= 0) continue;
    const domicile = symbol.includes('.') ? symbol.slice(symbol.lastIndexOf('.') + 1) : '';
    const yieldPct = p.dividendYields[symbol] ?? (domicile ? p.dividendYields[domicile] : undefined);
    const taxPct = p.dividendTaxRates[symbol] ?? (domicile ? p.dividendTaxRates[domicile] : undefined);
    if (!Number.isFinite(yieldPct) || !Number.isFinite(taxPct)) continue;
    annual += (weight / total) * (yieldPct / 100) * (taxPct / 100);
  }
  if (!(annual > 0)) return null;
  return { monthlyRate: annual / 12 };
}

// 給定一段月報酬，提領期的最大可持續提領率（SWR：期末歸零）與永續提領率（PWR：期末保住實質本金）
function withdrawalRates(rs) {
  let growth = 1;
  let sumGrowth = 0;
  for (let k = rs.length - 1; k >= 0; k--) {
    growth *= 1 + rs[k];
    sumGrowth += growth;
  }
  return { swr: 12 * growth / sumGrowth, pwr: 12 * (growth - 1) / sumGrowth };
}

/** 當月從投資組合提領的金額（不含其他收入；其他收入另以 inflow 加入）。 */
function monthWithdrawal(strategy, p, state, balance, k, retireMonth, totalMonths) {
  if (strategy === 'vpw') {
    const remaining = totalMonths - k;
    if (remaining <= 0) return Math.max(0, balance);
    return Math.max(0, balance / remaining);
  }
  if (strategy === 'guardrails') {
    if ((k - retireMonth) % 12 === 0 && balance > 1e-6) {
      const wr = state.annualSpend / balance;
      if (wr > p.guardrailCeiling / 100) state.annualSpend *= 1 - p.guardrailAdjustPct / 100;
      else if (wr < p.guardrailFloor / 100) state.annualSpend *= 1 + p.guardrailAdjustPct / 100;
    }
    return Math.max(0, state.annualSpend / 12);
  }
  return p.annualSpending / 12;
}

/**
 * 單一提領規則下，對所有歷史起點跑完整人生路徑。
 * fixed_real 時同時用線性分解算 maxSpending（期末歸零的最大固定年支出）。
 */
function worseRun(a, b) {
  if (a.success !== b.success) return !a.success;
  const da = a.depletedAge ?? Infinity;
  const db = b.depletedAge ?? Infinity;
  if (da !== db) return da < db;
  return a.endBalance < b.endBalance;
}

/**
 * 與 runLifePaths 同一條月初現金流、其後報酬的迴圈。
 * keepRows 只給測試對帳；正式摘要算完就丟掉逐月列。
 */
function walkLife(p, returns, strategy, { keepRows = false, glide = null, dividend = null, feeParts = null } = {}) {
  const L = returns.length;
  const totalMonths = (p.endAge - p.currentAge) * 12;
  const retireMonth = (p.retireAge - p.currentAge) * 12;
  const incomeMonth = (p.otherIncomeAge - p.currentAge) * 12;
  const r = Float64Array.from(returns, x => x.r);
  const circular = L < totalMonths;
  const starts = circular ? L : L - totalMonths + 1;
  const years = totalMonths / 12;
  const retireYears = p.endAge - p.retireAge;
  const contribution = p.monthlyContribution;
  const income = p.otherIncome / 12;
  const targetMonthly = p.annualSpending / 12;
  const trackLinear = strategy === 'fixed_real';

  const yearly = Array.from({ length: years + 1 }, () => new Float64Array(starts));
  const runs = new Array(starts);
  const totals = new Float64Array(starts);
  const yearSpends = new Array(starts);
  const yearFunded = new Array(starts);
  const guardStats = new Array(starts);
  const rows = keepRows ? [] : null;
  const glideOn = Boolean(glide && p.glidePath && glide.equityR.length === L);
  const dividendOn = Boolean(dividend && p.dividendTax && dividend.monthlyRate > 0);
  let eqMin = Infinity;
  let eqMax = -Infinity;

  for (let s = 0; s < starts; s++) {
    let balance = p.currentSavings;
    let base = p.currentSavings;
    let perSpend = 0;
    let depletedAt = null;
    let balanceAtRetire = retireMonth === 0 ? balance : NaN;
    let totalSpent = 0;
    let targetSpent = 0;
    let coverageMonths = 0;
    let retireMonths = 0;
    const spendState = { annualSpend: p.annualSpending };
    const yearSpend = new Float64Array(retireYears);
    const funded = new Float64Array(retireYears);
    let streak = 0;
    let longest = 0;
    let largest = 0;
    yearly[0][s] = balance;

    for (let k = 0; k < totalMonths; k++) {
      const idx = (s + k) % L;
      let equityWeight = null;
      let growth;
      if (glideOn) {
        const span = totalMonths <= 1 ? 0 : k / (totalMonths - 1);
        equityWeight = glide.startEquity + (glide.endEquity - glide.startEquity) * span;
        if (equityWeight < 0) equityWeight = 0;
        if (equityWeight > 1) equityWeight = 1;
        if (equityWeight < eqMin) eqMin = equityWeight;
        if (equityWeight > eqMax) eqMax = equityWeight;
        const gross = 1 + equityWeight * glide.equityR[idx] + (1 - equityWeight) * glide.restR[idx];
        growth = gross * glide.feeFactor / glide.inflation[idx];
      } else {
        growth = 1 + r[idx];
      }
      const realReturn = growth - 1;
      const contrib = k < retireMonth ? contribution : 0;
      const other = k >= incomeMonth ? income : 0;
      const inflow = contrib + other;
      if (trackLinear) base += inflow;
      balance += inflow;
      let taxPaid = 0;
      if (dividendOn && balance > 0) {
        taxPaid = balance * dividend.monthlyRate;
        balance -= taxPaid;
      }

      let withdraw = 0;
      if (k >= retireMonth) {
        const beforeSpend = spendState.annualSpend;
        withdraw = monthWithdrawal(strategy, p, spendState, balance, k, retireMonth, totalMonths);
        if (strategy === 'guardrails' && (k - retireMonth) % 12 === 0) {
          const cut = beforeSpend - spendState.annualSpend;
          if (cut > 1e-6) {
            streak += 1;
            if (streak > longest) longest = streak;
            if (cut > largest) largest = cut;
          } else streak = 0;
        }
        if (trackLinear) perSpend -= 1 / 12;
        const payable = Math.min(withdraw, Math.max(0, balance));
        balance -= withdraw;
        totalSpent += withdraw;
        targetSpent += targetMonthly;
        retireMonths++;
        if (withdraw + 1e-9 >= targetMonthly * 0.9) coverageMonths++;
        if (balance < -1e-6 && depletedAt === null) depletedAt = k;
        if (balance < 0) balance = 0;
        const y = Math.floor((k - retireMonth) / 12);
        if (y >= 0 && y < retireYears) {
          yearSpend[y] += withdraw;
          funded[y] += payable;
        }
      }

      const balanceAfterFlows = balance;
      balance *= growth;
      if (trackLinear) {
        base *= growth;
        perSpend *= growth;
      }
      if (k + 1 === retireMonth) balanceAtRetire = balance;
      if ((k + 1) % 12 === 0) yearly[(k + 1) / 12][s] = balance;

      if (rows) {
        rows.push({
          start_month: returns[s].month,
          k,
          return_month: returns[idx].month,
          circular,
          contribution: contrib,
          other_income: other,
          withdrawal: withdraw,
          real_return: realReturn,
          balance_after_flows: balanceAfterFlows,
          balance_end: balance,
          depleted: depletedAt !== null && k >= depletedAt ? 1 : 0,
          ...(equityWeight === null ? {} : { equity_weight_actual: equityWeight }),
          ...(dividendOn ? { tax_paid: taxPaid } : {}),
          ...(feeParts ? {
            ter_cost: balanceAfterFlows * (1 - (1 - feeParts.ter / 100) ** (1 / 12)),
            turnover_cost: balanceAfterFlows * (1 - (1 - feeParts.turnover / 100) ** (1 / 12)),
            fx_spread: balanceAfterFlows * (1 - (1 - feeParts.fxSpread / 100) ** (1 / 12))
          } : {})
        });
      }
    }

    totals[s] = totalSpent;
    yearSpends[s] = yearSpend;
    yearFunded[s] = funded;
    guardStats[s] = { longest, largest };
    runs[s] = {
      start: returns[s].month,
      success: depletedAt === null,
      depletedAge: depletedAt === null ? null : p.currentAge + depletedAt / 12,
      endBalance: balance,
      balanceAtRetire,
      maxSpending: trackLinear && perSpend < 0 ? Math.max(0, base / -perSpend) : NaN,
      spendRatio: targetSpent > 0 ? totalSpent / targetSpent : 1,
      coverageRate: retireMonths > 0 ? coverageMonths / retireMonths : 1
    };
  }

  return {
    runs, yearly, starts, circular, years, rows, totals, yearSpends, guardStats, retireYears,
    equityWeightRange: glideOn ? { min: eqMin, max: eqMax } : null,
    yearFunded
  };
}

function medianFunded(walked) {
  const sums = walked.yearFunded.map(years => years.reduce((sum, v) => sum + v, 0)).sort((a, b) => a - b);
  return sums[Math.floor((sums.length - 1) / 2)];
}

function runLifePaths(p, returns, strategy, glide, dividend) {
  return walkLife(p, returns, strategy, {
    keepRows: false,
    glide: p.glidePath ? glide : null,
    dividend: p.dividendTax ? dividend : null,
    feeParts: feeSplitParts(p)
  });
}

function spendingBriefFromWalk(p, strategy, returns, walked) {
  const { runs, yearSpends, guardStats, retireYears } = walked;
  let worst = 0;
  for (let s = 1; s < runs.length; s++) if (worseRun(runs[s], runs[worst])) worst = s;
  const target = p.annualSpending;
  const years = yearSpends[worst];
  let tightY = 0;
  for (let y = 1; y < retireYears; y++) if (years[y] < years[tightY]) tightY = y;
  const retireMonth = (p.retireAge - p.currentAge) * 12;
  const L = returns.length;
  const yearOf = y => returns[(worst + retireMonth + y * 12) % L].month.slice(0, 4);
  let absGap = 0;
  const snippet = [];
  for (let y = 0; y < retireYears; y++) {
    if (target > 0) absGap += Math.abs(years[y] - target) / target;
    snippet.push({ age: p.retireAge + y, year: yearOf(y), spending: years[y] });
  }
  const guard = strategy === 'guardrails' ? guardStats[worst] : null;
  return {
    worstStart: runs[worst].start,
    tightest: { age: p.retireAge + tightY, year: yearOf(tightY), spending: years[tightY] },
    meanAbsGapRatio: retireYears > 0 ? absGap / retireYears : null,
    guardrail: guard && (guard.longest > 0 || guard.largest > 0) ? guard : (strategy === 'guardrails' ? { longest: 0, largest: 0 } : null),
    snippet
  };
}

/** 測試用：逐月列只在呼叫時存在。正式畫面不保留。 */
export function buildLifeLedger(plan, returns, strategy, glide = null, dividend = null) {
  const p = normalizePlan(plan);
  const strat = strategy || p.withdrawalStrategy;
  const walked = walkLife(p, returns, strat, {
    keepRows: true,
    glide: p.glidePath ? glide : null,
    dividend: p.dividendTax ? dividend : null,
    feeParts: feeSplitParts(p)
  });
  return {
    header: {
      feeRate: p.feeRate,
      inflationMode: p.inflationMode,
      method: walked.circular ? 'circular' : 'rolling'
    },
    rows: walked.rows,
    paths: walked.runs.map((run, s) => ({
      start_month: run.start,
      success: run.success,
      end_balance: run.endBalance,
      balance_at_retire: run.balanceAtRetire,
      total_withdrawal: walked.totals[s],
      spend_ratio: run.spendRatio,
      depleted_age: run.depletedAge
    })),
    totals: walked.totals,
    cumWithdrawal: summarize(walked.totals)
  };
}

/**
 * 以歷史每個起始月份模擬整個人生計劃（累積期 + 提領期）。
 * 歷史長度不足計劃年限時，改用循環序列（走到尾端後接回開頭），並在結果中標示。
 * @param returns realMonthlyReturns().returns
 */
export function simulateRetirement(plan, returns, glide = null, dividend = null, baselineReturns = null) {
  const p = normalizePlan(plan);
  const L = returns.length;
  if (L < 24) throw new Error('可用歷史不足 2 年，無法做退休模擬');

  const primary = runLifePaths(p, returns, p.withdrawalStrategy, glide, dividend);
  const needFixedCompare = p.withdrawalStrategy !== 'fixed_real';
  const fixed = needFixedCompare ? runLifePaths(p, returns, 'fixed_real', glide, dividend) : primary;
  const { runs, yearly, starts, circular } = primary;

  const successCount = runs.filter(x => x.success).length;
  const fixedSuccessCount = fixed.runs.filter(x => x.success).length;
  const sortedRuns = runs.slice().sort((a, b) =>
    (a.success - b.success) || ((a.depletedAge ?? Infinity) - (b.depletedAge ?? Infinity)) || (a.endBalance - b.endBalance));

  const bands = yearly.map((vals, y) => ({ age: p.currentAge + y, ...summarize(vals) }));
  const spendQs = summarize(fixed.runs.map(x => x.maxSpending).filter(Number.isFinite), [5, 10, 50]);
  const spendRatioQs = summarize(runs.map(x => x.spendRatio), [10, 50, 90]);
  const coverageQs = summarize(runs.map(x => x.coverageRate), [10, 50, 90]);

  // 經典提領率分析：只看提領期（退休那一刻的資產為 100%）；與提領規則無關
  const r = Float64Array.from(returns, x => x.r);
  const horizon = (p.endAge - p.retireAge) * 12;
  const wCircular = L < horizon;
  const wStarts = wCircular ? L : L - horizon + 1;
  const swr = new Float64Array(wStarts);
  const pwr = new Float64Array(wStarts);
  const slice = new Float64Array(horizon);
  for (let s = 0; s < wStarts; s++) {
    for (let k = 0; k < horizon; k++) slice[k] = r[(s + k) % L];
    const w = withdrawalRates(slice);
    swr[s] = w.swr;
    pwr[s] = w.pwr;
  }
  const swrStats = summarize(swr, [5, 10, 50]);
  const pwrStats = summarize(pwr, [5, 10, 50]);
  let worstSwrStart = 0;
  for (let s = 1; s < wStarts; s++) if (swr[s] < swr[worstSwrStart]) worstSwrStart = s;

  const retireValues = runs.map(x => x.balanceAtRetire).filter(Number.isFinite);
  const retireStats = retireValues.length ? summarize(retireValues) : null;
  const netSpendAtRetire = p.annualSpending - (p.otherIncomeAge <= p.retireAge ? p.otherIncome : 0);
  const spendingBrief = spendingBriefFromWalk(p, p.withdrawalStrategy, returns, primary);
  let dividendSpend = null;
  if (p.dividendTax && dividend?.monthlyRate > 0) {
    const plain = { ...p, dividendTax: false };
    const without = runLifePaths(plain, returns, p.withdrawalStrategy, glide, null);
    dividendSpend = { withTax: medianFunded(primary), withoutTax: medianFunded(without) };
  }
  let feeSpend = null;
  if (p.feeSplit && !p.glidePath && baselineReturns) {
    const plain = { ...p, feeSplit: false };
    const without = runLifePaths(plain, baselineReturns, p.withdrawalStrategy, null, dividend);
    feeSpend = { withSplit: medianFunded(primary), withoutSplit: medianFunded(without) };
  }

  return {
    plan: p,
    history: {
      start: returns[0].month,
      end: returns[L - 1].month,
      months: L,
      method: circular ? 'circular' : 'rolling',
      starts
    },
    withdrawalStrategy: p.withdrawalStrategy,
    successRate: successCount / starts,
    successRateFixedReal: fixedSuccessCount / starts,
    endBalance: summarize(runs.map(x => x.endBalance)),
    balanceAtRetire: retireStats,
    initialWithdrawalRate: retireStats && retireStats.p50 > 0 ? netSpendAtRetire / retireStats.p50 : null,
    // 可持續支出始終以「固定實質提領」線性解為準，方便跨策略比較目標是否過高
    sustainableSpending: { p100: spendQs.min, p95: spendQs.p5, p90: spendQs.p10, p50: spendQs.p50 },
    spendingFlexibility: {
      // 實際累積提領 ÷ 目標累積提領；護欄／VPW 會低於 1 換取較高成功率
      spendRatio: { p10: spendRatioQs.p10, p50: spendRatioQs.p50, p90: spendRatioQs.p90 },
      // 單月提領 ≥ 目標 90% 的月份占比
      coverageRate: { p10: coverageQs.p10, p50: coverageQs.p50, p90: coverageQs.p90 }
    },
    withdrawalRates: {
      horizonYears: p.endAge - p.retireAge,
      method: wCircular ? 'circular' : 'rolling',
      starts: wStarts,
      swr: { min: swrStats.min, p5: swrStats.p5, p10: swrStats.p10, p50: swrStats.p50 },
      pwr: { min: pwrStats.min, p5: pwrStats.p5, p10: pwrStats.p10, p50: pwrStats.p50 },
      worstStart: returns[worstSwrStart].month
    },
    worstRuns: sortedRuns.slice(0, 5),
    bands,
    cumWithdrawal: summarize(primary.totals),
    spendingBrief,
    glide: p.glidePath ? (primary.equityWeightRange || { skipped: true }) : null,
    dividendSpend,
    feeSpend,
    byStartYear: runs.filter(x => x.start.endsWith('-01')).map(x => ({
      year: Number(x.start.slice(0, 4)),
      success: x.success,
      depletedAge: x.depletedAge,
      endBalance: x.endBalance,
      spendRatio: x.spendRatio
    }))
  };
}

// 兩段所需報酬的搜尋邊界（年化實質）。超出邊界不回假精度數字，改由 flags 標示。
const PHASE_RATE_FLOOR = -0.20;
const PHASE_RATE_CAP = 0.30;

function accumulateToNestEgg(savings, contribution, months, annual) {
  const g = (1 + annual) ** (1 / 12);
  let balance = savings;
  for (let k = 0; k < months; k++) balance = (balance + contribution) * g;
  return balance;
}

// 月初先扣支出、加上已開始的其他收入，再套用當月報酬。不把負餘額歸零，才能解出期末剛好花完的利率。
function withdrawToEnd(start, spendMonthly, incomeMonthly, incomeDelayMonths, months, annual) {
  const g = (1 + annual) ** (1 / 12);
  let balance = start;
  for (let k = 0; k < months; k++) {
    const income = k >= incomeDelayMonths ? incomeMonthly : 0;
    balance = (balance - spendMonthly + income) * g;
  }
  return balance;
}

function solvePhaseRate(scoreAt, scale) {
  const tol = Math.max(1, Math.abs(scale) * 1e-8);
  const fLo = scoreAt(PHASE_RATE_FLOOR);
  const fHi = scoreAt(PHASE_RATE_CAP);
  if (Math.abs(fLo) <= tol && Math.abs(fHi) <= tol) return { annual: 0, flag: null };
  if (fLo > tol) return { annual: null, flag: 'below_zero' };
  if (fHi < -tol) return { annual: null, flag: 'above_cap' };
  if (Math.abs(fLo) <= tol) return { annual: PHASE_RATE_FLOOR, flag: null };
  if (Math.abs(fHi) <= tol) return { annual: PHASE_RATE_CAP, flag: null };
  let lo = PHASE_RATE_FLOOR;
  let hi = PHASE_RATE_CAP;
  let annual = 0;
  for (let i = 0; i < 64; i++) {
    annual = (lo + hi) / 2;
    const f = scoreAt(annual);
    if (Math.abs(f) <= tol) break;
    if (f > 0) hi = annual;
    else lo = annual;
  }
  return { annual, flag: null };
}

/**
 * 累積期與提領期各自需要的實質年化報酬（今日幣值）。
 * 累積：現有資產＋每月投入，月初入帳後再增值，長到 nestEgg。
 * 提領：由該資產（已退休則用現有資產）支付年支出至終點，其他收入自 otherIncomeAge 起每月加入，允許花完本金。
 * 年化為 null 表示這一段不適用，或利率落在搜尋邊界外（見 flags：below_zero / above_cap）。
 */
export function requiredPhaseReturns(plan, { nestEgg = null, alreadyRetired = false } = {}) {
  const p = normalizePlan(plan);
  const retired = Boolean(alreadyRetired) || p.retireAge <= p.currentAge;
  const target = Number(nestEgg);
  const accumMonths = retired ? 0 : (p.retireAge - p.currentAge) * 12;

  let accumulation = { annual: null, flag: null };
  if (accumMonths > 0 && Number.isFinite(target) && target > 0) {
    accumulation = solvePhaseRate(
      annual => accumulateToNestEgg(p.currentSavings, p.monthlyContribution, accumMonths, annual) - target,
      target
    );
  }

  const start = retired ? p.currentSavings : (Number.isFinite(target) && target > 0 ? target : null);
  let withdrawal = { annual: null, flag: null };
  if (start != null) {
    const anchorAge = retired ? p.currentAge : p.retireAge;
    const months = (p.endAge - anchorAge) * 12;
    const incomeDelay = (p.otherIncomeAge - anchorAge) * 12;
    withdrawal = solvePhaseRate(
      annual => withdrawToEnd(start, p.annualSpending / 12, p.otherIncome / 12, incomeDelay, months, annual),
      Math.max(start, p.annualSpending, 1)
    );
  }

  return {
    accumulationAnnual: accumulation.annual,
    withdrawalAnnual: withdrawal.annual,
    flags: {
      accumulation: accumulation.flag,
      withdrawal: withdrawal.flag
    }
  };
}
