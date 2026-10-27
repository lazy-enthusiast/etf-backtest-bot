import { REBALANCE_LABELS, PLAN_LABELS, STORE } from './config.js';
import { state } from './state.js';
import { $, el, pct, money, intFmt } from './dom.js';
import { saveJSON } from './storage.js';
import { writePlanForm } from './plan-form.js';
import { writePortfolioForm, readPortfolioForm } from './portfolio-form.js';
import { recalc, setStatus } from './recalc.js';
import { saveConversations } from './chat.js';
import { migrateHoldingSymbol } from '../backtest/symbols.js';
import { parseHoldingWeight } from '../backtest/retirement.js';
import { buildApplyReceipt } from './context.js';

function toggleAdvisor(force) {
  const open = force ?? !document.body.classList.contains('advisor-open');
  document.body.classList.toggle('advisor-open', open);
}

export function parsePortfolioBlock(text) {
  let obj;
  try { obj = JSON.parse(text); } catch (e) { return null; }
  if (!obj || typeof obj.holdings !== 'object' || obj.holdings === null) return null;
  const holdings = {};
  const holdingTax = {};
  for (const [symbol, raw] of Object.entries(obj.holdings)) {
    const parsed = parseHoldingWeight(raw);
    // 僅對 mapping 已知美股裸代號補 .US；VWRD／IGLN 等保持原樣由 validate 攔截
    const s = migrateHoldingSymbol(symbol, state.usBareKeys);
    if (s && Number.isFinite(parsed.weight) && parsed.weight > 0) {
      holdings[s] = (holdings[s] || 0) + parsed.weight;
      if (parsed.tax) holdingTax[s] = parsed.tax;
    }
  }
  if (obj.holdingTax && typeof obj.holdingTax === 'object') {
    for (const [symbol, raw] of Object.entries(obj.holdingTax)) {
      const s = migrateHoldingSymbol(symbol, state.usBareKeys);
      const parsed = parseHoldingWeight({ weight: 1, ...raw });
      if (s && parsed.tax) holdingTax[s] = parsed.tax;
    }
  }
  if (!Object.keys(holdings).length) return null;
  const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  return {
    name: String(obj.name || 'AI 建議組合').slice(0, 40),
    holdings,
    ...(Object.keys(holdingTax).length ? { holdingTax } : {}),
    rebalance: REBALANCE_LABELS[obj.rebalance] ? obj.rebalance : 'annual',
    start: isDate(obj.start) ? obj.start : '',
    end: isDate(obj.end) ? obj.end : ''
  };
}

const PLAN_NUMERIC_KEYS = ['currentAge', 'retireAge', 'endAge', 'currentSavings', 'monthlyContribution', 'annualSpending', 'otherIncome', 'otherIncomeAge', 'inflationRate', 'feeRate'];

