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
    const result = await runBacktestCached(pf);
    const draft = readPlanForm();
    const cpi = draft.inflationMode === 'fixed' ? null : await loadCpi(meta);
    const prepared = meta.retirement.prepareRetirement({
      plan: draft,
      holdings: pf.holdings,
      holdingTax: pf.holdingTax,
      equityMonthly: result.equityMonthly,
      assetMonthly: result.assetMonthly,
      cpiSeries: cpi
    });
    const plan = prepared.plan;
    state.plan = plan;
    saveJSON(STORE.plan, plan);
    const sim = meta.retirement.runPrepared(prepared);
    if (seq !== recalcSeq) return null;
    if (markPrevious && state.current) state.previous = state.current;
    state.current = {
      label: label || pf.name, portfolio: pf, plan, result, sim,
      cpiFallbackMonths: prepared.cpiFallbackMonths,
      series: prepared.returns,
      glide: prepared.glide,
      dividend: prepared.dividend,
      fx: prepared.fx,
      taxDrag: prepared.taxDrag,
      cashSleeve: prepared.cashSleeve
    };
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
