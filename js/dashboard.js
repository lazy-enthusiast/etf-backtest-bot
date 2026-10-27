import { state } from './state.js';
import { STORE } from './config.js';
import { $, el, pct, num2, intFmt, money, compact } from './dom.js';
import { requiredPhaseReturns, inflationLabel, REQUIRED_RETURN_LABEL } from '../backtest/retirement.js';

export function themeColors() {
  const css = getComputedStyle(document.body);
  const v = name => css.getPropertyValue(name).trim();
  return { text: v('--text'), muted: v('--muted'), border: v('--border'), accent: v('--accent'), accent2: v('--accent-2'), good: v('--good'), bad: v('--bad'), warn: v('--warn'), faint: v('--faint') };
}

export function hexToRgba(hex, a) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export function makeChart(id, config) {
  if (state.charts[id]) state.charts[id].destroy();
  const canvas = $(id);
  if (!canvas || !window.Chart) return;
  const c = themeColors();
  Chart.defaults.color = c.muted;
  Chart.defaults.borderColor = c.border;
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  state.charts[id] = new Chart(canvas, config);
}

export function successTone(rate) {
  return rate >= 0.9 ? 'good' : rate >= 0.75 ? 'warn' : 'bad';
}

function setText(id, text) {
  const node = $(id);
  if (node) node.textContent = text;
  return node;
}

export function setDelta(id, cur, prev, fmt, higherIsBetter = true) {
  const node = $(id);
  if (!node) return;
  if (prev == null || !Number.isFinite(prev) || !Number.isFinite(cur)) { node.textContent = ''; node.className = 'delta'; return; }
  const diff = cur - prev;
  if (Math.abs(diff) < 1e-9) { node.textContent = '與上一版相同'; node.className = 'delta'; return; }
  const better = higherIsBetter ? diff > 0 : diff < 0;
  node.textContent = `${diff > 0 ? '▲' : '▼'} ${fmt(Math.abs(diff))} vs 上一版`;
  node.className = 'delta ' + (better ? 'up' : 'down');
}

function phaseRateText(annual, flag, belowLabel) {
  if (flag === 'above_cap') return '超過 30%';
  if (flag === 'below_zero') return belowLabel;
  if (!Number.isFinite(annual)) return null;
  return pct(annual);
}

function phaseTone(annual, flag, cagr) {
  if (flag === 'above_cap') return 'tone-bad';
  if (!Number.isFinite(annual) || !Number.isFinite(cagr) || annual <= cagr) return '';
  if (annual > cagr * 1.15) return 'tone-bad';
  return 'tone-warn';
}

function phaseDelta(cur, prev) {
  if (!prev) return [null, null];
  if (Number.isFinite(cur.withdrawalAnnual) && Number.isFinite(prev.withdrawalAnnual)) {
    return [cur.withdrawalAnnual, prev.withdrawalAnnual];
  }
  if (Number.isFinite(cur.accumulationAnnual) && Number.isFinite(prev.accumulationAnnual)) {
    return [cur.accumulationAnnual, prev.accumulationAnnual];
  }
  return [null, null];
}

function renderPhaseYield(phases, cagr) {
  const yieldEl = $('kpiYield');
  const subEl = $('kpiYieldSub');
  const accumText = phaseRateText(phases.accumulationAnnual, phases.flags.accumulation, '0% 以下');
  const withdrawText = phaseRateText(phases.withdrawalAnnual, phases.flags.withdrawal, '低於 0%');
  if (yieldEl) {
    yieldEl.style.color = '';
    yieldEl.classList.add('phase-rates');
    yieldEl.innerHTML = '';
    const addLine = (prefix, text, annual, flag) => {
      const line = el('div');
      line.append(document.createTextNode(`${prefix} `), el('span', phaseTone(annual, flag, cagr), text));
      yieldEl.append(line);
    };
    if (accumText) addLine('至退休', accumText, phases.accumulationAnnual, phases.flags.accumulation);
    if (withdrawText) addLine('退休後', withdrawText, phases.withdrawalAnnual, phases.flags.withdrawal);
    if (!accumText && !withdrawText) yieldEl.textContent = '—';
  }
  if (!subEl) return;
  subEl.innerHTML = '';
  if (!accumText && !withdrawText) {
    subEl.textContent = '無法計算（缺退休資產）';
    return;
  }
  const assumption = accumText
    ? '名目報酬。累積：現有資產＋每月投入，長到退休時中位資產。提領：由該資產支付淨支出至終點，允許花完本金。'
    : '名目報酬。提領：由現有資產支付淨支出至終點，允許花完本金。';
  subEl.append(document.createTextNode(assumption));
  if (Number.isFinite(cagr)) {
    subEl.append(document.createElement('br'), document.createTextNode(`對照組合歷史名目 CAGR ${pct(cagr)}（口徑不同，僅供參考）`));
  }
}

