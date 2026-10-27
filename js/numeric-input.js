// 儀表板數字欄：手機只出數字鍵盤，金額在輸入框裡顯示千分位。
// 計算與 localStorage 用去掉逗號後的數字。空欄保持空，不寫 NaN。
// iOS 對 type=text 預設開字母全鍵盤。inputmode 必須在使用者點到的那個元素上。
// 舊版 iOS 還要整數欄的 pattern="[0-9]*" 才會改數字鍵盤。
// 小數與金額不能加這個 pattern，否則沒有小數點。不要用 type=tel。
// 不要留 min/step：那是 type=number 的屬性，留在文字欄上時 iOS 會忽略 inputmode。

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

export function armNumericKeypad(input) {
  const integer = input.dataset.numeric === 'integer';
  const mode = integer ? 'numeric' : 'decimal';
  input.setAttribute('type', 'text');
  input.removeAttribute('min');
  input.removeAttribute('max');
  input.removeAttribute('step');
  input.removeAttribute('autocorrect');
  input.removeAttribute('autocapitalize');
  input.removeAttribute('spellcheck');
  if (integer) input.setAttribute('pattern', '[0-9]*');
  else input.removeAttribute('pattern');
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('enterkeyhint', 'done');
  input.inputMode = mode;
  input.setAttribute('inputmode', mode);
}

function paintMoney(input) {
  if (input.dataset.money !== '1') return;
  const formatted = formatGroupedNumber(input.value);
  if (formatted !== input.value) input.value = formatted;
}

function bindWrapTap(input) {
  const attach = () => {
    const wrap = input.closest('.input-wrap');
    if (!wrap || wrap.dataset.keypadBound === '1') return;
    wrap.dataset.keypadBound = '1';
    const onTap = (event) => {
      const field = wrap.querySelector('input[data-numeric]');
      if (!field) return;
      armNumericKeypad(field);
      if (event.target !== field) field.focus();
    };
    wrap.addEventListener('pointerdown', onTap);
    wrap.addEventListener('touchstart', onTap, { passive: true });
  };
  if (input.isConnected) attach();
  else queueMicrotask(attach);
}

export function bindNumericInput(input, { integer = false, money = false } = {}) {
  input.dataset.numeric = integer ? 'integer' : 'decimal';
  if (money) input.dataset.money = '1';
  armNumericKeypad(input);
  const opts = { integer, money };
  const arm = () => armNumericKeypad(input);
  input.addEventListener('pointerdown', arm);
  input.addEventListener('touchstart', arm, { passive: true });
  input.addEventListener('focus', () => {
    arm();
    paintMoney(input);
  });
  input.addEventListener('input', (e) => {
    if (e.isComposing || input.dataset.rewriting === '1') return;
    input.dataset.rewriting = '1';
    rewriteNumericField(input, opts);
    delete input.dataset.rewriting;
  });
  input.addEventListener('compositionend', () => {
    rewriteNumericField(input, opts);
  });
  input.addEventListener('blur', () => {
    const n = readInputNumber(input.value);
    if (n == null) { input.value = ''; return; }
    input.value = money ? formatGroupedNumber(n) : String(n);
  });
  bindWrapTap(input);
}
