// 置業現金流。純計算、無 I/O。金額皆為貨幣元。
// 舊檔的樓價／佣金／律師／裝修若仍是「萬」，只在讀入時換算一次。
// 樓價、佣金、律師、裝修、印花稅是置業當年名目。持有費與租金是今日幣值。

export const STAMP_DUTY_AS_OF = '2026-02-26';
export const CANNOT_PURCHASE_WARN = 0.2;
export const POST_PURCHASE_MIN = 30;

/** 住宅從價印花稅（2026-02-26 起，含 marginal relief）。上捨至元。估算，非報稅。 */
export function stampDutyHKD(price) {
  const value = Number(price);
  if (!Number.isFinite(value) || value <= 0) return 0;
  const due = dutyRaw(value);
  return Math.ceil(due - 1e-8);
}

function dutyRaw(value) {
  if (value <= 4_000_000) return 100;
  if (value <= 4_323_780) return 100 + (value - 4_000_000) * 0.2;
  if (value <= 4_500_000) return value * 0.015;
  if (value <= 4_935_480) return 67_500 + (value - 4_500_000) * 0.1;
  if (value <= 6_000_000) return value * 0.0225;
  if (value <= 6_642_860) return 135_000 + (value - 6_000_000) * 0.1;
  if (value <= 9_000_000) return value * 0.03;
  if (value <= 10_080_000) return 270_000 + (value - 9_000_000) * 0.1;
  if (value <= 20_000_000) return value * 0.0375;
  if (value <= 21_739_120) return 750_000 + (value - 20_000_000) * 0.1;
  if (value <= 100_000_000) return value * 0.0425;
  if (value <= 109_574_470) return 4_250_000 + (value - 100_000_000) * 0.3;
  return value * 0.065;
}

/** 固定名目利率、期末清償的每月還款。年期愈長，月供愈低。 */
export function mortgagePayment(principal, annualRatePct, years) {
  const principalAmount = Number(principal);
  const months = Math.round(Number(years) * 12);
  if (!(principalAmount > 0) || !(months > 0)) return 0;
  const monthly = (Number(annualRatePct) || 0) / 100 / 12;
  if (!(monthly > 0)) return principalAmount / months;
  const grown = (1 + monthly) ** months;
  return principalAmount * monthly * grown / (grown - 1);
}

export const PROPERTY_MONEY_UNIT = 'currency';

export function propertyNeedsMigration(raw) {
  if (!raw || typeof raw !== 'object') return false;
  if (raw.moneyUnit !== PROPERTY_MONEY_UNIT) return true;
  return ['priceWan', 'commissionWan', 'legalWan', 'renovationWan'].some(key => raw[key] != null && raw[key] !== '');
}

function isBlank(value) {
  return value == null || value === '';
}