export function renderDashboard() {
  const cur = state.current;
  if (!cur) return;
  const { sim, plan } = cur;
  const prev = state.previous?.sim;
  const c = themeColors();

  const tone = successTone(sim.successRate);
  const meter = $('ringMeter');
  if (meter) {
    meter.style.stroke = c[tone];
    meter.setAttribute('stroke-dashoffset', String(314.16 * (1 - sim.successRate)));
  }
  const successText = pct(sim.successRate, sim.successRate > 0.995 && sim.successRate < 1 ? 1 : 0);
  setText('ringText', successText);
  const successEl = setText('kpiSuccess', successText);
  if (successEl) successEl.className = tone;
  const successSub = $('kpiSuccessSub');
  if (successSub) {
    successSub.innerHTML = '';
    const pill = el('span', 'pill ' + tone, tone === 'good' ? '穩健' : tone === 'warn' ? '需留意' : '風險高');
    const stratLabel = ({ fixed_real: '固定實質', guardrails: '護欄法', vpw: 'VPW' })[plan.withdrawalStrategy] || '固定實質';
    let successNote = ` ${stratLabel} · 撐到 ${plan.endAge} 歲（${intFmt.format(sim.history.starts)} 起點）`;
    if (plan.withdrawalStrategy !== 'fixed_real' && Number.isFinite(sim.successRateFixedReal)) {
      successNote += ` · 固定實質對照 ${pct(sim.successRateFixedReal, 0)}`;
    }
    successSub.append(pill, document.createTextNode(successNote));
  }
  setDelta('kpiSuccessDelta', sim.successRate, prev?.successRate, x => pct(x));

  const atRetire = sim.balanceAtRetire;
  setText('kpiRetire', atRetire ? compact(atRetire.p50) : '—');
  setText('kpiRetireSub', atRetire
    ? `（P10 ${compact(atRetire.p10)} · P90 ${compact(atRetire.p90)}）`
    : '（已在退休期）');
  setDelta('kpiRetireDelta', atRetire?.p50, prev?.balanceAtRetire?.p50, compact);

  const s95 = sim.sustainableSpending.p95;
  const monthly = s95 / 12;
  const targetMonthly = plan.annualSpending / 12;
  const gapMonthly = monthly - targetMonthly;
  const spend = $('kpiSpend');
  if (spend) {
    spend.innerHTML = '';
    spend.append(document.createTextNode(compact(monthly)), el('span', 'unit', '/月'));
  }
  setText('kpiSpendAnnual', compact(s95));
  const spendSub = $('kpiSpendSub');
  if (spendSub) {
    spendSub.innerHTML = '';
    const spendBasis = plan.withdrawalStrategy !== 'fixed_real' ? '固定實質口徑 · ' : '';
    spendSub.append(
      document.createTextNode(`${spendBasis}95% 成功可持續 · 年 ${compact(s95)} · 目標 ${compact(targetMonthly)}/月 · `),
      el('span', gapMonthly >= 0 ? 'delta up' : 'delta down', gapMonthly >= 0 ? `寬裕 ${compact(gapMonthly)}/月` : `不足 ${compact(-gapMonthly)}/月`)
    );
  }
  setDelta('kpiSpendDelta', monthly, prev?.sustainableSpending?.p95 != null ? prev.sustainableSpending.p95 / 12 : null, compact);

  const w = sim.withdrawalRates;
  const initRate = sim.initialWithdrawalRate;
  setText('kpiWithdraw', Number.isFinite(initRate) ? pct(initRate) : '—');
  setText('kpiWithdrawSub', atRetire
    ? `目標年支出 ÷ 退休時中位資產`
    : '已在退休期，以目前資產估算');
  const swrEl = setText('kpiSwr', w ? pct(w.swr.min, 2) : '—');
  const pwrEl = setText('kpiPwr', w ? pct(w.pwr.min, 2) : '—');
  if (w) {
    if (swrEl) swrEl.title = `${w.horizonYears} 年最差起點 ${w.worstStart} · P10 ${pct(w.swr.p10, 2)}`;
    if (pwrEl) pwrEl.title = `保住實質本金 · 中位 ${pct(w.pwr.p50, 2)}`;
  }
  setDelta('kpiWithdrawDelta', initRate, prev?.initialWithdrawalRate, x => pct(x), false);

  // 所需報酬（名目）分兩段：累積到退休時中位資產，以及退休後花到終點（允許花完本金）。不是支出÷資產。
  setText('kpiYieldLabel', REQUIRED_RETURN_LABEL);
  const nestEgg = atRetire?.p50;
  const alreadyRetired = plan.retireAge <= plan.currentAge || !Number.isFinite(nestEgg);
  const phases = requiredPhaseReturns(plan, { nestEgg, alreadyRetired });
  renderPhaseYield(phases, cur.result?.stats?.cagr);
  const prevPhases = state.previous?.plan
    ? requiredPhaseReturns(state.previous.plan, {
      nestEgg: prev?.balanceAtRetire?.p50,
      alreadyRetired: state.previous.plan.retireAge <= state.previous.plan.currentAge || !Number.isFinite(prev?.balanceAtRetire?.p50)
    })
    : null;
  const [deltaCur, deltaPrev] = phaseDelta(phases, prevPhases);
  setDelta('kpiYieldDelta', deltaCur, deltaPrev, x => pct(x), false);

  renderFanChart(cur, c);
  renderPathHighlights(cur);
  renderGlideHighlight(cur);
  renderDividendHighlight(cur);
  renderFeeHighlight(cur);
  renderFxHighlight(cur);
  renderInflationLabel(cur);
  renderBootstrapHighlight(cur);
  renderFrequencyHighlight(cur);
  renderActiveTab();
}

