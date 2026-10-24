// 退休規劃模擬：純計算、無 I/O，Node 與瀏覽器共用。
// 全部以「今日幣值」（實質金額）計算：名目月報酬先扣費用、再以通膨折算成實質報酬。
// 投入與支出在每月月初發生，之後套用當月報酬。

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
  feeRate: 0.2            // %／年，基金費用與交易成本
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
  return p;
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
  const feeFactor = (1 - p.feeRate / 100) ** (1 / 12);
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

/**
 * 以歷史每個起始月份模擬整個人生計劃（累積期 + 提領期）。
 * 歷史長度不足計劃年限時，改用循環序列（走到尾端後接回開頭），並在結果中標示。
 * @param returns realMonthlyReturns().returns
 */
export function simulateRetirement(plan, returns) {
  const p = normalizePlan(plan);
  const L = returns.length;
  if (L < 24) throw new Error('可用歷史不足 2 年，無法做退休模擬');

  const totalMonths = (p.endAge - p.currentAge) * 12;
  const retireMonth = (p.retireAge - p.currentAge) * 12;
  const incomeMonth = (p.otherIncomeAge - p.currentAge) * 12;
  const r = Float64Array.from(returns, x => x.r);

  const circular = L < totalMonths;
  const starts = circular ? L : L - totalMonths + 1;
  const years = totalMonths / 12;
  const contribution = p.monthlyContribution;
  const spending = p.annualSpending / 12;
  const income = p.otherIncome / 12;

  const yearly = Array.from({ length: years + 1 }, () => new Float64Array(starts));
  const runs = new Array(starts);

  for (let s = 0; s < starts; s++) {
    let balance = p.currentSavings;
    let base = p.currentSavings;   // 支出 = 0 時的餘額
    let perSpend = 0;              // 每 1 單位年支出對期末餘額的影響（線性）
    let depletedAt = null;
    let balanceAtRetire = retireMonth === 0 ? balance : NaN;
    yearly[0][s] = balance;

    for (let k = 0; k < totalMonths; k++) {
      const growth = 1 + r[(s + k) % L];
      const inflow = (k < retireMonth ? contribution : 0) + (k >= incomeMonth ? income : 0);
      base += inflow;
      balance += inflow;
      if (k >= retireMonth) {
        perSpend -= 1 / 12;
        balance -= spending;
        if (balance < -1e-6 && depletedAt === null) depletedAt = k;
        if (balance < 0) balance = 0;
      }
      balance *= growth;
      base *= growth;
      perSpend *= growth;
      if (k + 1 === retireMonth) balanceAtRetire = balance;
      if ((k + 1) % 12 === 0) yearly[(k + 1) / 12][s] = balance;
    }

    runs[s] = {
      start: returns[s].month,
      success: depletedAt === null,
      depletedAge: depletedAt === null ? null : p.currentAge + depletedAt / 12,
      endBalance: balance,
      balanceAtRetire,
      // 期末剛好歸零的年支出上限（淨提領始終 >= 0 時精確）
      maxSpending: perSpend < 0 ? Math.max(0, base / -perSpend) : Infinity
    };
  }

  const successCount = runs.filter(x => x.success).length;
  const sortedRuns = runs.slice().sort((a, b) =>
    (a.success - b.success) || ((a.depletedAge ?? Infinity) - (b.depletedAge ?? Infinity)) || (a.endBalance - b.endBalance));

  const bands = yearly.map((vals, y) => ({ age: p.currentAge + y, ...summarize(vals) }));
  const spendQs = summarize(runs.map(x => x.maxSpending), [5, 10, 50]);

  // 經典提領率分析：只看提領期（退休那一刻的資產為 100%）
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

  return {
    plan: p,
    history: {
      start: returns[0].month,
      end: returns[L - 1].month,
      months: L,
      method: circular ? 'circular' : 'rolling',
      starts
    },
    successRate: successCount / starts,
    endBalance: summarize(runs.map(x => x.endBalance)),
    balanceAtRetire: retireStats,
    initialWithdrawalRate: retireStats && retireStats.p50 > 0 ? netSpendAtRetire / retireStats.p50 : null,
    sustainableSpending: { p100: spendQs.min, p95: spendQs.p5, p90: spendQs.p10, p50: spendQs.p50 },
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
    byStartYear: runs.filter(x => x.start.endsWith('-01')).map(x => ({
      year: Number(x.start.slice(0, 4)), success: x.success, depletedAge: x.depletedAge, endBalance: x.endBalance
    }))
  };
}
