import { state } from './state.js';

export const $ = id => document.getElementById(id);

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
export const pct = (x, d = 1) => (x == null || !Number.isFinite(x) ? '—' : `${(x * 100).toFixed(d)}%`);
export const num2 = x => (x == null || !Number.isFinite(x) ? '—' : x.toFixed(2));
export const intFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
export const compactFmt = new Intl.NumberFormat('zh-TW', { notation: 'compact', maximumFractionDigits: 1 });
export const money = (x, cur = state.plan?.currency || 'HKD') => (x == null || !Number.isFinite(x) ? '—' : `${cur} ${intFmt.format(Math.round(x))}`);
export const compact = x => (Number.isFinite(x) ? compactFmt.format(x) : '—');
export function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
