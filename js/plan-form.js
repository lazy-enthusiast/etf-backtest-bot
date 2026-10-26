import { PLAN_FIELDS, CURRENCIES, STORE, WITHDRAWAL_OPTIONS } from './config.js';
import { state } from './state.js';
import { $, el, money, debounce } from './dom.js';
import { saveJSON } from './storage.js';
import * as retirement from '../backtest/retirement.js';
import { recalc } from './recalc.js';

const COMPACT_LABEL = {
  currentSavings: '現有資產',
  monthlyContribution: '每月投入',
  annualSpending: '年支出目標',
  guardrailCeiling: '護欄上限',
  guardrailFloor: '護欄下限',
  guardrailAdjustPct: '觸發調整',
  otherIncome: '其他收入',
  otherIncomeAge: '收入年齡'
};

const PLAN_ROWS = [
  { cols: 4, keys: ['currentAge', 'retireAge', 'endAge', 'currency'] },
  { cols: 3, keys: ['currentSavings', 'monthlyContribution', 'annualSpending'] },
  { cols: 1, keys: ['withdrawalStrategy'] },
  { cols: 3, keys: ['guardrailCeiling', 'guardrailFloor', 'guardrailAdjustPct'], guardrail: true },
  { cols: 2, keys: ['otherIncome', 'otherIncomeAge'] },
  { cols: 1, keys: ['inflationMode'] },
  { cols: 2, keys: ['inflationRate', 'feeRate'] }
];

function buildPlanField(f) {
  const field = el('div', 'field' + (f.guardrail ? ' guardrail-only' : ''));
  if (f.guardrail) field.dataset.guardrail = '1';
  const shown = COMPACT_LABEL[f.key] || f.label;
  const label = el('label', '', shown);
  label.htmlFor = 'plan-' + f.key;
  if (shown !== f.label) label.title = f.label;
  if (f.guardrail && f.key === 'guardrailCeiling') {
    label.title = '絕對提領率＝年提領額÷當下資產（例如 6＝6%）';
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
  return field;
}

export function renderPlanForm() {
  const form = $('planForm');
  form.innerHTML = '';
  const byKey = Object.fromEntries(PLAN_FIELDS.map(f => [f.key, f]));
  for (const rowDef of PLAN_ROWS) {
    const row = el('div', 'plan-row cols-' + rowDef.cols + (rowDef.guardrail ? ' guardrail-row' : ''));
    for (const key of rowDef.keys) row.appendChild(buildPlanField(byKey[key]));
    form.appendChild(row);
  }
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
  renderPlanTimeline();
}

export function readPlanForm() {
  const p = { ...state.plan };
  for (const f of PLAN_FIELDS) {
    if (f.type === 'inflation' || f.type === 'withdrawal') continue;
    const v = $('plan-' + f.key).value;
    p[f.key] = f.type === 'currency' ? v : (v === '' ? 0 : Number(v));
  }
  return p;
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
