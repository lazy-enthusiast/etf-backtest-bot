import { state } from './state.js';
import { pct, num2, money, compact } from './dom.js';
import { loadMeta, backtestableSymbols, earliestDate } from './data.js';

function describeWithdrawal(p) {
  if (p.withdrawalStrategy === 'guardrails') {
    return `護欄法（Guyton-Klinger：提領率>${p.guardrailCeiling}% 砍 ${p.guardrailAdjustPct}%、<${p.guardrailFloor}% 加 ${p.guardrailAdjustPct}%）`;
  }
  if (p.withdrawalStrategy === 'vpw') return '變動百分比 VPW（每月提領＝剩餘資產÷剩餘月數）';
  return '固定實質提領（每年固定今日幣值）';
}

export function describePlan(p) {
  const income = p.otherIncome > 0 ? `其他收入每年 ${money(p.otherIncome, p.currency)}（${p.otherIncomeAge} 歲起）` : '無其他退休收入';
  const infl = p.inflationMode === 'cpi' ? `美國歷史 CPI（缺月以 ${p.inflationRate}% 替代）` : `固定 ${p.inflationRate}%/年`;
  return [
    `幣別 ${p.currency}；目前 ${p.currentAge} 歲、${p.retireAge} 歲退休、規劃至 ${p.endAge} 歲（所有金額為今日幣值）`,
    `現有投資資產 ${money(p.currentSavings, p.currency)}；每月投入 ${money(p.monthlyContribution, p.currency)}（至退休）；退休後目標年支出 ${money(p.annualSpending, p.currency)}；${income}`,
    `提領規則：${describeWithdrawal(p)}`,
    `通膨：${infl}；費用＋成本 ${p.feeRate}%/年`
  ].join('\n');
}

export function describeSim(cur) {
  const { sim, plan } = cur;
  const h = sim.history;
  const w = sim.withdrawalRates;
  const keyAges = [...new Set([plan.retireAge, plan.retireAge + 10, plan.retireAge + 20, plan.endAge])].filter(a => a >= plan.currentAge && a <= plan.endAge);
  const flex = sim.spendingFlexibility;
  const lines = [
    `方法：${h.start} ~ ${h.end} 共 ${h.months} 個月實質報酬（已扣費用與通膨），${h.starts} 個起始月份（${h.method === 'rolling' ? '完整歷史窗口' : '歷史不足，循環序列'}）${cur.cpiFallbackMonths ? `；${cur.cpiFallbackMonths} 個月缺 CPI` : ''}`,
    `提領規則 ${describeWithdrawal(plan)}；成功率 ${pct(sim.successRate, 1)}` +
      (plan.withdrawalStrategy !== 'fixed_real' ? `（對照固定實質 ${pct(sim.successRateFixedReal, 1)}）` : ''),
    sim.balanceAtRetire ? `退休時資產：中位 ${money(sim.balanceAtRetire.p50)}、P10 ${money(sim.balanceAtRetire.p10)}、P90 ${money(sim.balanceAtRetire.p90)}；以中位數計初始淨提領率 ${pct(sim.initialWithdrawalRate, 2)}` : '已在退休期',
    `期末資產（${plan.endAge} 歲）：中位 ${money(sim.endBalance.p50)}、P10 ${money(sim.endBalance.p10)}、最差 ${money(sim.endBalance.min)}`,
    `可持續年支出（固定實質口徑）：100% 歷史成功 ${money(sim.sustainableSpending.p100)}、95% ${money(sim.sustainableSpending.p95)}、90% ${money(sim.sustainableSpending.p90)}、中位 ${money(sim.sustainableSpending.p50)}（目前目標 ${money(plan.annualSpending)}）`,
    flex ? `實際／目標累積提領比：P10 ${pct(flex.spendRatio.p10, 0)}、中位 ${pct(flex.spendRatio.p50, 0)}、P90 ${pct(flex.spendRatio.p90, 0)}；達目標九成的月份占比中位 ${pct(flex.coverageRate.p50, 0)}` : null,
    `提領期 ${w.horizonYears} 年的 SWR：最差 ${pct(w.swr.min, 2)}（${w.worstStart} 起）、P5 ${pct(w.swr.p5, 2)}、P10 ${pct(w.swr.p10, 2)}、中位 ${pct(w.swr.p50, 2)}；PWR：最差 ${pct(w.pwr.min, 2)}、P10 ${pct(w.pwr.p10, 2)}、中位 ${pct(w.pwr.p50, 2)}`,
    '最差起始時點：' + sim.worstRuns.map(r => `${r.start}${r.success ? '（成功）' : `（${r.depletedAge.toFixed(1)} 歲耗盡）`}`).join('、'),
    '各年齡資產分位：' + keyAges.map(a => {
      const b = sim.bands.find(x => x.age === a);
      return b ? `${a} 歲 P10 ${compact(b.p10)} / 中位 ${compact(b.p50)} / P90 ${compact(b.p90)}` : '';
    }).filter(Boolean).join('；')
  ].filter(Boolean);
  const failedYears = sim.byStartYear.filter(d => !d.success).map(d => d.year);
  if (failedYears.length) lines.push(`失敗的起始年份（1 月起點）：${failedYears.slice(0, 40).join('、')}${failedYears.length > 40 ? ' 等' : ''}`);
  return lines.join('\n');
}