function renderFrequencyHighlight(cur) {
  const node = $('frequencyHighlight');
  const plan = cur?.plan;
  if (!node) return;
  if (!plan || (plan.withdrawEvery === 1 && plan.guardrailEvery === 12)) {
    node.hidden = true;
    node.textContent = '';
    return;
  }
  node.textContent = `提領每 ${plan.withdrawEvery} 個月，護欄每 ${plan.guardrailEvery} 個月檢查`;
  node.hidden = false;
}

function renderBootstrapHighlight(cur) {
  const node = $('bootstrapHighlight');
  if (!node) return;
  if (cur?.plan?.pathMode !== 'bootstrap') { node.hidden = true; node.textContent = ''; return; }
  node.textContent = `拔靴：${cur.plan.bootstrapBlock} 個月區塊，種子 ${cur.plan.bootstrapSeed}`;
  node.hidden = false;
}

function renderInflationLabel(cur) {
  const node = $('inflationLabel');
  if (!node) return;
  if (!cur?.plan) { node.hidden = true; node.textContent = ''; return; }
  node.textContent = inflationLabel(cur.plan, cur.cpiFallbackMonths);
  node.hidden = false;
}

function renderFxHighlight(cur) {
  const node = $('fxHighlight');
  if (!node) return;
  if (!cur?.plan?.fxMode) { node.hidden = true; node.textContent = ''; return; }
  if (cur.sim?.fxStatus?.skipped === 'twd') {
    node.textContent = '台幣支出需要匯率序列，這次沒有套用。';
  } else if (cur.sim?.fxSpend) {
    const peg = cur.sim.fxStatus?.twd ? '' : '（港幣為 7.8 聯繫匯率假設）';
    node.textContent = `匯率：中位實際提出 ${compact(cur.sim.fxSpend.withFx)}，未換算 ${compact(cur.sim.fxSpend.withoutFx)}${peg}`;
  } else node.textContent = '匯率未套用。';
  node.hidden = false;
}

function renderFeeHighlight(cur) {
  const node = $('feeHighlight');
  if (!node) return;
  if (!cur?.plan?.feeSplit) { node.hidden = true; node.textContent = ''; return; }
  const cmp = cur.sim?.feeSpend;
  node.textContent = cmp
    ? `費用拆分：中位實際提出 ${compact(cmp.withSplit)}，未拆分 ${compact(cmp.withoutSplit)}`
    : '費用拆分已取代單一費用率。';
  node.hidden = false;
}

