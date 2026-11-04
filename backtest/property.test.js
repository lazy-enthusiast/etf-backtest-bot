import test from 'node:test';
import assert from 'node:assert/strict';
import {
  simulateRetirement,
  buildLifeLedger,
  normalizePlan,
  drawReshuffleIndices,
  realMonthlyReturns
} from './retirement.js';
import { stampDutyHKD, mortgagePayment } from './property.js';
import { propertyOverviewLines, propertyQuoteText } from '../js/narrate.js';

const GOLDEN_SPEND = {
  p100: 600.0000000000002,
  p95: 600.0000000000002,
  p90: 600.0000000000002,
  p50: 600.0000000000002
};

function flat(n, r = 0, inflation = null) {
  return Array.from({ length: n }, (_, i) => {
    const row = {
      month: `${2000 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`,
      r
    };
    if (inflation != null) row.inflation = typeof inflation === 'function' ? inflation(i) : inflation;
    return row;
  });
}

function base(over = {}) {
  return {
    currency: 'HKD',
    currentAge: 40,
    retireAge: 41,
    endAge: 43,
    currentSavings: 1200,
    monthlyContribution: 0,
    annualSpending: 120,
    otherIncome: 0,
    otherIncomeAge: 65,
    inflationMode: 'fixed',
    inflationRate: 0,
    feeRate: 0,
    withdrawalStrategy: 'fixed_real',
    ...over
  };
}

function buy(over = {}) {
  return {
    enabled: true,
    purchaseAge: 40,
    priceWan: 100,
    ltvPct: 50,
    commissionWan: 0,
    legalWan: 0,
    renovationWan: 0,
    mortgageRatePct: 0,
    mortgageYears: 10,
    holdingMonthly: 0,
    rentIfCannot: false,
    rentMonthly: 0,
    ...over
  };
}

test('stamp duty matches the 2026-02-26 residential AVD brackets, including 13M', () => {
  const samples = [
    [3_000_000, 100],
    [4_000_000, 100],
    [4_000_001, 101],
    [4_323_780, 64856],
    [4_323_781, 64857],
    [4_400_000, 66000],
    [4_500_000, 67500],
    [4_500_001, 67501],
    [4_935_480, 111048],
    [4_935_481, 111049],
    [6_000_000, 135000],
    [6_000_001, 135001],
    [6_642_860, 199286],
    [6_642_861, 199286],
    [9_000_000, 270000],
    [9_000_001, 270001],
    [10_080_000, 378000],
    [10_080_001, 378001],
    [13_000_000, 487500],
    [20_000_000, 750000],
    [20_000_001, 750001],
    [21_739_120, 923912],
    [21_739_121, 923913],
    [50_000_000, 2125000],
    [100_000_000, 4250000],
    [100_000_001, 4250001],
    [109_574_470, 7122341],
    [109_574_471, 7122341],
    [200_000_000, 13000000]
  ];
  for (const [price, tax] of samples) assert.equal(stampDutyHKD(price), tax, String(price));
  assert.equal(stampDutyHKD(0), 0);
  assert.equal(stampDutyHKD(-1), 0);
});

test('longer mortgage term lowers the fixed nominal payment', () => {
  const short = mortgagePayment(1_000_000, 3.5, 15);
  const long = mortgagePayment(1_000_000, 3.5, 30);
  assert.ok(short > long);
  assert.ok(Math.abs(mortgagePayment(1_000_000, 0, 10) - 1_000_000 / 120) < 1e-6);
  assert.ok(Math.abs(mortgagePayment(100_000, 6, 30) - 599.5505251527569) < 1e-6);
  assert.equal(mortgagePayment(0, 3, 30), 0);
});

