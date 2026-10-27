import { STORE, DEFAULT_PORTFOLIO } from './config.js';
import { loadJSON, saveJSON } from './storage.js';
import { migrateHoldings } from '../backtest/symbols.js';

// 啟動時不自動裸→.US（未知／倫敦代號會被誤標）；美股遷移等 meta 載入後再做。
const loadedPortfolio = loadJSON(STORE.portfolio, DEFAULT_PORTFOLIO);
const rawPortfolio = loadedPortfolio && typeof loadedPortfolio === 'object' && !Array.isArray(loadedPortfolio)
  ? loadedPortfolio
  : { ...DEFAULT_PORTFOLIO };
const sourceHoldings = rawPortfolio.holdings && typeof rawPortfolio.holdings === 'object'
  ? rawPortfolio.holdings
  : DEFAULT_PORTFOLIO.holdings;
const migratedHoldings = migrateHoldings(sourceHoldings, null);
const portfolio = { ...DEFAULT_PORTFOLIO, ...rawPortfolio, holdings: migratedHoldings };
if (rawPortfolio.holdings && JSON.stringify(rawPortfolio.holdings) !== JSON.stringify(migratedHoldings)) {
  saveJSON(STORE.portfolio, portfolio);
}

export const state = {
  plan: null,
  portfolio,
  current: null,
  previous: null,
  meta: null,
  /** mapping 推導的美股裸鍵；meta 載入後設定，供 AI／遷移用 */
  usBareKeys: null,
  series: new Map(),
  backtestCache: new Map(),
  charts: {},
  tab: localStorage.getItem(STORE.tab) || 'overview',
  logScale: localStorage.getItem(STORE.logScale) !== '0',
  isSending: false,
  /** 最近一次 AI／手動套用 portfolio／plan 後的執行回執 */
  lastApplyReceipt: null
};

if (localStorage.getItem(STORE.theme) === 'dark') document.body.classList.add('dark');