function renderDividendHighlight(cur) {
  const node = $('dividendHighlight');
  if (!node) return;
  if (!cur?.plan?.dividendTax) { node.hidden = true; node.textContent = ''; return; }
  const cmp = cur.sim?.dividendSpend;
  node.textContent = cmp
    ? `股息稅：中位實際提出 ${compact(cmp.withTax)}，未扣稅 ${compact(cmp.withoutTax)}`
    : '股息稅未套用：請給假設殖利率與註冊地稅率。';
  node.hidden = false;
}

function renderGlideHighlight(cur) {
  const node = $('glideHighlight');
  const glide = cur?.sim?.glide;
  if (!node) return;
  if (!glide) { node.hidden = true; node.textContent = ''; return; }
  node.textContent = glide.skipped || !Number.isFinite(glide.min)
    ? '下滑路徑未套用：請同時標示股票代號與其他持倉。'
    : `實際股權重 ${pct(glide.min, 0)}–${pct(glide.max, 0)}`;
  node.hidden = false;
}

function renderPathHighlights(cur) {
  const node = $('pathHighlights');
  const brief = cur?.sim?.spendingBrief;
  if (!node) return;
  if (!brief?.tightest) { node.hidden = true; node.textContent = ''; return; }
  const lines = [`最緊的一年：${brief.tightest.age} 歲實質支出 ${compact(brief.tightest.spending)}`];
  if (brief.guardrail) lines.push(`護欄：最長連續下調 ${brief.guardrail.longest} 年，單次最大 ${compact(brief.guardrail.largest)}`);
  node.textContent = lines.join('\n');
  node.hidden = false;
}

const retireLinePlugin = {
  id: 'retireLine',
  afterDatasetsDraw(chart, args, opts) {
    if (opts.age == null) return;
    const x = chart.scales.x.getPixelForValue(opts.age);
    const { top, bottom } = chart.chartArea;
    const ctx = chart.ctx;
    ctx.save();
    ctx.strokeStyle = opts.color;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = opts.color;
    ctx.font = '600 11px sans-serif';
    ctx.fillText(`${opts.age} 歲退休`, x + 6, top + 12);
    ctx.restore();
  }
};

export function renderFanChart(cur, c) {
  const { sim, plan } = cur;
  const pts = key => sim.bands.map(b => ({ x: b.age, y: b[key] }));
  const datasets = [
    { label: 'P90', data: pts('p90'), borderColor: 'transparent', pointRadius: 0, fill: false },
    { label: 'P10–P90', data: pts('p10'), borderColor: hexToRgba(c.accent, 0.35), borderWidth: 1, pointRadius: 0, fill: '-1', backgroundColor: hexToRgba(c.accent, 0.10) },
    { label: 'P75', data: pts('p75'), borderColor: 'transparent', pointRadius: 0, fill: false },
    { label: 'P25–P75', data: pts('p25'), borderColor: 'transparent', pointRadius: 0, fill: '-1', backgroundColor: hexToRgba(c.accent, 0.20) },
    { label: '中位數', data: pts('p50'), borderColor: c.accent, borderWidth: 2.5, pointRadius: 0, fill: false },
    { label: '最差（最低值）', data: pts('min'), borderColor: c.bad, borderWidth: 1.2, borderDash: [5, 4], pointRadius: 0, fill: false }
  ];
  makeChart('fanChart', {
    type: 'line',
    data: { datasets },
    plugins: [retireLinePlugin],
    options: {
      animation: false, maintainAspectRatio: false, parsing: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { type: 'linear', min: plan.currentAge, max: plan.endAge, ticks: { stepSize: 5, callback: v => `${v} 歲` }, grid: { display: false } },
        y: { beginAtZero: true, ticks: { callback: v => compact(v) } }
      },
      plugins: {
        retireLine: { age: plan.retireAge > plan.currentAge ? plan.retireAge : null, color: c.warn },
        legend: { labels: { boxWidth: 12, filter: item => !['P90', 'P75'].includes(item.text) } },
        tooltip: {
          filter: item => !['P90–', 'P75'].includes(item.dataset.label),
          callbacks: {
            title: items => `${items[0].parsed.x} 歲`,
            label: item => {
              const b = sim.bands.find(x => x.age === item.parsed.x);
              const map = { 'P10–P90': ['P10', b.p10], 'P25–P75': ['P25', b.p25], '中位數': ['中位數', b.p50], '最差（最低值）': ['最差', b.min], 'P90': ['P90', b.p90], 'P75': ['P75', b.p75] };
              const [name, value] = map[item.dataset.label] || [item.dataset.label, item.parsed.y];
              return `${name}：${money(value)}`;
            }
          }
        }
      }
    }
  });
  setText('fanHint', `${plan.currency}，今日幣值`);
  const h = sim.history;
  const method = h.method === 'rolling' ? '完整歷史窗口' : '歷史不足計劃年限，以循環序列補足';
  const infl = plan.inflationMode === 'cpi'
    ? `美國 CPI${cur.cpiFallbackMonths ? `（最近 ${cur.cpiFallbackMonths} 個月缺 CPI，以 ${plan.inflationRate}% 替代）` : ''}`
    : `固定 ${plan.inflationRate}%/年`;
  setText('fanNote', `以 ${h.start} ~ ${h.end} 每個起始月份各模擬一次（${intFmt.format(h.starts)} 次，${method}）。通膨：${infl}；費用 ${plan.feeRate}%/年。色帶為各年齡資產的 P10–P90 與 P25–P75。`);
}

