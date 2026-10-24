// 前端設定與常數
export const WORKER_URL = ['localhost', '127.0.0.1'].includes(location.hostname)
  ? 'http://127.0.0.1:8787/'
  : 'https://etf-backtest-worker.davchan-clp.workers.dev/';
export const AUTH_STORAGE_KEY = 'appAuth';

export const STORE = {
  plan: 'rp.plan', portfolio: 'rp.portfolio', conversations: 'rp.conversations',
  activeConv: 'rp.activeConv', theme: 'rp.theme', tab: 'rp.tab', logScale: 'rp.logScale'
};
export const REBALANCE_LABELS = { annual: '每年再平衡', semiannual: '每半年', quarterly: '每季', monthly: '每月', none: '不再平衡' };
export const DEFAULT_PORTFOLIO = { name: '起始組合：股債 60/40', holdings: { VTI: 60, IEF: 40 }, rebalance: 'annual', start: '', end: '' };
export const CURRENCIES = ['HKD', 'USD', 'TWD', 'CNY', 'SGD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD'];

export const PLAN_FIELDS = [
  { key: 'currentAge', label: '目前年齡', unit: '歲', step: 1 },
  { key: 'retireAge', label: '退休年齡', unit: '歲', step: 1 },
  { key: 'endAge', label: '規劃至', unit: '歲', step: 1 },
  { key: 'currency', label: '幣別', type: 'currency' },
  { key: 'currentSavings', label: '現有投資資產', unit: '', step: 10000, money: true, wide: true },
  { key: 'monthlyContribution', label: '每月投入（至退休）', unit: '/月', step: 1000, money: true, wide: true },
  { key: 'annualSpending', label: '退休後每年支出', unit: '/年', step: 10000, money: true, wide: true },
  { key: 'otherIncome', label: '其他退休收入', unit: '/年', step: 10000, money: true },
  { key: 'otherIncomeAge', label: '收入起始年齡', unit: '歲', step: 1 },
  { key: 'inflationMode', label: '通膨來源', type: 'inflation', wide: true },
  { key: 'inflationRate', label: '通膨假設', unit: '%/年', step: 0.1 },
  { key: 'feeRate', label: '費用＋成本', unit: '%/年', step: 0.05 }
];
export const PLAN_LABELS = Object.fromEntries(PLAN_FIELDS.map(f => [f.key, f.label]));
