// 儀表板數字欄：手機用數字鍵盤，金額顯示千分位。計算一律用去掉逗號後的數字。

export function readInputNumber(value) {
  let out = '';
  let seenDot = false;
  for (const ch of String(value ?? '')) {
    if (ch >= '0' && ch <= '9') out += ch;
    else if (ch === '.' && !seenDot) { out += '.'; seenDot = true; }
  }
  if (out === '' || out === '.') return null;
  if (out.endsWith('.')) out = out.slice(0, -1);
  if (out === '') return null;
  const n = Number(out);
  return Number.isFinite(n) ? n : null;
}

export function formatGroupedNumber(value) {
  if (value == null || value === '') return '';
  const n = typeof value === 'number' ? value : readInputNumber(value);
  if (n == null) return '';
  const neg = n < 0;
  let plain = String(Math.abs(n));
  if (/e/i.test(plain)) plain = Math.abs(n).toFixed(8).replace(/\.?0+$/, '');
  const [intPart, frac] = plain.split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-' : '') + (frac != null ? `${grouped}.${frac}` : grouped);
}

function caretAfter(formatted, kept) {
  if (kept <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < formatted.length; i++) {
    if (formatted[i] === ',') continue;
    seen += 1;
    if (seen >= kept) return i + 1;
  }
  return formatted.length;
}

export function rewriteNumericField(input, { integer = false, money = false } = {}) {
  const raw = String(input.value ?? '');
  const start = input.selectionStart ?? raw.length;
  const end = input.selectionEnd ?? start;
  const cut = integer ? (() => { const d = raw.indexOf('.'); return d === -1 ? raw.length : d; })() : raw.length;
  let plain = '';
  let seenDot = false;
  let keptStart = 0;
  let keptEnd = 0;
  for (let i = 0; i < cut; i++) {
    const ch = raw[i];
    const isDigit = ch >= '0' && ch <= '9';
    const isDot = !integer && ch === '.' && !seenDot;
    if (!isDigit && !isDot) continue;
    if (isDot) seenDot = true;
    plain += ch;
    if (i < start) keptStart += 1;
    if (i < end) keptEnd += 1;
  }
  let next = plain;
  if (money && plain !== '' && plain !== '.') {
    const dot = plain.indexOf('.');
    const intPart = dot === -1 ? plain : plain.slice(0, dot);
    const frac = dot === -1 ? '' : plain.slice(dot);
    next = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + frac;
  }
  if (next === raw) return;
  input.value = next;
  if (typeof input.setSelectionRange === 'function') {
    input.setSelectionRange(caretAfter(next, keptStart), caretAfter(next, keptEnd));
  }
}

export function bindNumericInput(input, { integer = false, money = false, min, max, step } = {}) {
  const mode = integer ? 'numeric' : 'decimal';
  input.type = 'text';
  input.inputMode = mode;
  input.setAttribute('inputmode', mode);
  input.autocomplete = 'off';
  input.setAttribute('autocorrect', 'off');
  input.setAttribute('autocapitalize', 'none');
  input.spellcheck = false;
  if (min != null) input.setAttribute('min', String(min));
  if (max != null) input.setAttribute('max', String(max));
  if (step != null) input.setAttribute('step', String(step));
  const opts = { integer, money };
  input.addEventListener('input', (e) => {
    if (e.isComposing || input.dataset.rewriting === '1') return;
    input.dataset.rewriting = '1';
    rewriteNumericField(input, opts);
    delete input.dataset.rewriting;
  });
  input.addEventListener('blur', () => {
    const n = readInputNumber(input.value);
    if (n == null) { input.value = ''; return; }
    input.value = money ? formatGroupedNumber(n) : String(n);
  });
}