const TAB_RENDERERS = { scenarios: renderScenarios, performance: renderPerformance, assets: renderAssets };

const TAB_NAMES = ['overview', 'scenarios', 'performance', 'assets'];

export function renderActiveTab() {
  const active = TAB_NAMES.includes(state.tab) ? state.tab : 'overview';
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === active));
  TAB_NAMES.forEach(t => {
    const panel = $('tab-' + t);
    if (panel) panel.hidden = t !== active;
  });
  if (!state.current) return;
  TAB_RENDERERS[active]?.();
}

export function statBox(k, v, p, neg) {
  const box = el('div', 'stat');
  box.append(el('div', 'k', k), el('div', 'v' + (neg ? ' neg' : ''), v));
  if (p) box.appendChild(el('div', 'p', p));
  return box;
}

export function table(headers, rows, className = 'tbl') {
  const wrap = el('div', 'tbl-wrap');
  const t = el('table', className);
  const head = t.insertRow();
  headers.forEach(h => head.appendChild(el('th', '', h)));
  rows.forEach(cells => {
    const tr = t.insertRow();
    cells.forEach(c => {
      const td = tr.insertCell();
      if (c && typeof c === 'object') {
        td.textContent = c.text;
        if (c.neg) td.classList.add('neg');
        if (c.bg) td.style.background = c.bg;
        if (c.title) td.title = c.title;
      } else td.textContent = c;
    });
  });
  wrap.appendChild(t);
  return wrap;
}