export function parsePlanBlock(text) {
  let obj;
  try { obj = JSON.parse(text); } catch (e) { return null; }
  if (!obj || typeof obj !== 'object') return null;
  const changes = {};
  for (const k of PLAN_NUMERIC_KEYS) if (obj[k] !== undefined && Number.isFinite(Number(obj[k]))) changes[k] = Number(obj[k]);
  if (obj.inflationMode === 'cpi' || obj.inflationMode === 'fixed') changes.inflationMode = obj.inflationMode;
  if (typeof obj.currency === 'string' && /^[A-Z]{3}$/.test(obj.currency)) changes.currency = obj.currency;
  if (obj.withdrawalStrategy === 'fixed_real' || obj.withdrawalStrategy === 'guardrails' || obj.withdrawalStrategy === 'vpw') {
    changes.withdrawalStrategy = obj.withdrawalStrategy;
  }
  for (const k of ['guardrailCeiling', 'guardrailFloor', 'guardrailAdjustPct']) {
    if (obj[k] !== undefined && Number.isFinite(Number(obj[k]))) changes[k] = Number(obj[k]);
  }
  if (obj.glidePath && typeof obj.glidePath === 'object') {
    const g = obj.glidePath;
    if (g.enabled === true || g.enabled === false) changes.glidePath = g.enabled;
    if (g.stockStart != null && Number.isFinite(Number(g.stockStart))) changes.glideStockStart = Number(g.stockStart);
    if (g.stockEnd != null && Number.isFinite(Number(g.stockEnd))) changes.glideEquityEnd = Number(g.stockEnd);
    if (g.bondFloor != null && Number.isFinite(Number(g.bondFloor))) changes.glideBondFloor = Number(g.bondFloor);
  } else if (obj.glidePath === true || obj.glidePath === false) changes.glidePath = obj.glidePath;
  if (Array.isArray(obj.equityTickers) || typeof obj.equityTickers === 'string') changes.equityTickers = obj.equityTickers;
  if (obj.glideEquityEnd === null) changes.glideEquityEnd = null;
  else if (obj.glideEquityEnd !== undefined && Number.isFinite(Number(obj.glideEquityEnd))) changes.glideEquityEnd = Number(obj.glideEquityEnd);
  if (obj.glideStockStart === null) changes.glideStockStart = null;
  else if (obj.glideStockStart !== undefined && Number.isFinite(Number(obj.glideStockStart))) changes.glideStockStart = Number(obj.glideStockStart);
  if (obj.glideBondFloor === null) changes.glideBondFloor = null;
  else if (obj.glideBondFloor !== undefined && Number.isFinite(Number(obj.glideBondFloor))) changes.glideBondFloor = Number(obj.glideBondFloor);
  if (obj.dividendTax === true || obj.dividendTax === false) changes.dividendTax = obj.dividendTax;
  if (obj.dividendYields && typeof obj.dividendYields === 'object') changes.dividendYields = obj.dividendYields;
  else if (typeof obj.dividendYields === 'string') changes.dividendYields = obj.dividendYields;
  if (obj.dividendTaxRates && typeof obj.dividendTaxRates === 'object') changes.dividendTaxRates = obj.dividendTaxRates;
  else if (typeof obj.dividendTaxRates === 'string') changes.dividendTaxRates = obj.dividendTaxRates;
  if (obj.feeSplit === true || obj.feeSplit === false) changes.feeSplit = obj.feeSplit;
  if (obj.fxMode === true || obj.fxMode === false) changes.fxMode = obj.fxMode;
  if (obj.spendingBasket && typeof obj.spendingBasket === 'object') changes.spendingBasket = obj.spendingBasket;
  else if (typeof obj.spendingBasket === 'string') changes.spendingBasket = obj.spendingBasket;
  if (obj.pathMode === 'historical' || obj.pathMode === 'bootstrap') changes.pathMode = obj.pathMode;
  if (obj.bootstrapSeed !== undefined && Number.isFinite(Number(obj.bootstrapSeed))) changes.bootstrapSeed = Math.trunc(Number(obj.bootstrapSeed));
  if (obj.bootstrapBlock !== undefined && Number.isFinite(Number(obj.bootstrapBlock))) changes.bootstrapBlock = Number(obj.bootstrapBlock);
  if (obj.spendingCurve === 'flat' || obj.spendingCurve === 'declining' || obj.spendingCurve === 'u_shape') changes.spendingCurve = obj.spendingCurve;
  if (Array.isArray(obj.lumpSums) || typeof obj.lumpSums === 'string') changes.lumpSums = obj.lumpSums;
  if (Array.isArray(obj.otherIncomeSegments) || typeof obj.otherIncomeSegments === 'string') changes.otherIncomeSegments = obj.otherIncomeSegments;
  if (obj.compareBootstrap === true || obj.compareBootstrap === false) changes.compareBootstrap = obj.compareBootstrap;
  if (obj.cashBucketYears === null || obj.cashBucketYears === false) changes.cashBucketYears = null;
  else if (obj.cashBucketYears === true) changes.cashBucketYears = true;
  else if (obj.cashBucketYears !== undefined && Number.isFinite(Number(obj.cashBucketYears))) changes.cashBucketYears = Number(obj.cashBucketYears);
  for (const k of ['withdrawEvery', 'guardrailEvery']) {
    if (obj[k] !== undefined && Number.isFinite(Number(obj[k]))) changes[k] = Number(obj[k]);
  }
  for (const k of ['ter', 'turnover', 'turnoverCost', 'fxSpread']) {
    if (obj[k] !== undefined && Number.isFinite(Number(obj[k]))) changes[k] = Number(obj[k]);
  }
  if (!Object.keys(changes).length) return null;
  return { note: typeof obj.note === 'string' ? obj.note.slice(0, 80) : '', changes };
}

