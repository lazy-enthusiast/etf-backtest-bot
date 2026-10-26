import { STORE } from './config.js';
import { state } from './state.js';
import { $, intFmt } from './dom.js';
import { saveJSON } from './storage.js';
import { loadMeta, runBacktestCached, loadCpi } from './data.js';
import { readPlanForm } from './plan-form.js';
import { readPortfolioForm, validateHoldings } from './portfolio-form.js';
import { renderDashboard } from './dashboard.js';

export function setStatus(text, isError) {
  $('status').textContent = text;
  $('status').classList.toggle('error', Boolean(isError));
}

let recalcSeq = 0;
export async function recalc({ markPrevious = true, label } = {}) {
  const seq = ++recalcSeq;
  const pf = readPortfolioForm();
  if (!Object.keys(pf.holdings).length) { setStatus('請至少輸入一檔 ETF 與權重。', true); return null; }
  const symErrors = validateHoldings(pf.holdings);
  if (symErrors.length) { setStatus('計算失敗：' + symErrors[0], true); return null; }
  state.portfolio = pf;
  saveJSON(STORE.portfolio, pf);
  $('calcBtn').disabled = true;
  setStatus('計算中…');
  try {
    const meta = await loadMeta();
    const plan = meta.retirement.normalizePlan(readPlanForm());
    state.plan = plan;
    saveJSON(STORE.plan, plan);
    const result = await runBacktestCached(pf);
    const cpi = plan.inflationMode === 'cpi' ? await loadCpi(meta) : null;
    const { returns, cpiFallbackMonths } = meta.retirement.realMonthlyReturns(result.equityMonthly, plan, cpi);
    const glide = meta.retirement.buildGlide(result.assetMonthly, pf.holdings, plan, cpi);
    const dividend = meta.retirement.buildDividendTax(pf.holdings, plan);
    const baselineReturns = plan.feeSplit && !plan.glidePath
      ? meta.retirement.realMonthlyReturns(result.equityMonthly, { ...plan, feeSplit: false }, cpi).returns
      : null;
    const sim = meta.retirement.simulateRetirement(plan, returns, glide, dividend, baselineReturns);
    if (seq !== recalcSeq) return null;
    if (markPrevious && state.current) state.previous = state.current;
    state.current = { label: label || pf.name, portfolio: pf, plan, result, sim, cpiFallbackMonths };
    renderDashboard();
    setStatus(`已更新 · 歷史 ${sim.history.start} ~ ${sim.history.end} · ${intFmt.format(sim.history.starts)} 個起始月份`);
    return state.current;
  } catch (e) {
    console.error(e);
    if (seq === recalcSeq) setStatus('計算失敗：' + e.message, true);
    return null;
  } finally {
    if (seq === recalcSeq) $('calcBtn').disabled = false;
  }
}