test('property off matches the pre-change success, sustainable spend, and reshuffle', () => {
  const returns = flat(120, 0);
  const plain = simulateRetirement(base(), returns);
  const flagged = simulateRetirement(base({ property: false }), returns);
  const disabled = simulateRetirement(base({ property: { enabled: false, priceWan: 1300 } }), returns);
  const emptyPrice = simulateRetirement(base({ property: buy({ priceWan: 0 }) }), returns);
  for (const sim of [plain, flagged, disabled, emptyPrice]) {
    assert.equal(sim.successRate, 1);
    assert.equal(sim.endBalance.p50, 960);
    assert.equal(sim.balanceAtRetire.p50, 1200);
    assert.deepEqual(sim.sustainableSpending, GOLDEN_SPEND);
    assert.equal(sim.monteCarlo.solventRate, 1);
    assert.deepEqual(sim.monteCarlo.sustainableSpending, {
      p10: 600.0000000000002,
      p50: 600.0000000000002
    });
    assert.equal(sim.property, undefined);
    assert.equal(sim.monteCarlo.propertyProbe, undefined);
    assert.equal(sim.propertyEquity, undefined);
  }
  assert.equal(JSON.stringify(plain.sustainableSpending), JSON.stringify(flagged.sustainableSpending));
  assert.equal(plain.monteCarlo.solventRate, flagged.monteCarlo.solventRate);
  const ledger = buildLifeLedger(base(), returns);
  assert.equal('down_real' in ledger.rows[0], false);
  assert.equal('housing_from_portfolio' in ledger.rows[0], false);
});

test('quote uses nominal price, default commission, and shows the age actually paid to', () => {
  const on = normalizePlan(base({
    annualSpending: 240000,
    endAge: 50,
    retireAge: 45,
    property: buy({ priceWan: 1300, ltvPct: 50, mortgageRatePct: 0, mortgageYears: 30, commissionWan: null })
  }));
  const prop = on.property;
  assert.equal(prop.price, 13_000_000);
  assert.equal(prop.loan, 6_500_000);
  assert.equal(prop.down, 6_500_000);
  assert.equal(prop.stamp, 487500);
  assert.equal(prop.commission, 130_000);
  assert.equal(prop.cashNominal, 6_500_000 + 130_000 + 487500);
  assert.ok(Math.abs(prop.nominalPmt - 6_500_000 / (30 * 12)) < 1e-6);
  assert.equal(prop.quote.paidToAge, 50);
  assert.equal(prop.quote.truncated, true);
  assert.equal(prop.quote.scheduledYears, 30);
  assert.match(prop.quote.paidToText, /供至 50 歲/);
  assert.match(prop.quote.paidToText, /原定 30 年/);
  assert.match(prop.quote.paidToText, /截斷/);
  const full = normalizePlan(base({
    endAge: 80,
    retireAge: 60,
    property: buy({ purchaseAge: 40, mortgageYears: 5, priceWan: 100 })
  }));
  assert.equal(full.property.quote.paidToAge, 45);
  assert.equal(full.property.quote.truncated, false);
  assert.doesNotMatch(full.property.quote.paidToText, /截斷/);
  const zeroCommission = normalizePlan(base({ property: buy({ priceWan: 100, commissionWan: 0 }) }));
  assert.equal(zeroCommission.property.commission, 0);
  const text = propertyQuoteText(prop, {
    money: n => String(Math.round(n)),
    pct: n => `${Math.round(n * 100)}%`
  });
  assert.match(text, /印花稅（估算）487500/);
  assert.match(text, /月供÷年支出/);
});

test('same-year lump sum is taken before the down payment', () => {
  const returns = flat(48, 0, 1);
  const cannot = simulateRetirement(base({
    currentAge: 40,
    retireAge: 44,
    endAge: 46,
    currentSavings: 1000,
    annualSpending: 0,
    lumpSums: [{ age: 42, amount: 600 }],
    property: buy({ purchaseAge: 42, priceWan: 0.04, ltvPct: 0, commissionWan: 0, mortgageYears: 5 })
  }), returns);
  assert.equal(cannot.property.cannotPurchaseRate, 1);
  assert.equal(cannot.property.purchasedPaths, 0);
  assert.equal(cannot.successRate, 1);
  assert.equal(cannot.endBalance.p50, 400);

  const factor = 2 ** (1 / 24);
  const inflated = simulateRetirement(base({
    currentAge: 40,
    retireAge: 44,
    endAge: 46,
    currentSavings: 800,
    annualSpending: 0,
    lumpSums: [{ age: 42, amount: 200 }],
    property: buy({ purchaseAge: 42, priceWan: 0.1, ltvPct: 0, commissionWan: 0, mortgageYears: 5 })
  }), flat(48, 0, factor));
  assert.equal(inflated.property.purchasedPaths, inflated.property.paths);
  const ledger = buildLifeLedger(inflated.plan, flat(48, 0, factor));
  const hit = ledger.rows.filter(row => row.bought === 1);
  assert.ok(hit.length >= 1);
  for (const row of hit) {
    assert.equal(row.k, 24);
    assert.ok(Math.abs(row.down_real - (1000 + 100) / 2) < 1e-4);
  }
});