export function formatPlanValue(key, v) {
  if (['currentSavings', 'monthlyContribution', 'annualSpending', 'otherIncome'].includes(key)) return intFmt.format(v);
  if (['inflationRate', 'feeRate', 'guardrailCeiling', 'guardrailFloor', 'guardrailAdjustPct'].includes(key)) return `${v}%`;
  if (key === 'inflationMode') return v === 'cpi' ? '美國 CPI' : '固定假設';
  if (key === 'withdrawalStrategy') {
    return ({ fixed_real: '固定實質', guardrails: '護欄法', vpw: 'VPW' })[v] || v;
  }
  if (key.endsWith('Age')) return `${v} 歲`;
  if (key === 'glidePath') return v ? '開' : '關';
  if (key === 'equityTickers') return Array.isArray(v) ? v.join('、') : String(v || '');
  if (key === 'glideEquityEnd' || key === 'glideStockStart' || key === 'glideBondFloor') return v == null || v === '' ? '維持目前' : `${v}%`;
  if (key === 'dividendTax') return v ? '開' : '關';
  if (key === 'feeSplit' || key === 'fxMode') return v ? '開' : '關';
  if (key === 'spendingBasket') return v && typeof v === 'object' ? Object.entries(v).map(([k, n]) => `${k}:${n}`).join(', ') : String(v || '');
  if (key === 'pathMode') return v === 'bootstrap' ? '拔靴' : '歷史起點';
  if (key === 'withdrawEvery' || key === 'guardrailEvery') return `${v} 個月`;
  if (key === 'cashBucketYears') return v == null || v === false ? '關' : (v === true ? '3 年' : `${v} 年`);
  if (key === 'spendingCurve') return ({ flat: '固定', declining: '75歲後遞減', u_shape: '先降後升' })[v] || v;
  if (key === 'compareBootstrap') return v ? '開' : '關';
  if (key === 'lumpSums' || key === 'otherIncomeSegments') return Array.isArray(v) ? `${v.length} 段` : String(v || '');
  if (['ter', 'turnover', 'turnoverCost', 'fxSpread'].includes(key)) return `${v}%`;
  if (key === 'dividendYields' || key === 'dividendTaxRates') {
    return v && typeof v === 'object' ? Object.entries(v).map(([k, n]) => `${k}:${n}`).join(', ') : String(v || '');
  }
  return String(v);
}

export function extractControlsFromText(text) {
  const portfolios = [];
  const plans = [];
  if (!text) return { portfolios, plans };
  const re = /```(portfolio|plan)\s*\n([\s\S]*?)```/gi;
  let m;
  while ((m = re.exec(text))) {
    if (m[1].toLowerCase() === 'portfolio') {
      const pf = parsePortfolioBlock(m[2].trim());
      if (pf) portfolios.push(pf);
    } else {
      const plan = parsePlanBlock(m[2].trim());
      if (plan) plans.push(plan);
    }
  }
  return { portfolios, plans };
}

export function buildPortfolioCard(pf) {
  const card = el('div', 'action-card');
  card.appendChild(el('div', 'ac-title', '📦 ' + pf.name));
  const chips = el('div', 'chips');
  Object.entries(pf.holdings).forEach(([s, w]) => chips.appendChild(el('span', 'chip', `${s} ${w}%`)));
  card.appendChild(chips);
  const range = (pf.start || pf.end) ? `；期間 ${pf.start || '最早'} ~ ${pf.end || '最新'}` : '';
  card.appendChild(el('div', 'ac-meta', `${REBALANCE_LABELS[pf.rebalance]}${range}`));
  const actions = el('div', 'ac-actions');
  const apply = el('button', 'btn primary', '套用並回測');
  apply.onclick = () => applyAiControls({ portfolio: pf, notifyAi: true });
  const fill = el('button', 'btn', '只填入組合');
  fill.onclick = () => { writePortfolioForm(pf); state.portfolio = readPortfolioForm(); saveJSON(STORE.portfolio, state.portfolio); toggleAdvisor(false); };
  actions.append(apply, fill);
  card.appendChild(actions);
  return card;
}

