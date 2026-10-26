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
export const DEFAULT_PORTFOLIO = { name: '起始組合：股債 60/40', holdings: { 'VTI.US': 60, 'IEF.US': 40 }, rebalance: 'annual', start: '', end: '' };
export const CURRENCIES = ['HKD', 'USD', 'TWD', 'CNY', 'SGD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD'];

export const PLAN_FIELDS = [
  { key: 'currentAge', label: '目前年齡', unit: '歲', step: 1 },
  { key: 'retireAge', label: '退休年齡', unit: '歲', step: 1 },
  { key: 'endAge', label: '規劃至', unit: '歲', step: 1 },
  { key: 'currency', label: '幣別', type: 'currency' },
  { key: 'currentSavings', label: '現有投資資產', unit: '', step: 10000, money: true, wide: true },
  { key: 'monthlyContribution', label: '每月投入（至退休）', unit: '/月', step: 1000, money: true, wide: true },
  { key: 'annualSpending', label: '退休後每年支出（目標）', unit: '/年', step: 10000, money: true, wide: true },
  { key: 'withdrawalStrategy', label: '提領規則', type: 'withdrawal', wide: true },
  { key: 'guardrailCeiling', label: '護欄上限（絕對提領率）', unit: '%', step: 0.1, guardrail: true },
  { key: 'guardrailFloor', label: '護欄下限（絕對提領率）', unit: '%', step: 0.1, guardrail: true },
  { key: 'guardrailAdjustPct', label: '觸發後調整支出', unit: '%', step: 1, guardrail: true },
  { key: 'otherIncome', label: '其他退休收入', unit: '/年', step: 10000, money: true },
  { key: 'otherIncomeAge', label: '收入起始年齡', unit: '歲', step: 1 },
  { key: 'inflationMode', label: '通膨來源', type: 'inflation', wide: true },
  { key: 'inflationRate', label: '通膨假設', unit: '%/年', step: 0.1 },
  { key: 'feeRate', label: '費用＋成本', unit: '%/年', step: 0.05 }
];

export const WITHDRAWAL_OPTIONS = [
  { value: 'fixed_real', label: '固定實質' },
  { value: 'guardrails', label: '護欄法' },
  { value: 'vpw', label: 'VPW 變動%' }
];
export const PLAN_LABELS = {
  ...Object.fromEntries(PLAN_FIELDS.map(f => [f.key, f.label])),
  guardrailCeiling: '護欄上限（絕對%）',
  guardrailFloor: '護欄下限（絕對%）',
  guardrailAdjustPct: '觸發後調整支出%',
  glidePath: '下滑路徑',
  equityTickers: '股票代號',
  glideEquityEnd: '期末股權重',
  dividendTax: '股息稅',
  dividendYields: '假設殖利率',
  dividendTaxRates: '註冊地稅率',
  feeSplit: '費用拆分',
  ter: 'TER',
  turnover: '年換手',
  turnoverCost: '換手成本',
  fxSpread: '匯率價差'
};