test('cannot-purchase stays in the success denominator; rent changes only that housing cash flow', () => {
  const returns = flat(24, 0, 1);
  const common = {
    currentAge: 60,
    retireAge: 60,
    endAge: 62,
    currentSavings: 1000,
    annualSpending: 0,
    property: buy({ purchaseAge: 60, priceWan: 10000, ltvPct: 0, mortgageYears: 10 })
  };
  const off = simulateRetirement(base(common), returns);
  const on = simulateRetirement(base({
    ...common,
    property: buy({ purchaseAge: 60, priceWan: 10000, ltvPct: 0, mortgageYears: 10, rentIfCannot: true, rentMonthly: 10 })
  }), returns);
  assert.equal(off.property.cannotPurchaseRate, 1);
  assert.equal(off.property.paths, off.history.starts);
  assert.equal(off.successRate, 1);
  assert.equal(off.endBalance.p50, 1000);
  assert.equal(on.successRate, 1);
  assert.equal(on.endBalance.p50, 760);
  assert.equal(off.property.housingLabel, '不含住房開支');
  assert.equal(on.property.housingLabel, '已改計租金');
  assert.equal(off.property.warnCannotPurchase, true);
  const lines = propertyOverviewLines(off, { money: n => String(n) });
  assert.ok(lines.some(line => line.includes('已含置業現金流、未計樓淨值')));
  assert.ok(lines.some(line => line.includes('無法置業') && line.includes('不含住房開支')));
  assert.ok(lines.some(line => line.includes('無法置業比例偏高')));
  assert.ok(lines.some(line => line.includes('可花金額：含住房開支下的原計劃提領')));
  const rentLines = propertyOverviewLines(on, { money: n => String(n) });
  assert.ok(rentLines.some(line => line.includes('已改計租金')));
});

test('cannot-purchase warning uses 20% and still labels housing when the rate is lower', () => {
  function mixed(crashMonths) {
    const returns = flat(33, 0, 1).map((row, i) => ({ ...row, r: i < crashMonths ? -0.6 : 0 }));
    return simulateRetirement(base({
      currentAge: 40,
      retireAge: 41,
      endAge: 42,
      currentSavings: 1000,
      annualSpending: 0,
      property: buy({ purchaseAge: 41, priceWan: 0.05, ltvPct: 0, commissionWan: 0, mortgageYears: 5 })
    }), returns);
  }
  const at = mixed(2);
  const below = mixed(1);
  assert.equal(at.property.paths, 10);
  assert.equal(at.property.purchasedPaths, 8);
  assert.equal(at.property.cannotPurchaseRate, 0.2);
  assert.equal(at.property.warnCannotPurchase, true);
  assert.equal(below.property.cannotPurchaseRate, 0.1);
  assert.equal(below.property.warnCannotPurchase, false);
  const quiet = propertyOverviewLines(below, { money: n => String(n) });
  assert.ok(quiet.some(line => line.includes('不含住房開支')));
  assert.equal(quiet.some(line => line.includes('無法置業比例偏高')), false);
  assert.equal(at.successRate, 1);
});

test('post-purchase balance percentiles need 30 purchased paths', () => {
  const plan = base({
    currentAge: 60,
    retireAge: 61,
    endAge: 62,
    currentSavings: 2_000_000,
    annualSpending: 0,
    property: buy({ purchaseAge: 60, priceWan: 100, ltvPct: 0, commissionWan: 0, mortgageYears: 5 })
  });
  const cash = 1_000_000 + 100;
  const enough = simulateRetirement(plan, flat(53, 0, 1));
  const few = simulateRetirement(plan, flat(52, 0, 1));
  assert.equal(enough.property.purchasedPaths, 30);
  assert.equal(enough.property.postPurchase.p10, 2_000_000 - cash);
  assert.equal(enough.property.postPurchase.p50, 2_000_000 - cash);
  assert.equal(enough.property.postPurchaseNote, null);
  assert.equal(few.property.purchasedPaths, 29);
  assert.equal(few.property.postPurchase, null);
  assert.equal(few.property.postPurchaseNote, '樣本不足');
  const lines = propertyOverviewLines(few, { money: n => String(n) });
  assert.ok(lines.some(line => line.includes('樣本不足')));
  assert.equal(lines.some(line => line.includes('無法置業比例偏高')), false);
});