export function renderScenarios() {
  const { sim, plan } = state.current;
  const box = $('tab-scenarios');
  if (!box) return;
  box.innerHTML = '';
  const c = themeColors();
  const w = sim.withdrawalRates;

  const grid = el('div', 'stat-grid');
  grid.append(
    statBox('期末資產（中位）', compact(sim.endBalance.p50), `P10 ${compact(sim.endBalance.p10)} · 最差 ${compact(sim.endBalance.min)}`),
    statBox('100% 成功年支出', compact(sim.sustainableSpending.p100), `90% 成功：${compact(sim.sustainableSpending.p90)}`),
    statBox(`安全提領率 SWR（${w.horizonYears} 年）`, pct(w.swr.min, 2), `最差起點 ${w.worstStart} · P10 ${pct(w.swr.p10, 2)}`),
    statBox('永續提領率 PWR', pct(w.pwr.min, 2), `保住實質本金 · 中位 ${pct(w.pwr.p50, 2)}`)
  );
  box.appendChild(grid);

  box.appendChild(el('div', 'section-h', '每個起始年份的結果（以 1 月起點為代表）'));
  const chartBox = el('div', 'chart-box short');
  const canvas = el('canvas');
  canvas.id = 'startYearChart';
  chartBox.appendChild(canvas);
  box.appendChild(chartBox);
  box.appendChild(el('div', 'legend-note', '綠柱：資產撐到計劃終點，高度為期末資產。紅柱：中途耗盡，高度為未能支付的支出缺口（負值）。'));

  const data = sim.byStartYear;
  makeChart('startYearChart', {
    type: 'bar',
    data: {
      labels: data.map(d => d.year),
      datasets: [{
        data: data.map(d => d.success ? d.endBalance : -(plan.endAge - d.depletedAge) * plan.annualSpending),
        backgroundColor: data.map(d => hexToRgba(d.success ? c.good : c.bad, 0.75)),
        borderWidth: 0, barPercentage: 1, categoryPercentage: 0.9
      }]
    },
    options: {
      animation: false, maintainAspectRatio: false,
      scales: { x: { ticks: { maxTicksLimit: 12, autoSkip: true }, grid: { display: false } }, y: { ticks: { callback: v => compact(v) } } },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: items => `${items[0].label} 年 1 月起`,
            label: item => {
              const d = data[item.dataIndex];
              return d.success ? `成功，期末 ${money(d.endBalance)}` : `${d.depletedAge.toFixed(1)} 歲耗盡`;
            }
          }
        }
      }
    }
  });

  box.appendChild(el('div', 'section-h', '最差的 5 個起始時點'));
  box.appendChild(table(['起始月份', '結果', '退休時資產', '期末資產'], sim.worstRuns.map(r => [
    r.start,
    { text: r.success ? `成功（撐到 ${plan.endAge} 歲）` : `${r.depletedAge.toFixed(1)} 歲耗盡`, neg: !r.success },
    Number.isFinite(r.balanceAtRetire) ? money(r.balanceAtRetire) : '—',
    money(r.endBalance)
  ])));
}

export function renderPerformance() {
  const { result: r } = state.current;
  const prev = state.previous?.result;
  const box = $('tab-performance');
  if (!box) return;
  box.innerHTML = '';
  const s = r.stats;
  const ps = prev?.stats;
  const growth = r.finalValue / r.portfolio.initial;

  const head = el('div', 'small muted');
  head.style.marginBottom = '10px';
  head.textContent = `${state.current.portfolio.name} · ${r.period.start} ~ ${r.period.end}（${r.period.years.toFixed(1)} 年，起點受 ${r.period.limitingAsset} 限制）· 名目報酬，未扣計劃費用`;
  box.appendChild(head);

  const grid = el('div', 'stat-grid');
  grid.append(
    statBox('CAGR', pct(s.cagr, 2), ps && `上一版 ${pct(ps.cagr, 2)}`, s.cagr < 0),
    statBox('年化波動', pct(s.volatility, 2), ps && `上一版 ${pct(ps.volatility, 2)}`),
    statBox('最大回撤', pct(s.maxDrawdown, 2), `${s.peakDate} → ${s.troughDate}`, true),
    statBox('Sharpe (rf=0)', num2(s.sharpe), ps && `上一版 ${num2(ps.sharpe)}`),
    statBox('Sortino', num2(s.sortino)),
    statBox('Calmar', num2(s.calmar)),
    statBox('累積倍數', `${growth >= 100 ? intFmt.format(growth) : growth.toFixed(1)}x`),
    statBox('回撤回復', s.recoveryDate || '尚未回復')
  );
  box.appendChild(grid);

  const toggle = el('div', 'toggle-line');
  toggle.appendChild(el('b', '', '淨值曲線'));
  toggle.appendChild(el('span', 'spacer'));
  const lab = el('label');
  const cb = el('input');
  cb.type = 'checkbox';
  cb.checked = state.logScale;
  cb.onchange = () => { state.logScale = cb.checked; localStorage.setItem(STORE.logScale, cb.checked ? '1' : '0'); renderPerformance(); };
  lab.append(cb, document.createTextNode('對數座標'));
  toggle.appendChild(lab);
  box.appendChild(toggle);
  const cbox = el('div', 'chart-box short');
  const canvas = el('canvas'); canvas.id = 'equityChart';
  cbox.appendChild(canvas);
  box.appendChild(cbox);

  const c = themeColors();
  const toPoints = res => res.equityMonthly.map(([d, v]) => ({ x: Date.parse(d), y: v / res.portfolio.initial }));
  const datasets = [{ label: state.current.portfolio.name, data: toPoints(r), borderColor: c.accent, borderWidth: 1.6, pointRadius: 0 }];
  if (prev) datasets.push({ label: '上一版：' + state.previous.portfolio.name, data: toPoints(prev), borderColor: c.faint, borderWidth: 1.2, borderDash: [4, 3], pointRadius: 0 });
  const niceLog = v => {
    const m = v / 10 ** Math.floor(Math.log10(v));
    return [1, 2, 5].some(n => Math.abs(m - n) < 1e-6) ? `${Number(v.toPrecision(2))}x` : '';
  };
  makeChart('equityChart', {
    type: 'line',
    data: { datasets },
    options: {
      animation: false, maintainAspectRatio: false, parsing: false,
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      scales: {
        x: { type: 'linear', min: Math.min(...datasets.map(d => d.data[0].x)), max: Math.max(...datasets.map(d => d.data.at(-1).x)), ticks: { maxTicksLimit: 10, callback: v => new Date(v).getUTCFullYear() }, grid: { display: false } },
        y: state.logScale ? { type: 'logarithmic', ticks: { callback: niceLog } } : { ticks: { callback: v => `${v}x` } }
      },
      plugins: {
        legend: { labels: { boxWidth: 12 } },
        tooltip: { callbacks: { title: items => new Date(items[0].parsed.x).toISOString().slice(0, 7), label: item => `${item.dataset.label}：${item.parsed.y.toFixed(2)}x` } }
      }
    }
  });

  box.appendChild(el('div', 'section-h', '逐年報酬'));
  const abox = el('div', 'chart-box short');
  const acanvas = el('canvas'); acanvas.id = 'annualChart';
  abox.appendChild(acanvas);
  box.appendChild(abox);
  const years = r.annualReturns;
  makeChart('annualChart', {
    type: 'bar',
    data: { labels: years.map(y => y.year), datasets: [{ data: years.map(y => y.return * 100), backgroundColor: years.map(y => hexToRgba(y.return >= 0 ? c.good : c.bad, y.partial ? 0.35 : 0.8)), borderWidth: 0, barPercentage: 1, categoryPercentage: 0.85 }] },
    options: {
      animation: false, maintainAspectRatio: false,
      scales: { x: { ticks: { maxTicksLimit: 14 }, grid: { display: false } }, y: { ticks: { callback: v => `${v}%` } } },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: item => `${item.parsed.y.toFixed(2)}%${years[item.dataIndex].partial ? '（不完整年度）' : ''}` } } }
    }
  });
}

