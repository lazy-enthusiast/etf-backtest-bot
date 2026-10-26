import { PLAN_FIELDS, CURRENCIES, STORE, WITHDRAWAL_OPTIONS } from './config.js';
import { state } from './state.js';
import { $, el, money, debounce } from './dom.js';
import { saveJSON } from './storage.js';
import * as retirement from '../backtest/retirement.js';
import { recalc } from './recalc.js';

export function renderPlanForm() {
  const form = $('planForm');
  form.innerHTML = '';
  for (const f of PLAN_FIELDS) {
    const field = el('div', 'field' + (f.wide ? ' wide' : '') + (f.guardrail ? ' guardrail-only' : ''));
    if (f.guardrail) field.dataset.guardrail = '1';
    const label = el('label', '', f.label);
    label.htmlFor = 'plan-' + f.key;
    if (f.guardrail && f.key === 'guardrailCeiling') {
      label.title = '絕對提領率＝年提領額÷當下資產（例如 6＝6%），不是相對初始提領率 +6%';
    }
    field.appendChild(label);

    if (f.type === 'inflation') {
      const seg = el('div', 'seg');
      seg.id = 'plan-inflationMode';
      [['cpi', '美國歷史 CPI'], ['fixed', '固定通膨假設']].forEach(([value, text]) => {
        const b = el('button', '', text);
        b.type = 'button';
        b.dataset.value = value;
        b.onclick = () => { state.plan.inflationMode = value; writePlanForm(); onPlanEdited(); };
        seg.appendChild(b);
      });
      field.appendChild(seg);
    } else if (f.type === 'withdrawal') {
      const seg = el('div', 'seg');
      seg.id = 'plan-withdrawalStrategy';
      WITHDRAWAL_OPTIONS.forEach(({ value, label: text }) => {
        const b = el('button', '', text);
        b.type = 'button';
        b.dataset.value = value;
        b.title = retirement.WITHDRAWAL_STRATEGIES[value] || text;
        b.onclick = () => { state.plan.withdrawalStrategy = value; writePlanForm(); onPlanEdited(); };
        seg.appendChild(b);
      });
      field.appendChild(seg);
    } else {
      const wrap = el('div', 'input-wrap');
      let input;
      if (f.type === 'currency') {
        input = el('select');
        CURRENCIES.forEach(c => { const o = el('option', '', c); o.value = c; input.appendChild(o); });
      } else {
        input = el('input');
        input.type = 'number';
        input.step = f.step;
        input.min = 0;
        input.inputMode = 'decimal';
      }
      input.id = 'plan-' + f.key;
      input.addEventListener('input', onPlanEdited);
      input.addEventListener('change', onPlanEdited);
      wrap.appendChild(input);
      if (f.unit !== undefined || f.money) {
        const unit = el('span', 'unit', f.money ? '' : f.unit);
        unit.dataset.money = f.money ? f.unit : '';
        wrap.appendChild(unit);
      }
      field.appendChild(wrap);
    }
    form.appendChild(field);
  }
  form.appendChild(renderGlideFields());
}

function renderGlideFields() {
  const box = el('details', 'advanced-plan');
  box.appendChild(el('summary', '', '進階（預設關閉）'));
  const row = el('label', 'check-row');
  const toggle = el('input');
  toggle.type = 'checkbox';
  toggle.id = 'plan-glidePath';
  toggle.addEventListener('change', onPlanEdited);
  row.append(toggle, document.createTextNode(' 啟用下滑路徑'));
  const tick = el('input');
  tick.id = 'plan-equityTickers';
  tick.placeholder = '股票代號，例如 VTI.US';
  tick.addEventListener('input', onPlanEdited);
  const end = el('input');
  end.id = 'plan-glideEquityEnd';
  end.type = 'number';
  end.min = 0;
  end.max = 100;
  end.step = 1;
  end.placeholder = '期末股權重 %，空白＝維持目前';
  end.addEventListener('input', onPlanEdited);
  const taxRow = el('label', 'check-row');
  const taxToggle = el('input');
  taxToggle.type = 'checkbox';
  taxToggle.id = 'plan-dividendTax';
  taxToggle.addEventListener('change', onPlanEdited);
  taxRow.append(taxToggle, document.createTextNode(' 股息稅（需另給假設殖利率）'));
  const yields = el('input');
  yields.id = 'plan-dividendYields';
  yields.placeholder = '假設年殖利率，例如 VTI.US:1.6 或 US:1.6';
  yields.addEventListener('input', onPlanEdited);
  const rates = el('input');
  rates.id = 'plan-dividendTaxRates';
  rates.placeholder = '註冊地稅率 %，例如 US:30, L:15, HK:0';
  rates.addEventListener('input', onPlanEdited);
  box.append(row, tick, end, taxRow, yields, rates);
  return box;
}