test('sustainable spend is the planned withdrawal after housing, and does not rise when property turns on', () => {
  const returns = flat(24, 0, 1);
  const offPlan = base({
    currentAge: 60,
    retireAge: 60,
    endAge: 62,
    currentSavings: 1_000_000,
    annualSpending: 12000
  });
  const onPlan = base({
    ...offPlan,
    property: buy({
      purchaseAge: 60,
      priceWan: 100,
      ltvPct: 50,
      commissionWan: 0,
      mortgageRatePct: 0,
      mortgageYears: 10,
      holdingMonthly: 0
    })
  });
  const off = simulateRetirement(offPlan, returns);
  const on = simulateRetirement(onPlan, returns);
  for (const key of ['p100', 'p95', 'p90', 'p50']) {
    assert.ok(on.sustainableSpending[key] <= off.sustainableSpending[key]);
  }
  assert.ok(on.sustainableSpending.p50 < off.sustainableSpending.p50);
  const prop = on.plan.property;
  const housing = prop.nominalPmt * 24;
  const expected = (1_000_000 - prop.cashNominal - housing) / 2;
  assert.ok(Math.abs(on.sustainableSpending.p50 - expected) < 1e-4);
  const ledger = buildLifeLedger(on.plan, returns);
  const withdrawn = ledger.rows.reduce((sum, row) => sum + row.withdrawal, 0);
  assert.equal(withdrawn, 24000);
  const housingPaid = ledger.rows.reduce((sum, row) => sum + row.housing_from_portfolio, 0);
  assert.ok(Math.abs(housingPaid - housing) < 1e-4);
});

test('mortgage and holding switch at the retirement month; accumulation does not touch the portfolio', () => {
  const returns = flat(48, 0, 1);
  const plan = base({
    currentAge: 40,
    retireAge: 42,
    endAge: 44,
    currentSavings: 5_000_000,
    annualSpending: 0,
    property: buy({
      purchaseAge: 40,
      priceWan: 400,
      ltvPct: 50,
      commissionWan: 0,
      mortgageRatePct: 0,
      mortgageYears: 10,
      holdingMonthly: 80
    })
  });
  const sim = simulateRetirement(plan, returns);
  const ledger = buildLifeLedger(plan, returns);
  const pmt = sim.plan.property.nominalPmt;
  assert.equal(sim.balanceAtRetire.p50, 5_000_000 - sim.plan.property.cashNominal);
  for (const row of ledger.rows) {
    assert.equal(row.holding_real, 80);
    assert.ok(Math.abs(row.mortgage_real - pmt) < 1e-6);
    if (row.k < 24) assert.equal(row.housing_from_portfolio, 0);
    else assert.ok(Math.abs(row.housing_from_portfolio - (pmt + 80)) < 1e-6);
  }
  const crossed = simulateRetirement(base({
    currentAge: 40,
    retireAge: 42,
    endAge: 44,
    currentSavings: 5_000_000,
    annualSpending: 0,
    property: buy({ purchaseAge: 41, priceWan: 100, ltvPct: 50, commissionWan: 0, mortgageYears: 2, holdingMonthly: 0 })
  }), returns);
  const rows = buildLifeLedger(crossed.plan, returns).rows;
  const pmt2 = crossed.plan.property.nominalPmt;
  for (const row of rows) {
    if (row.k < 12) assert.equal(row.mortgage_real, 0);
    else if (row.k < 36) assert.ok(Math.abs(row.mortgage_real - pmt2) < 1e-6);
    else assert.equal(row.mortgage_real, 0);
    if (row.k < 24) assert.equal(row.housing_from_portfolio, 0);
    else if (row.k < 36) assert.ok(Math.abs(row.housing_from_portfolio - pmt2) < 1e-6);
    else assert.equal(row.housing_from_portfolio, 0);
  }
});

