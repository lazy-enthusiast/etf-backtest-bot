import { STORE } from './config.js';
import { state } from './state.js';
import { $, el } from './dom.js';
import { saveJSON } from './storage.js';
import { normalizeSymbol, holdingSymbolError, SYMBOL_HINT } from '../backtest/symbols.js';

export function addHoldingRow(symbol, weight) {
  const row = el('div', 'holding');
  const sym = el('input', 'sym');
  sym.setAttribute('list', 'symbolList');
  sym.placeholder = 'VTI.US / VWRD.L / 2800.HK';
  sym.title = SYMBOL_HINT;
  // 不自動補 .US：裸代號留給 validateHoldings 攔截
  sym.value = normalizeSymbol(symbol);
  const w = el('input', 'w');
  w.type = 'number'; w.min = 0; w.step = 1; w.placeholder = '%';
  w.value = weight;
  const x = el('button', 'x-btn', '✕');
  x.title = '移除';
  x.onclick = () => { row.remove(); onPortfolioEdited(); };
  const bar = el('div', 'bar');
  bar.appendChild(el('span'));
  row.append(sym, w, x, bar);
  [sym, w].forEach(i => i.addEventListener('input', onPortfolioEdited));
  sym.addEventListener('change', () => {
    sym.value = normalizeSymbol(sym.value);
    onPortfolioEdited();
  });
  $('holdings').appendChild(row);
  updateWeightBars();
}

export function writePortfolioForm(pf) {
  $('holdings').innerHTML = '';
  Object.entries(pf.holdings).forEach(([s, w]) => addHoldingRow(s, w));
  $('rebalance').value = pf.rebalance || 'annual';
  $('btStart').value = pf.start || '';
  $('btEnd').value = pf.end || '';
  const nameEl = $('portfolioName');
  if (nameEl) nameEl.textContent = pf.name || '';
  updateWeightBars();
}

export function readPortfolioForm() {
  const holdings = {};
  document.querySelectorAll('#holdings .holding').forEach(row => {
    const s = normalizeSymbol(row.querySelector('.sym').value);
    const w = Number(row.querySelector('.w').value);
    if (s && w > 0) holdings[s] = (holdings[s] || 0) + w;
  });
  return {
    name: $('portfolioName')?.textContent || '自訂組合',
    holdings,
    rebalance: $('rebalance').value,
    start: $('btStart').value,
    end: $('btEnd').value
  };
}

export function validateHoldings(holdings) {
  const errors = [];
  for (const s of Object.keys(holdings || {})) {
    const err = holdingSymbolError(s);
    if (err) errors.push(err);
  }
  return errors;
}

export function updateWeightBars() {
  const rows = [...document.querySelectorAll('#holdings .holding')];
  const total = rows.reduce((a, r) => a + (Number(r.querySelector('.w').value) || 0), 0);
  rows.forEach(r => {
    const w = Number(r.querySelector('.w').value) || 0;
    r.querySelector('.bar span').style.width = total > 0 ? `${w / total * 100}%` : '0';
  });
  const off = Math.abs(total - 100) > 0.01;
  $('weightSum').textContent = `合計 ${Number(total.toFixed(2))}%${off ? '（自動按比例）' : ''}`;
  $('weightSum').style.color = off ? 'var(--warn)' : '';
}

export function onPortfolioEdited() {
  const nameEl = $('portfolioName');
  if (nameEl) nameEl.textContent = '自訂組合';
  updateWeightBars();
  state.portfolio = readPortfolioForm();
  saveJSON(STORE.portfolio, state.portfolio);
}