export function buildPlanCard(plan) {
  const card = el('div', 'action-card plan');
  card.appendChild(el('div', 'ac-title', '🎯 計劃調整' + (plan.note ? `：${plan.note}` : '')));
  const chips = el('div', 'chips');
  for (const [k, v] of Object.entries(plan.changes)) {
    const before = state.plan[k];
    chips.appendChild(el('span', 'chip', `${PLAN_LABELS[k] || k}：${formatPlanValue(k, before)} → ${formatPlanValue(k, v)}`));
  }
  card.appendChild(chips);
  const actions = el('div', 'ac-actions');
  const apply = el('button', 'btn primary', '套用計劃並重算');
  apply.onclick = () => applyAiControls({ plan, notifyAi: true });
  actions.appendChild(apply);
  card.appendChild(actions);
  return card;
}

export function summaryLine(cur, prev) {
  const s = cur.sim;
  const vs = prev ? `（上一版 ${pct(prev.sim.successRate, 1)}）` : '';
  return `成功率 ${pct(s.successRate, 1)}${vs}，95% 可持續年支出 ${money(s.sustainableSpending.p95)}，最差起點 ${s.worstRuns[0]?.start}${s.worstRuns[0] && !s.worstRuns[0].success ? `（${s.worstRuns[0].depletedAge.toFixed(1)} 歲耗盡）` : ''}，組合 CAGR ${pct(cur.result.stats.cagr, 2)}、最大回撤 ${pct(cur.result.stats.maxDrawdown, 1)}`;
}

export async function autoSendAfterApply(what) {
  const cur = state.current;
  if (!cur) return;
  if (state.isSending) { setStatus('已重算。AI 仍在回覆中，稍後可再請它分析。'); return; }
  const receipt = state.lastApplyReceipt;
  const receiptLine = receipt
    ? `執行回執：status=${receipt.status}` +
      (receipt.warning ? `；${receipt.warning}` : '') +
      `；實際期間 ${receipt.actual_start} 起共 ${receipt.period_years} 年（限制資產 ${receipt.limiting_asset}）。`
    : '';
  import('./chat.js').then(({ sendMessage }) => sendMessage(
    `已套用${what}並重算：${summaryLine(cur, state.previous)}。${receiptLine}請依回執分析（若 partial_data 先修正代號／起點），再繼續改良。`
  ));
}

export function describeControlApply(portfolio, plan) {
  const parts = [];
  if (portfolio) parts.push(`組合「${portfolio.name}」`);
  if (plan) parts.push(`計劃調整${plan.note ? `「${plan.note}」` : ''}`);
  return parts.join('與') || 'AI 建議';
}

export async function applyAiControls({ portfolio, plan, notifyAi = false } = {}) {
  if (!portfolio && !plan) return null;
  if (plan) {
    state.plan = { ...state.plan, ...plan.changes };
    writePlanForm();
  }
  if (portfolio) writePortfolioForm(portfolio);
  const cur = await recalc({ markPrevious: true, label: portfolio?.name });
  if (!cur) return null;
  state.lastApplyReceipt = buildApplyReceipt({ portfolio, plan, cur });
  const what = describeControlApply(portfolio, plan);
  const statusTag = state.lastApplyReceipt?.status === 'partial_data' ? '（數據被截斷）' : '';
  if (notifyAi) autoSendAfterApply(what);
  else setStatus(`已套用${what}並重算${statusTag}。`);
  return cur;
}

/** 單組建議自動寫入左側；多組比較則保留卡片供手動挑選 */
export async function maybeAutoApplyControls(botMsg) {
  if (!botMsg || botMsg.controlsApplied) return;
  const { portfolios, plans } = extractControlsFromText(botMsg.text);
  if (!portfolios.length && !plans.length) return;
  if (portfolios.length > 1 || plans.length > 1) return;
  botMsg.controlsApplied = true;
  saveConversations();
  await applyAiControls({ portfolio: portfolios[0], plan: plans[0], notifyAi: false });
}
