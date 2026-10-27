import { PLAN_FIELDS, CURRENCIES, STORE, WITHDRAWAL_OPTIONS } from './config.js';
import { state } from './state.js';
import { $, el, money, debounce } from './dom.js';
import { saveJSON } from './storage.js';
import * as retirement from '../backtest/retirement.js';
import { recalc } from './recalc.js';
import { bindNumericInput, formatGroupedNumber, readInputNumber } from './numeric-input.js';

function readNum(value, fallback = 0) {
  const n = readInputNumber(value);
  return n == null ? fallback : n;
}

function usesIntegerKeypad(f) {
  if (f.money) return false;
  if (typeof f.unit === 'string' && f.unit.includes('%')) return false;
  return Number.isInteger(Number(f.step));
}

function shownNumber(value, asMoney) {
  if (value == null || value === '') return '';
  return asMoney ? formatGroupedNumber(value) : String(value);
}

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
      bindNumericInput(input, {
        integer: usesIntegerKeypad(f),
        money: Boolean(f.money),
        min: 0,
        step: f.step
      });
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
  end.placeholder = '期末股權重 %，空白＝維持目前';
  bindNumericInput(end, { integer: false, min: 0, max: 100, step: 1 });
  end.addEventListener('input', onPlanEdited);
  const start = el('input');
  start.id = 'plan-glideStockStart';
  start.placeholder = '起始股權重 %，空白＝目前權重';
  bindNumericInput(start, { integer: false, min: 0, max: 100, step: 1 });
  start.addEventListener('input', onPlanEdited);
  const floor = el('input');
  floor.id = 'plan-glideBondFloor';
  floor.placeholder = '債券下限 %，空白＝不設';
  bindNumericInput(floor, { integer: false, min: 0, max: 100, step: 1 });
  floor.addEventListener('input', onPlanEdited);
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
    input.placeholder = ({ ter: 'TER %/年', turnover: '年換手 %', turnoverCost: '換手單邊成本 %', fxSpread: '匯率價差 %/年' })[key];
    bindNumericInput(input, { integer: false, min: 0, step: 0.05 });
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
  const curve = el('select');
  curve.id = 'plan-spendingCurve';
  curve.title = '支出曲線。固定以外會跟固定結果並列，不取代成功率。';
  for (const [value, label] of [['flat', '支出：固定'], ['declining', '支出：75歲後每年−1%'], ['u_shape', '支出：先降後升']]) {
    const opt = el('option');
    opt.value = value;
    opt.textContent = label;
    curve.appendChild(opt);
  }
  curve.addEventListener('change', onPlanEdited);
  const cashRow = el('label', 'check-row');
  const cashToggle = el('input');
  cashToggle.type = 'checkbox';
  cashToggle.id = 'plan-cashBucket';
  cashToggle.addEventListener('change', onPlanEdited);
  cashRow.append(cashToggle, document.createTextNode(' 現金桶（概念建議，預設關）'));
  const cashYears = el('input');
  cashYears.id = 'plan-cashBucketYears';
  cashYears.placeholder = '年數，開啟後空白＝3';
  bindNumericInput(cashYears, { integer: true, min: 1, step: 1 });
  cashYears.addEventListener('input', onPlanEdited);
  const lumps = el('input');
  lumps.id = 'plan-lumpSums';
  lumps.placeholder = '一次性支出，例如 70:200000';
  lumps.addEventListener('input', onPlanEdited);
  const segments = el('input');
  segments.id = 'plan-otherIncomeSegments';
  segments.placeholder = '分段收入，例如 60-65:120000, 65-:80000';
  segments.addEventListener('input', onPlanEdited);
  const dualRow = el('label', 'check-row');
  const dualToggle = el('input');
  dualToggle.type = 'checkbox';
  dualToggle.id = 'plan-compareBootstrap';
  dualToggle.addEventListener('change', onPlanEdited);
  dualRow.append(dualToggle, document.createTextNode(' 歷史與拔靴成功率並列（預設只看歷史）'));
  const bootRow = el('label', 'check-row');
  const bootToggle = el('input');
  bootToggle.type = 'checkbox';
  bootToggle.id = 'plan-pathMode';
  bootToggle.addEventListener('change', onPlanEdited);
  bootRow.append(bootToggle, document.createTextNode(' 區塊拔靴（額外模式，預設關）'));
  const seed = el('input');
  seed.id = 'plan-bootstrapSeed';
  seed.placeholder = '種子';
  bindNumericInput(seed, { integer: true, step: 1 });
  seed.addEventListener('input', onPlanEdited);
  const block = el('input');
  block.id = 'plan-bootstrapBlock';
  block.placeholder = '區塊月數';
  bindNumericInput(block, { integer: true, min: 1, max: 120, step: 1 });
  block.addEventListener('input', onPlanEdited);
  const withdrawEvery = el('input');
  withdrawEvery.id = 'plan-withdrawEvery';
  withdrawEvery.placeholder = '提領間隔月數，1＝每月';
  bindNumericInput(withdrawEvery, { integer: true, min: 1, max: 12, step: 1 });
  withdrawEvery.addEventListener('input', onPlanEdited);
  const guardrailEvery = el('input');
  guardrailEvery.id = 'plan-guardrailEvery';
  guardrailEvery.placeholder = '護欄檢查間隔月數，12＝每年';
  bindNumericInput(guardrailEvery, { integer: true, min: 1, max: 12, step: 1 });
  guardrailEvery.addEventListener('input', onPlanEdited);
  box.append(row, tick, start, end, floor, taxRow, yields, rates, feeRow, ...feeInputs, fxRow, basket, series, curve, cashRow, cashYears, lumps, segments, dualRow, bootRow, seed, block, withdrawEvery, guardrailEvery);
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
    if (document.activeElement !== input) input.value = f.type === 'currency' ? p[f.key] : shownNumber(p[f.key], f.money);
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
  const glideStart = $('plan-glideStockStart');
  if (glideStart && document.activeElement !== glideStart) glideStart.value = p.glideStockStart == null ? '' : p.glideStockStart;
  const bondFloor = $('plan-glideBondFloor');
  if (bondFloor && document.activeElement !== bondFloor) bondFloor.value = p.glideBondFloor == null ? '' : p.glideBondFloor;
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
  const curve = $('plan-spendingCurve');
  if (curve && document.activeElement !== curve) curve.value = p.spendingCurve || 'flat';
  const cashToggle = $('plan-cashBucket');
  if (cashToggle && document.activeElement !== cashToggle) cashToggle.checked = p.cashBucketYears != null && p.cashBucketYears !== false;
  const cashYears = $('plan-cashBucketYears');
  if (cashYears && document.activeElement !== cashYears) cashYears.value = p.cashBucketYears == null ? '' : p.cashBucketYears;
  const lumps = $('plan-lumpSums');
  if (lumps && document.activeElement !== lumps) lumps.value = eventText(p.lumpSums, row => `${row.age}:${row.amount}`);
  const segments = $('plan-otherIncomeSegments');
  if (segments && document.activeElement !== segments) segments.value = eventText(p.otherIncomeSegments, row => `${row.fromAge}-${row.toAge ?? ''}:${row.amount}`);
  const dualToggle = $('plan-compareBootstrap');
  if (dualToggle && document.activeElement !== dualToggle) dualToggle.checked = Boolean(p.compareBootstrap);
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
    p[f.key] = f.type === 'currency' ? v : readNum(v, 0);
  }
  const glideToggle = $('plan-glidePath');
  if (glideToggle) p.glidePath = glideToggle.checked;
  const tickers = $('plan-equityTickers');
  if (tickers) p.equityTickers = tickers.value;
  const glideEnd = $('plan-glideEquityEnd');
  if (glideEnd) p.glideEquityEnd = readInputNumber(glideEnd.value);
  const glideStart = $('plan-glideStockStart');
  if (glideStart) p.glideStockStart = readInputNumber(glideStart.value);
  const bondFloor = $('plan-glideBondFloor');
  if (bondFloor) p.glideBondFloor = readInputNumber(bondFloor.value);
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
    if (input) p[key] = readNum(input.value, 0);
  }
  const fxToggle = $('plan-fxMode');
  if (fxToggle) p.fxMode = fxToggle.checked;
  const basket = $('plan-spendingBasket');
  if (basket) p.spendingBasket = basket.value;
  const series = $('plan-fxSeries');
  if (series) p.fxSeries = series.value;
  const curve = $('plan-spendingCurve');
  if (curve) p.spendingCurve = curve.value;
  const cashToggle = $('plan-cashBucket');
  const cashYears = $('plan-cashBucketYears');
  if (cashToggle) {
    if (!cashToggle.checked) p.cashBucketYears = null;
    else {
      const n = cashYears ? readInputNumber(cashYears.value) : null;
      p.cashBucketYears = n == null ? true : n;
    }
  }
  const lumps = $('plan-lumpSums');
  if (lumps) p.lumpSums = retirement.parseLumpSums(lumps.value);
  const segments = $('plan-otherIncomeSegments');
  if (segments) p.otherIncomeSegments = retirement.parseIncomeSegments(segments.value);
  const dualToggle = $('plan-compareBootstrap');
  if (dualToggle) p.compareBootstrap = dualToggle.checked;
  const bootToggle = $('plan-pathMode');
  if (bootToggle) p.pathMode = bootToggle.checked ? 'bootstrap' : 'historical';
  const seed = $('plan-bootstrapSeed');
  if (seed && readInputNumber(seed.value) != null) p.bootstrapSeed = readInputNumber(seed.value);
  const block = $('plan-bootstrapBlock');
  if (block && readInputNumber(block.value) != null) p.bootstrapBlock = readInputNumber(block.value);
  const withdrawEvery = $('plan-withdrawEvery');
  if (withdrawEvery && readInputNumber(withdrawEvery.value) != null) p.withdrawEvery = readInputNumber(withdrawEvery.value);
  const guardrailEvery = $('plan-guardrailEvery');
  if (guardrailEvery && readInputNumber(guardrailEvery.value) != null) p.guardrailEvery = readInputNumber(guardrailEvery.value);
  return p;
}

function eventText(value, format) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.map(format).join(', ');
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
  const brief = $('planBrief');
  if (brief) brief.textContent = planBriefText(p);
}

export function formatWan(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  return String(Math.round((n / 10000) * 100) / 100);
}

export function planBriefText(p) {
  if (!p) return '';
  const cur = p.currency || '$';
  return `現時${p.currentAge}歲，退休年齡${p.retireAge}歲，起始本金${cur}${formatWan(p.currentSavings)}萬，每月投入${cur}${formatWan(p.monthlyContribution)}萬，年支出${cur}${formatWan(p.annualSpending)}萬`;
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
