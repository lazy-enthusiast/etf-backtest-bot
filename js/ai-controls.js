import { REBALANCE_LABELS, PLAN_LABELS, STORE } from './config.js';
import { state } from './state.js';
import { $, el, pct, money, intFmt } from './dom.js';
import { saveJSON } from './storage.js';
import { writePlanForm } from './plan-form.js';
import { writePortfolioForm, readPortfolioForm } from './portfolio-form.js';
import { recalc, setStatus } from './recalc.js';
import { saveConversations } from './chat.js';

function toggleAdvisor(force) {
  const open = force ?? !document.body.classList.contains('advisor-open');
  document.body.classList.toggle('advisor-open', open);
}

export function parsePortfolioBlock(text) {
  let obj;
  try { obj = JSON.parse(text); } catch (e) { return null; }
  if (!obj || typeof obj.holdings !== 'object' || obj.holdings === null) return null;
  const holdings = {};
  for (const [symbol, weight] of Object.entries(obj.holdings)) {
    const w = Number(weight);
    const s = String(symbol).trim().toUpperCase();
    if (s && Number.isFinite(w) && w > 0) holdings[s] = w;
  }
  if (!Object.keys(holdings).length) return null;
  const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  return {
    name: String(obj.name || 'AI 建議組合').slice(0, 40),
    holdings,
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
  if (!Object.keys(changes).length) return null;
  return { note: typeof obj.note === 'string' ? obj.note.slice(0, 80) : '', changes };
}

export function formatPlanValue(key, v) {
  if (['currentSavings', 'monthlyContribution', 'annualSpending', 'otherIncome'].includes(key)) return intFmt.format(v);
  if (['inflationRate', 'feeRate'].includes(key)) return `${v}%`;
  if (key === 'inflationMode') return v === 'cpi' ? '美國 CPI' : '固定假設';
  if (key.endsWith('Age')) return `${v} 歲`;
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
  import('./chat.js').then(({ sendMessage }) => sendMessage(`已套用${what}並重算：${summaryLine(cur, state.previous)}。請分析結果並繼續改良。`));
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
  const what = describeControlApply(portfolio, plan);
  if (notifyAi) autoSendAfterApply(what);
  else setStatus(`已套用${what}並重算。`);
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