test('real mortgage follows path inflation, while holding and rent stay in today dollars', () => {
  function retired(g, extra = {}) {
    const plan = base({
      currentAge: 60,
      retireAge: 60,
      endAge: 62,
      currentSavings: 5_000_000,
      annualSpending: 0,
      property: buy({
        purchaseAge: 60,
        priceWan: 100,
        ltvPct: 50,
        commissionWan: 0,
        mortgageRatePct: 0,
        mortgageYears: 10,
        holdingMonthly: 80,
        ...extra
      })
    });
    const ledger = buildLifeLedger(plan, flat(24, 0, g));
    return { plan: normalizePlan(plan), rows: ledger.rows.filter(row => row.start_month === ledger.rows[0].start_month) };
  }
  const nominal = retired(1).plan.property.nominalPmt;
  for (const g of [1, 1.01, 0.99]) {
    const { rows } = retired(g);
    rows.forEach((row, k) => {
      assert.ok(Math.abs(row.mortgage_real - nominal / (g ** k)) < 1e-4, `${g} @ ${k}`);
      assert.equal(row.holding_real, 80);
      assert.ok(Math.abs(row.housing_from_portfolio - (row.mortgage_real + 80)) < 1e-4);
    });
  }
  const rent = retired(1.02, { priceWan: 10000, ltvPct: 0, rentIfCannot: true, rentMonthly: 25, holdingMonthly: 80 });
  for (const row of rent.rows) {
    assert.equal(row.rent_real, 25);
    assert.equal(row.holding_real, 0);
    assert.equal(row.mortgage_real, 0);
    assert.equal(row.housing_from_portfolio, 25);
  }
  const hi = retired(1.02);
  const lo = retired(1);
  const sum = rows => rows.reduce((s, row) => s + row.mortgage_real, 0);
  assert.ok(sum(hi.rows) < sum(lo.rows));
  const hiLedger = buildLifeLedger(hi.plan, flat(24, 0, 1.02));
  const loLedger = buildLifeLedger(lo.plan, flat(24, 0, 1));
  assert.ok(hiLedger.paths[0].max_spending > loLedger.paths[0].max_spending);
  assert.equal(hi.plan.annualSpending, lo.plan.annualSpending);
});

test('two historical paths keep one planned withdrawal and deflate housing on their own inflation', () => {
  const returns = flat(25, 0, i => (i < 12 ? 1.03 : 1));
  const plan = base({
    currentAge: 60,
    retireAge: 60,
    endAge: 62,
    currentSavings: 5_000_000,
    annualSpending: 24000,
    property: buy({ purchaseAge: 60, priceWan: 100, ltvPct: 50, commissionWan: 0, mortgageYears: 10, holdingMonthly: 0 })
  });
  const ledger = buildLifeLedger(plan, returns);
  const byStart = new Map();
  for (const row of ledger.rows) {
    if (!byStart.has(row.start_month)) byStart.set(row.start_month, []);
    byStart.get(row.start_month).push(row);
  }
  assert.equal(byStart.size, 2);
  const sums = [...byStart.values()].map(rows => rows.reduce((s, row) => s + row.mortgage_real, 0));
  assert.ok(Math.abs(sums[0] - sums[1]) > 1);
  const spends = ledger.paths.map(path => path.max_spending);
  assert.ok(Math.abs(spends[0] - spends[1]) > 1);
  const richer = spends[0] > spends[1] ? 0 : 1;
  const cheaperHousing = sums[0] < sums[1] ? 0 : 1;
  assert.equal(richer, cheaperHousing);
  for (const rows of byStart.values()) assert.ok(rows.every(row => row.k === 0 || row.bought === 0));
  assert.ok([...byStart.values()].every(rows => rows.some(row => row.bought === 1 && row.k === 0)));
});