export function writePlanForm() {
  const p = state.plan;
  for (const f of PLAN_FIELDS) {
    if (f.type === 'inflation') {
      $('plan-inflationMode').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.value === p.inflationMode));
      continue;
    }
    if (f.type === 'withdrawal') {
      $('plan-withdrawalStrategy').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.value === p.withdrawalStrategy));
      continue;
    }
    const input = $('plan-' + f.key);
    if (document.activeElement !== input) input.value = p[f.key];
  }
  document.querySelectorAll('#planForm .unit').forEach(u => {
    if (u.dataset.money !== '') u.textContent = `${p.currency}${u.dataset.money}`;
  });
  const showGuard = p.withdrawalStrategy === 'guardrails';
  document.querySelectorAll('#planForm .field[data-guardrail]').forEach(f => {
    f.hidden = !showGuard;
  });
  const glideToggle = $('plan-glidePath');
  if (glideToggle && document.activeElement !== glideToggle) glideToggle.checked = Boolean(p.glidePath);
  const tickers = $('plan-equityTickers');
  if (tickers && document.activeElement !== tickers) {
    tickers.value = Array.isArray(p.equityTickers) ? p.equityTickers.join(', ') : (p.equityTickers || '');
  }
  const glideEnd = $('plan-glideEquityEnd');
  if (glideEnd && document.activeElement !== glideEnd) glideEnd.value = p.glideEquityEnd == null ? '' : p.glideEquityEnd;
  const taxToggle = $('plan-dividendTax');
  if (taxToggle && document.activeElement !== taxToggle) taxToggle.checked = Boolean(p.dividendTax);
  const yields = $('plan-dividendYields');
  if (yields && document.activeElement !== yields) yields.value = rateMapText(p.dividendYields);
  const rates = $('plan-dividendTaxRates');
  if (rates && document.activeElement !== rates) rates.value = rateMapText(p.dividendTaxRates);
  renderPlanTimeline();
}

export function readPlanForm() {
  const p = { ...state.plan };
  for (const f of PLAN_FIELDS) {
    if (f.type === 'inflation' || f.type === 'withdrawal') continue;
    const v = $('plan-' + f.key).value;
    p[f.key] = f.type === 'currency' ? v : (v === '' ? 0 : Number(v));
  }
  const glideToggle = $('plan-glidePath');
  if (glideToggle) p.glidePath = glideToggle.checked;
  const tickers = $('plan-equityTickers');
  if (tickers) p.equityTickers = tickers.value;
  const glideEnd = $('plan-glideEquityEnd');
  if (glideEnd) p.glideEquityEnd = glideEnd.value === '' ? null : Number(glideEnd.value);
  const taxToggle = $('plan-dividendTax');
  if (taxToggle) p.dividendTax = taxToggle.checked;
  const yields = $('plan-dividendYields');
  if (yields) p.dividendYields = yields.value;
  const rates = $('plan-dividendTaxRates');
  if (rates) p.dividendTaxRates = rates.value;
  return p;
}

function rateMapText(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return Object.entries(value).map(([k, n]) => `${k}:${n}`).join(', ');
}

export function renderPlanTimeline() {
  const p = state.plan;
  const total = Math.max(1, p.endAge - p.currentAge);
  const acc = Math.max(0, p.retireAge - p.currentAge);
  $('planTimeline').children[0].style.width = `${acc / total * 100}%`;
  $('planTimeline').children[1].style.width = `${(total - acc) / total * 100}%`;
  $('planTimelineLabels').innerHTML = '';
  [`${p.currentAge} 歲`, `累積 ${acc} 年 → ${p.retireAge} 歲退休`, `提領 ${p.endAge - p.retireAge} 年 → ${p.endAge} 歲`]
    .forEach(t => $('planTimelineLabels').appendChild(el('span', '', t)));
  const strat = ({ fixed_real: '固定', guardrails: '護欄', vpw: 'VPW' })[p.withdrawalStrategy] || '固定';
  $('planChip').textContent = `${p.currentAge} 歲 · ${p.retireAge} 歲退休 · 至 ${p.endAge} 歲 · ${strat} · 年支出 ${money(p.annualSpending)}`;
}

const recalcPlanOnly = debounce(() => recalc({ markPrevious: false }), 350);

export function onPlanEdited() {
  state.plan = retirement.normalizePlan(readPlanForm());
  saveJSON(STORE.plan, state.plan);
  renderPlanTimeline();
  document.querySelectorAll('#planForm .unit').forEach(u => {
    if (u.dataset.money !== '') u.textContent = `${state.plan.currency}${u.dataset.money}`;
  });
  recalcPlanOnly();
}
