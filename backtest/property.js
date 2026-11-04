// 置業現金流。純計算、無 I/O。金額除標明「萬」的輸入外，皆為貨幣元。
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

function wan(value) {
  return Math.max(0, Number(value) || 0) * 10000;
}

/**
 * 關、或缺樓價時回傳 null（模擬不改）。開啟且樓價為正時才產生現金流。
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

  const priceWan = Math.max(0, Number(raw.priceWan) || 0);
  const price = priceWan * 10000;
  const ltvPct = Math.min(100, Math.max(0, Number(raw.ltvPct) || 0));
  const loan = price * ltvPct / 100;
  const down = Math.max(0, price - loan);
  const commissionBlank = raw.commissionWan == null || raw.commissionWan === '';
  const commissionWan = commissionBlank ? null : Math.max(0, Number(raw.commissionWan) || 0);
  const commission = commissionBlank ? price * 0.01 : commissionWan * 10000;
  const legalWan = Math.max(0, Number(raw.legalWan) || 0);
  const renovationWan = Math.max(0, Number(raw.renovationWan) || 0);
  const stamp = price > 0 ? stampDutyHKD(price) : 0;
  const cashNominal = down + commission + stamp + wan(legalWan) + wan(renovationWan);
  const mortgageRatePct = Math.max(0, Number(raw.mortgageRatePct) || 0);
  let mortgageYears = Math.round(Number(raw.mortgageYears));
  if (!Number.isFinite(mortgageYears) || mortgageYears <= 0) mortgageYears = 30;
  mortgageYears = Math.min(50, Math.max(1, mortgageYears));
  const nominalPmt = mortgagePayment(loan, mortgageRatePct, mortgageYears);
  const naturalEnd = purchaseAge + mortgageYears;
  const truncated = naturalEnd > endAge;
  const paidToAge = truncated ? endAge : naturalEnd;
  const paidToText = truncated
    ? `供至 ${paidToAge} 歲（原定 ${mortgageYears} 年，已按計劃結束截斷）`
    : `供至 ${paidToAge} 歲（原定 ${mortgageYears} 年）`;
  const annualSpending = Math.max(0, Number(plan.annualSpending) || 0);
  return {
    enabled: true,
    active: price > 0,
    purchaseAge,
    priceWan,
    price,
    ltvPct,
    loan,
    down,
    commissionWan,
    commission,
    legalWan,
    renovationWan,
    stamp,
    cashNominal,
    mortgageRatePct,
    mortgageYears,
    nominalPmt,
    termMonths: mortgageYears * 12,
    holdingMonthly: Math.max(0, Number(raw.holdingMonthly) || 0),
    rentIfCannot: raw.rentIfCannot === true || raw.rentIfCannot === 'true',
    rentMonthly: Math.max(0, Number(raw.rentMonthly) || 0),
    quote: {
      loan,
      down,
      stamp,
      cashNominal,
      monthlyPayment: nominalPmt,
      paymentShare: annualSpending > 0 ? (nominalPmt * 12) / annualSpending : null,
      paidToAge,
      scheduledYears: mortgageYears,
      truncated,
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
