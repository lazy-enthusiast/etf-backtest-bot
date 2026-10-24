import { STORE, DEFAULT_PORTFOLIO } from './config.js';
import { loadJSON } from './storage.js';

export const state = {
  plan: null,
  portfolio: loadJSON(STORE.portfolio, DEFAULT_PORTFOLIO),
  current: null,
  previous: null,
  meta: null,
  series: new Map(),
  backtestCache: new Map(),
  charts: {},
  tab: localStorage.getItem(STORE.tab) || 'scenarios',
  logScale: localStorage.getItem(STORE.logScale) !== '0',
  isSending: false
};

if (localStorage.getItem(STORE.theme) === 'dark') document.body.classList.add('dark');