test('purchase age stays on the life timeline when history or reshuffle replaces paired returns', () => {
  const returns = flat(40, 0, i => 1 + (i + 1) / 1000);
  const plan = base({
    currentAge: 40,
    retireAge: 41,
    endAge: 42,
    currentSavings: 5_000_000,
    annualSpending: 0,
    property: buy({ purchaseAge: 41, priceWan: 100, ltvPct: 0, commissionWan: 0, mortgageYears: 5 })
  });
  const ledger = buildLifeLedger(plan, returns);
  const hits = ledger.rows.filter(row => row.bought === 1);
  assert.ok(hits.length > 1);
  const months = new Set(hits.map(row => row.return_month));
  assert.ok(months.size > 1);
  for (const row of hits) assert.equal(row.k, 12);

  const reshuffleReturns = flat(120, 0, i => 1 + (i + 1) / 1000);
  const long = base({
    currentAge: 40,
    retireAge: 42,
    endAge: 43,
    currentSavings: 5_000_000,
    annualSpending: 0,
    reshuffleSeed: 1,
    property: buy({ purchaseAge: 42, priceWan: 100, ltvPct: 0, commissionWan: 0, mortgageYears: 5 })
  });
  const sim = simulateRetirement(long, reshuffleReturns);
  const indices = drawReshuffleIndices(120, sim.monteCarlo.blockMonths, 1, 36);
  let level = 1;
  for (let k = 0; k < 24; k++) level *= reshuffleReturns[indices[k]].inflation;
  assert.ok(Math.abs(sim.monteCarlo.propertyProbe.priceLevel - level) < 1e-8);
  let chronological = 1;
  for (let k = 0; k < 24; k++) chronological *= reshuffleReturns[k].inflation;
  assert.ok(Math.abs(level - chronological) > 1e-6);
  assert.equal(sim.monteCarlo.propertyProbe.purchased, true);
  const off = simulateRetirement(base({
    currentAge: 40,
    retireAge: 42,
    endAge: 43,
    currentSavings: 5_000_000,
    annualSpending: 0
  }), reshuffleReturns);
  assert.equal(off.monteCarlo.solventRate, sim.monteCarlo.solventRate);
});

test('glide paths deflate the down payment with the paired sleeve inflation', () => {
  const returns = flat(24, 0, 1);
  const inflation = Float64Array.from({ length: 24 }, () => 1.05);
  const glide = {
    equityR: new Float64Array(24),
    restR: new Float64Array(24),
    inflation,
    feeFactor: 1,
    startEquity: 0.6,
    endEquity: 0.6
  };
  const plan = base({
    currentAge: 60,
    retireAge: 61,
    endAge: 62,
    currentSavings: 5_000_000,
    annualSpending: 0,
    glidePath: true,
    property: buy({ purchaseAge: 61, priceWan: 100, ltvPct: 0, commissionWan: 0, mortgageYears: 5 })
  });
  const ledger = buildLifeLedger(plan, returns, null, glide);
  const hit = ledger.rows.find(row => row.bought === 1);
  assert.equal(hit.k, 12);
  const cash = normalizePlan(plan).property.cashNominal;
  assert.ok(Math.abs(hit.down_real - cash / (1.05 ** 12)) < 1e-4);
  assert.ok(Math.abs(hit.down_real - cash) > 1);
});

test('portfolio bands stay the portfolio; real monthly returns keep inflation beside an unchanged real return', () => {
  const equity = [['2000-01-31', 100], ['2000-02-28', 110], ['2000-03-31', 121]];
  const cpi = [['2000-01-31', 100], ['2000-02-28', 110], ['2000-03-31', 121]];
  const { returns } = realMonthlyReturns(equity, { inflationMode: 'cpi', inflationRate: 0, feeRate: 0 }, cpi);
  assert.equal(returns[0].inflation, 1.1);
  assert.ok(Math.abs(returns[0].r) < 1e-12);

  const off = simulateRetirement(base({
    currentAge: 60, retireAge: 61, endAge: 62, currentSavings: 1_000_000, annualSpending: 0
  }), flat(36, 0, 1));
  const on = simulateRetirement(base({
    currentAge: 60, retireAge: 61, endAge: 62, currentSavings: 1_000_000, annualSpending: 0,
    property: buy({ purchaseAge: 60, priceWan: 20, ltvPct: 0, commissionWan: 0, mortgageYears: 5 })
  }), flat(36, 0, 1));
  assert.ok(on.bands[1].p50 < off.bands[1].p50);
  assert.equal(on.propertyEquity, undefined);
  assert.equal(on.bands[1].property, undefined);
});