export function renderAssets() {
  const { result: r } = state.current;
  const box = $('tab-assets');
  if (!box) return;
  box.innerHTML = '';
  box.appendChild(el('div', 'section-h', '個別資產（同一期間）'));
  box.appendChild(table(['代號', '權重', 'CAGR', '波動', '最大回撤', '數據來源（新 ← 舊）'], r.assets.map(a => [
    a.symbol, pct(a.weight), pct(a.cagr, 2), pct(a.volatility, 2), { text: pct(a.maxDrawdown, 2), neg: true },
    a.dataSources.slice().reverse().map(d => `${d.symbol}（${d.from.slice(0, 4)}~）`).join(' ← ')
  ])));

  if (r.correlation.symbols.length > 1) {
    box.appendChild(el('div', 'section-h', '相關係數（月報酬）'));
    const c = themeColors();
    box.appendChild(table(['', ...r.correlation.symbols], r.correlation.symbols.map((sym, i) => [
      sym, ...r.correlation.matrix[i].map(v => ({ text: v.toFixed(2), bg: hexToRgba(v >= 0 ? c.accent : c.good, Math.min(0.6, Math.abs(v) * 0.6)) }))
    ]), 'tbl heat'));
  }

  const warnings = [...r.warnings];
  if (state.current.sim.history.method === 'circular') warnings.push('歷史長度不足整個計劃年限，退休模擬以循環序列（走到尾端接回開頭）補足，結果較不可靠。');
  if (state.current.cpiFallbackMonths) warnings.push(`最近 ${state.current.cpiFallbackMonths} 個月沒有 CPI 資料，以固定通膨 ${state.current.plan.inflationRate}% 替代。`);
  warnings.push('各資產以自身幣別計算，未做匯率換算；美國 CPI 未必反映你所在地的通膨。');
  box.appendChild(el('div', 'section-h', '數據限制'));
  const ul = el('ul', 'warn-list');
  warnings.forEach(w => ul.appendChild(el('li', '', w)));
  box.appendChild(ul);
}