function blankNumber(value) {
  if (isBlank(value)) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** 舊檔的「萬」只乘這一次。已經是元的數字不要再進來。 */
export function wanToCurrency(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n * 10000;
}

function priceFrom(raw) {
  if (raw.moneyUnit === PROPERTY_MONEY_UNIT) return blankNumber(raw.price);
  if ('priceWan' in raw && !isBlank(raw.priceWan)) return wanToCurrency(raw.priceWan);
  if ('priceWan' in raw && isBlank(raw.priceWan)) return null;
  return blankNumber(raw.price);
}

function amountFrom(raw, key, wanKey) {
  if (raw.moneyUnit === PROPERTY_MONEY_UNIT) return blankNumber(raw[key]);
  if (wanKey in raw) {
    if (isBlank(raw[wanKey])) return null;
    return wanToCurrency(raw[wanKey]);
  }
  return blankNumber(raw[key]);
}

function commissionSpecifiedFrom(raw) {
  if ('commissionSpecified' in raw) return blankNumber(raw.commissionSpecified);
  if ('commissionWan' in raw) {
    if (isBlank(raw.commissionWan)) return null;
    return wanToCurrency(raw.commissionWan);
  }
  if (raw.moneyUnit === PROPERTY_MONEY_UNIT && !('loan' in raw) && 'commission' in raw) {
    return blankNumber(raw.commission);
  }
  return null;
}

function fundingFrom(raw) {
  if (raw.funding === 'cash' || raw.funding === 'mortgage' || raw.funding === 'unconfirmed') return raw.funding;
  if (isBlank(raw.ltvPct)) return 'unconfirmed';
  const n = Number(raw.ltvPct);
  if (!Number.isFinite(n)) return 'unconfirmed';
  if (n === 0) return 'cash';
  return 'mortgage';
}

function yearsFrom(raw) {
  if (isBlank(raw.mortgageYears)) return null;
  const n = Number(raw.mortgageYears);
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

function mortgageBlockReason(funding, ltv, rate, years) {
  if (funding === 'unconfirmed') return '請選擇全現金或按揭';
  if (funding !== 'mortgage') return '';
  if (ltv == null || !(ltv > 0)) return '按揭成數須大於 0';
  if (ltv > 100) return '按揭成數不可超過 100';
  if (rate == null) return '請填按揭年利率（可以是 0）';
  if (rate < 0) return '按揭年利率不可為負';
  if (years == null || years < 1) return '按揭年期須大於 0';
  return '';
}

function spentAmount(value) {
  if (value == null) return 0;
  return Math.max(0, Number(value) || 0);
}

/**
 * 關、或缺樓價時不產生現金流。樓價、佣金、律師、裝修以元儲存（moneyUnit=currency）。
 * 舊的 *Wan 只在沒有 moneyUnit 時換算一次。全現金要明確標 funding=cash；
 * 空白或 0 成數不會自己變成全現金，除非是舊檔裡寫明的 ltvPct 0。
 * 呼叫前計劃年齡須已正規化。
 */
export function normalizeProperty(plan) {
  const raw = plan?.property;
  if (raw == null || raw === false || raw === 'false') return null;
  if (typeof raw !== 'object') return null;
  if (raw.enabled === false || raw.enabled === 'false') return null;

  const currentAge = plan.currentAge;
  const endAge = plan.endAge;
  const lastAge = Math.max(currentAge, endAge - 1);
  let purchaseAge = Math.round(Number(raw.purchaseAge));
  if (!Number.isFinite(purchaseAge)) purchaseAge = currentAge;
  purchaseAge = Math.min(lastAge, Math.max(currentAge, purchaseAge));

  const price = priceFrom(raw);
  const priceAmount = price == null ? 0 : Math.max(0, price);
  const commissionSpecified = commissionSpecifiedFrom(raw);
  const legal = amountFrom(raw, 'legal', 'legalWan');
  const renovation = amountFrom(raw, 'renovation', 'renovationWan');
  const funding = fundingFrom(raw);
  const ltvPct = blankNumber(raw.ltvPct);
  const mortgageRatePct = blankNumber(raw.mortgageRatePct);
  const mortgageYears = yearsFrom(raw);
  const holdingMonthly = Math.max(0, Number(raw.holdingMonthly) || 0);
  const rentIfCannot = raw.rentIfCannot === true || raw.rentIfCannot === 'true';
  const rentMonthly = Math.max(0, Number(raw.rentMonthly) || 0);
  const baseFields = {
    enabled: true,
    moneyUnit: PROPERTY_MONEY_UNIT,
    funding,
    purchaseAge,
    price,
    commissionSpecified,
    legal,
    renovation,
    ltvPct,
    mortgageRatePct,
    mortgageYears,
    holdingMonthly,
    rentIfCannot,
    rentMonthly
  };

  if (!(priceAmount > 0)) {
    return { ...baseFields, active: false, commission: commissionSpecified == null ? 0 : Math.max(0, commissionSpecified), loan: 0, nominalPmt: 0 };
  }

  const reason = mortgageBlockReason(funding, ltvPct, mortgageRatePct, mortgageYears);
  if (reason) {
    return { ...baseFields, active: false, blocked: true, blockReason: reason };
  }

  const cash = funding === 'cash';
  const ltvForLoan = cash ? 0 : ltvPct;
  const loan = priceAmount * ltvForLoan / 100;
  const down = Math.max(0, priceAmount - loan);
  const commission = commissionSpecified == null ? priceAmount * 0.01 : Math.max(0, commissionSpecified);
  const stamp = stampDutyHKD(priceAmount);
  const cashNominal = down + commission + stamp + spentAmount(legal) + spentAmount(renovation);
  const scheduledYears = cash ? (mortgageYears ?? 0) : Math.min(50, mortgageYears);
  const rate = cash ? 0 : mortgageRatePct;
  const nominalPmt = cash ? 0 : mortgagePayment(loan, rate, scheduledYears);
  const termMonths = cash ? 0 : scheduledYears * 12;
  const naturalEnd = purchaseAge + (cash ? 0 : scheduledYears);
  const truncated = !cash && naturalEnd > endAge;
  const paidToAge = truncated ? endAge : naturalEnd;
  const paidToText = cash
    ? '全現金，無月供'
    : truncated
      ? `供至 ${paidToAge} 歲（原定 ${scheduledYears} 年，已按計劃結束截斷）`
      : `供至 ${paidToAge} 歲（原定 ${scheduledYears} 年）`;
  const annualSpending = Math.max(0, Number(plan.annualSpending) || 0);
  return {
    ...baseFields,
    active: true,
    mortgageYears: cash ? mortgageYears : scheduledYears,
    commission,
    loan,
    down,
    stamp,
    cashNominal,
    nominalPmt,
    termMonths,
    quote: {
      loan,
      down,
      stamp,
      cashNominal,
      monthlyPayment: nominalPmt,
      paymentShare: annualSpending > 0 ? (nominalPmt * 12) / annualSpending : null,
      paidToAge: cash ? null : paidToAge,
      scheduledYears: cash ? 0 : scheduledYears,
      truncated: cash ? false : truncated,
      paidToText
    }
  };
}

export function propertyQuoteText(prop, fmt) {
  const quote = prop?.quote;
  if (!quote) return '';
  const share = quote.paymentShare == null ? '—' : fmt.pct(quote.paymentShare);
  return [
    `按揭額 ${fmt.money(quote.loan)}`,
    `首期 ${fmt.money(quote.down)}`,
    `印花稅（估算）${fmt.money(quote.stamp)}`,
    `首期總額 ${fmt.money(quote.cashNominal)}`,
    `月供 ${fmt.money(quote.monthlyPayment)}`,
    `月供÷年支出 ${share}`,
    quote.paidToText
  ].filter(Boolean).join(' · ');
}