export function describeBacktest(name, r, brief) {
  const s = r.stats;
  const lines = [
    `組合：${name}；權重：${r.portfolio.holdings.map(h => `${h.symbol} ${(h.weight * 100).toFixed(1)}%`).join('、')}；再平衡：${r.portfolio.rebalance}`,
    `期間：${r.period.start} ~ ${r.period.end}（${r.period.years.toFixed(1)} 年），起點受 ${r.period.limitingAsset} 限制`,
    `名目 CAGR ${pct(s.cagr, 2)}、年化波動 ${pct(s.volatility, 2)}、Sharpe(rf=0) ${num2(s.sharpe)}、Sortino ${num2(s.sortino)}、Calmar ${num2(s.calmar)}`,
    `最大回撤 ${pct(s.maxDrawdown, 2)}（${s.peakDate} → ${s.troughDate}，回復：${s.recoveryDate || '尚未回復'}）`
  ];
  if (brief) return lines.join('\n');
  const yearly = r.annualReturns;
  const shown = yearly.length > 60 ? yearly.filter(y => y.return < -0.1 || y.return > 0.25 || y.year >= yearly.at(-1).year - 30) : yearly;
  lines.push(`逐年報酬${shown.length < yearly.length ? '（只列近 30 年及 -10% 以下或 +25% 以上的年份）' : ''}：` + shown.map(y => `${y.year}${y.partial ? '*' : ''} ${pct(y.return)}`).join('、'));
  lines.push('各資產（同期間）：');
  for (const a of r.assets) {
    lines.push(`- ${a.symbol}：權重 ${(a.weight * 100).toFixed(1)}%，CAGR ${pct(a.cagr, 2)}，波動 ${pct(a.volatility, 2)}，最大回撤 ${pct(a.maxDrawdown, 2)}；數據：${a.dataSources.map(d => `${d.symbol}[${d.type}] ${d.from.slice(0, 4)}~`).join(' ← ')}`);
  }
  const c = r.correlation;
  if (c.symbols.length > 1) {
    lines.push('月報酬相關係數：' + c.symbols.map((sym, i) => `${sym}[${c.symbols.map((o, j) => j > i ? `${o} ${c.matrix[i][j].toFixed(2)}` : '').filter(Boolean).join(' ')}]`).filter(x => !x.endsWith('[]')).join('；'));
  }
  if (r.warnings.length) lines.push('注意：' + r.warnings.join('；'));
  return lines.join('\n');
}

export async function buildBacktestContext() {
  const parts = [];
  try {
    const meta = await loadMeta();
    parts.push('【可回測代號】（括號內為含替代序列後最早年份）：' + backtestableSymbols(meta).map(s => `${s}(${earliestDate(meta, s).slice(0, 4)})`).join('、'));
  } catch (e) {
    parts.push('【可回測代號】載入失敗');
  }
  parts.push('【退休計劃】\n' + describePlan(state.plan));
  const cur = state.current;
  if (cur) {
    parts.push('【退休模擬結果】\n' + describeSim(cur));
    parts.push('【組合回測】\n' + describeBacktest(cur.portfolio.name, cur.result, false));
  } else {
    parts.push('（尚未完成計算）');
  }
  const prev = state.previous;
  if (prev) {
    parts.push(`【上一版，供比較】\n退休年齡 ${prev.plan.retireAge}、年支出 ${money(prev.plan.annualSpending)}、每月投入 ${money(prev.plan.monthlyContribution)}；成功率 ${pct(prev.sim.successRate, 1)}；95% 可持續年支出 ${money(prev.sim.sustainableSpending.p95)}\n` + describeBacktest(prev.portfolio.name, prev.result, true));
  }
  let text = parts.join('\n\n');
  if (text.length > 11800) text = text.slice(0, 11800) + '\n…（已截斷）';
  return text;
}
