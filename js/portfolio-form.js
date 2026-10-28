import { STORE } from './config.js';
import { state } from './state.js';
import { $, el } from './dom.js';
import { saveJSON } from './storage.js';
import { normalizeSymbol, holdingSymbolError, SYMBOL_HINT } from '../backtest/symbols.js';
import { bindNumericInput, readInputNumber } from './numeric-input.js';

export function addHoldingRow(symbol, weight, tax) {
  const row = el('div', 'holding');
  const line = el('div', 'holding-line');
  const sym = el('input', 'sym');
  sym.setAttribute('list', 'symbolList');
  sym.placeholder = 'VTI.US / VWRD.L / 2800.HK';
  sym.title = SYMBOL_HINT;
  // 不自動補 .US：裸代號留給 validateHoldings 攔截
  sym.value = normalizeSymbol(symbol);
  const w = el('input', 'w');
  w.placeholder = '%';
  bindNumericInput(w, { integer: false, min: 0, step: 1 });
  w.value = weight ?? '';
  const x = el('button', 'x-btn', '✕');
  x.title = '移除';
  x.onclick = () => { row.remove(); onPortfolioEdited(); };
  const dom = el('select', 'tax-dom');
  dom.title = '估計：註冊地稅率。不選則不扣稅。';
  for (const [value, label] of [['', '不計稅'], ['IE', 'IE 15%'], ['US', 'US 30%'], ['other', '其他']]) {
    const opt = el('option');
    opt.value = value;
    opt.textContent = label;
    dom.appendChild(opt);
  }
  const domicile = String(tax?.taxDomicile || '').toUpperCase();
  dom.value = domicile === 'IE' || domicile === 'US' ? domicile : (domicile ? 'other' : '');
  const yieldInput = el('input', 'tax-yield');
  yieldInput.placeholder = '殖利率%';
  yieldInput.title = '估計：假設年殖利率。空白則這檔不扣稅。';
  bindNumericInput(yieldInput, { integer: false, min: 0, step: 0.1 });
  if (tax && Number.isFinite(Number(tax.dividendYield))) yieldInput.value = tax.dividendYield;
  const other = el('input', 'tax-other');
  other.placeholder = '稅率%';
  other.title = '其他註冊地稅率，空白＝30%';
  bindNumericInput(other, { integer: false, min: 0, step: 1 });
  if (tax && Number.isFinite(Number(tax.otherTaxRate))) other.value = tax.otherTaxRate;
  const syncOther = () => { other.hidden = dom.value !== 'other'; };
  syncOther();
  dom.addEventListener('change', () => { syncOther(); onPortfolioEdited(); });
  const bar = el('div', 'bar');
  bar.appendChild(el('span'));
  line.append(sym, w, dom, yieldInput, other, x);
  row.append(line, bar);
  [sym, w, yieldInput, other].forEach(i => i.addEventListener('input', onPortfolioEdited));
  sym.addEventListener('change', () => {
    sym.value = normalizeSymbol(sym.value);
    onPortfolioEdited();
  });
  $('holdings').appendChild(row);
  updateWeightBars();
}

export function writePortfolioForm(pf) {
  $('holdings').innerHTML = '';
  Object.entries(pf.holdings).forEach(([s, w]) => addHoldingRow(s, w, pf.holdingTax?.[s]));
  $('rebalance').value = pf.rebalance || 'annual';
  $('btStart').value = pf.start || '';
  $('btEnd').value = pf.end || '';
  const nameEl = $('portfolioName');
  if (nameEl) nameEl.textContent = pf.name || '';
  updateWeightBars();
}

export function readPortfolioForm() {
  const holdings = {};
  const holdingTax = {};
  document.querySelectorAll('#holdings .holding').forEach(row => {
    const s = normalizeSymbol(row.querySelector('.sym').value);
    const w = readInputNumber(row.querySelector('.w').value);
    if (s && w > 0) holdings[s] = (holdings[s] || 0) + w;
    const domicile = row.querySelector('.tax-dom')?.value || '';
    const y = readInputNumber(row.querySelector('.tax-yield')?.value);
    if (s && domicile && y != null) {
      const meta = { taxDomicile: domicile, dividendYield: y };
      if (domicile === 'other') {
        const rate = readInputNumber(row.querySelector('.tax-other')?.value);
        meta.otherTaxRate = rate == null ? 30 : rate;
      }
      holdingTax[s] = meta;
    }
  });
  return {
    name: $('portfolioName')?.textContent || '自訂組合',
    holdings,
    holdingTax,
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

const MIX_COLORS = ['#4f46e5', '#0ea5e9', '#059669', '#d97706', '#db2777', '#7c3aed'];

export function updateWeightBars() {
  const rows = [...document.querySelectorAll('#holdings .holding')];
  const total = rows.reduce((a, r) => a + (readInputNumber(r.querySelector('.w').value) || 0), 0);
  const mix = $('mixBar');
  if (mix) mix.replaceChildren();
  rows.forEach((r, i) => {
    const w = readInputNumber(r.querySelector('.w').value) || 0;
    r.querySelector('.bar span').style.width = total > 0 ? `${w / total * 100}%` : '0';
    if (!mix || !(w > 0) || !(total > 0)) return;
    const seg = document.createElement('i');
    const symbol = r.querySelector('.sym')?.value || '';
    seg.style.width = `${w / total * 100}%`;
    seg.style.background = MIX_COLORS[i % MIX_COLORS.length];
    seg.title = `${symbol} ${w}%`;
    mix.appendChild(seg);
  });
  const off = Math.abs(total - 100) > 0.01;
  $('weightSum').textContent = ` 合計 ${Number(total.toFixed(2))}%${off ? '（自動按比例）' : ''}`;
  $('weightSum').style.color = off ? 'var(--warn)' : '';
  const brief = $('portfolioBrief');
  if (brief) brief.textContent = portfolioBriefText();
}

export function portfolioBriefText() {
  const parts = [];
  document.querySelectorAll('#holdings .holding').forEach(row => {
    const s = normalizeSymbol(row.querySelector('.sym').value);
    const w = readInputNumber(row.querySelector('.w').value);
    if (!s || !(w > 0)) return;
    parts.push(`${s} (${w}%)`);
  });
  return parts.join(', ');
}

export function onPortfolioEdited() {
  const nameEl = $('portfolioName');
  if (nameEl) nameEl.textContent = '自訂組合';
  updateWeightBars();
  state.portfolio = readPortfolioForm();
  saveJSON(STORE.portfolio, state.portfolio);
}
