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
  const feeRow = el('label', 'check-row');
  const feeToggle = el('input');
  feeToggle.type = 'checkbox';
  feeToggle.id = 'plan-feeSplit';
  feeToggle.addEventListener('change', onPlanEdited);
  feeRow.append(feeToggle, document.createTextNode(' 拆開費用（取代單一費用率）'));
  const feeInputs = ['ter', 'turnover', 'turnoverCost', 'fxSpread'].map(key => {
    const input = el('input');
    input.id = 'plan-' + key;
    input.type = 'number';
    input.min = 0;
    input.step = 0.05;
    input.placeholder = ({ ter: 'TER %/年', turnover: '年換手 %', turnoverCost: '換手單邊成本 %', fxSpread: '匯率價差 %/年' })[key];
    input.addEventListener('input', onPlanEdited);
    return input;
  });
  const fxRow = el('label', 'check-row');
  const fxToggle = el('input');
  fxToggle.type = 'checkbox';
  fxToggle.id = 'plan-fxMode';
  fxToggle.addEventListener('change', onPlanEdited);
  fxRow.append(fxToggle, document.createTextNode(' 支出匯率（預設關）'));
  const basket = el('input');
  basket.id = 'plan-spendingBasket';
  basket.placeholder = '支出籃，空白＝100% 計劃幣別，例如 HKD:80, TWD:20';
  basket.addEventListener('input', onPlanEdited);
  const series = el('textarea');
  series.id = 'plan-fxSeries';
  series.rows = 2;
  series.placeholder = '台幣匯率（每 1 USD），例如 2000-01,32.5。沒有序列就不套用台幣。港幣用 7.8 聯繫匯率假設。';
  series.addEventListener('input', onPlanEdited);
  const bootRow = el('label', 'check-row');
  const bootToggle = el('input');
  bootToggle.type = 'checkbox';
  bootToggle.id = 'plan-pathMode';
  bootToggle.addEventListener('change', onPlanEdited);
  bootRow.append(bootToggle, document.createTextNode(' 區塊拔靴（額外模式，預設關）'));
  const seed = el('input');
  seed.id = 'plan-bootstrapSeed';
  seed.type = 'number';
  seed.step = 1;
  seed.placeholder = '種子';
  seed.addEventListener('input', onPlanEdited);
  const block = el('input');
  block.id = 'plan-bootstrapBlock';
  block.type = 'number';
  block.min = 1;
  block.max = 120;
  block.step = 1;
  block.placeholder = '區塊月數';
  block.addEventListener('input', onPlanEdited);
  const withdrawEvery = el('input');
  withdrawEvery.id = 'plan-withdrawEvery';
  withdrawEvery.type = 'number';
  withdrawEvery.min = 1;
  withdrawEvery.max = 12;
  withdrawEvery.step = 1;
  withdrawEvery.placeholder = '提領間隔月數，1＝每月';
  withdrawEvery.addEventListener('input', onPlanEdited);
  const guardrailEvery = el('input');
  guardrailEvery.id = 'plan-guardrailEvery';
  guardrailEvery.type = 'number';
  guardrailEvery.min = 1;
  guardrailEvery.max = 12;
  guardrailEvery.step = 1;
  guardrailEvery.placeholder = '護欄檢查間隔月數，12＝每年';
  guardrailEvery.addEventListener('input', onPlanEdited);
  box.append(row, tick, end, taxRow, yields, rates, feeRow, ...feeInputs, fxRow, basket, series, bootRow, seed, block, withdrawEvery, guardrailEvery);
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
  const feeToggle = $('plan-feeSplit');
  if (feeToggle && document.activeElement !== feeToggle) feeToggle.checked = Boolean(p.feeSplit);
  for (const key of ['ter', 'turnover', 'turnoverCost', 'fxSpread']) {
    const input = $('plan-' + key);
    if (input && document.activeElement !== input) input.value = p[key] ?? '';
  }
  const fxToggle = $('plan-fxMode');
  if (fxToggle && document.activeElement !== fxToggle) fxToggle.checked = Boolean(p.fxMode);
  const basket = $('plan-spendingBasket');
  if (basket && document.activeElement !== basket) basket.value = rateMapText(p.spendingBasket);
  const series = $('plan-fxSeries');
  if (series && document.activeElement !== series) series.value = p.fxSeries || '';
  const bootToggle = $('plan-pathMode');
  if (bootToggle && document.activeElement !== bootToggle) bootToggle.checked = p.pathMode === 'bootstrap';
  const seed = $('plan-bootstrapSeed');
  if (seed && document.activeElement !== seed) seed.value = p.bootstrapSeed ?? 1;
  const block = $('plan-bootstrapBlock');
  if (block && document.activeElement !== block) block.value = p.bootstrapBlock ?? 12;
  const withdrawEvery = $('plan-withdrawEvery');
  if (withdrawEvery && document.activeElement !== withdrawEvery) withdrawEvery.value = p.withdrawEvery ?? 1;
  const guardrailEvery = $('plan-guardrailEvery');
  if (guardrailEvery && document.activeElement !== guardrailEvery) guardrailEvery.value = p.guardrailEvery ?? 12;
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
  const feeToggle = $('plan-feeSplit');
  if (feeToggle) p.feeSplit = feeToggle.checked;
  for (const key of ['ter', 'turnover', 'turnoverCost', 'fxSpread']) {
    const input = $('plan-' + key);
    if (input) p[key] = input.value === '' ? 0 : Number(input.value);
  }
  const fxToggle = $('plan-fxMode');
  if (fxToggle) p.fxMode = fxToggle.checked;
  const basket = $('plan-spendingBasket');
  if (basket) p.spendingBasket = basket.value;
  const series = $('plan-fxSeries');
  if (series) p.fxSeries = series.value;
  const bootToggle = $('plan-pathMode');
  if (bootToggle) p.pathMode = bootToggle.checked ? 'bootstrap' : 'historical';
  const seed = $('plan-bootstrapSeed');
  if (seed && seed.value !== '') p.bootstrapSeed = Number(seed.value);
  const block = $('plan-bootstrapBlock');
  if (block && block.value !== '') p.bootstrapBlock = Number(block.value);
  const withdrawEvery = $('plan-withdrawEvery');
  if (withdrawEvery && withdrawEvery.value !== '') p.withdrawEvery = Number(withdrawEvery.value);
  const guardrailEvery = $('plan-guardrailEvery');
  if (guardrailEvery && guardrailEvery.value !== '') p.guardrailEvery = Number(guardrailEvery.value);
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
